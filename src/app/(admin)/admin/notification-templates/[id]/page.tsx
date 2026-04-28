import { notFound } from "next/navigation";

import { TemplateEditor } from "@/components/communications/template-editor";
import { PageHeader } from "@/components/layout/page-header";
import { PageSection, PageShell } from "@/components/layout/page-section";
import { prisma } from "@/lib/prisma";

export default async function TemplateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const template = await prisma.notificationTemplate.findUnique({
    where: { id },
    include: {
      versions: {
        take: 20,
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true, updatedById: true, subject: true },
      },
    },
  });
  if (!template) notFound();

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administration · Templates"
        title={template.name}
        description={template.description ?? `Type: ${template.type ?? "—"} · Key: ${template.key}`}
      />
      <PageSection>
        <TemplateEditor
          template={{
            id: template.id,
            key: template.key,
            type: template.type,
            category: template.category,
            name: template.name,
            description: template.description,
            channels: template.channels,
            subject: template.subject,
            bodyTemplate: template.bodyTemplate,
            emailBodyHtml: template.emailBodyHtml,
            format: template.format,
            variables: template.variables,
          }}
        />
      </PageSection>

      {template.versions.length > 0 && (
        <PageSection>
          <h2 className="h3">Version history</h2>
          <ul className="space-y-1">
            {template.versions.map((v) => (
              <li key={v.id} className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm">
                <span className="text-muted-foreground">
                  {new Date(v.createdAt).toLocaleString("en-AU")}
                </span>
                <span className="truncate text-xs">{v.subject ?? "—"}</span>
              </li>
            ))}
          </ul>
        </PageSection>
      )}
    </PageShell>
  );
}
