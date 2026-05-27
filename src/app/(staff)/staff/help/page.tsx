import type { Metadata } from "next";
import { HelpShell } from "@/components/help/help-shell";
import { HelpCenter } from "@/components/help/help-center";

export const metadata: Metadata = { title: "Help & guides" };

export default function StaffHelpPage() {
  return (
    <HelpShell basePath="/staff/help">
      <HelpCenter basePath="/staff/help" />
    </HelpShell>
  );
}
