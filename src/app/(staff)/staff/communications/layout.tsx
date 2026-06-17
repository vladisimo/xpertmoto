import { SectionShell } from "@/components/layout/section-shell";

/**
 * Wraps every /staff/communications route in the Communications section rail
 * (lg+). Each page keeps rendering its own <CommsTabs /> as the horizontal
 * fallback below lg.
 */
export default function CommunicationsLayout({ children }: { children: React.ReactNode }) {
  return <SectionShell section="comms">{children}</SectionShell>;
}
