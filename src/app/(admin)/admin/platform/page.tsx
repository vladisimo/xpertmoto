import { PlatformPageShell } from "@/components/admin/platform/platform-page-shell";
import { DatabaseTab } from "@/components/admin/platform/database-tab";

/** Default tab — served at /admin/platform. */
export default function PlatformDatabasePage() {
  return (
    <PlatformPageShell>
      <DatabaseTab />
    </PlatformPageShell>
  );
}
