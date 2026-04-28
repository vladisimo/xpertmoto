"use client";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type WidgetStep = "triage" | "form" | "chat" | "sent";
export type WidgetCategory = "ABANDONED_VEHICLE" | "BREAKDOWN" | "PAYMENT" | "GENERAL";

interface SupportWidgetState {
  isOpen: boolean;
  step: WidgetStep;
  conversationId: string | null;
  selectedCategory: WidgetCategory | null;
  ticketNumber: string | null;
  open(): void;
  close(): void;
  toggle(): void;
  setStep(step: WidgetStep): void;
  setConversationId(id: string | null): void;
  setCategory(cat: WidgetCategory | null): void;
  setTicketNumber(n: string | null): void;
  reset(): void;
}

export const useSupportWidget = create<SupportWidgetState>()(
  persist(
    (set) => ({
      isOpen: false,
      step: "triage",
      conversationId: null,
      selectedCategory: null,
      ticketNumber: null,
      open: () => set({ isOpen: true }),
      close: () => set({ isOpen: false }),
      toggle: () => set((s) => ({ isOpen: !s.isOpen })),
      setStep: (step) => set({ step }),
      setConversationId: (conversationId) => set({ conversationId }),
      setCategory: (selectedCategory) => set({ selectedCategory }),
      setTicketNumber: (ticketNumber) => set({ ticketNumber }),
      reset: () =>
        set({
          step: "triage",
          conversationId: null,
          selectedCategory: null,
          ticketNumber: null,
        }),
    }),
    {
      name: "scootering-support-widget",
      storage: createJSONStorage(() => localStorage),
      // Only persist conversationId so the user can reopen a session.
      partialize: (s) => ({
        conversationId: s.conversationId,
        ticketNumber: s.ticketNumber,
      }),
    },
  ),
);
