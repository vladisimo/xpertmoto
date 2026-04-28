import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/router";

export type VehicleDetail = inferRouterOutputs<AppRouter>["fleet"]["vehicleDetail"];
export type VehicleWithRelations = VehicleDetail["vehicle"];
