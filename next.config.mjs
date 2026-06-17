import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== "production";

// Object-storage origin (S3/MinIO) for CSP img-src and next/image
// remotePatterns. Parsed from S3_PUBLIC_URL (preferred) or S3_ENDPOINT so
// the allow-lists track the configured bucket host without a code edit.
// A misconfigured prod host that still points at localhost will be visible
// here in the rendered CSP rather than only as failed image loads.
function parseStorageOrigin(raw) {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return { protocol: u.protocol.replace(":", ""), hostname: u.hostname, origin: u.origin };
  } catch {
    return null;
  }
}
const storageOrigin =
  parseStorageOrigin(process.env.S3_PUBLIC_URL) ??
  parseStorageOrigin(process.env.S3_ENDPOINT);

// MapLibre basemap origin for CSP. The interactive back-office maps fetch the
// style JSON, vector tiles, glyphs and sprite from the provider over
// `connect-src`. Derive the origin from NEXT_PUBLIC_MAP_STYLE_URL so swapping
// providers (OpenFreeMap → MapTiler / Stadia / Protomaps) stays a pure env
// change. Falls back to OpenFreeMap's host, which matches the code default in
// src/lib/maps/style.ts. Providers co-locate style + tiles + glyphs + sprite
// on this origin; split-host providers would need their tile host added too.
const mapTileOrigin =
  parseStorageOrigin(process.env.NEXT_PUBLIC_MAP_STYLE_URL)?.origin ??
  "https://tiles.openfreemap.org";

// CSP img-src must not allow plaintext http for a remote storage host
// (mixed content on an https page). Upgrade the storage origin's scheme to
// https for any non-local host so a misconfigured `S3_PUBLIC_URL` (e.g.
// http://) can't open a mixed-content hole; dev MinIO on localhost stays
// http so local images keep loading. The real fix is to set S3_PUBLIC_URL
// to an https:// URL — this is belt-and-braces.
function cspStorageImgSrc(origin) {
  if (!origin) return null;
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(origin.hostname);
  if (isLocal || origin.protocol === "https") return origin.origin;
  return origin.origin.replace(/^http:\/\//, "https://");
}

// Next.js dev server compiles modules with `eval` for fast HMR, and the
// React Refresh runtime evaluates fresh code on every hot update. Both
// trip `script-src` without 'unsafe-eval'. Production builds emit only
// regular <script> tags so we drop it there.
const scriptSrc = [
  "'self'",
  "'unsafe-inline'",
  isDev ? "'unsafe-eval'" : null,
  "https://js.stripe.com",
  // PostHog snippet loads array.js from <region>-assets.i.posthog.com.
  "https://*.i.posthog.com",
]
  .filter(Boolean)
  .join(" ");

// 'unsafe-inline' on script-src is temporary: Next 16 App Router still
// ships inline hydration scripts without nonce propagation. A later
// security tier adds a middleware.ts that issues per-request nonces and
// tightens to strict-dynamic, which is what lets us finally drop
// 'unsafe-inline'. This policy is now ENFORCED (not report-only): with all
// third parties enumerated below it hardens object-src/frame-ancestors/
// base-uri/form-action today, while `report-uri` keeps surfacing any
// violation at /api/csp-report so regressions stay visible.
const imgSrc = [
  "'self'",
  "data:",
  "blob:",
  "https://*.s3.ap-southeast-2.amazonaws.com",
  "https://files.stripe.com",
  "https://*.googleusercontent.com",
  cspStorageImgSrc(storageOrigin),
]
  .filter(Boolean)
  .join(" ");

const cspDirectives = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src ${imgSrc}`,
  "font-src 'self' data:",
  // *.i.posthog.com covers both event ingestion (us.i.posthog.com) and the
  // static asset host (us-assets.i.posthog.com), plus the EU region.
  // mapTileOrigin allows the MapLibre basemap provider (style + tiles + glyphs
  // + sprite all fetch over connect-src).
  `connect-src 'self' https://api.stripe.com https://*.ingest.sentry.io https://*.i.posthog.com ${mapTileOrigin}`,
  // MapLibre GL parses vector tiles in a web worker created from a blob: URL.
  // Without an explicit worker-src it falls back to script-src (no blob:) and
  // the worker is blocked, so the map never renders tiles.
  "worker-src 'self' blob:",
  // www.google.com hosts the Google Maps embed iframes (public depot map).
  "frame-src https://js.stripe.com https://hooks.stripe.com https://www.google.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "report-uri /api/csp-report",
].join("; ");

