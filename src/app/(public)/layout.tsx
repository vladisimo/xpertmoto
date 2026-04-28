import { auth, signOut } from "@/lib/auth";
import { PublicHeader } from "@/components/layout/public-header";
import { PublicMain } from "@/components/layout/public-main";
import { PublicFooter } from "@/components/layout/public-footer";
import { HideOnBooking } from "@/components/layout/hide-on-booking";
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
      <PublicHeader user={user} signOutAction={handleSignOut} />
      <PublicMain>{children}</PublicMain>
      <ReviewsShowcaseSlot>
        <ReviewsShowcase />
      </ReviewsShowcaseSlot>
      <HideOnBooking>
        <PublicFooter />
      </HideOnBooking>
      <VisitorHeartbeatMount />
      <VisitorEventsMount />
      <LiveChatLauncher />
    </div>
  );
}
