import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getSupportConfig, toPublicConfig } from "@/lib/support-config";
import { SupportWidgetDynamic } from "./support-widget-dynamic";

/**
 * Server component gate for the floating support widget.
 *
 * Mounted in the root layout. Returns null on:
 *   - /staff/**, /admin/** (staff have their own support inbox)
 *   - /login, /register, /forgot-password (auth flows)
 *   - /booking/** (the wizard owns its own bottom-bar UX; the floating
 *     chat bubble overlapping the sticky CTA is confusing on mobile)
 * Returns the client widget everywhere else (marketing, customer
 * portal).
 */
export async function SupportWidgetGate(): Promise<React.ReactElement | null> {
  const cfg = getSupportConfig();
  if (!cfg.enabled) return null;

  const h = await headers();
  const path = h.get("x-audit-path") ?? h.get("x-pathname") ?? "";

  if (
    path.startsWith("/staff") ||
    path.startsWith("/admin") ||
    path.startsWith("/login") ||
    path.startsWith("/register") ||
    path.startsWith("/forgot-password") ||
    path.startsWith("/booking") ||
    path.startsWith("/api")
  ) {
    return null;
  }

  const session = await auth();
  const customer = session?.user
    ? {
        id: session.user.id,
        firstName: session.user.name?.split(" ")[0] ?? null,
      }
    : null;

  return <SupportWidgetDynamic config={toPublicConfig(cfg)} customer={customer} />;
}
