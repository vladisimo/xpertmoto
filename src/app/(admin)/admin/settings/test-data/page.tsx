import { notFound } from "next/navigation";
import { SettingsTabBody } from "@/components/admin/settings/settings-tab-body";

/** Dev-only test-data injector; hidden (404) in production and absent from the section bar. */
export default function SettingsTestDataPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <SettingsTabBody tabKey="testData" />;
}
