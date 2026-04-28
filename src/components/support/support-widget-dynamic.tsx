"use client";

import dynamic from "next/dynamic";
import type { SupportWidgetProps } from "./support-widget";

const SupportWidget = dynamic(
  () => import("./support-widget").then((m) => m.SupportWidget),
  { ssr: false },
);

export function SupportWidgetDynamic(props: SupportWidgetProps) {
  return <SupportWidget {...props} />;
}
