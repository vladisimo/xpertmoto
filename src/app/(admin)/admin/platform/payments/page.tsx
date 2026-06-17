import { PlatformPageShell } from "@/components/admin/platform/platform-page-shell";
import { PaymentsTab } from "@/components/admin/platform/payments-tab";

export default function PlatformPaymentsPage() {
  return (
    <PlatformPageShell>
      <PaymentsTab />
    </PlatformPageShell>
  );
}
