"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Headset, Loader2, Paperclip, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";
import { useBranding } from "@/components/shared/branding-provider";

type Msg = {
  messageId: string;
  senderRole: "CUSTOMER" | "STAFF" | "AI" | "SYSTEM";
  body: string;
  attachments: Array<{ url: string; mimeType: string; name?: string }> | null;
  createdAt: string;
};

/**
 * Floating launcher on every public page. Appears ONLY when at least one
 * staff member has the live-view open. Opens a chat panel that reuses the
 * same message primitives as the support widget; messages are keyed to
 * the `scootering_vid` cookie so a visitor's thread follows them across
 * pages without any extra state.
 */
export function LiveChatLauncher() {
  const { siteName } = useBranding();
  const { data: online } = trpc.live.staffOnlineCount.useQuery(undefined, {
    refetchInterval: 30_000,
    staleTime: 5_000,
  });
  const staffOnline = (online?.count ?? 0) > 0;

  const [open, setOpen] = useState(false);
  const [liveMessages, setLiveMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [localConvId, setLocalConvId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const myConv = trpc.live.myConversation.useQuery(undefined, {
    enabled: open,
    refetchOnWindowFocus: false,
  });
  const openChat = trpc.live.visitorOpenChat.useMutation();
  const send = trpc.live.sendVisitorMessage.useMutation();

  const conversationId = localConvId ?? myConv.data?.id ?? null;

  type MessageRow = NonNullable<typeof myConv.data>["messages"][number];

  const messages = useMemo<Msg[]>(() => {
    const seen = new Set<string>();
    const out: Msg[] = [];
    for (const m of (myConv.data?.messages ?? []) as MessageRow[]) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push({
        messageId: m.id,
        senderRole: m.senderRole,
        body: m.body,
        attachments: (m.attachments as Msg["attachments"]) ?? null,
        createdAt: m.createdAt.toString(),
      });
    }
    for (const m of liveMessages) {
      if (seen.has(m.messageId)) continue;
      seen.add(m.messageId);
      out.push(m);
    }
    return out;
  }, [myConv.data, liveMessages]);

  useEffect(() => {
    if (!open || !conversationId) return;
    const es = new EventSource("/api/live/events");
    es.onmessage = (e) => {
      try {
        const payload = JSON.parse(e.data) as
          | { type: "ready" }
          | { type: "chat.message"; conversationId: string; messageId: string; senderRole: Msg["senderRole"]; body: string; attachments: Msg["attachments"]; createdAt: string };
        if (payload.type !== "chat.message") return;
        if (payload.conversationId !== conversationId) return;
        setLiveMessages((prev) =>
          prev.some((m) => m.messageId === payload.messageId)
            ? prev
            : [
                ...prev,
                {
                  messageId: payload.messageId,
                  senderRole: payload.senderRole,
                  body: payload.body,
                  attachments: payload.attachments,
                  createdAt: payload.createdAt,
                },
              ],
        );
      } catch {
        // ignore malformed frame
      }
    };
    return () => es.close();
  }, [open, conversationId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages.length]);

  async function handleSend() {
    if (!input.trim() || busy) return;
    setBusy(true);
    try {
      let convId = conversationId;
      if (!convId) {
        const res = await openChat.mutateAsync({ firstMessage: input });
        convId = res.conversationId;
        setLocalConvId(convId);
      } else {
        await send.mutateAsync({ conversationId: convId, body: input });
      }
      setInput("");
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(file: File) {
    let convId = conversationId;
    if (!convId) {
      const res = await openChat.mutateAsync({ firstMessage: `Attaching: ${file.name}` });
      convId = res.conversationId;
      setLocalConvId(convId);
    }
    const form = new FormData();
    form.append("file", file);
    form.append("conversationId", convId);
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
        conversationId: convId,
        body: `[Attachment: ${attach.name}]`,
        attachments: [attach],
      });
    } finally {
      setBusy(false);
    }
  }

  if (!staffOnline && !open) return null;

  return (
    <div className="fixed bottom-4 left-4 z-[59] flex flex-col items-start gap-3 sm:bottom-6 sm:left-6">
      {open && (
        <div
          role="dialog"
          aria-label="Live chat with staff"
          className={cn(
            "flex h-[520px] max-h-[calc(100vh-6rem)] w-[380px] max-w-[calc(100vw-2rem)]",
            "flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl",
          )}
        >
          <header className="flex items-center justify-between border-b bg-primary px-4 py-3 text-primary-foreground">
            <div>
              <p className="text-xs uppercase tracking-wider opacity-80">Live help</p>
              <h2 className="text-sm font-semibold">{`Chat with a ${siteName} rider`}</h2>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close live chat"
              className="rounded-md p-1 opacity-80 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 && (
              <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                {staffOnline
                  ? "A staff member is online — say hi and we'll jump in."
                  : "No staff online right now — leave a message and we'll reply by email."}
              </p>
            )}
            {messages.map((m) => (
              <MessageBubble key={m.messageId} msg={m} />
            ))}
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
                  const pastedFile = Array.from(e.clipboardData.files).find((f) =>
                    f.type.startsWith("image/"),
                  );
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
                placeholder="Ask or paste a screenshot…"
                rows={2}
                className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                disabled={busy}
              />
              <Button type="button" onClick={handleSend} disabled={busy || !input.trim()} size="icon">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
      )}

      <Button
        type="button"
        variant="cta"
        size="lg"
        onClick={() => setOpen((o) => !o)}
        aria-label={open ? "Close live chat" : "Chat with staff"}
      >
        {open ? (
          <X className="h-4 w-4" />
        ) : (
          <span className="inline-flex items-center gap-2">
            <Headset className="h-4 w-4" />
            <span className="relative flex items-center gap-2">
              Chat with staff
              <span className="relative flex h-2 w-2">
                <span className="absolute inset-0 animate-ping rounded-full bg-primary-foreground/70" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary-foreground" />
              </span>
            </span>
          </span>
        )}
      </Button>
    </div>
  );
}

function MessageBubble({ msg }: { msg: Msg }) {
  const mine = msg.senderRole === "CUSTOMER";
  return (
    <div className={mine ? "flex justify-end" : "flex justify-start"}>
      <div
        className={cn(
          "max-w-[85%] rounded-md px-3 py-2 text-sm whitespace-pre-wrap",
          mine ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
        )}
      >
        <p>{msg.body}</p>
        {msg.attachments?.map((a, i) => (
          <AttachmentPreview key={i} url={a.url} mime={a.mimeType} name={a.name} />
        ))}
      </div>
    </div>
  );
}

function AttachmentPreview({
  url,
  mime,
  name,
}: {
  url: string;
  mime: string;
  name?: string;
}) {
  if (mime.startsWith("image/")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt={name ?? "attachment"} className="mt-2 max-h-48 rounded-md" />
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="mt-2 block text-xs underline">
      {name ?? "Download file"}
    </a>
  );
}
