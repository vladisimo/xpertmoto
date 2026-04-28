export const CACHE_TAGS = {
  DEPOTS: "depots",
  CATEGORIES: "categories",
  FLEET_PUBLIC: "fleet:public",
  PRICING: (vehicleId: string) => `pricing:${vehicleId}`,
  AVAILABILITY: (depotId: string, dateIso: string) => `availability:${depotId}:${dateIso}`,
  DASHBOARD: (depotId: string | null | undefined) => `dashboard:${depotId ?? "all"}`,
  CUSTOMER: (id: string) => `customer:${id}`,
} as const;

export const PRICING_TAG_PREFIX = "pricing:";
export const AVAILABILITY_TAG_PREFIX = "availability:";
export const DASHBOARD_TAG_PREFIX = "dashboard:";
export const CUSTOMER_TAG_PREFIX = "customer:";
