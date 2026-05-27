"use client";

import * as React from "react";
import Link from "next/link";
import { z } from "zod";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Info,
  Loader2,
  Mail,
  MessageCircle,
  Paperclip,
  Phone,
  Send,
  Smartphone,
  User as UserIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { formatDeliveryNote } from "@/components/communications/delivery-status";
import { trpc } from "@/lib/trpc/client";

type Channel = "EMAIL" | "SMS" | "IN_APP" | "PUSH";

const CHANNEL_ICON: Record<Channel, typeof Mail> = {
  EMAIL: Mail,
  SMS: Phone,
  IN_APP: MessageCircle,
  PUSH: Smartphone,
};

const CHANNEL_LABEL: Record<Channel, string> = {
  EMAIL: "Email",
  SMS: "SMS",
  IN_APP: "In-app",
  PUSH: "Push",
};

const ATTACHMENT_KIND_LABEL: Record<string, string> = {
  invoice: "Tax invoice",
  "adjustment-note": "Adjustment note",
  "rental-agreement": "Rental agreement",
  "return-assessment": "Return assessment",
  receipt: "Payment receipt",
  // Legacy shapes — kept so old CommunicationLog rows still render after
  // the AttachmentRef rewrite. Safe to remove once retention sweeps the
  // last log row that pre-dates the change.
  "lease-agreement": "Rental agreement",
  "return-paperwork": "Return paperwork",
  "inspection-report": "Inspection report",
};

const attachmentRefSchema = z.union([
  // Current shape — see notification-sender.ts AttachmentRef.
  z.object({ kind: z.literal("invoice"), invoiceId: z.string() }),
  z.object({ kind: z.literal("adjustment-note"), adjustmentNoteId: z.string() }),
  z.object({ kind: z.literal("rental-agreement"), agreementId: z.string() }),
  z.object({ kind: z.literal("return-assessment"), assessmentId: z.string() }),
  z.object({ kind: z.literal("receipt"), paymentId: z.string() }),
  // Legacy shapes for historical rows.
  z.object({ kind: z.literal("invoice"), invoiceId: z.string(), url: z.string().optional() }),
  z.object({ kind: z.literal("lease-agreement"), bookingId: z.string(), url: z.string().optional() }),
  z.object({ kind: z.literal("return-paperwork"), bookingId: z.string(), url: z.string().optional() }),
  z.object({ kind: z.literal("inspection-report"), inspectionId: z.string(), url: z.string().optional() }),
]);

const attachmentListSchema = z.array(attachmentRefSchema);
type AttachmentRef = z.infer<typeof attachmentRefSchema>;

function parseAttachments(raw: unknown): AttachmentRef[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const result = attachmentListSchema.safeParse(raw);
  if (result.success) return result.data;
  // Fall back to per-item parsing so one malformed entry doesn't hide the rest.
  return raw.flatMap((item) => {
    const p = attachmentRefSchema.safeParse(item);
    return p.success ? [p.data] : [];
  });
}

function attachmentLinkFor(ref: AttachmentRef): string | undefined {
  if ("url" in ref && ref.url) return ref.url;
  switch (ref.kind) {
    case "invoice":
    case "adjustment-note":
    case "rental-agreement":
    case "return-assessment":
    case "receipt":
    case "inspection-report":
      return undefined;
    case "lease-agreement":
    case "return-paperwork":
      return `/staff/bookings/${ref.bookingId}`;
  }
}

function attachmentSubLabel(ref: AttachmentRef): string {
  switch (ref.kind) {
    case "invoice":
      return ref.invoiceId;
    case "adjustment-note":
      return ref.adjustmentNoteId;
    case "rental-agreement":
      return ref.agreementId;
    case "return-assessment":
      return ref.assessmentId;
    case "receipt":
      return ref.paymentId;
    case "inspection-report":
      return ref.inspectionId;
    case "lease-agreement":
    case "return-paperwork":
      return ref.bookingId;
  }
}

function formatDateTime(iso: string | Date | null | undefined): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString("en-AU", { dateStyle: "short", timeStyle: "short" });
}

