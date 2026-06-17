import { PlatformPageShell } from "@/components/admin/platform/platform-page-shell";
import { ServerTab } from "@/components/admin/platform/server-tab";

export default function PlatformServerPage() {
  return (
    <PlatformPageShell>
      <ServerTab />
    </PlatformPageShell>
  );
}
