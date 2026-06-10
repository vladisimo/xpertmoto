"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { TRPCClientError } from "@trpc/client";
import { useSupportWidget } from "@/stores/support-widget";
import { trpc } from "@/lib/trpc/client";

const Schema = z.object({
  bookingReference: z.string().optional(),
  summary: z.string().min(3, "Please add a short summary").max(120),
  description: z.string().min(10, "Tell us what happened").max(4000),
  urgency: z.boolean().default(false),
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal("")),
  contactPhone: z.string().optional(),
});

type FormValues = z.infer<typeof Schema>;

export interface SupportStructuredFormProps {
  /** When true we skip the contact-details section — the server already
   *  knows who the customer is via the session. */
  hasCustomer: boolean;
}

const CATEGORY_COPY: Record<string, { title: string; blurb: string; urgencyLabel: string }> = {
  BREAKDOWN: {
    title: "Mechanical issue",
    blurb: "Tell us what's happening. If you're stranded tick the urgent box — we'll page on-call.",
    urgencyLabel: "I'm stranded / can't ride",
  },
  ABANDONED_VEHICLE: {
    title: "Scooter left somewhere",
    blurb: "Share the location and the booking reference if you know it.",
    urgencyLabel: "Safety hazard — needs urgent attention",
  },
  PAYMENT: {
    title: "Payment question",
    blurb: "Our finance team will follow up by email. Please don't paste card numbers.",
    urgencyLabel: "",
  },
  GENERAL: {
    title: "Your question",
    blurb: "Happy to help — the more detail the better.",
    urgencyLabel: "",
  },
};

export function SupportStructuredForm({ hasCustomer }: SupportStructuredFormProps) {
  const {
    selectedCategory,
    conversationId,
    setStep,
    setTicketNumber,
    setConversationId,
  } = useSupportWidget();
  const start = trpc.support.startConversation.useMutation();
  const create = trpc.support.createTicket.useMutation();

  const category = selectedCategory ?? "GENERAL";
  const copy = CATEGORY_COPY[category] ?? CATEGORY_COPY.GENERAL!;

  const form = useForm<FormValues>({
    resolver: zodResolver(Schema),
    defaultValues: {
      bookingReference: "",
      summary: "",
      description: "",
      urgency: false,
      contactName: "",
      contactEmail: "",
      contactPhone: "",
    },
  });

  async function startNewConversation(values: FormValues): Promise<string> {
    const res = await start.mutateAsync({
      bookingReference: values.bookingReference || undefined,
      // Guest payload is only relevant for unauthenticated users —
      // logged-in customers are resolved from the session server-side.
      guest:
        !hasCustomer && values.contactEmail
          ? {
              name: values.contactName || "Guest",
              email: values.contactEmail,
              phone: values.contactPhone,
            }
          : undefined,
    });
    setConversationId(res.conversationId);
    return res.conversationId;
  }

  async function raise(cid: string, values: FormValues) {
    const created = await create.mutateAsync({
      conversationId: cid,
      category,
      summary: values.summary,
      description: values.description,
      urgency: values.urgency,
    });
    setTicketNumber(created.ticketNumber);
    setStep("sent");
  }

  async function onSubmit(values: FormValues) {
    form.clearErrors("root");
    try {
      const cid = conversationId ?? (await startNewConversation(values));
      try {
        await raise(cid, values);
      } catch (err) {
        // The conversationId is persisted in localStorage so a session can be
        // reopened, but it can go stale: the conversation may have been pruned,
        // the dev DB reseeded, or it belongs to a previously signed-in user on
        // this browser. The server then replies NOT_FOUND / FORBIDDEN. When we
        // reused a persisted id, discard it, open a fresh conversation, and
        // retry once before surfacing anything to the user.
        const code = err instanceof TRPCClientError ? err.data?.code : undefined;
        if (conversationId && (code === "NOT_FOUND" || code === "FORBIDDEN")) {
          setConversationId(null);
          await raise(await startNewConversation(values), values);
        } else {
          throw err;
        }
      }
    } catch (err) {
      form.setError("root", {
        message:
          err instanceof TRPCClientError && err.message
            ? err.message
            : "We couldn't raise your ticket. Please try again.",
      });
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 p-4">
        <div className="space-y-1">
          <h3 className="text-base font-semibold">{copy.title}</h3>
          <p className="text-xs text-muted-foreground">{copy.blurb}</p>
        </div>

        <div className="space-y-4">
          <FormField
            control={form.control}
            name="summary"
            render={({ field }) => (
              <FormItem className="space-y-1.5">
                <FormLabel>Summary</FormLabel>
                <FormControl>
                  <Input placeholder="One-line summary" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="bookingReference"
            render={({ field }) => (
              <FormItem className="space-y-1.5">
                <FormLabel>Booking reference (optional)</FormLabel>
                <FormControl>
                  <Input placeholder="SCT-20260417-1234" {...field} />
                </FormControl>
                <FormDescription>
                  Helps us jump straight to your vehicle and depot.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="description"
            render={({ field }) => (
              <FormItem className="space-y-1.5">
                <FormLabel>What&apos;s happening?</FormLabel>
                <FormControl>
                  <textarea
                    className="flex min-h-[96px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {copy.urgencyLabel && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input text-primary focus:ring-ring"
                {...form.register("urgency")}
              />
              <span>{copy.urgencyLabel}</span>
            </label>
          )}
        </div>

        {!hasCustomer && (
          <div className="space-y-4 border-t pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Contact details
            </p>
            <FormField
              control={form.control}
              name="contactName"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Your name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="contactEmail"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="you@example.com" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="contactPhone"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <FormLabel>Phone (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="04xx xxx xxx" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        )}

        {form.formState.errors.root && (
          <p className="text-sm text-destructive" role="alert">
            {form.formState.errors.root.message}
          </p>
        )}

        <div className="flex items-center justify-between gap-2 border-t pt-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setStep("triage")}
            disabled={form.formState.isSubmitting}
          >
            Back
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            )}
            Raise ticket
          </Button>
        </div>
      </form>
    </Form>
  );
}
