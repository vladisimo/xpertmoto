"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Send, ThumbsDown, ThumbsUp } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { useSupportWidget } from "@/stores/support-widget";
import { trpc } from "@/lib/trpc/client";
import { useBranding } from "@/components/shared/branding-provider";

type ChatBubble = { id: string; who: "user" | "ai" | "system"; text: string };

// `crypto.randomUUID()` is only available on secure contexts; fall back
// to a timestamp + counter so the widget works over plain http in dev.
let bubbleCounter = 0;
function newBubbleId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  bubbleCounter += 1;
  return `b-${Date.now()}-${bubbleCounter}`;
}

export function SupportChatPanel({ hasCustomer }: { hasCustomer: boolean }) {
  const { siteName } = useBranding();
  const { conversationId, setStep, setTicketNumber } = useSupportWidget();
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [bubbles, setBubbles] = useState<ChatBubble[]>([]);
  const [showFeedback, setShowFeedback] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const feedback = trpc.support.submitFeedback.useMutation();

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [bubbles]);

  async function send() {
    if (!conversationId || !input.trim() || sending) return;
    const userBubble: ChatBubble = {
      id: newBubbleId(),
      who: "user",
      text: input,
    };
    const aiBubble: ChatBubble = {
      id: newBubbleId(),
      who: "ai",
      text: "",
    };
    setBubbles((b) => [...b, userBubble, aiBubble]);
    setInput("");
    setSending(true);

    try {
      const res = await fetch("/api/support/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message: userBubble.text }),
      });
      if (!res.ok || !res.body) {
        setBubbles((b) =>
          b.map((x) =>
            x.id === aiBubble.id ? { ...x, text: "Sorry — couldn't reach support." } : x,
          ),
        );
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          if (!frame.startsWith("data: ")) continue;
          try {
            const payload = JSON.parse(frame.slice(6)) as {
              type: string;
              text?: string;
              ticketNumber?: string;
            };
            if (payload.type === "delta" && payload.text) {
              setBubbles((b) =>
                b.map((x) =>
                  x.id === aiBubble.id ? { ...x, text: x.text + payload.text! } : x,
                ),
              );
            } else if (payload.type === "tool_result" && payload.ticketNumber) {
              setTicketNumber(payload.ticketNumber);
              setBubbles((b) => [
                ...b,
                {
                  id: newBubbleId(),
                  who: "system",
                  text: `Ticket ${payload.ticketNumber} raised — our team has been notified.`,
                },
              ]);
            }
          } catch {
            /* ignore parse errors */
          }
        }
      }
      setShowFeedback(bubbles.length + 2 >= 4);
    } finally {
      setSending(false);
    }
  }

  async function sendFeedback(kind: "AI_HELPFUL" | "AI_NOT_HELPFUL") {
    if (!conversationId) return;
    await feedback.mutateAsync({
      conversationId,
      kind,
      rating: kind === "AI_HELPFUL" ? 1 : 0,
    });
    setShowFeedback(false);
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {bubbles.length === 0 && (
          <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
            {hasCustomer
              ? "Hi! Ask me about pricing, availability, opening hours, bond release, licence requirements — anything. I can raise a ticket if we need a human."
              : `Hi! Ask a question about ${siteName}. I can answer FAQs or hand off to the team.`}
          </p>
        )}
        {bubbles.map((b) => (
          <Bubble key={b.id} bubble={b} />
        ))}
        {showFeedback && (
          <div className="flex items-center gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            <span>Did that help?</span>
            <button
              type="button"
              onClick={() => sendFeedback("AI_HELPFUL")}
              className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 hover:bg-muted"
            >
              <ThumbsUp className="h-3 w-3" /> Yes
            </button>
            <button
              type="button"
              onClick={() => sendFeedback("AI_NOT_HELPFUL")}
              className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 hover:bg-muted"
            >
              <ThumbsDown className="h-3 w-3" /> No
            </button>
          </div>
        )}
      </div>

      <div className="border-t p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Ask a question…"
            rows={2}
            className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            disabled={sending}
          />
          <Button type="button" onClick={send} disabled={sending || !input.trim()} size="icon">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
        <button
          type="button"
          className="mt-2 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => setStep("triage")}
        >
          Back to menu
        </button>
      </div>
    </div>
  );
}

function Bubble({ bubble }: { bubble: ChatBubble }) {
  if (bubble.who === "system") {
    return (
      <div className="rounded-md border border-primary/30 bg-primary/10 p-2 text-xs text-primary">
        {bubble.text}
      </div>
    );
  }
  return (
    <div className={bubble.who === "user" ? "flex justify-end" : "flex justify-start"}>
      <div
        className={
          bubble.who === "user"
            ? "max-w-[85%] rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground whitespace-pre-wrap"
            : "max-w-[85%] rounded-md bg-muted px-3 py-2 text-sm text-foreground"
        }
      >
        {bubble.who === "user" ? (
          bubble.text || "…"
        ) : bubble.text ? (
          <MarkdownBody source={bubble.text} />
        ) : (
          "…"
        )}
      </div>
    </div>
  );
}

/**
 * Tailwind-typography isn't in this project — so we map react-markdown's
 * elements to semantic classes directly. Only the subset relevant inside
 * a chat bubble (paragraphs, lists, bold, code, links). No images; no
 * headings larger than h3 to keep the panel compact.
 */
function MarkdownBody({ source }: { source: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,
        ul: ({ children }) => (
          <ul className="mb-2 ml-5 list-disc space-y-1 last:mb-0">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-2 ml-5 list-decimal space-y-1 last:mb-0">{children}</ol>
        ),
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        h1: ({ children }) => (
          <h3 className="mb-2 mt-1 text-sm font-semibold">{children}</h3>
        ),
        h2: ({ children }) => (
          <h3 className="mb-2 mt-1 text-sm font-semibold">{children}</h3>
        ),
        h3: ({ children }) => (
          <h3 className="mb-2 mt-1 text-sm font-semibold">{children}</h3>
        ),
        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        a: ({ children, href }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2 hover:text-primary"
          >
            {children}
          </a>
        ),
        code: ({ children }) => (
          <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[12px]">
            {children}
          </code>
        ),
        pre: ({ children }) => (
          <pre className="mb-2 overflow-x-auto rounded-md bg-background/60 p-2 text-[12px] last:mb-0">
            {children}
          </pre>
        ),
        blockquote: ({ children }) => (
          <blockquote className="mb-2 border-l-2 border-primary/40 pl-3 italic text-muted-foreground last:mb-0">
            {children}
          </blockquote>
        ),
        hr: () => <hr className="my-2 border-border" />,
      }}
    >
      {source}
    </ReactMarkdown>
  );
}
