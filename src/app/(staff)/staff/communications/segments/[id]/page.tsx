import { notFound } from "next/navigation";

import { CommsTabs } from "@/components/communications/comms-tabs";
import { SegmentEditor } from "@/components/communications/segment-editor";
import { PageHeader } from "@/components/layout/page-header";
import { PageSection, PageShell } from "@/components/layout/page-section";
import { prisma } from "@/lib/prisma";
import { segmentFiltersSchema } from "@/lib/validators/segment";

export default async function SegmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const segment = await prisma.segment.findUnique({ where: { id } });
  if (!segment) notFound();

  const parsed = segmentFiltersSchema.safeParse(segment.filters);
  if (!parsed.success) notFound();

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operations · Segments"
        title={segment.name}
        description={segment.description ?? "Edit the filters below and save to update this audience."}
      />

      <CommsTabs />

      <PageSection>
        <SegmentEditor
          segmentId={segment.id}
          initialName={segment.name}
          initialDescription={segment.description ?? ""}
          initialFilters={parsed.data}
        />
      </PageSection>
    </PageShell>
  );
}
