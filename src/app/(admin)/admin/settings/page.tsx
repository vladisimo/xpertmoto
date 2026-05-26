"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { PageHeader } from "@/components/layout/page-header";
import { PageSection, PageShell } from "@/components/layout/page-section";
import { FormGrid } from "@/components/forms/form-grid";
import { SettingField } from "@/components/admin/settings/setting-field";
import {
  AuditRetentionEditor,
  type AuditRetentionValue,
} from "@/components/admin/settings/audit-retention-editor";
import { TestDataInjectorPanel } from "@/components/admin/settings/test-data-injector-panel";
import { EncryptionStatusCard } from "@/components/admin/settings/encryption-status-card";
import { BrandAssetField } from "@/components/admin/settings/brand-asset-field";
import {
  SETTING_DEFAULTS,
  SETTING_DESCRIPTIONS,
  SETTING_GROUP_FOR,
  type SettingKey,
} from "@/lib/settings-defaults";
import {
  Archive,
  Award,
  Bell,
  Building2,
  CalendarCheck,
  CalendarX,
  CreditCard,
  FlaskConical,
  KeyRound,
  ShieldCheck,
  ShoppingCart,
  Tags,
  type LucideIcon,
} from "lucide-react";

type FieldType = "number" | "decimal" | "text" | "boolean";

type TabKey =
  | "organisation"
  | "booking"
  | "checkout"
  | "cancellation"
  | "payment"
  | "pricing"
  | "loyalty"
  | "notifications"
  | "authentication"
  | "audit"
  | "security"
  | "testData";

const IS_DEV = process.env.NODE_ENV !== "production";

interface TabDef {
  key: TabKey;
  label: string;
  icon: LucideIcon;
  description: string;
  fields?: { key: SettingKey; label: string; type: FieldType; suffix?: string }[];
}

