import { CommsTabs } from "@/components/communications/comms-tabs";
import { SegmentEditor } from "@/components/communications/segment-editor";
import { PageHeader } from "@/components/layout/page-header";
import { PageSection, PageShell } from "@/components/layout/page-section";

export default function NewSegmentPage() {
  return (
    <PageShell>
      <PageHeader
        eyebrow="Operations · Segments"
        title="New segment"
        description="Build a reusable audience filter for campaigns. All filters are ANDed together."
      />

      <CommsTabs />

      <PageSection>
        <SegmentEditor />
      </PageSection>
    </PageShell>
  );
}
