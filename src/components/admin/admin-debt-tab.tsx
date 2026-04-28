import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { DebtorsPanel } from "@/components/admin/debtors-panel";
import {
  debtorsList,
  debtorsSummary,
  unpaidInfringementsSummary,
} from "@/server/services/admin-risk-signals";

export async function AdminDebtTab() {
  const [summary, infringements, debtors] = await Promise.all([
    debtorsSummary(),
    unpaidInfringementsSummary(),
    debtorsList(100),
  ]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Kpi
          label="Total owed"
          value={formatCurrency(summary.totalOwed)}
          hint={`${summary.debtorCount} customers`}
        />
        <Kpi
          label="Booking balances"
          value={formatCurrency(summary.bookingPortion)}
          hint="balanceDue on open bookings"
        />
        <Kpi
          label="Overdue invoices"
          value={formatCurrency(summary.invoicePortion)}
        />
        <Kpi
          label="Unpaid infringements"
          value={formatCurrency(infringements.totalAmount)}
          hint={`${infringements.totalCount} items`}
        />
      </div>

      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Customers who owe money</CardTitle>
          <p className="text-caption text-muted-foreground">
            Reminders fire automatically daily at 9am AEST. Use the button to send one
            manually; each customer gets at most one reminder per 7 days.
          </p>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col overflow-hidden p-0">
          <div className="min-h-0 flex-1 overflow-auto">
            <DebtorsPanel debtors={debtors} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-normal text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="font-display text-2xl font-semibold tracking-tight text-foreground">
          {value}
        </div>
        {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}
