import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { CommsTabs } from "@/components/communications/comms-tabs";
import { PageHeader } from "@/components/layout/page-header";
import { PageSection, PageShell } from "@/components/layout/page-section";
import { Button } from "@/components/ui/button";
import { renderCodeTemplatePreview } from "@/server/services/email-code-templates";

export default async function CodeTemplatePreviewPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const preview = await renderCodeTemplatePreview(key);
  if (!preview) notFound();
  const { meta, html } = preview;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operations · Templates · Built-in"
        title={meta.name}
        description={meta.description}
        actions={
          <Button asChild variant="outline">
            <Link href="/staff/communications/templates">
              <ArrowLeft className="h-4 w-4" />
              Back to templates
            </Link>
          </Button>
        }
      />

      <CommsTabs />

      <PageSection
        title="Details"
        description="This template is defined in code and rendered with sample data. To change it, edit the source file."
      >
        <dl className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between gap-4 border-b border-border py-1.5">
            <dt className="text-muted-foreground">Key</dt>
            <dd className="font-mono text-xs">{meta.key}</dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-border py-1.5">
            <dt className="text-muted-foreground">Category</dt>
            <dd>{meta.category}</dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-border py-1.5">
            <dt className="text-muted-foreground">Channels</dt>
            <dd>{meta.channels.join(", ")}</dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-border py-1.5">
            <dt className="text-muted-foreground">Source file</dt>
            <dd className="font-mono text-xs">{meta.file}</dd>
          </div>
        </dl>
      </PageSection>

      <PageSection title="Preview">
        <iframe
          title={`${meta.name} email preview`}
          srcDoc={html}
          // allow-same-origin (without allow-scripts) keeps scripts blocked
          // but gives the srcdoc a real origin — an opaque origin can't load
          // same-host images through our Cross-Origin-Resource-Policy:
          // same-origin response header.
          sandbox="allow-same-origin"
          className="h-[800px] w-full rounded-md border border-border bg-white"
        />
      </PageSection>
    </PageShell>
  );
}
