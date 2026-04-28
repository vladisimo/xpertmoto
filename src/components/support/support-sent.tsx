"use client";

import { useState } from "react";
import { CheckCircle2, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSupportWidget } from "@/stores/support-widget";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";

/**
 * Post-submit confirmation. For logged-in customers we include a link
 * to the full support history; for guests we just confirm.
 *
 * When a ticket was just resolved, this component also collects the
 * 1-5 star CSAT rating (enforced by SUPPORT_FEEDBACK_ENABLED upstream).
 */
export function SupportSent() {
  const { ticketNumber, conversationId, reset, setStep } = useSupportWidget();
  const feedback = trpc.support.submitFeedback.useMutation();
  const [stars, setStars] = useState<number>(0);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);

  async function submitFeedback() {
    if (!conversationId || stars === 0) return;
    await feedback.mutateAsync({
      conversationId,
      kind: "CSAT",
      rating: stars,
      comment: comment || undefined,
    });
    setSubmitted(true);
  }

  return (
    <div className="space-y-5 p-5 text-center">
      <CheckCircle2 className="mx-auto h-12 w-12 text-primary" aria-hidden />
      <div className="space-y-1">
        <h3 className="text-base font-semibold">Thanks — we&apos;ve got it.</h3>
        {ticketNumber ? (
          <p className="text-sm text-muted-foreground">
            Your ticket reference is <strong>{ticketNumber}</strong>. The team has been notified and
            we&apos;ll be in touch by email and SMS.
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            Thanks for reaching out — we&apos;ll be in touch soon.
          </p>
        )}
      </div>

      <div className="space-y-2 rounded-md border border-dashed p-4 text-left">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          How did we do?
        </p>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              aria-label={`${n} star${n === 1 ? "" : "s"}`}
              onClick={() => setStars(n)}
              className="rounded-sm p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Star
                className={cn(
                  "h-6 w-6 transition",
                  n <= stars ? "fill-amber-400 text-amber-400" : "text-muted-foreground",
                )}
              />
            </button>
          ))}
        </div>
        <textarea
          className="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="Leave a comment (optional)"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
        <Button
          type="button"
          size="sm"
          onClick={submitFeedback}
          disabled={stars === 0 || submitted || feedback.isPending}
        >
          {submitted ? "Thanks!" : "Submit rating"}
        </Button>
      </div>

      <div className="flex items-center justify-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setStep("chat")}
        >
          Keep chatting
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={reset}>
          Start new
        </Button>
      </div>
    </div>
  );
}
