import { redirect } from "next/navigation";

export default async function VehicleRegistryRedirect({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; depotId?: string }>;
}) {
  const sp = await searchParams;
  const params = new URLSearchParams({ tab: "vehicles" });
  if (sp.q) params.set("q", sp.q);
  if (sp.status) params.set("status", sp.status);
  if (sp.depotId) params.set("depotId", sp.depotId);
  redirect(`/staff/fleet?${params.toString()}`);
}
