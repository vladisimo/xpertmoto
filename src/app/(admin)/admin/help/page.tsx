import type { Metadata } from "next";
import { HelpShell } from "@/components/help/help-shell";
import { HelpCenter } from "@/components/help/help-center";

export const metadata: Metadata = { title: "Help & guides" };

export default function AdminHelpPage() {
  return (
    <HelpShell basePath="/admin/help">
      <HelpCenter basePath="/admin/help" />
    </HelpShell>
  );
}
