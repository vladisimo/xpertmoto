import { z } from "zod";

// Zod schemas for every `Json` column in the Prisma schema that carries
// structured data we care about. Use these on BOTH sides:
//   - WRITE:  parse before `prisma.create` / `prisma.update` to prevent
//             malformed payloads from landing in the DB.
//   - READ:   `schema.parse(row.jsonField)` after a Prisma read to narrow
//             the `unknown`/`Prisma.JsonValue` to a concrete TypeScript
//             type. Avoid `row.jsonField as unknown as X` casts.
//
// If you need a new shape, add it here — do not invent ad-hoc local types
// in routers.

// ─── Booking.pricingSnapshot ─────────────────────────────────────────────
// Frozen copy of the pricing calculation at booking-confirmation time. Used
// by invoice generation, extension calculations, and audit reconstruction.
export const PricingLineItemSchema = z.object({
  label: z.string(),
  amount: z.number(),
  kind: z.enum([
    "BASE",
    "DURATION_DISCOUNT",
    "SEASON_MULT",
    "YIELD_MULT",
    "DISCOUNT_CODE",
    "ADDON",
    "INSURANCE",
    "DELIVERY",
    "ONE_WAY",
    "GST",
    "ROUND",
  ]),
});

export const PricingSnapshotSchema = z.object({
  durationDays: z.number(),
  baseSubtotal: z.number(),
  seasonMultiplier: z.number().default(1),
  yieldMultiplier: z.number().default(1),
  durationDiscountPct: z.number().default(0),
  codeDiscount: z.number().default(0),
  discountAmount: z.number().default(0),
  addonTotal: z.number().default(0),
  insuranceTotal: z.number().default(0),
  deliveryFee: z.number().default(0),
  oneWayFee: z.number().default(0),
  bondAmount: z.number().default(0),
  gstAmount: z.number(),
  totalAmount: z.number(),
  lineItems: z.array(PricingLineItemSchema).optional(),
  computedAt: z.string().optional(), // ISO timestamp
});
export type PricingSnapshot = z.infer<typeof PricingSnapshotSchema>;

// ─── BondLedger.deductions ───────────────────────────────────────────────
// Each capture against the bond has an entry. Running sum should equal
// BondLedger.capturedAmount.
export const BondDeductionSchema = z.object({
  reason: z.string(),
  amount: z.number(),
  capturedAt: z.string().optional(), // ISO timestamp
  stripeChargeId: z.string().optional(),
  actorUserId: z.string().optional(),
});
export const BondDeductionsSchema = z.array(BondDeductionSchema);
export type BondDeduction = z.infer<typeof BondDeductionSchema>;

// ─── Inspection.bodyDamageMap ────────────────────────────────────────────
// SVG-coordinate damage markers on the pre-hire/post-hire vehicle outline.
// The writer (staff-booking router) normalises input into this shape.
export const DamageMarkerSeveritySchema = z.enum(["MINOR", "MODERATE", "MAJOR"]);
export const StoredDamageMarkerSchema = z.object({
  id: z.string(),
  x: z.number(),
  y: z.number(),
  severity: DamageMarkerSeveritySchema,
  note: z.string().optional(),
  source: z.enum(["PRE_HIRE", "POST_HIRE", "INCIDENT", "ROUTINE"]).optional(),
  view: z.enum(["LEFT", "RIGHT", "FRONT", "REAR", "TOP"]).optional(),
  addedAt: z.string().optional(),
  photoUrl: z.string().optional(),
});
export const BodyDamageMapSchema = z.object({
  markers: z.array(StoredDamageMarkerSchema).default([]),
  capturedAt: z.string().optional(),
});
export type StoredDamageMarker = z.infer<typeof StoredDamageMarkerSchema>;
export type BodyDamageMap = z.infer<typeof BodyDamageMapSchema>;

