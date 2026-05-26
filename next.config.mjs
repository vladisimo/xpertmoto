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
// tightens to strict-dynamic. Shipping report-only here first so we see
// real violations before enforcing.
const imgSrc = [
  "'self'",
  "data:",
  "blob:",
  "https://*.s3.ap-southeast-2.amazonaws.com",
  "https://files.stripe.com",
  "https://*.googleusercontent.com",
  storageOrigin ? storageOrigin.origin : null,
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
  `connect-src 'self' https://api.stripe.com https://*.ingest.sentry.io https://*.i.posthog.com${
    process.env.NEXT_PUBLIC_MAP_STYLE_URL
      ? ""
      : " https://demotiles.maplibre.org"
  }`,
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
  { key: "Content-Security-Policy-Report-Only", value: cspDirectives },
];

const nextConfig = {
  // Lets the e2e dev server (NEXT_DIST_DIR=.next-e2e) run from its own build
  // dir, coexisting with a normal `next dev` on the dev DB (Next refuses two
  // dev servers sharing one build dir).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  poweredByHeader: false,
  devIndicators: false,
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
