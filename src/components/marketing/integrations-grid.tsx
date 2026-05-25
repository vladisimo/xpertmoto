import Image from "next/image";
import { BellRing, Globe2, Milestone, Route, type LucideIcon } from "lucide-react";
import { DividedTitle } from "@/components/marketing/divided-title";

interface Integration {
  name: string;
  category: string;
  blurb: string;
  /** Vendor logo under /public/brand/integrations. Omit to use `icon`. */
  logo?: string;
  /** Fallback glyph for integrations that have no vendor logo. */
  icon?: LucideIcon;
}

// What each third-party service does inside the platform. Logos live in
// /public/brand/integrations (official marks); the pieces without a vendor
// logo (toll accounts, MaxMind, Web Push) fall back to a lucide glyph.
const INTEGRATIONS: Integration[] = [
  // Payments & finance
  {
    name: "Stripe",
    category: "Payments",
    logo: "/brand/integrations/stripe.svg",
    blurb:
      "Card payments, refunds and held security bonds (PaymentIntent authorisations). Raw card data never touches our servers.",
  },
  {
    name: "Xero",
    category: "Accounting",
    logo: "/brand/integrations/xero.svg",
    blurb:
      "OAuth-connected sync that pushes GST-itemised invoices and customer contacts into Xero for reconciliation, with nightly catch-up.",
  },
  // Toll & infringement accounts
  {
    name: "Linkt",
    category: "Toll accounts",
    icon: Route,
    blurb:
      "Pulls trip statements from a Linkt (Transurban) business account and matches each toll to the booking that was on the road at the time.",
  },
  {
    name: "E-Toll NSW",
    category: "Toll accounts",
    icon: Milestone,
    blurb:
      "Imports NSW E-Toll activity exports and reconciles every gantry crossing against the active hire for accurate rebilling.",
  },
  // Messaging & email
  {
    name: "Twilio",
    category: "Messaging",
    logo: "/brand/integrations/twilio.svg",
    blurb:
      "SMS booking confirmations, pickup reminders and overdue-return alerts, with per-message delivery tracking.",
  },
  {
    name: "Resend",
    category: "Email",
    logo: "/brand/integrations/resend.svg",
    blurb:
      "Branded, GST-compliant booking and invoice emails from our React Email templates, with an SMTP fallback.",
  },
  // AI
  {
    name: "Anthropic Claude",
    category: "AI",
    logo: "/brand/integrations/claude.svg",
    blurb:
      "Powers the customer-support assistant and the plain-English analytics summaries in the back office.",
  },
  {
    name: "OpenAI",
    category: "Document AI",
    logo: "/brand/integrations/openai.svg",
    blurb:
      "Reads uploaded driver licences and identity documents to extract and structure their details for staff review.",
  },
  // Sign-in / identity
  {
    name: "Google",
    category: "Sign-in",
    logo: "/brand/integrations/google.svg",
    blurb:
      "One-tap sign-in with a Google or Workspace account, auto-linked to existing customer records once the email is verified.",
  },
  {
    name: "Microsoft",
    category: "Sign-in",
    logo: "/brand/integrations/microsoft.svg",
    blurb:
      "Microsoft Entra ID sign-in covering Outlook, Hotmail, Live and work/school accounts, with verified-email account linking.",
  },
  {
    name: "Apple",
    category: "Sign-in",
    logo: "/brand/integrations/apple.svg",
    blurb:
      "Sign in with Apple, including its private-relay addresses, for customers who would rather not share a personal email.",
  },
  {
    name: "GitHub",
    category: "Sign-in",
    logo: "/brand/integrations/github.svg",
    blurb:
      "GitHub OAuth sign-in, used mainly by internal and partner accounts. Back-office logins still enforce TOTP after the handshake.",
  },
  // Data & infrastructure
  {
    name: "PostgreSQL",
    category: "Database",
    logo: "/brand/integrations/postgresql.svg",
    blurb:
      "The system of record for every booking, vehicle, customer, invoice and audit-log entry.",
  },
  {
    name: "Redis",
    category: "Cache & queue",
    logo: "/brand/integrations/redis.svg",
    blurb:
      "Availability and pricing caches plus the BullMQ job queue behind reminders, overdue detection and nightly recomputes.",
  },
  {
    name: "Amazon S3 / MinIO",
    category: "Object storage",
    logo: "/brand/integrations/minio.svg",
    blurb:
      "Secure storage for licence photos, signed rental agreements and generated PDFs — S3-compatible, with MinIO in development.",
  },
  // Observability
  {
    name: "Sentry",
    category: "Monitoring",
    logo: "/brand/integrations/sentry.svg",
    blurb:
      "Real-time error and performance monitoring across the server, edge and browser, surfaced in the admin observability tab.",
  },
  {
    name: "PostHog",
    category: "Analytics",
    logo: "/brand/integrations/posthog.svg",
    blurb:
      "Privacy-aware product analytics and conversion funnels for the public booking flow and back office.",
  },
  // Maps & geolocation
  {
    name: "MapTiler + MapLibre",
    category: "Maps",
    logo: "/brand/integrations/maptiler.svg",
    blurb:
      "Depot maps and location pickers rendered with MapLibre GL on MapTiler vector tiles.",
  },
  {
    name: "MaxMind GeoIP",
    category: "Geolocation",
    icon: Globe2,
    blurb:
      "Resolves a visitor's IP to a city to surface the nearest depot and inform fraud checks.",
  },
  // Notifications
  {
    name: "Web Push",
    category: "Notifications",
    icon: BellRing,
    blurb:
      "Browser push (VAPID) for staff task alerts and customer booking updates — no app install required.",
  },
];

export function IntegrationsGrid({ siteName }: { siteName: string }) {
  return (
    <section className="space-y-4">
      <DividedTitle>Integrations &amp; technology</DividedTitle>
      <p className="text-sm text-muted-foreground">
        {siteName} is one platform, but it stands on a best-in-class set of
        services. Here is every external integration and what the system uses
        it for.
      </p>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {INTEGRATIONS.map((it) => {
          const Icon = it.icon;
          return (
            <li
              key={it.name}
              className="flex flex-col gap-3 rounded-md border border-border bg-card p-4 transition-colors hover:border-foreground/30"
            >
              <div className="flex items-center gap-3">
                <span className="inline-flex h-11 items-center justify-center rounded-lg bg-white px-2.5 ring-1 ring-black/5">
                  {it.logo ? (
                    <Image
                      src={it.logo}
                      alt={`${it.name} logo`}
                      width={96}
                      height={28}
                      unoptimized
                      className="h-6 w-auto object-contain"
                    />
                  ) : Icon ? (
                    <Icon className="h-6 w-6 text-zinc-800" aria-hidden />
                  ) : null}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {it.name}
                  </p>
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    {it.category}
                  </p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground">{it.blurb}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