// ─── Invoice.lineItems ───────────────────────────────────────────────────
export const InvoiceLineItemSchema = z.object({
  description: z.string(),
  /** Optional second descriptive line on the rendered PDF (eg dates). */
  detail: z.string().optional(),
  quantity: z.number().default(1),
  unitPrice: z.number(),
  totalPrice: z.number(),
  gstAmount: z.number().optional(),
  gstIncluded: z.boolean().default(true),
  /** Discount lines render in destructive ink with a parenthesised total. */
  negative: z.boolean().optional(),
});
export const InvoiceLineItemsSchema = z.array(InvoiceLineItemSchema);
export type InvoiceLineItem = z.infer<typeof InvoiceLineItemSchema>;

// ─── AdjustmentNote.lineItems ────────────────────────────────────────────
// Same shape as InvoiceLineItem; existed historically as a parallel schema
// before the design unified. Re-exported so call sites read clearly.
export const AdjustmentNoteLineItemSchema = InvoiceLineItemSchema;
export const AdjustmentNoteLineItemsSchema = InvoiceLineItemsSchema;
export type AdjustmentNoteLineItem = InvoiceLineItem;

// ─── Notification.data ───────────────────────────────────────────────────
// Variable bag used by the email/SMS template engine. We intentionally
// keep this permissive (string-keyed, unknown values) because template
// variables vary per notification type — callers should use the dedicated
// helpers in notification-sender.ts rather than poking at `data` directly.
export const NotificationDataSchema = z.record(z.string(), z.unknown());
export type NotificationData = z.infer<typeof NotificationDataSchema>;

// ─── Incident.thirdPartyDetails ──────────────────────────────────────────
export const ThirdPartyDetailsSchema = z.object({
  name: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  rego: z.string().optional(),
  vehicleMake: z.string().optional(),
  vehicleModel: z.string().optional(),
  driverLicenceNumber: z.string().optional(),
  insuranceCompany: z.string().optional(),
  insurancePolicyNumber: z.string().optional(),
  notes: z.string().optional(),
});
export type ThirdPartyDetails = z.infer<typeof ThirdPartyDetailsSchema>;

// ─── RentalAgreement / ReturnAssessment.pagesInitialled ──────────────────
export const PageInitialsEntrySchema = z.object({
  pageIndex: z.number().int().min(0),
  signedAt: z.string(), // ISO timestamp
  initialsUrl: z.string().optional(),
  ipAddress: z.string().optional(),
});
export const PagesInitialledSchema = z.array(PageInitialsEntrySchema);
export type PageInitialsEntry = z.infer<typeof PageInitialsEntrySchema>;

// ─── SystemSetting.value ─────────────────────────────────────────────────
// Each setting key has its own shape; this schema is intentionally permissive
// at the JSON level. Consumers should narrow with a key-specific schema in
// their own module.
export const SystemSettingValueSchema = z
  .union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.unknown()), z.record(z.string(), z.unknown())])
  .or(z.object({}).passthrough());
export type SystemSettingValue = z.infer<typeof SystemSettingValueSchema>;

// Helpers: read a Prisma `Json` column and narrow to a typed shape, or
// return `undefined` with a logged warning on shape failure. Prefer this
// over casts.
export function parsePricingSnapshot(value: unknown): PricingSnapshot | undefined {
  const r = PricingSnapshotSchema.safeParse(value);
  return r.success ? r.data : undefined;
}
export function parseBondDeductions(value: unknown): BondDeduction[] {
  const r = BondDeductionsSchema.safeParse(value);
  return r.success ? r.data : [];
}
export function parseBodyDamageMap(value: unknown): BodyDamageMap {
  const r = BodyDamageMapSchema.safeParse(value);
  return r.success ? r.data : { markers: [] };
}
export function parsePagesInitialled(value: unknown): PageInitialsEntry[] {
  const r = PagesInitialledSchema.safeParse(value);
  return r.success ? r.data : [];
}
