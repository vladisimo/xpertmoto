import { PlatformPageShell } from "@/components/admin/platform/platform-page-shell";
import { LlmTab } from "@/components/admin/platform/llm-tab";

export default function PlatformLlmPage() {
  return (
    <PlatformPageShell>
      <LlmTab />
    </PlatformPageShell>
  );
}
