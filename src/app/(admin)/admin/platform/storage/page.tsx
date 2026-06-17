import { PlatformPageShell } from "@/components/admin/platform/platform-page-shell";
import { StorageTab } from "@/components/admin/platform/storage-tab";

export default function PlatformStoragePage() {
  return (
    <PlatformPageShell>
      <StorageTab />
    </PlatformPageShell>
  );
}
