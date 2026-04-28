import { getBranding } from "@/lib/branding";
import { getSettings } from "@/lib/settings";
import { CANCELLATION_POLICY } from "@/lib/constants";
import { formatCurrency } from "@/lib/utils";

export default async function RefundPolicyPage() {
  const { siteName } = await getBranding();
  const overrides = await getSettings([
    "cancellation.fullRefundHours",
    "cancellation.halfRefundHours",
    "cancellation.adminFee",
    "cancellation.noShowFee",
  ] as const);
  const fullRefundHours =
    overrides["cancellation.fullRefundHours"] ?? CANCELLATION_POLICY.fullRefundHours;
  const halfRefundHours =
    overrides["cancellation.halfRefundHours"] ?? CANCELLATION_POLICY.halfRefundHours;
  const adminFee = overrides["cancellation.adminFee"] ?? CANCELLATION_POLICY.adminFee;
  const noShowFee = overrides["cancellation.noShowFee"] ?? CANCELLATION_POLICY.noShowFee;

  return (
    <div className="container max-w-3xl py-12">
      <h1 className="h-display">Cancellations &amp; refunds</h1>
      <p className="text-muted-foreground">GST-inclusive · Australian Consumer Law applies</p>

      <section className="mt-8 space-y-6 text-sm leading-relaxed">
        <div>
          <h2 className="h3">Cancellation policy</h2>
          <p className="mt-2">
            Cancel any booking with {siteName} up to the scheduled pickup time. The refund
            depends on how close to pickup you cancel:
          </p>
          <ul className="mt-3 space-y-2">
            <li>
              <strong>More than {fullRefundHours} hours before pickup:</strong> full refund of
              what you&apos;ve paid, less a {formatCurrency(adminFee)} admin fee.
            </li>
            <li>
              <strong>
                Between {halfRefundHours} and {fullRefundHours} hours before pickup:
              </strong>{" "}
              50% refund, less a {formatCurrency(adminFee)} admin fee.
            </li>
            <li>
              <strong>Less than {halfRefundHours} hours before pickup:</strong> no refund. The
              booking is forfeited.
            </li>
          </ul>
          <p className="mt-3 text-muted-foreground">
            The admin fee is never more than the refund itself — if the refund would be smaller
            than {formatCurrency(adminFee)} we just refund the smaller amount.
          </p>
        </div>

        <div>
          <h2 className="h3">Bond holds</h2>
          <p className="mt-2">
            Any bond we&apos;ve authorised on your card is released as soon as the cancellation
            is confirmed. Funds usually return to your account within 5–10 business days,
            depending on your bank.
          </p>
        </div>

        <div>
          <h2 className="h3">No-shows</h2>
          <p className="mt-2">
            If you don&apos;t arrive for your booking and don&apos;t cancel, the booking is
            forfeited and a {formatCurrency(noShowFee)} no-show fee applies. Call the depot as
            soon as you know you&apos;ll be late so we can help.
          </p>
        </div>

        <div>
          <h2 className="h3">Extending your booking</h2>
          <p className="mt-2">
            You can extend your return date from your dashboard up until you return the vehicle.
            Extra days are priced at current daily rates and charged to the card on file.
          </p>
        </div>

        <div>
          <h2 className="h3">Early return</h2>
          <p className="mt-2">
            Returning the vehicle early is always welcome. Partial refunds for unused whole days
            are assessed at return by the depot team.
          </p>
        </div>

        <div>
          <h2 className="h3">How to cancel</h2>
          <p className="mt-2">
            Sign in and open your booking from the customer dashboard — the <em>Cancel
            booking</em> button shows the refund you&apos;ll receive before you confirm. If your
            booking is part of a subscription or already picked up, contact support and
            we&apos;ll take it from there.
          </p>
        </div>

        <div>
          <h2 className="h3">Your consumer rights</h2>
          <p className="mt-2">
            Nothing in this policy limits your rights under the Australian Consumer Law. If the
            vehicle has a major failure, you&apos;re entitled to a refund or replacement
            regardless of the cancellation window.
          </p>
        </div>
      </section>
    </div>
  );
}
