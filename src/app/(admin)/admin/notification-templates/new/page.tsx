import { PageHeader } from "@/components/layout/page-header";
import { PageSection, PageShell } from "@/components/layout/page-section";
import { TemplateEditor } from "@/components/communications/template-editor";

export default function NewTemplatePage() {
  return (
    <PageShell>
      <PageHeader
        eyebrow="Administration · Templates"
        title="New notification template"
        description="Create a template that can be used by automations, campaigns, or compose."
      />
      <PageSection>
        <TemplateEditor />
      </PageSection>
    </PageShell>
  );
}
