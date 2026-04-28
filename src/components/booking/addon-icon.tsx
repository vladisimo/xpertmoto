import {
  Briefcase,
  CloudRain,
  HardHat,
  LifeBuoy,
  Lock,
  MapPin,
  PackageCheck,
  Shield,
  Smartphone,
  Truck,
  type LucideIcon,
} from "lucide-react";
import type { AddonType } from "@prisma/client";

const ADDON_ICON_MAP: Record<AddonType, LucideIcon> = {
  HELMET: HardHat,
  LOCK: Lock,
  PHONE_MOUNT: Smartphone,
  GPS: MapPin,
  PANNIERS: Briefcase,
  RAIN_GEAR: CloudRain,
  EXTRA_INSURANCE: Shield,
  ROADSIDE_ASSIST: LifeBuoy,
  DELIVERY: Truck,
  PICKUP: PackageCheck,
};

export function AddonIcon({
  type,
  className,
}: {
  type: AddonType;
  className?: string;
}) {
  const Icon = ADDON_ICON_MAP[type] ?? Shield;
  return <Icon className={className} aria-hidden="true" />;
}