function humaniseType(t: string): string {
  return t.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

export type CommsLogDetailDrawerProps = {
  id: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CommsLogDetailDrawer({ id, open, onOpenChange }: CommsLogDetailDrawerProps) {
  const utils = trpc.useUtils();
  const me = trpc.session.whoAmI.useQuery(undefined, { staleTime: 60_000 });
  const canResend = me.data?.role === "MANAGER" || me.data?.role === "ADMIN" || me.data?.role === "SUPER_ADMIN";

  const detail = trpc.communication.logDetail.useQuery(
    { id: id ?? "" },
    { enabled: !!id && open },
  );

  const resend = trpc.communication.logResend.useMutation({
    onSuccess: () => {
      utils.communication.logList.invalidate();
      utils.communication.stats.invalidate();
      if (id) utils.communication.logDetail.invalidate({ id });
    },
  });

  function handleOpenChange(next: boolean) {
    if (!next) resend.reset();
    onOpenChange(next);
  }

  const log = detail.data;
  const channel = (log?.channel ?? "EMAIL") as Channel;
  const ChannelIcon = CHANNEL_ICON[channel];
  const customerName = log?.customer
    ? `${log.customer.firstName ?? ""} ${log.customer.lastName ?? ""}`.trim() || log.customer.email || "Unknown customer"
    : null;
  const currentRecipient = log?.customer
    ? channel === "SMS"
      ? log.customer.phone ?? "—"
      : log.customer.email ?? "—"
    : "—";
  const attachments = parseAttachments(log?.attachmentRefs);
  const deliveryNote = formatDeliveryNote(log?.errorMessage);
  const resendBlockedReason =
    !log
      ? null
      : !log.customerId
        ? "This entry has no linked customer, so it can't be resent from here."
        : channel === "IN_APP"
          ? "In-app notifications live in the app and aren't re-delivered."
          : null;

  function handleResend() {
    if (!log || !log.customerId) return;
    const confirmMsg = `Resend this ${CHANNEL_LABEL[channel]} to ${customerName ?? "this customer"} at ${currentRecipient}?\n\nIt will use the customer's current contact details, which may differ from the original recipient.`;
    if (!window.confirm(confirmMsg)) return;
    resend.mutate({ id: log.id });
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent side="right" className="w-full max-w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <div className="flex items-center gap-2 text-muted-foreground">
            <ChannelIcon className="h-4 w-4" aria-hidden />
            <span className="caption">{CHANNEL_LABEL[channel]}</span>
            {log ? (
              <StatusBadge
                status={(deliveryNote?.suppressed ? "SUPPRESSED" : log.status) as StatusKey}
              />
            ) : null}
          </div>
          <SheetTitle className="pr-6">
            {log?.subject ? log.subject : log ? humaniseType(log.type) : "Communication"}
          </SheetTitle>
          <SheetDescription>
            {log ? (
              <>
                Sent {formatDateTime(log.sentAt) ?? "—"}
                {log.campaign ? ` · Campaign: ${log.campaign.name}` : ""}
              </>
            ) : (
              "Loading…"
            )}
          </SheetDescription>
        </SheetHeader>

        {detail.isLoading || !log ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
            Loading message…
          </div>
        ) : (
          <div className="mt-6 space-y-6 pb-20">
            <section className="rounded-md border bg-card p-4">
              <div className="caption mb-2 text-muted-foreground">Recipient</div>
              <div className="flex items-start gap-3">
                <UserIcon className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1 space-y-1">
                  {log.customer ? (
                    <>
                      <Link
                        href={`/staff/customers/${log.customer.id}`}
                        className="text-sm font-medium hover:underline"
                      >
                        {customerName}
                      </Link>
                      <div className="text-xs text-muted-foreground">{currentRecipient}</div>
                      {log.customerId && channel !== "IN_APP" ? (
                        <div className="caption text-muted-foreground">
                          Resend target uses the customer's current contact details above.
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-sm text-muted-foreground">No linked customer</span>
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-md border bg-card p-4">
              <div className="caption mb-3 text-muted-foreground">Delivery</div>
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Type</dt>
                <dd>{humaniseType(log.type)} · <span className="text-muted-foreground">{log.category}</span></dd>

                <dt className="text-muted-foreground">Sent</dt>
                <dd>{formatDateTime(log.sentAt) ?? "—"}</dd>

                {log.deliveredAt ? (
                  <>
                    <dt className="text-muted-foreground">Delivered</dt>
                    <dd>{formatDateTime(log.deliveredAt)}</dd>
                  </>
                ) : null}

                {log.openedAt ? (
                  <>
                    <dt className="text-muted-foreground">Opened</dt>
                    <dd>{formatDateTime(log.openedAt)}</dd>
                  </>
                ) : null}

                {log.templateUsed ? (
                  <>
                    <dt className="text-muted-foreground">Template</dt>
                    <dd className="font-mono text-xs">{log.templateUsed}</dd>
                  </>
                ) : null}

                {log.providerMessageId ? (
                  <>
                    <dt className="text-muted-foreground">Provider id</dt>
                    <dd className="truncate font-mono text-xs">{log.providerMessageId}</dd>
                  </>
                ) : null}

                {log.providerStatus ? (
                  <>
                    <dt className="text-muted-foreground">Provider status</dt>
                    <dd className="text-xs">{log.providerStatus}</dd>
                  </>
                ) : null}
              </dl>

              {deliveryNote ? (
                deliveryNote.suppressed ? (
                  <div className="mt-4 flex items-start gap-2 rounded-md bg-muted p-3 text-sm text-muted-foreground">
                    <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span className="break-words">{deliveryNote.text}</span>
                  </div>
                ) : (
                  <div className="mt-4 flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <div className="min-w-0 space-y-1">
                      <span className="break-words">{deliveryNote.text}</span>
                      {deliveryNote.detail ? (
                        <p className="break-words font-mono text-xs text-destructive/70">
                          {deliveryNote.detail}
                        </p>
                      ) : null}
                    </div>
                  </div>
                )
              ) : null}
            </section>

            <section className="space-y-2">
              <div className="caption text-muted-foreground">
                {channel === "SMS" ? "Message" : log.subject ? "Body" : "Content"}
              </div>
              {log.body ? (
                channel === "SMS" ? (
                  <div className="max-w-[80%] rounded-lg rounded-bl-sm bg-muted p-4 text-sm">
                    <p className="whitespace-pre-wrap break-words">{log.body}</p>
                  </div>
                ) : (
                  <div className="max-h-[60vh] overflow-auto rounded-md border bg-card p-4">
                    <pre className="body-text whitespace-pre-wrap break-words font-sans text-sm">{log.body}</pre>
                  </div>
                )
              ) : (
                <p className="text-sm italic text-muted-foreground">Body not recorded.</p>
              )}
            </section>

            {attachments.length > 0 ? (
              <section className="rounded-md border bg-card p-4">
                <div className="caption mb-3 flex items-center gap-1.5 text-muted-foreground">
                  <Paperclip className="h-3.5 w-3.5" aria-hidden />
                  Attachments
                </div>
                <ul className="space-y-2">
                  {attachments.map((ref, idx) => {
                    const href = attachmentLinkFor(ref);
                    const label = ATTACHMENT_KIND_LABEL[ref.kind] ?? ref.kind;
                    const subLabel = attachmentSubLabel(ref);
                    const externalUrl = "url" in ref ? ref.url : undefined;
                    return (
                      <li key={`${ref.kind}-${idx}`} className="flex items-center gap-3 text-sm">
                        <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">{label}</div>
                          <div className="truncate text-xs text-muted-foreground">{subLabel}</div>
                        </div>
                        {href ? (
                          <Button asChild variant="ghost" size="sm">
                            <Link href={href} target={externalUrl ? "_blank" : undefined} rel={externalUrl ? "noreferrer" : undefined}>
                              {externalUrl ? "Download" : "View"}
                            </Link>
                          </Button>
                        ) : (
                          <span className="caption text-muted-foreground">No link</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}

            {resend.isSuccess && resend.variables?.id === log.id ? (
              <div className="flex items-start gap-2 rounded-md bg-primary/10 p-3 text-sm text-primary ring-1 ring-inset ring-primary/20">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>Resent just now. A new log entry has been added to the top of the list.</span>
              </div>
            ) : null}

            {resend.isError && resend.variables?.id === log.id ? (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span className="break-words">Resend failed: {resend.error.message}</span>
              </div>
            ) : null}
          </div>
        )}

        <div className="sticky bottom-0 -mx-6 -mb-6 flex items-center justify-end gap-2 border-t bg-background px-6 py-4">
          {canResend && !resendBlockedReason ? (
            <Button onClick={handleResend} disabled={resend.isPending || !log}>
              {resend.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Send className="h-4 w-4" aria-hidden />
              )}
              Resend
            </Button>
          ) : canResend && resendBlockedReason ? (
            <span className="caption mr-auto text-muted-foreground">{resendBlockedReason}</span>
          ) : null}
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