const securityHeaders = [
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
  // Cross-origin isolation. `same-origin-allow-popups` isolates this window
  // from cross-origin openers while keeping popup-based flows (Stripe 3DS,
  // OAuth popups) working; full `same-origin` would sever those. COEP is
  // intentionally omitted — it would block Stripe.js / PostHog cross-origin
  // embeds.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "Content-Security-Policy", value: cspDirectives },
];

const nextConfig = {
  // Lets the e2e dev server (NEXT_DIST_DIR=.next-e2e) run from its own build
  // dir, coexisting with a normal `next dev` on the dev DB (Next refuses two
  // dev servers sharing one build dir).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
  // LOADTEST_BUILD=1 skips lint/type checking during `next build` for the
  // perf-measurement build only (the repo's lint/tsc baseline is red — see
  // project_lint_baseline_red memory). Never set in normal/CI builds; has no
  // runtime effect. Used by docker-compose.loadtest.yml / .env.loadtest.
  ...(process.env.LOADTEST_BUILD === "1"
    ? {
        eslint: { ignoreDuringBuilds: true },
        typescript: { ignoreBuildErrors: true },
      }
    : {}),
  allowedDevOrigins: ["xpertmoto.dfortix.ai", "192.168.0.42"],
  turbopack: {
    root: import.meta.dirname,
  },
  cacheComponents: true,
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "@radix-ui/react-icons",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-popover",
      "@radix-ui/react-select",
      "@radix-ui/react-tabs",
      "@radix-ui/react-toast",
      "recharts",
      "date-fns",
      "@fullcalendar/react",
    ],
  },
  serverExternalPackages: [
    "playwright",
    "playwright-core",
    "bullmq",
    "ioredis",
    "@react-pdf/renderer",
    "nodemailer",
    "twilio",
    "resend",
    "@aws-sdk/client-s3",
    "@aws-sdk/s3-request-presigner",
    "pino",
    "pino-pretty",
    "pdf-to-png-converter",
    "@napi-rs/canvas",
    "pdfjs-dist",
  ],
  images: {
    // Narrowly scoped to our S3 region — prevents Next's image optimiser
    // from acting as an open proxy against any AWS-hosted content. Update
    // the region pattern if the primary bucket moves.
    remotePatterns: [
      { protocol: "http", hostname: "localhost" },
      { protocol: "https", hostname: "*.s3.ap-southeast-2.amazonaws.com" },
      { protocol: "https", hostname: "s3.ap-southeast-2.amazonaws.com" },
      { protocol: "https", hostname: "www.xpertmoto.com.au" },
      { protocol: "https", hostname: "xpertmoto.com.au" },
      { protocol: "https", hostname: "files.stripe.com" },
      { protocol: "https", hostname: "*.googleusercontent.com" },
      ...(storageOrigin
        ? [{ protocol: storageOrigin.protocol, hostname: storageOrigin.hostname }]
        : []),
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    return [
      // RFC 9116 security.txt. Served by a route handler (reads branding for
      // the contact address) rather than a static file; the rewrite avoids
      // the leading-dot app-folder ambiguity for `.well-known`.
      {
        source: "/.well-known/security.txt",
        destination: "/api/well-known/security-txt",
      },
    ];
  },
  webpack: (config) => {
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      { module: /@opentelemetry\/instrumentation/ },
      { module: /@prisma\/instrumentation/ },
    ];
    return config;
  },
};

const sentryBuildOptions = {
  silent: !process.env.CI,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  hideSourceMaps: true,
  // Delete client source maps from .next/static after they're uploaded to
  // Sentry so the original source isn't downloadable from production
  // (the .map files were publicly reachable). Server maps in .next/server
  // are kept (needed for runtime symbolication; not publicly served).
  // Only triggers when the upload runs — i.e. SENTRY_AUTH_TOKEN is set at
  // build time; otherwise lock .map down at the edge.
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring",
  webpack: {
    // disableLogger → webpack.treeshake.removeDebugLogging (Sentry SDK move)
    treeshake: { removeDebugLogging: true },
    // reactComponentAnnotation → webpack.reactComponentAnnotation
    reactComponentAnnotation: { enabled: false },
  },
};

export default process.env.SENTRY_DSN
  ? withSentryConfig(nextConfig, sentryBuildOptions)
  : nextConfig;
