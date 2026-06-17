import { FleetSettingsTab } from "@/components/fleet/fleet-settings-tab";

export default async function FleetSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; depotId?: string }>;
}) {
  const sp = await searchParams;
  return <FleetSettingsTab q={sp.q} status={sp.status} depotId={sp.depotId} />;
}
