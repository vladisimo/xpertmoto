import { PlatformPageShell } from "@/components/admin/platform/platform-page-shell";
import { ObservabilityTab } from "@/components/admin/platform/observability-tab";

/**
 * Observability owns its own vertical space: the daily-series table scrolls
 * internally rather than growing the page, so this route uses the full shell.
 */
export default function PlatformObservabilityPage() {
  return (
    <PlatformPageShell full>
      <ObservabilityTab />
    </PlatformPageShell>
  );
}
