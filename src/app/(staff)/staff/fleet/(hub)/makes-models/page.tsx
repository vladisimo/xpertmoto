import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { getSSRHelpers } from "@/lib/trpc/ssr";
import { FleetMakesModelsTab } from "@/components/fleet/fleet-makes-models-tab";

export default async function FleetMakesModelsPage() {
  const helpers = await getSSRHelpers();
  await helpers.vehicleModel.list.prefetch();
  return (
    <HydrationBoundary state={dehydrate(helpers.queryClient)}>
      <FleetMakesModelsTab />
    </HydrationBoundary>
  );
}
