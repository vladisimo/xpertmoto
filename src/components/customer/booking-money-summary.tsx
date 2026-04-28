import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils";

type BondLedgerSnapshot = {
  heldAmount: unknown;
  capturedAmount: unknown;
  status: "HELD" | "CAPTURED" | "RELEASED" | string;
} | null;

const BOND_CAPTION: Record<string, string> = {
  HELD: "Held on card",
  CAPTURED: "Captured",
  RELEASED: "Released",
};

function Tile({
  label,
  value,
  caption,
  tone,
}: {
  label: string;
  value: string;
  caption?: string;
  tone?: "primary" | "warning" | "muted";
}) {
  return (
    <div className="rounded-lg border bg-card p-3 text-card-foreground sm:p-4">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground sm:text-xs">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-lg font-semibold tabular-nums sm:text-2xl",
          tone === "primary" && "text-primary",
          tone === "warning" && "text-destructive",
        )}
      >
        {value}
      </p>
      {caption && (
        <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground sm:text-xs">
          {caption}
        </p>
      )}
    </div>
  );
}

export function BookingMoneySummary({
  amountPaid,
  balanceDue,
  bondAmount,
  bondLedger,
}: {
  amountPaid: unknown;
  balanceDue: unknown;
  bondAmount: unknown;
  bondLedger: BondLedgerSnapshot;
}) {
  const paid = Number(amountPaid);
  const remaining = Number(balanceDue);
  const authorisedBond = Number(bondAmount);
  const heldNet = bondLedger
    ? Math.max(
        0,
        Number(bondLedger.heldAmount) - Number(bondLedger.capturedAmount),
      )
    : 0;

  const remainingTone: "primary" | "warning" | "muted" =
    remaining > 0 ? "warning" : "muted";

  const bondValue = bondLedger ? heldNet : authorisedBond;
  const bondCaption = bondLedger
    ? (BOND_CAPTION[bondLedger.status as string] ?? "On record")
    : authorisedBond > 0
      ? "Authorised at pickup"
      : "Not required";

  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      <Tile
        label="Paid to date"
        value={formatCurrency(paid)}
        tone="primary"
      />
      <Tile
        label="Remaining"
        value={formatCurrency(remaining)}
        caption={remaining > 0 ? "Due at pickup" : "Settled"}
        tone={remainingTone}
      />
      <Tile
        label="Bond held"
        value={formatCurrency(bondValue)}
        caption={bondCaption}
      />
    </div>
  );
}
