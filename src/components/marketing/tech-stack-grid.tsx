import { DividedTitle } from "@/components/marketing/divided-title";

interface StackItem {
  /** Tech name with its major version inline, e.g. "Next.js 16". */
  name: string;
  role: string;
}

interface StackLayer {
  layer: string;
  items: StackItem[];
}

// What the platform is built with, grouped by layer. Major versions only
// (matching the CLAUDE.md "Next.js 16 · React 19" style) so the copy doesn't
// churn on patch bumps. Distinct from the IntegrationsGrid, which lists the
// external services the platform connects to — some overlap is fine.
const STACK: StackLayer[] = [
  {
    layer: "Framework & runtime",
    items: [
      { name: "Next.js 16", role: "App Router, React Server Components, server actions" },
      { name: "React 19", role: "Component model across public, customer and back-office apps" },
      { name: "TypeScript 5", role: "Strict mode end to end — no untyped code" },
      { name: "Node.js 20", role: "Server runtime for API, jobs and rendering" },
    ],
  },
  {
    layer: "API & data layer",
    items: [
      { name: "tRPC v11", role: "44 typed routers — end-to-end type safety, no hand-written API client" },
      { name: "TanStack Query v5", role: "Client caching, optimistic updates and background refetch" },
      { name: "Zod 3", role: "Runtime validation of every external input" },
      { name: "superjson", role: "Lossless Date and Decimal transport across the wire" },
    ],
  },
  {
    layer: "Database & ORM",
    items: [
      { name: "Prisma 5", role: "Typed ORM over 117 models and 62 tracked migrations" },
      { name: "PostgreSQL 16", role: "System of record for bookings, fleet, invoices and audit log" },
    ],
  },
  {
    layer: "Auth & security",
    items: [
      { name: "NextAuth v5", role: "Sessions, OAuth providers and magic-link sign-in" },
      { name: "TOTP two-factor", role: "Mandatory authenticator-app 2FA for back-office logins" },
      { name: "bcrypt", role: "Salted password hashing — no plaintext credentials stored" },
    ],
  },
  {
    layer: "UI & styling",
    items: [
      { name: "Tailwind CSS 3", role: "Utility-first styling on a shared semantic-token theme" },
      { name: "shadcn/ui on Radix", role: "Accessible component primitives with full keyboard nav" },
      { name: "lucide-react", role: "Consistent icon set across every surface" },
      { name: "cva + tailwind-merge", role: "Type-safe component variants without class conflicts" },
    ],
  },
  {
    layer: "Forms & state",
    items: [
      { name: "react-hook-form 7", role: "Performant forms with Zod-resolver validation" },
      { name: "Zustand 5", role: "Lightweight client state for the few stateful flows" },
    ],
  },
  {
    layer: "Background jobs & cache",
    items: [
      { name: "BullMQ 5", role: "Cron workers for reminders, overdue detection and nightly recomputes" },
      { name: "Redis 7 (ioredis)", role: "Availability and pricing caches plus the job queue" },
    ],
  },
  {
    layer: "Payments",
    items: [
      { name: "Stripe", role: "Card payments, refunds and held bonds (PaymentIntent authorisations) — PCI-DSS, no raw PAN" },
    ],
  },
  {
    layer: "Email & messaging",
    items: [
      { name: "React Email + Resend", role: "27 branded, GST-compliant transactional templates" },
      { name: "Twilio", role: "SMS confirmations, reminders and overdue alerts" },
      { name: "Web Push (VAPID)", role: "Browser push for staff tasks and customer updates" },
      { name: "nodemailer", role: "SMTP fallback when the primary email path is unavailable" },
    ],
  },
  {
    layer: "AI",
    items: [
      { name: "Anthropic Claude SDK", role: "Support assistant, plain-English analytics and licence OCR" },
    ],
  },
  {
    layer: "Documents & media",
    items: [
      { name: "@react-pdf/renderer", role: "GST/ABN invoices and signed rental agreements" },
      { name: "pdf-to-png-converter", role: "Rasterised previews of generated documents" },
      { name: "sharp", role: "Server-side image resizing and optimisation" },
      { name: "TipTap", role: "Rich-text editing for templates and notes" },
    ],
  },
  {
    layer: "Maps & geo",
    items: [
      { name: "MapLibre GL + react-map-gl", role: "Depot maps and location pickers on MapTiler tiles" },
      { name: "MaxMind GeoIP", role: "Nearest-depot suggestions and fraud signals from IP" },
    ],
  },
  {
    layer: "Scheduling & DnD",
    items: [
      { name: "FullCalendar 6", role: "Booking and maintenance calendars in the back office" },
      { name: "@dnd-kit", role: "Drag-and-drop for fleet allocation and ordering" },
    ],
  },
  {
    layer: "Analytics & charts",
    items: [
      { name: "PostHog", role: "Privacy-aware product analytics and conversion funnels" },
      { name: "Recharts", role: "Finance and fleet dashboards" },
    ],
  },
  {
    layer: "Observability & logging",
    items: [
      { name: "Sentry", role: "Error and performance monitoring across server, edge and browser" },
      { name: "Pino", role: "Structured logs with built-in PII redaction" },
    ],
  },
  {
    layer: "Object storage",
    items: [
      { name: "AWS S3 SDK", role: "Licence photos, signed agreements and PDFs (MinIO in dev)" },
    ],
  },
  {
    layer: "Testing & QA",
    items: [
      { name: "Vitest 4 + MSW", role: "Unit and integration tests with mocked network" },
      { name: "Testing Library", role: "Component tests that assert on what users see" },
      { name: "Playwright", role: "E2E coverage of auth, booking, payments, staff and admin" },
    ],
  },
  {
    layer: "Local infrastructure",
    items: [
      { name: "Docker Compose", role: "Postgres 16, Redis 7, MinIO (S3) and Mailpit for dev parity" },
    ],
  },
];

export function TechStackGrid({ siteName }: { siteName: string }) {
  return (
    <section className="space-y-4">
      <DividedTitle>Built on a modern, typed stack</DividedTitle>
      <p className="text-sm text-muted-foreground">
        {siteName} is built end to end in TypeScript on a current, well-supported
        foundation. Here is every layer of the engineering stack and what it does.
      </p>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {STACK.map((layer) => (
          <li
            key={layer.layer}
            className="flex flex-col rounded-md border border-border bg-card p-5"
          >
            <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
              {layer.layer}
            </h3>
            <ul className="mt-3 space-y-2 divide-y divide-border">
              {layer.items.map((item) => (
                <li key={item.name} className="pt-2 first:pt-0">
                  <p className="text-sm font-medium text-foreground">{item.name}</p>
                  <p className="text-xs text-muted-foreground">{item.role}</p>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
