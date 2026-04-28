"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Paperclip, Send, User2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { StatusBadge } from "@/components/ui/status-badge";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import {
  useLiveVisitors,
  type LiveChatMessage,
  type LiveVisitor,
  type LiveVisitorCart,
} from "@/stores/live-visitors";

const EMPTY_MESSAGES: LiveChatMessage[] = [];

const WIZARD_STEP_LABEL: Record<number, string> = {
  1: "Step 1 · Search",
  2: "Step 2 · Vehicle",
  3: "Step 3 · Extras",
  4: "Step 4 · Details",
  5: "Step 5 · Review",
  6: "Step 6 · Payment",
};

export function LiveConsole() {
  const { data: initial } = trpc.live.activeVisitors.useQuery(undefined, {
    refetchOnWindowFocus: false,
    staleTime: 10_000,
    // Refetch on the same cadence as a client heartbeat so cart
    // contents stay fresh (SSE events don't carry cart data).
    refetchInterval: 20_000,
  });
  const hydrate = useLiveVisitors((s) => s.hydrate);
  const upsertFromEvent = useLiveVisitors((s) => s.upsertFromEvent);
  const appendChat = useLiveVisitors((s) => s.appendChat);
  const pruneInactive = useLiveVisitors((s) => s.pruneInactive);
  const visitors = useLiveVisitors((s) => s.visitors);
  const selectedConversationId = useLiveVisitors((s) => s.selectedConversationId);
  const select = useLiveVisitors((s) => s.select);

  const visitorList = useMemo(
    () => Object.values(visitors).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)),
    [visitors],
  );

  useEffect(() => {
    if (initial) hydrate(initial);
  }, [initial, hydrate]);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "default") {
      void Notification.requestPermission().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const es = new EventSource("/api/live/events?role=staff");
    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data) as
          | { type: "ready" }
          | { type: "staff.online"; count: number }
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
          | { type: "presence.offline"; sessionId: string }
          | {
              type: "chat.message";
              conversationId: string;
              messageId: string;
              senderRole: "CUSTOMER" | "STAFF" | "AI" | "SYSTEM";
              body: string;
              attachments: unknown[] | null;
              createdAt: string;
            };
        if (payload.type === "presence.upsert") {
          const isNew = !useLiveVisitors.getState().visitors[payload.sessionId];
          upsertFromEvent(payload);
          if (isNew) notifyNewVisitor(payload);
        } else if (payload.type === "presence.offline") {
          upsertFromEvent(payload);
        } else if (payload.type === "chat.message") {
          appendChat(payload);
        }
      } catch {
        // ignore malformed frame
      }
    };
    const prune = setInterval(pruneInactive, 15_000);
    return () => {
      es.close();
      clearInterval(prune);
    };
  }, [upsertFromEvent, appendChat, pruneInactive]);

  const selectedVisitor = useMemo(
    () =>
      selectedConversationId
        ? visitorList.find((v) => v.conversationId === selectedConversationId) ?? null
        : null,
    [selectedConversationId, visitorList],
  );

  const columns: DataTableColumn<LiveVisitor>[] = [
    {
      id: "visitor",
      header: "Visitor",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-muted-foreground">
            {row.displayName ? row.displayName[0]?.toUpperCase() : <User2 className="h-3.5 w-3.5" />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-sm font-medium">{row.displayName ?? "Guest"}</p>
              {row.atRisk && (
                <StatusBadge
                  status="AT_RISK"
                  title="Fired exit-intent in the last 5 min with wizard partly filled"
                />
              )}
            </div>
            <p className="truncate text-xs text-muted-foreground">{row.sessionId.slice(0, 10)}…</p>
          </div>
        </div>
      ),
    },
    {
      id: "path",
      header: "Page",
      cell: (row) => <span className="font-mono text-xs text-muted-foreground">{row.currentPath}</span>,
    },
    {
      id: "step",
      header: "Booking",
      cell: (row) =>
        row.wizardStep ? (
          <StatusBadge status="IN_PROGRESS" label={WIZARD_STEP_LABEL[row.wizardStep] ?? `Step ${row.wizardStep}`} />
        ) : (
          <span className="text-xs text-muted-foreground">Browsing</span>
        ),
    },
    {
      id: "cart",
      header: "Cart",
      cell: (row) => <CartSummary cart={row.cart} />,
    },
    {
      id: "dwell",
      header: "Here",
      accessor: (row) => new Date(row.startedAt).getTime(),
      sortable: true,
      cell: (row) => <DwellTime startedAt={row.startedAt} />,
    },
    {
      id: "lastSeen",
      header: "Last seen",
      accessor: (row) => new Date(row.lastSeenAt).getTime(),
      sortable: true,
      cell: (row) => <span className="text-xs text-muted-foreground"><RelativeTime iso={row.lastSeenAt} /></span>,
    },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-4">
        <DataTable<LiveVisitor>
          columns={columns}
          data={visitorList}
          getRowId={(r) => r.sessionId}
          onRowClick={(row) => select(row.conversationId)}
          rowActions={(row) => <ChatButton visitor={row} onOpened={(id) => select(id)} />}
          empty={
            <div className="space-y-1 py-4">
              <p>Nobody's browsing right now.</p>
              <p className="text-xs">When a visitor opens the site, they'll appear here within 20s.</p>
            </div>
          }
        />
      </div>

      <aside className="flex h-[640px] min-h-[480px] flex-col overflow-hidden rounded-md border bg-card">
        {selectedConversationId ? (
          <ChatPane
            conversationId={selectedConversationId}
            visitor={selectedVisitor}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
            Select a visitor with an open chat to reply.
          </div>
        )}
      </aside>
    </div>
  );
}

