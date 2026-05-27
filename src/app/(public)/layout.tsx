import { auth, signOut } from "@/lib/auth";
import { PublicHeader } from "@/components/layout/public-header";
import { PublicMain } from "@/components/layout/public-main";
import { PublicFooter } from "@/components/layout/public-footer";
import { HideOnRoute } from "@/components/layout/hide-on-route";
import { ReviewsShowcase } from "@/components/marketing/reviews-showcase";
import { ReviewsShowcaseSlot } from "@/components/marketing/reviews-showcase-slot";
import { VisitorHeartbeatMount } from "@/components/live/visitor-heartbeat-mount";
import { VisitorEventsMount } from "@/components/live/visitor-events-mount";
import { LiveChatLauncher } from "@/components/live/live-chat-launcher";

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const user = session?.user
    ? {
        name: session.user.name ?? null,
        email: session.user.email ?? null,
        image: session.user.image ?? null,
        role: session.user.role,
      }
    : null;

  async function handleSignOut() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <HideOnRoute prefixes={["/why-xpert"]}>
        <PublicHeader user={user} signOutAction={handleSignOut} />
      </HideOnRoute>
      <PublicMain>{children}</PublicMain>
      <HideOnRoute prefixes={["/why-xpert"]}>
        <ReviewsShowcaseSlot>
          <ReviewsShowcase />
        </ReviewsShowcaseSlot>
      </HideOnRoute>
      <HideOnRoute prefixes={["/booking", "/why-xpert"]}>
        <PublicFooter />
      </HideOnRoute>
      <VisitorHeartbeatMount />
      <VisitorEventsMount />
      <HideOnRoute prefixes={["/why-xpert"]}>
        <LiveChatLauncher />
      </HideOnRoute>
    </div>
  );
}
