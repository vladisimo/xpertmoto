import { redirect } from "next/navigation";

/**
 * Phase B — the old "Settle & close" screen has been folded into the
 * unified Payment Console on the booking detail page. Anyone who still
 * deep-links here lands on the Payments & charges tab where the same
 * work now happens (with interactive charges, bond, billing plan, and
 * refund controls on one surface).
 */
export default async function LegacySettleRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/staff/bookings/${id}?tab=payments`);
}