function ChatButton({
  visitor,
  onOpened,
}: {
  visitor: LiveVisitor;
  onOpened: (conversationId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const start = trpc.live.startChatWithVisitor.useMutation();

  async function handle() {
    setBusy(true);
    try {
      const prompt = visitor.wizardStep
        ? `Hey — I'm online if you need a hand with step ${visitor.wizardStep}.`
        : "Hey — I'm online if you'd like a hand.";
      const res = await start.mutateAsync({
        visitorSessionId: visitor.sessionId,
        firstMessage: prompt,
      });
      onOpened(res.conversationId);
    } finally {
      setBusy(false);
    }
  }

  if (visitor.conversationId) {
    return (
      <Button type="button" variant="secondary" size="sm" onClick={() => onOpened(visitor.conversationId!)}>
        Open chat
      </Button>
    );
  }
  return (
    <Button type="button" variant="default" size="sm" onClick={handle} disabled={busy}>
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Say hi"}
    </Button>
  );
}

function ChatPane({
  conversationId,
  visitor,
}: {
  conversationId: string;
  visitor: LiveVisitor | null;
}) {
  const thread = trpc.live.conversationThread.useQuery(
    { conversationId },
    { staleTime: 1_000 },
  );
  const liveMessages = useLiveVisitors((s) => s.chatByConv[conversationId]) ?? EMPTY_MESSAGES;
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const send = trpc.live.sendStaffMessage.useMutation();
  const fileInput = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const hydratedMessages = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{
      messageId: string;
      senderRole: "CUSTOMER" | "STAFF" | "AI" | "SYSTEM";
      body: string;
      attachments: Array<{ url: string; mimeType: string; name?: string }> | null;
      createdAt: string;
    }> = [];
    for (const m of thread.data?.messages ?? []) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push({
        messageId: m.id,
        senderRole: m.senderRole,
        body: m.body,
        attachments: (m.attachments as Array<{ url: string; mimeType: string; name?: string }>) ?? null,
        createdAt: m.createdAt.toString(),
      });
    }
    for (const m of liveMessages) {
      if (seen.has(m.messageId)) continue;
      seen.add(m.messageId);
      out.push({
        messageId: m.messageId,
        senderRole: m.senderRole,
        body: m.body,
        attachments: (m.attachments as Array<{ url: string; mimeType: string; name?: string }>) ?? null,
        createdAt: m.createdAt,
      });
    }
    return out;
  }, [thread.data, liveMessages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [hydratedMessages.length]);

  async function handleSend() {
    if (!input.trim() || busy) return;
    setBusy(true);
    try {
      await send.mutateAsync({ conversationId, body: input });
      setInput("");
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(file: File) {
    const form = new FormData();
    form.append("file", file);
    form.append("conversationId", conversationId);
    setBusy(true);
    try {
      const res = await fetch("/api/upload/live-chat", { method: "POST", body: form });
      if (!res.ok) throw new Error(await res.text());
      const attach = (await res.json()) as {
        url: string;
        key: string;
        mimeType: string;
        sizeBytes: number;
        name: string;
      };
      await send.mutateAsync({
        conversationId,
        body: `[Attachment: ${attach.name}]`,
        attachments: [attach],
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="border-b px-4 py-3">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Conversation</p>
        <h3 className="text-sm font-semibold">{visitor?.displayName ?? "Guest visitor"}</h3>
        <p className="truncate text-xs text-muted-foreground">{visitor?.currentPath ?? "(away)"}</p>
      </header>
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {hydratedMessages.length === 0 ? (
          <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">No messages yet.</p>
        ) : (
          hydratedMessages.map((m) => <StaffBubble key={m.messageId} msg={m} />)
        )}
      </div>
      <div className="border-t p-3">
        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="rounded-md border border-input p-2 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Attach file"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*,application/pdf,text/plain"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
              e.target.value = "";
            }}
          />
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={(e) => {
              const pastedFile = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
              if (pastedFile) {
                e.preventDefault();
                void handleFile(pastedFile);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            placeholder="Reply to the visitor…"
            rows={2}
            className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={busy}
          />
          <Button type="button" onClick={handleSend} disabled={busy || !input.trim()} size="icon">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </>
  );
}

function StaffBubble({
  msg,
}: {
  msg: {
    messageId: string;
    senderRole: "CUSTOMER" | "STAFF" | "AI" | "SYSTEM";
    body: string;
    attachments: Array<{ url: string; mimeType: string; name?: string }> | null;
    createdAt: string;
  };
}) {
  const mine = msg.senderRole === "STAFF";
  return (
    <div className={mine ? "flex justify-end" : "flex justify-start"}>
      <div
        className={cn(
          "max-w-[85%] rounded-md px-3 py-2 text-sm whitespace-pre-wrap",
          mine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
        )}
      >
        <p>{msg.body}</p>
        {msg.attachments?.map((a, i) => {
          if (a.mimeType?.startsWith("image/")) {
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={a.url}
                alt={a.name ?? "attachment"}
                className="mt-2 max-h-48 rounded-md"
              />
            );
          }
          return (
            <a
              key={i}
              href={a.url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 block text-xs underline"
            >
              {a.name ?? "Download file"}
            </a>
          );
        })}
      </div>
    </div>
  );
}

function CartSummary({ cart }: { cart: LiveVisitorCart | null }) {
  if (!cart) return <span className="text-xs text-muted-foreground">—</span>;
  const primary = cart.vehicleLabel ?? cart.categoryLabel ?? cart.depotLabel;
  const secondary: string[] = [];
  if (cart.vehicleLabel && cart.categoryLabel) secondary.push(cart.categoryLabel);
  if (cart.depotLabel && primary !== cart.depotLabel) secondary.push(cart.depotLabel);
  if (cart.discountCode) secondary.push(cart.discountCode);
  const total =
    cart.quotedTotalCents != null
      ? `$${(cart.quotedTotalCents / 100).toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : null;
  return (
    <div className="min-w-0 text-xs">
      {primary ? (
        <p className="truncate font-medium text-foreground">{primary}</p>
      ) : (
        <p className="text-muted-foreground">Searching…</p>
      )}
      {secondary.length > 0 && (
        <p className="truncate text-muted-foreground">{secondary.join(" · ")}</p>
      )}
      {total && <p className="tabular-nums text-primary">{total}</p>}
    </div>
  );
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(i);
  }, [intervalMs]);
  return now;
}

function DwellTime({ startedAt }: { startedAt: string }) {
  const now = useNow(15_000);
  const ms = now - new Date(startedAt).getTime();
  return <span className="text-xs text-muted-foreground">{formatDuration(ms)}</span>;
}

function RelativeTime({ iso }: { iso: string }) {
  const now = useNow(10_000);
  const ms = now - new Date(iso).getTime();
  return <>{formatDuration(ms)} ago</>;
}

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1000))}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${Math.round(ms / 3_600_000)}h`;
}

function notifyNewVisitor(v: {
  sessionId: string;
  displayName: string | null;
  currentPath: string;
  wizardStep: number | null;
}) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  const who = v.displayName ?? "A guest";
  const where = v.wizardStep
    ? WIZARD_STEP_LABEL[v.wizardStep] ?? `Step ${v.wizardStep}`
    : v.currentPath;
  try {
    const n = new Notification("New visitor on site", {
      body: `${who} · ${where}`,
      tag: `visitor-${v.sessionId}`,
      icon: "/favicon.ico",
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // Notifications can throw on some browsers/contexts — non-fatal
  }
}
