import { z } from "zod";
import { Prisma } from "@prisma/client";
import { createTRPCRouter, staffProcedure } from "../trpc";
import { customerDirectoryUserWhere } from "@/lib/customer-identity";

/**
 * Global back-office search. Powers the ⌘K command palette in
 * BackOfficeShell. One query fans out across the five entity types staff
 * most often need to jump to — bookings, vehicles, customers, receipts and
 * tax invoices — and returns small, pre-shaped, display-ready groups (each
 * item already carries the `href` to its detail page so the client doesn't
 * re-derive routing). Receipts and tax invoices have no detail page of their
 * own, so they deep-link to their parent booking.
 *
 * Search idiom mirrors the rest of the back office: `contains` +
 * `mode: "insensitive"` OR-arrays (no full-text index in the schema).
 */

export const GlobalSearchInput = z.object({
  query: z.string().trim().min(2),
  perGroup: z.number().int().min(1).max(10).default(5),
});

function customerName(
  c: { firstName: string | null; lastName: string | null; email: string } | null,
): string {
  if (!c) return "Unknown customer";
  const full = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
  return full || c.email;
}

export const globalSearchRouter = createTRPCRouter({
  search: staffProcedure
    .input(GlobalSearchInput)
    .query(async ({ ctx, input }) => {
      const { query, perGroup } = input;
      const contains = { contains: query, mode: "insensitive" as const };

      const [bookings, vehicles, customers, receipts, invoices] =
        await Promise.all([
          ctx.prisma.booking.findMany({
            where: {
              OR: [
                { bookingReference: contains },
                { customer: { firstName: contains } },
                { customer: { lastName: contains } },
                { customer: { email: contains } },
                { vehicle: { rego: contains } },
              ],
            },
            select: {
              id: true,
              bookingReference: true,
              status: true,
              pickupDateTime: true,
              returnDateTime: true,
              customer: { select: { firstName: true, lastName: true, email: true } },
              vehicle: { select: { make: true, model: true, rego: true } },
            },
            orderBy: { pickupDateTime: "desc" },
            take: perGroup,
          }),

          ctx.prisma.vehicle.findMany({
            where: {
              deletedAt: null,
              OR: [
                { internalCode: contains },
                { rego: contains },
                { vin: contains },
                { make: contains },
                { model: contains },
              ],
            },
            select: {
              id: true,
              internalCode: true,
              rego: true,
              make: true,
              model: true,
              year: true,
              status: true,
            },
            orderBy: { internalCode: "asc" },
            take: perGroup,
          }),

          ctx.prisma.user.findMany({
            where: {
              AND: [
                customerDirectoryUserWhere(),
                {
                  OR: [
                    { email: contains },
                    { firstName: contains },
                    { lastName: contains },
                    { phone: { contains: query } },
                    { customerProfile: { companyName: contains } },
                  ],
                },
              ],
            },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
            orderBy: { createdAt: "desc" },
            take: perGroup,
          }),

          ctx.prisma.payment.findMany({
            where: {
              deletedAt: null,
              bookingId: { not: null },
              OR: [{ receiptNumber: contains }, { reference: contains }],
            },
            select: {
              id: true,
              receiptNumber: true,
              reference: true,
              amount: true,
              booking: { select: { id: true, bookingReference: true } },
            },
            orderBy: { createdAt: "desc" },
            take: perGroup,
          }),

          ctx.prisma.invoice.findMany({
            where: {
              deletedAt: null,
              bookingId: { not: null },
              invoiceNumber: contains,
            },
            select: {
              id: true,
              invoiceNumber: true,
              status: true,
              totalAmount: true,
              issuedAt: true,
              booking: { select: { id: true, bookingReference: true } },
            },
            orderBy: { createdAt: "desc" },
            take: perGroup,
          }),
        ]);

      const toMoney = (d: Prisma.Decimal) => d.toFixed(2);

      return {
        bookings: bookings.map((b) => ({
          id: b.id,
          href: `/staff/bookings/${b.id}`,
          reference: b.bookingReference,
          status: b.status,
          pickupDateTime: b.pickupDateTime,
          returnDateTime: b.returnDateTime,
          customerName: customerName(b.customer),
          vehicleLabel: b.vehicle
            ? `${b.vehicle.make} ${b.vehicle.model}${b.vehicle.rego ? ` · ${b.vehicle.rego}` : ""}`
            : null,
        })),
        vehicles: vehicles.map((v) => ({
          id: v.id,
          href: `/staff/fleet/vehicles/${v.id}`,
          internalCode: v.internalCode,
          rego: v.rego,
          label: `${v.make} ${v.model} (${v.year})`,
          status: v.status,
        })),
        customers: customers.map((c) => ({
          id: c.id,
          href: `/staff/customers/${c.id}`,
          name: customerName(c),
          email: c.email,
          phone: c.phone,
        })),
        receipts: receipts.map((p) => ({
          id: p.id,
          // booking is guaranteed present by the `bookingId: { not: null }` filter
          href: `/staff/bookings/${p.booking!.id}`,
          receiptNumber: p.receiptNumber ?? p.reference,
          amount: toMoney(p.amount),
          bookingReference: p.booking!.bookingReference,
        })),
        invoices: invoices.map((inv) => ({
          id: inv.id,
          href: `/staff/bookings/${inv.booking!.id}`,
          invoiceNumber: inv.invoiceNumber,
          status: inv.status,
          totalAmount: toMoney(inv.totalAmount),
          issuedAt: inv.issuedAt,
          bookingReference: inv.booking!.bookingReference,
        })),
      };
    }),
});