const TABS: TabDef[] = [
  {
    key: "organisation",
    label: "Organisation",
    icon: Building2,
    description: "Business identity shown on the public site, emails, and tax documents.",
    fields: [
      { key: "org.tradingName", label: "Trading name", type: "text" },
      { key: "org.legalName", label: "Legal name", type: "text" },
      { key: "org.siteTagline", label: "Tagline", type: "text" },
      { key: "org.abn", label: "ABN", type: "text" },
      { key: "org.supportEmail", label: "Support email", type: "text" },
      { key: "org.supportPhone", label: "Support phone", type: "text" },
      { key: "org.privacyEmail", label: "Privacy Officer email", type: "text" },
      { key: "org.postalAddress", label: "Postal address", type: "text" },
      { key: "org.invoiceFooter", label: "Invoice footer", type: "text" },
    ],
  },
  {
    key: "booking",
    label: "Booking",
    icon: CalendarCheck,
    description: "Control how far ahead customers can book and the duration limits.",
    fields: [
      { key: "booking.minDays", label: "Minimum duration", type: "number", suffix: "days" },
      { key: "booking.maxDays", label: "Maximum duration", type: "number", suffix: "days" },
      { key: "booking.advanceWindowDays", label: "Advance window", type: "number", suffix: "days" },
      { key: "booking.bufferHours", label: "Buffer between bookings", type: "number", suffix: "hrs" },
      { key: "booking.requireLicenceVerification", label: "Require licence verification", type: "boolean" },
    ],
  },
  {
    key: "checkout",
    label: "Checkout",
    icon: ShoppingCart,
    description: "Rules that apply at check-out and return, including late fees and fuel charges.",
    fields: [
      { key: "booking.allowGuestCheckout", label: "Allow guest checkout", type: "boolean" },
      { key: "booking.pendingPaymentTimeoutHours", label: "Auto-cancel unpaid bookings after", type: "number", suffix: "hrs" },
      { key: "booking.lateReturnGraceHours", label: "Late return grace window", type: "number", suffix: "hrs" },
      { key: "booking.fuelChargePerLitre", label: "Fuel charge", type: "decimal", suffix: "A$/L" },
    ],
  },
  {
    key: "cancellation",
    label: "Cancellation",
    icon: CalendarX,
    description: "Thresholds used when customers or staff cancel a booking.",
    fields: [
      { key: "cancellation.fullRefundHours", label: "Full refund cutoff", type: "number", suffix: "hrs" },
      { key: "cancellation.halfRefundHours", label: "Half refund cutoff", type: "number", suffix: "hrs" },
      { key: "cancellation.adminFee", label: "Admin fee", type: "decimal", suffix: "A$" },
      { key: "cancellation.noShowFee", label: "No-show fee", type: "decimal", suffix: "A$" },
    ],
  },
  {
    key: "payment",
    label: "Payment & tax",
    icon: CreditCard,
    description: "Tax settings, bond behaviour, and accepted payment methods.",
    fields: [
      { key: "tax.gstRate", label: "GST rate", type: "decimal", suffix: "ratio" },
      { key: "payment.bondHoldDays", label: "Bond hold duration", type: "number", suffix: "days" },
      { key: "payment.bondReleaseDays", label: "Auto-release bond after", type: "number", suffix: "days" },
      { key: "payment.acceptCash", label: "Accept cash", type: "boolean" },
    ],
  },
  {
    key: "pricing",
    label: "Pricing",
    icon: Tags,
    description:
      "Global levers that gate the demand multiplier and the legacy duration-discount ladder. PricingTier ladders are unaffected — they always replace the duration discount where configured.",
    fields: [
      {
        key: "pricing.yieldEnabled",
        label: "Apply demand multiplier",
        type: "boolean",
      },
      {
        key: "pricing.durationDiscountEnabled",
        label: "Apply duration discount ladder (10% / 25%)",
        type: "boolean",
      },
    ],
  },
  {
    key: "loyalty",
    label: "Loyalty",
    icon: Award,
    description: "Point earning rates and lifetime-tier thresholds.",
    fields: [
      { key: "loyalty.pointsPerDollar", label: "Points per A$1 spent", type: "number" },
      { key: "loyalty.pointsPerReview", label: "Bonus per review", type: "number" },
      { key: "loyalty.pointsPerReferral", label: "Bonus per referral", type: "number" },
      { key: "loyalty.goldThreshold", label: "Gold tier threshold", type: "number", suffix: "pts" },
      { key: "loyalty.platinumThreshold", label: "Platinum tier threshold", type: "number", suffix: "pts" },
    ],
  },
  {
    key: "notifications",
    label: "Notifications",
    icon: Bell,
    description:
      "Kill-switch, per-channel master toggles, and reminder timing. Disabling a channel stops every send on that channel — auth emails (password reset, magic link) remain exempt.",
    fields: [
      { key: "notification.pauseAll", label: "Pause all outbound notifications", type: "boolean" },
      { key: "notification.enableEmail", label: "Send emails", type: "boolean" },
      { key: "notification.enableSms", label: "Send SMS", type: "boolean" },
      { key: "notification.enablePush", label: "Send push", type: "boolean" },
      { key: "notification.enableInApp", label: "Write in-app notifications", type: "boolean" },
      { key: "notification.reminderHoursBefore", label: "Pickup reminder lead time", type: "number", suffix: "hrs" },
      { key: "notification.managerDailySummary", label: "Manager daily summary", type: "boolean" },
    ],
  },
  {
    key: "authentication",
    label: "Authentication",
    icon: KeyRound,
    description:
      "Sign-in policy for back-office users. Customers always have OAuth available; this toggle only controls staff, manager, and admin accounts.",
    fields: [
      {
        key: "auth.oauthAllowedForBackOffice",
        label: "Allow OAuth for staff and admins",
        type: "boolean",
      },
    ],
  },
  {
    key: "audit",
    label: "Audit & retention",
    icon: Archive,
    description: "Per-category audit log trimming. Runs daily at 03:00 Australia/Brisbane.",
  },
  {
    key: "security",
    label: "Security",
    icon: ShieldCheck,
    description: "APP-11 encryption rollout, secret rotation status, and other security posture indicators.",
  },
  ...(IS_DEV
    ? [
        {
          key: "testData" as const,
          label: "Test data",
          icon: FlaskConical,
          description:
            "Inject simulated events (tolls, infringements, incidents, overdue) to rehearse workflows. Hidden in production.",
        },
      ]
    : []),
];

