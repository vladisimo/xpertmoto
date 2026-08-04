import { Suspense } from "react";
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

async function handleSignOut() {
  "use server";
  await signOut({ redirectTo: "/" });
}

/**
 * Reading the session (cookies) is dynamic, so doing it at the top of the
 * layout would taint the whole subtree — the page body would render as a
 * dynamic hole streamed inside an inert `<template>` that no-JS SEO crawlers
 * ignore (this is why an external audit reported the homepage as having no
 * `<h1>` and few links). Isolating the session read in its own async component
 * behind `<Suspense>` lets the page body and footer prerender statically (PPR);
 * only the header's auth state streams in. The fallback renders the logged-out
 * header, so the static HTML still carries the full primary nav.
 */
async function PublicHeaderSlot() {
  const session = await auth();
  const user = session?.user
    ? {
        name: session.user.name ?? null,
        email: session.user.email ?? null,
        image: session.user.image ?? null,
        role: session.user.role,
      }
    : null;
  return <PublicHeader user={user} signOutAction={handleSignOut} />;
}

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <HideOnRoute prefixes={["/why-xpert"]}>
        <Suspense fallback={<PublicHeader user={null} signOutAction={handleSignOut} />}>
          <PublicHeaderSlot />
        </Suspense>
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
