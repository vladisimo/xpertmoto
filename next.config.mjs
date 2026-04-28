import { withSentryConfig } from "@sentry/nextjs";

/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== "production";

// Next.js dev server compiles modules with `eval` for fast HMR, and the
// React Refresh runtime evaluates fresh code on every hot update. Both
// trip `script-src` without 'unsafe-eval'. Production builds emit only
// regular <script> tags so we drop it there.
const scriptSrc = [
  "'self'",
  "'unsafe-inline'",
  isDev ? "'unsafe-eval'" : null,
  "https://js.stripe.com",
]
  .filter(Boolean)
  .join(" ");

// 'unsafe-inline' on script-src is temporary: Next 16 App Router still
// ships inline hydration scripts without nonce propagation. A later
// security tier adds a middleware.ts that issues per-request nonces and
// tightens to strict-dynamic. Shipping report-only here first so we see
// real violations before enforcing.
const cspDirectives = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.s3.ap-southeast-2.amazonaws.com https://files.stripe.com https://*.googleusercontent.com",
  "font-src 'self' data:",
  `connect-src 'self' https://api.stripe.com https://*.ingest.sentry.io${
    process.env.NEXT_PUBLIC_MAP_STYLE_URL
      ? ""
      : " https://demotiles.maplibre.org"
  }`,
  "frame-src https://js.stripe.com https://hooks.stripe.com",
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
      { protocol: "https", hostname: "www.scootering.com.au" },
      { protocol: "https", hostname: "scootering.com.au" },
      { protocol: "https", hostname: "files.stripe.com" },
      { protocol: "https", hostname: "*.googleusercontent.com" },
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
  disableLogger: true,
  hideSourceMaps: true,
  widenClientFileUpload: true,
  reactComponentAnnotation: { enabled: false },
  tunnelRoute: "/monitoring",
};

export default process.env.SENTRY_DSN
  ? withSentryConfig(nextConfig, sentryBuildOptions)
  : nextConfig;
