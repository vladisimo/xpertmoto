"use client";
import { SessionProvider } from "next-auth/react";

/**
 * Minimal shell for the onboarding wizard. SessionProvider is required so
 * the wizard's final-step `useSession().update()` call can drop the
 * `requiresOnboarding` flag without a full page reload.
 *
 * No portal sidebar / staff chrome — we want a single-purpose surface
 * that focuses the customer on completing the gate.
 */
export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
