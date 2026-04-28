"use client";

import { createContext, useContext } from "react";

export type WizardShellLayout = "desktop" | "mobile";

const WizardShellLayoutContext = createContext<WizardShellLayout>("desktop");

/**
 * Provided by each shell (`BookingShellDesktop` / `BookingShellMobile`).
 * Steps read it via `useWizardShellLayout()` to decide whether to render
 * their own inline Back/Continue buttons (desktop) or delegate to the
 * mobile shell's sticky bottom bar.
 *
 * Default is `"desktop"` so any step rendered outside a provider (tests,
 * Storybook) gets the richer layout by default.
 */
export function WizardShellLayoutProvider({
  layout,
  children,
}: {
  layout: WizardShellLayout;
  children: React.ReactNode;
}) {
  return (
    <WizardShellLayoutContext.Provider value={layout}>
      {children}
    </WizardShellLayoutContext.Provider>
  );
}

export function useWizardShellLayout(): WizardShellLayout {
  return useContext(WizardShellLayoutContext);
}
