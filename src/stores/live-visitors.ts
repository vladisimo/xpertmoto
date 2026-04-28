"use client";

import { create } from "zustand";

export type LiveVisitorCart = {
  depotLabel: string | null;
  categoryLabel: string | null;
  vehicleLabel: string | null;
  discountCode: string | null;
  quotedTotalCents: number | null;
};

export type LiveVisitor = {
  sessionId: string;
  userId: string | null;
  displayName: string | null;
  currentPath: string;
  wizardStep: number | null;
  startedAt: string;
  lastSeenAt: string;
  conversationId: string | null;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  cart: LiveVisitorCart | null;
  /**
   * True when the visitor fired EXIT_INTENT in the last 5 minutes
   * while somewhere in the booking wizard. Signals a "pounce now"
   * moment for staff.
   */
  atRisk: boolean;
};

export type LiveChatMessage = {
  conversationId: string;
  messageId: string;
  senderRole: "CUSTOMER" | "STAFF" | "AI" | "SYSTEM";
  body: string;
  attachments: unknown[] | null;
  createdAt: string;
};

type State = {
  visitors: Record<string, LiveVisitor>;
  chatByConv: Record<string, LiveChatMessage[]>;
  selectedConversationId: string | null;
  hydrate: (rows: LiveVisitor[]) => void;
  upsertFromEvent: (
    event:
      | {
          type: "presence.upsert";
          sessionId: string;
          currentPath: string;
          wizardStep: number | null;
          displayName: string | null;
          userId: string | null;
          startedAt: string;
          lastSeenAt: string;
        }
      | { type: "presence.offline"; sessionId: string },
  ) => void;
  appendChat: (msg: LiveChatMessage) => void;
  pruneInactive: () => void;
  select: (conversationId: string | null) => void;
};

const STALE_AFTER_MS = 60_000;

export const useLiveVisitors = create<State>((set, get) => ({
  visitors: {},
  chatByConv: {},
  selectedConversationId: null,

  hydrate(rows) {
    const next: Record<string, LiveVisitor> = {};
    for (const r of rows) next[r.sessionId] = r;
    set({ visitors: next });
  },

  upsertFromEvent(event) {
    if (event.type === "presence.offline") {
      set((s) => {
        const copy = { ...s.visitors };
        delete copy[event.sessionId];
        return { visitors: copy };
      });
      return;
    }
    set((s) => {
      const existing = s.visitors[event.sessionId];
      return {
        visitors: {
          ...s.visitors,
          [event.sessionId]: {
            sessionId: event.sessionId,
            userId: event.userId,
            displayName: event.displayName,
            currentPath: event.currentPath,
            wizardStep: event.wizardStep,
            startedAt: event.startedAt,
            lastSeenAt: event.lastSeenAt,
            conversationId: existing?.conversationId ?? null,
            lastMessageAt: existing?.lastMessageAt ?? null,
            lastMessagePreview: existing?.lastMessagePreview ?? null,
            // Presence events don't carry cart or atRisk info — preserve
            // the last snapshot from `activeVisitors` until the periodic
            // refetch. atRisk is server-computed from the EXIT_INTENT
            // event stream per-session and decays on the next refetch.
            cart: existing?.cart ?? null,
            atRisk: existing?.atRisk ?? false,
          },
        },
      };
    });
  },

  appendChat(msg) {
    set((s) => {
      const existing = s.chatByConv[msg.conversationId] ?? [];
      if (existing.some((m) => m.messageId === msg.messageId)) return s;
      return {
        chatByConv: {
          ...s.chatByConv,
          [msg.conversationId]: [...existing, msg],
        },
      };
    });
  },

  pruneInactive() {
    const cutoff = Date.now() - STALE_AFTER_MS;
    const next: Record<string, LiveVisitor> = {};
    for (const v of Object.values(get().visitors)) {
      if (new Date(v.lastSeenAt).getTime() >= cutoff) next[v.sessionId] = v;
    }
    set({ visitors: next });
  },

  select(conversationId) {
    set({ selectedConversationId: conversationId });
  },
}));
