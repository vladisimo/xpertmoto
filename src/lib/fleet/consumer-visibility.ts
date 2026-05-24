import type { Prisma } from "@prisma/client";

/**
 * Consumer-facing visibility rules for the fleet. Internal/service vehicles
 * (delivery vans, etc.) are flagged `VehicleModel.isRentable = false` and must
 * never appear on public fleet pages or in the booking wizard. Centralising the
 * where-clauses here keeps every consumer surface in lockstep — see the
 * `add_vehicle_model_is_rentable` migration for the data backfill.
 */

/**
 * A VehicleModel is consumer-visible when it is flagged rentable and has at
 * least one active unit. Spread into a `VehicleModel` where-clause; add
 * `useCases` / other filters alongside.
 */
export const RENTABLE_MODEL_WHERE = {
  isRentable: true,
  vehicles: { some: { isActive: true } },
} satisfies Prisma.VehicleModelWhereInput;

/**
 * A category is consumer-visible when it has an active unit belonging to a
 * rentable model. Combine with `isActive: true` on the category where-clause.
 */
export const CATEGORY_HAS_RENTABLE_VEHICLE = {
  vehicles: { some: { isActive: true, catalogueModel: { isRentable: true } } },
} satisfies Prisma.VehicleCategoryWhereInput;
