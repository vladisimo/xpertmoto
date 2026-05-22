import type { Metadata } from "next";
import React from "react";
import { Check, X } from "lucide-react";
import { getBranding } from "@/lib/branding";
import { DividedTitle } from "@/components/marketing/divided-title";
import { FaqList } from "@/components/marketing/faq-list";
import {
  LiveCostComparison,
  type StaticCostRow,
} from "@/components/marketing/live-cost-comparison";

export async function generateMetadata(): Promise<Metadata> {
  const { siteName } = await getBranding();
  const title = `Why ${siteName} — Scooter & Motorbike Hire Platform (Australia) | eFleetPass & Shopify Alternative`;
  const description = `Replace Shopify, eFleetPass and your helpdesk with one Australian-built scooter and motorbike hire platform. Native bookings, fleet, AI support, GST/ABN-compliant invoicing, and automated toll and infringement admin you can rebill to hirers. Includes a live fleet toll-cost calculator.`;
  return {
    title,
    description,
    keywords: [
      "scooter rental software Australia",
      "motorbike hire platform",
      "moto rental SaaS",
      "eFleetPass alternative",
      "Shopify rental alternative",
      "fleet toll management Australia",
      "rental fleet infringement nomination",
      "Linkt Business fleet admin",
      "scooter rental management",
      "vehicle hire booking platform Australia",
    ],
    alternates: { canonical: "/why-xpert" },
    openGraph: {
      title,
      description,
      type: "website",
      url: "/why-xpert",
      siteName,
      locale: "en_AU",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

interface FeatureRow {
  feature: string;
  legacy: boolean;
  platform: boolean;
}

interface CapabilityGroup {
  capability: string;
  features: FeatureRow[];
}

const CAPABILITY_GROUPS: CapabilityGroup[] = [
  {
    capability: "Bookings",
    features: [
      { feature: "Online storefront", legacy: true, platform: true },
      { feature: "Rental booking flow", legacy: false, platform: true },
      { feature: "Live depot availability", legacy: false, platform: true },
      { feature: "One-way hires", legacy: false, platform: true },
      { feature: "Security bond hold", legacy: false, platform: true },
    ],
  },
  {
    capability: "Fleet",
    features: [
      { feature: "Vehicle & depot register", legacy: false, platform: true },
      { feature: "Rego & insurance reminders", legacy: false, platform: true },
      { feature: "Toll & infringement handling", legacy: true, platform: true },
      { feature: "GPS / telematics ready", legacy: false, platform: true },
    ],
  },
  {
    capability: "Customer support",
    features: [
      { feature: "Ticket inbox", legacy: true, platform: true },
      { feature: "AI-powered chat", legacy: false, platform: true },
      { feature: "Searchable help centre", legacy: false, platform: true },
    ],
  },
  {
    capability: "Identity & licence checks",
    features: [
      { feature: "Photo upload", legacy: true, platform: true },
      { feature: "AI document scanning", legacy: false, platform: true },
      { feature: "Licence expiry reminders", legacy: false, platform: true },
    ],
  },
  {
    capability: "Analytics",
    features: [
      { feature: "Sales reports", legacy: true, platform: true },
      { feature: "Customer behaviour dashboard", legacy: false, platform: true },
      { feature: "Conversion & retention metrics", legacy: false, platform: true },
      { feature: "AI insights & alerts", legacy: false, platform: true },
    ],
  },
  {
    capability: "Marketing",
    features: [
      { feature: "Discount codes", legacy: true, platform: true },
      { feature: "Loyalty program", legacy: false, platform: true },
      { feature: "Gift cards & referrals", legacy: false, platform: true },
      { feature: "Cart recovery", legacy: false, platform: true },
      { feature: "Seasonal & dynamic pricing", legacy: false, platform: true },
    ],
  },
  {
    capability: "Communications",
    features: [
      { feature: "Transactional email", legacy: true, platform: true },
      { feature: "Branded email templates", legacy: false, platform: true },
      { feature: "SMS notifications", legacy: false, platform: true },
      { feature: "Push notifications", legacy: false, platform: true },
    ],
  },
  {
    capability: "Australian compliance",
    features: [
      { feature: "GST-inclusive pricing", legacy: false, platform: true },
      { feature: "ABN on every invoice", legacy: false, platform: true },
      { feature: "Privacy-grade data handling", legacy: false, platform: true },
      { feature: "Full audit trail", legacy: false, platform: true },
    ],
  },
  {
    capability: "Staff & admin security",
    features: [
      { feature: "Staff login", legacy: true, platform: true },
      { feature: "Two-factor authentication", legacy: false, platform: true },
      { feature: "Role-based permissions", legacy: false, platform: true },
    ],
  },
];

const STATIC_COST_ROWS: StaticCostRow[] = [
  {
    line: "Storefront / bookings",
    legacyAnnual: 1788,
    legacyDetail: "Shopify Grow $149 / mo. Shopify also charges 1.6% + 30c per online sale.",
    platformLabel: "Included",
  },
  {
    line: "Helpdesk / support tool",
    legacyAnnual: 2040,
    legacyDetail: "Zendesk-tier 2 agent seats ~$170 / mo",
    platformLabel: "Included",
  },
  {
    line: "Analytics / BI",
    legacyAnnual: 0,
    legacyDetail: "None native — blind spot in the current stack",
    platformLabel: "Included",
  },
  {
    line: "AI / OCR / chat",
    legacyAnnual: 0,
    legacyDetail: "Not available in the current stack at any tier",
    platformLabel: "Included (usage-metered AI)",
  },
];

const PLATFORM_ANNUAL_LIST = 72000;
const PLATFORM_ANNUAL_PREPAID = 64800; // ~10% prepay discount

interface WorkedRow {
  label: string;
  amount: number;
  detail?: string;
}

interface WorkedGroup {
  heading: string;
  rows: WorkedRow[];
  tone: "saving" | "revenue";
}

// Worked example assumptions for a $1.2M-turnover scooter rental operator:
//   ~75 hire-ready vehicles, ~4,000 hires/yr @ avg $300, 6 tolls / vehicle / month,
//   1.5 infringements / vehicle / yr, 2-3 mechanics, 2 support seats,
//   currently on Shopify Advanced + Stripe (external gateway).
const WORKED_TURNOVER = 1_200_000;
const WORKED_VEHICLES = 75;

const WORKED_GROUPS: WorkedGroup[] = [
  {
    heading: "Annual SaaS / fleet costs eliminated",
    tone: "saving",
    rows: [
      { label: "Shopify Advanced subscription", amount: 3588, detail: "$299 / mo × 12" },
      {
        label: "Shopify external-gateway fee",
        amount: 7200,
        detail: "0.6% × $1.2M turnover (penalty for using Stripe instead of Shopify Payments)",
      },
      {
        label: "eFleetPass (vehicle-rental tier)",
        amount: 8100,
        detail: "$1.50 / toll × 5,400 toll events",
      },
      {
        label: "Helpdesk (Zendesk Suite Pro, 2 seats)",
        amount: 4200,
        detail: "$175 / agent / mo × 2 × 12",
      },
    ],
  },
  {
    heading: "Manual back-office labour automated away",
    tone: "saving",
    rows: [
      {
        label: "Licence / ID OCR pre-fill (≥70% confidence)",
        amount: 8000,
        detail: "5 min → 1 min per booking × 4,000 hires @ $30 / hr",
      },
      {
        label: "Toll & infringement processing automation",
        amount: 2808,
        detail: "~2 hr / week of manual notice handling, ~90% automated",
      },
      {
        label: "Bond release & dunning chase automation",
        amount: 4500,
        detail: "BullMQ jobs replace manual follow-up workflow",
      },
    ],
  },
  {
    heading: "New revenue captured",
    tone: "revenue",
    rows: [
      {
        label: "Toll admin rebill",
        amount: 17820,
        detail: "$3.30 / toll × 5,400 events, charged through to hirer via bond hold",
      },
      {
        label: "Infringement admin rebill",
        amount: 3729,
        detail: "$33 / nomination × 113 notices / year",
      },
    ],
  },
];

const WORKED_GROWTH_UPLIFT_LOW = 24_000; // conservative 2% of $1.2M
const WORKED_GROWTH_UPLIFT_HIGH = 60_000; // 5% of $1.2M
const WORKED_PLATFORM_COST = 72_000;

const sumRows = (rows: WorkedRow[]) => rows.reduce((acc, r) => acc + r.amount, 0);
const WORKED_HARD_VALUE = WORKED_GROUPS.reduce((acc, g) => acc + sumRows(g.rows), 0);
const WORKED_NET_LOW = WORKED_HARD_VALUE + WORKED_GROWTH_UPLIFT_LOW - WORKED_PLATFORM_COST;
const WORKED_NET_HIGH = WORKED_HARD_VALUE + WORKED_GROWTH_UPLIFT_HIGH - WORKED_PLATFORM_COST;

const aud0 = (n: number) =>
  new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(n);

interface GrowthCard {
  title: string;
  body: string;
}

const GROWTH_CARDS: GrowthCard[] = [
  {
    title: "Higher conversion",
    body: "Real-time availability and a 6-step native wizard cut booking friction Shopify's generic checkout can't address. Cart-recovery emails and seasonal yield pricing reclaim drop-offs the legacy stack never sees.",
  },
  {
    title: "Shopper insight",
    body: "Visitor sessions, UTM attribution, funnel drop-off, device segmentation and Claude-generated anomaly alerts — all native. The current stack offers none of this without a separate analytics vendor.",
  },
  {
    title: "Built-in growth levers",
    body: "Loyalty tiers, referrals, gift cards, branded email campaigns and per-depot pricing overrides are first-class objects in the platform, not bolt-ons. Each one is a revenue lever the legacy stack cannot pull.",
  },
  {
    title: "Operational scale",
    body: "117 data models, 44 typed API routers, 88 service modules and BullMQ background jobs handle multi-depot expansion, dunning, bond auto-release and overdue alerts without manual ops.",
  },
  {
    title: "AI where it matters",
    body: "Claude-powered licence OCR (≥70% confidence pre-fill), support-chat with tool-use, and AI insight generation across the analytics surface — none of which exist in Shopify or eFleetPass.",
  },
  {
    title: "Compliance as a feature",
    body: "GST-inclusive pricing via a single utility, ABN on every PDF, APP-grade log redaction, immutable audit trail, mandatory TOTP for back-office, Essential Eight ML2 self-assessment published at /trust.",
  },
];

export default async function WhyXpertPage() {
  const branding = await getBranding();
  const { siteName, legalName, abn } = branding;

  const faqItems = [
    {
      q: `What does the ${siteName} platform replace for a scooter or motorbike hire business?`,
      a: `${siteName} consolidates Shopify (storefront and checkout), eFleetPass (toll account and fleet admin) and a stand-alone helpdesk seat — into a single Australian-built platform. Bookings, vehicles, depots, identity verification, customer support, marketing, GST-inclusive invoicing and toll / infringement administration all live in one application with one login.`,
    },
    {
      q: `How does ${siteName} handle toll passes and infringement notices?`,
      a: `Each booking already carries a verified hirer identity, a Stripe bond authorisation and an audit-logged event timeline. When a toll or infringement notice arrives, the platform matches it to the booking automatically, generates the Revenue NSW driver nomination, debits the agreed admin fee from the held bond, issues a GST-itemised invoice via the built-in email templates, and records the entire chain in the audit log. You keep one Linkt Business account at the depot level — there are no per-vehicle tag rental fees inside the platform.`,
    },
    {
      q: `Is ${siteName} cheaper than eFleetPass for a rental fleet?`,
      a: `For a typical 25-vehicle fleet doing six tolls per vehicle per month, the eFleetPass leasing model alone (tag rental plus per-toll vehicle matching, per their published fee schedule) is roughly $10,400 per year. Inside ${siteName} the same workflow is included in the platform subscription, and the per-toll admin fee charged to the hirer becomes new revenue you retain rather than a margin captured by an external reseller. Use the calculator above to model your own fleet size and toll volumes.`,
    },
    {
      q: `Can I rebill tolls and infringements to my hirers automatically?`,
      a: `Yes. The platform's proposed pass-through model charges the statutory toll plus a $3.30 per-toll admin fee, and $33.00 per infringement nomination, both GST-inclusive. Both amounts are quoted at booking time, snapshotted onto the booking record, and settled against the existing Stripe bond hold within the standard 14-day post-return window. The customer receives an itemised invoice with ABN, GST breakdown and source documentation.`,
    },
    {
      q: `Do I still need a Linkt Business account?`,
      a: `Yes — Linkt remains the toll operator. ${siteName} sits above it as the fleet-administration layer. You operate one Linkt Business account per depot ($5/month account fee, $0.90/month per tag) and the platform handles every other piece of the workflow: identity match, driver nomination, customer invoicing, dispute logging and revenue capture.`,
    },
    {
      q: `Which Australian toll roads are supported?`,
      a: `All NSW toll roads (Hills M2, M5 South-West, M5 East, Westlink M7, Eastern Distributor, Sydney Harbour Bridge and Tunnel, Cross City Tunnel, Lane Cove Tunnel, WestConnex M4 and M8). The platform passes through the statutory toll exactly as set by the operator — Transurban (Linkt) or NSW Government — adjusted quarterly with CPI. ${siteName} never marks up the toll itself.`,
    },
    {
      q: `Is the platform suitable for scooter and motorbike hire businesses specifically?`,
      a: `Yes — it was built for the moto vertical. Models, depots, walk-in POS, licence-class verification, helmet and gear hire and bond-style damage holds are all first-class objects. The toll and infringement workflow is tuned for the bike-rental reality: short hires, frequent state-camera infringements, and one-way depot returns.`,
    },
  ];

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: siteName,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      offers: {
        "@type": "Offer",
        priceCurrency: "AUD",
        price: "6000",
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          price: 6000,
          priceCurrency: "AUD",
          unitText: "MONTH",
        },
      },
      description: `Australian-built scooter and motorbike hire platform consolidating bookings, fleet, customer support, toll and infringement administration, and growth tooling. Replaces Shopify, eFleetPass and a third-party helpdesk.`,
      provider: {
        "@type": "Organization",
        name: "Mercury Road Equipment Pty Ltd",
        identifier: "ABN 36 614 422 187",
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: faqItems.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a },
      })),
    },
  ];

  return (
    <div className="container max-w-5xl space-y-12 py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <header className="space-y-3">
        <p className="caption uppercase tracking-[0.14em] text-muted-foreground">
          Platform comparison · Scooter & motorbike hire (Australia)
        </p>
        <h1 className="h-display">Why {siteName}</h1>
        <p className="max-w-3xl text-muted-foreground">
          One Australian-built platform replacing Shopify, eFleetPass and a
          third-party helpdesk — plus AI, analytics, GST and ABN-compliant
          invoicing, and a built-in toll and infringement workflow that turns
          a recurring cost line into a revenue line.
        </p>
      </header>

      <section className="space-y-4">
        <DividedTitle>Current stack vs. {siteName}</DividedTitle>
        <div className="overflow-hidden rounded-md border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-foreground text-background">
                <tr>
                  <th className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em]">
                    Feature
                  </th>
                  <th className="w-32 px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.08em]">
                    Current stack
                  </th>
                  <th className="w-32 px-3 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.08em]">
                    <span className="inline-flex items-center gap-1.5">
                      Proposed
                      <span className="rounded-full bg-emerald-400 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-950">
                        New
                      </span>
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {CAPABILITY_GROUPS.map((group) => (
                  <React.Fragment key={group.capability}>
                    <tr className="border-t border-border bg-muted/40">
                      <th
                        scope="colgroup"
                        colSpan={3}
                        className="px-3 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-foreground"
                      >
                        {group.capability}
                      </th>
                    </tr>
                    {group.features.map((f) => (
                      <tr
                        key={`${group.capability}-${f.feature}`}
                        className="border-t border-border align-middle transition-colors hover:bg-foreground/[0.05] dark:hover:bg-foreground/[0.08]"
                      >
                        <td className="px-3 py-1.5 pl-5">{f.feature}</td>
                        <td className="px-3 py-1.5 text-center">
                          {f.legacy ? (
                            <Check
                              className="mx-auto h-3.5 w-3.5 text-foreground"
                              aria-label="Included"
                            />
                          ) : (
                            <X
                              className="mx-auto h-3.5 w-3.5 text-muted-foreground/50"
                              aria-label="Not included"
                            />
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          {f.platform ? (
                            <Check
                              className="mx-auto h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
                              aria-label="Included"
                            />
                          ) : (
                            <X
                              className="mx-auto h-3.5 w-3.5 text-muted-foreground/50"
                              aria-label="Not included"
                            />
                          )}
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <DividedTitle>Live cost comparison (AUD / year)</DividedTitle>
        <LiveCostComparison
          siteName={siteName}
          staticRows={STATIC_COST_ROWS}
          platformAnnual={PLATFORM_ANNUAL_LIST}
          platformAnnualPrepaid={PLATFORM_ANNUAL_PREPAID}
        />
      </section>

      <section className="space-y-4">
        <DividedTitle>Why the toll line moves like that</DividedTitle>
        <div className="grid gap-4 lg:grid-cols-2">
          <p className="text-sm text-muted-foreground">
            Tolls and infringement notices on a rental fleet are a recurring
            admin tax — and a recurring revenue opportunity. Resellers like
            eFleetPass cannot legally discount the statutory toll (set by
            Transurban / Linkt and adjusted quarterly with CPI); their margin
            comes from per-tag rental, per-toll matching loadings, optional
            levies (carbon offset, GPS, feed-in), statement fees and dispute
            fees. That is the "Fleet toll administration" row in the live
            comparison above.
          </p>
          <p className="text-sm text-muted-foreground">
            Inside {siteName} the same workflow is included. Each booking
            already holds a verified hirer identity, a Stripe bond
            authorisation, an audit-logged event timeline and an ABN /
            GST-compliant invoice template. A toll notice arrives, the
            platform matches it to the booking, debits the agreed{" "}
            <strong className="text-foreground">$3.30</strong> per-toll admin
            fee (or <strong className="text-foreground">$33.00</strong> per
            infringement nomination) from the bond, issues the invoice and
            files the audit record. The reseller margin flips into your
            revenue line — that is the negative "Toll admin rebilled to
            hirers" row.
          </p>
        </div>

        <div className="overflow-hidden rounded-md border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-foreground text-background">
                <tr>
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em]">
                    Provider
                  </th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em]">
                    Toll admin
                  </th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em]">
                    Infringement nomination
                  </th>
                  <th className="px-4 py-2 text-xs font-semibold uppercase tracking-[0.08em]">
                    Tag / account
                  </th>
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    p: "Hertz Australia",
                    t: "$7.95 / day",
                    i: "$60.50",
                    a: "Bundled",
                  },
                  {
                    p: "Avis Australia",
                    t: "$6.05 / day or $33 / toll",
                    i: "$66.00",
                    a: "Bundled",
                  },
                  {
                    p: "Budget Australia",
                    t: "$5.50 / day",
                    i: "$66.00",
                    a: "Bundled",
                  },
                  {
                    p: "Europcar",
                    t: "$4.40 / day",
                    i: "$55.00",
                    a: "Bundled",
                  },
                  {
                    p: "eFleetPass",
                    t: "$1.50–$1.75 / toll + optional levies up to $3.50 / toll",
                    i: "$25 + $35 dispute fee",
                    a: "$25 / month per tag",
                  },
                  {
                    p: "Linkt Business (DIY)",
                    t: "$0.36–$0.75 / trip matching",
                    i: "Handled by hirer directly",
                    a: "$5 / month + $0.90 / tag",
                  },
                  {
                    p: `${siteName} platform`,
                    t: "$3.30 / toll (charged to hirer)",
                    i: "$33.00 (charged to hirer)",
                    a: "$0 — included",
                  },
                ].map((r) => {
                  const isUs = r.p.startsWith(siteName);
                  return (
                    <tr
                      key={r.p}
                      className={
                        isUs
                          ? "border-t border-border bg-primary/10 align-top font-medium"
                          : "border-t border-border align-top"
                      }
                    >
                      <td className="px-4 py-3">{r.p}</td>
                      <td className="px-4 py-3 text-muted-foreground tabular-nums">
                        {r.t}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground tabular-nums">
                        {r.i}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground tabular-nums">
                        {r.a}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          All figures AUD, GST-inclusive. Competitor pricing from each
          operator's published fee schedule as at April 2026. Statutory NSW
          tolls remain identical across every provider — the difference is
          the admin layer wrapped around them.
        </p>
      </section>

      <section className="space-y-4">
        <DividedTitle>
          Worked example — $1.2M turnover operator
        </DividedTitle>
        <div className="rounded-md border border-border bg-card p-5 sm:p-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="text-sm text-muted-foreground">
              Concrete numbers for a scooter / motorbike rental business
              comparable to {siteName} today — {aud0(WORKED_TURNOVER)} annual
              turnover across roughly {WORKED_VEHICLES.toLocaleString("en-AU")}
              {" "}hire-ready vehicles, ~4,000 hires per year, two-to-three
              mechanics and two customer-support seats, currently running
              Shopify Advanced with Stripe as an external gateway.
            </div>
            <div className="text-sm text-muted-foreground">
              All figures AUD, GST-inclusive, conservative. Toll and
              infringement volumes match the calculator above (6 tolls per
              vehicle per month, 1.5 infringements per vehicle per year). Adjust
              your own scale against the live calculator; this section anchors
              the headline economics.
            </div>
          </div>

          <div className="mt-5 space-y-5">
            {WORKED_GROUPS.map((group) => {
              const subtotal = sumRows(group.rows);
              return (
                <div key={group.heading}>
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
                      {group.heading}
                    </h3>
                    <span className="text-sm font-semibold tabular-nums text-foreground">
                      {group.tone === "revenue" ? "+" : ""}
                      {aud0(subtotal)} / yr
                    </span>
                  </div>
                  <div className="overflow-hidden rounded-md border border-border">
                    <table className="w-full border-collapse text-left text-sm">
                      <tbody>
                        {group.rows.map((row) => (
                          <tr
                            key={row.label}
                            className="border-t border-border first:border-t-0 align-top"
                          >
                            <td className="px-4 py-2.5">
                              <div className="font-medium">{row.label}</div>
                              {row.detail ? (
                                <div className="mt-0.5 text-xs text-muted-foreground">
                                  {row.detail}
                                </div>
                              ) : null}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums">
                              {group.tone === "revenue" ? "+" : ""}
                              {aud0(row.amount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}

            <div>
              <div className="mb-2 flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-semibold uppercase tracking-[0.08em] text-foreground">
                  Growth-tooling uplift (range)
                </h3>
                <span className="text-sm font-semibold tabular-nums text-foreground">
                  +{aud0(WORKED_GROWTH_UPLIFT_LOW)}–{aud0(WORKED_GROWTH_UPLIFT_HIGH)} / yr
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Conservative 2–5% of annual turnover, attributable to cart
                recovery, loyalty tiers, referrals, seasonal yield pricing and
                segmented email / SMS campaigns — none of which the legacy
                stack delivers natively. Industry-typical for AU e-commerce
                operators adopting these tools for the first time.
              </p>
            </div>
          </div>

          <div className="mt-6 rounded-md bg-muted/40 p-4">
            <dl className="space-y-2 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <dt className="text-muted-foreground">
                  Hard-dollar value (savings + revenue captured)
                </dt>
                <dd className="font-semibold tabular-nums">+{aud0(WORKED_HARD_VALUE)} / yr</dd>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <dt className="text-muted-foreground">Growth-tooling uplift (low–high)</dt>
                <dd className="font-semibold tabular-nums">
                  +{aud0(WORKED_GROWTH_UPLIFT_LOW)} to +{aud0(WORKED_GROWTH_UPLIFT_HIGH)} / yr
                </dd>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-border/60 pt-2">
                <dt className="text-muted-foreground">{siteName} platform subscription</dt>
                <dd className="font-semibold tabular-nums">
                  −{aud0(WORKED_PLATFORM_COST)} / yr
                </dd>
              </div>
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-t-2 border-foreground/40 pt-2">
                <dt className="text-base font-semibold">Net annual position (cash)</dt>
                <dd className="text-xl font-semibold tabular-nums text-foreground">
                  +{aud0(WORKED_NET_LOW)} to +{aud0(WORKED_NET_HIGH)} / yr
                </dd>
              </div>
            </dl>
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            On top of the cash position, the platform replaces approximately
            half an FTE of recurring administrative work and delivers
            capability the legacy stack cannot price-match at any cost: Claude
            licence OCR and AI customer support, native acquisition /
            conversion / retention analytics, AU compliance (GST-inclusive
            pricing, ABN on every PDF, APP-grade PII redaction, immutable
            audit log, Essential Eight ML2), mandatory TOTP and five-role
            RBAC, and a single staff / admin login replacing five separate
            vendor portals.
          </p>
        </div>
      </section>

      <section className="space-y-4">
        <DividedTitle>Beyond parity — growth levers</DividedTitle>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {GROWTH_CARDS.map((c) => (
            <div key={c.title} className="flex flex-col rounded-md border border-border bg-card p-5">
              <div className="h3">{c.title}</div>
              <p className="mt-2 text-sm text-muted-foreground">{c.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <DividedTitle>The headline numbers</DividedTitle>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { label: "Data models", value: "117" },
            { label: "Typed API routers", value: "44" },
            { label: "Branded email templates", value: "27" },
            { label: "Background jobs", value: "BullMQ" },
          ].map((s) => (
            <div key={s.label} className="rounded-md border border-border bg-card p-4">
              <div className="text-3xl font-semibold tabular-nums text-foreground">{s.value}</div>
              <div className="caption mt-1 text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <DividedTitle>Frequently asked questions</DividedTitle>
        <FaqList items={faqItems} />
      </section>

      <footer className="space-y-1 border-t border-border pt-6 text-xs text-muted-foreground">
        <p>
          {siteName} is a dFortix.ai deployment operated by {legalName}
          {abn ? ` (ABN ${abn})` : ""}. Platform technology by Mercury Road
          Equipment Pty Ltd (ABN 36 614 422 187). All AUD figures GST-inclusive
          and indicative — final quote on signed proposal. Statutory NSW toll
          amounts are set by the operator (Transurban / Linkt or NSW
          Government) and adjusted quarterly; the {siteName} platform passes
          them through at face value and never marks them up.
        </p>
      </footer>
    </div>
  );
}
