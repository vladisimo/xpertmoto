# syntax=docker/dockerfile:1.6

FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

# -------- dev target: mounts source, installs on start --------
FROM base AS dev
ENV NODE_ENV=development
EXPOSE 3000
CMD ["npm", "run", "dev"]

# -------- deps: lockfile-based install for production image --------
FROM base AS deps
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci
RUN npx prisma generate

# -------- geolite: downloads MaxMind GeoLite2-City.mmdb for visitor geo --------
# Build with: --secret id=maxmind_license,src=./maxmind.key to inject the key
# without baking it into image history. Missing secret → empty /data and
# runtime falls back to geo-disabled (country/region/city stay null).
FROM base AS geolite
RUN apk add --no-cache curl tar
WORKDIR /data
RUN --mount=type=secret,id=maxmind_license \
    if [ -s /run/secrets/maxmind_license ]; then \
      KEY=$(cat /run/secrets/maxmind_license) && \
      curl -sSL -o /tmp/db.tar.gz "https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City&license_key=${KEY}&suffix=tar.gz" && \
      tar -xzf /tmp/db.tar.gz -C /tmp && \
      find /tmp -name "GeoLite2-City.mmdb" -exec mv {} /data/GeoLite2-City.mmdb \; && \
      rm -rf /tmp/db.tar.gz; \
    else \
      echo "maxmind_license secret not provided; skipping mmdb download"; \
    fi

# -------- builder: compile next app --------
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# -------- runner: lean production image for next app --------
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/prisma ./prisma
COPY --from=geolite /data ./data
ENV MAXMIND_DB_PATH=/app/data/GeoLite2-City.mmdb
USER nextjs
EXPOSE 3000
# Apply pending migrations before serving traffic — fail-fast on schema
# drift instead of P20xx errors on the first request. The worker image
# deliberately does NOT migrate (single writer: the app container); start
# the worker after the app is healthy. `exec` replaces sh so SIGTERM
# reaches the node process and graceful shutdown still runs.
CMD ["sh", "-c", "npx prisma migrate deploy && exec npm run start"]

# -------- worker: BullMQ background process --------
FROM base AS worker
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/src ./src
COPY --from=builder --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json
COPY --from=geolite --chown=nextjs:nodejs /data ./data
ENV MAXMIND_DB_PATH=/app/data/GeoLite2-City.mmdb
USER nextjs
# Worker liveness: src/server/jobs/worker.ts serves /health (Redis PING +
# registered-worker count). A worker that lost Redis or idles with zero
# queues silently stops all background processing — restart it instead.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.WORKER_HEALTH_PORT||8786)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "run", "worker"]