export default function SettingsPage() {
  const util = trpc.useUtils();
  const { data: existing } = trpc.admin.listSettings.useQuery();
  const set = trpc.admin.setSetting.useMutation({
    onSuccess: () => util.admin.listSettings.invalidate(),
  });

  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: TabKey = TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : "organisation";
  const setTab = (key: TabKey) => {
    const params = new URLSearchParams(searchParams.toString());
    if (key === "organisation") params.delete("tab");
    else params.set("tab", key);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const active = TABS.find((t) => t.key === tab)!;

  function currentValue(key: SettingKey): unknown {
    const row = existing?.find((x) => x.key === key);
    return row?.value ?? SETTING_DEFAULTS[key];
  }

  async function save(key: SettingKey, value: unknown) {
    await set.mutateAsync({
      key,
      value,
      group: SETTING_GROUP_FOR[key],
      description: SETTING_DESCRIPTIONS[key],
    });
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administration"
        title="System settings"
        description="Configure business rules across the platform. Changes save automatically."
      />

      <div
        className="-mx-3 flex gap-1 overflow-x-auto border-b px-3 sm:mx-0 sm:px-0"
        role="tablist"
      >
        {TABS.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-1.5 border-b-2 whitespace-nowrap px-4 py-2 text-sm font-medium transition-colors ${
                tab === t.key
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {t.label}
            </button>
          );
        })}
      </div>

      {active.key === "testData" ? (
        <TestDataInjectorPanel />
      ) : active.key === "security" ? (
        <PageSection title={active.label} description={active.description}>
          <EncryptionStatusCard />
        </PageSection>
      ) : (
        <PageSection title={active.label} description={active.description}>
          {active.key === "audit" ? (
            <AuditRetentionEditor
              value={(currentValue("audit.retention") as AuditRetentionValue) ?? SETTING_DEFAULTS["audit.retention"]}
              onSave={(next) => save("audit.retention", next)}
            />
          ) : (
            <div className="space-y-8">
              <FormGrid cols={3}>
                {active.fields!.map((f) => (
                  <SettingField
                    key={f.key}
                    label={f.label}
                    description={SETTING_DESCRIPTIONS[f.key]}
                    settingKey={f.key}
                    type={f.type}
                    value={currentValue(f.key)}
                    suffix={f.suffix}
                    onSave={(v) => save(f.key, v)}
                  />
                ))}
              </FormGrid>
              {active.key === "organisation" ? (
                <div className="space-y-4 border-t pt-6">
                  <div>
                    <h3 className="h3">Brand assets</h3>
                    <p className="caption text-xs text-muted-foreground">
                      Upload the logos and favicon shown across the back-office sidebar, public
                      site, emails, and PDFs. Use transparent PNGs for best results on dark
                      surfaces. Max 4&nbsp;MB per file.
                    </p>
                  </div>
                  <FormGrid cols={2}>
                    <BrandAssetField
                      label="Horizontal logo (dark surfaces)"
                      slot="logoWide"
                      value={(currentValue("org.logoWideUrl") as string) || null}
                      description={SETTING_DESCRIPTIONS["org.logoWideUrl"]}
                      onChange={(url) => save("org.logoWideUrl", url)}
                    />
                    <BrandAssetField
                      label="Horizontal logo (light surfaces · PDFs)"
                      slot="logoBlack"
                      value={(currentValue("org.logoBlackUrl") as string) || null}
                      description={SETTING_DESCRIPTIONS["org.logoBlackUrl"]}
                      onChange={(url) => save("org.logoBlackUrl", url)}
                    />
                    <BrandAssetField
                      label="Square logo"
                      slot="logoSquare"
                      value={(currentValue("org.logoSquareUrl") as string) || null}
                      description={SETTING_DESCRIPTIONS["org.logoSquareUrl"]}
                      onChange={(url) => save("org.logoSquareUrl", url)}
                    />
                    <BrandAssetField
                      label="Favicon"
                      slot="favicon"
                      value={(currentValue("org.faviconUrl") as string) || null}
                      description={SETTING_DESCRIPTIONS["org.faviconUrl"]}
                      onChange={(url) => save("org.faviconUrl", url)}
                    />
                  </FormGrid>
                </div>
              ) : null}
            </div>
          )}
        </PageSection>
      )}
    </PageShell>
  );
}
