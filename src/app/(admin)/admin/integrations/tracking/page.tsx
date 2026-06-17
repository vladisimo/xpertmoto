import { IntegrationsTabTracking } from "@/components/admin/integration-tabs";

/** GPS tracking — fetches its own status; not surfaced in the section bar. */
export default function IntegrationsTrackingPage() {
  return <IntegrationsTabTracking />;
}
