"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { BodyEditor, type TemplateFormat } from "@/components/communications/body-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MobileBottomBar } from "@/components/layout/mobile-bottom-bar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc/client";

const CHANNELS = ["EMAIL", "SMS", "PUSH", "IN_APP"] as const;
const CATEGORIES = ["TRANSACTIONAL", "ACCOUNT", "OPERATIONAL", "MARKETING"] as const;
const TYPES = [
  "BOOKING_CONFIRMATION",
  "BOOKING_MODIFIED",
  "BOOKING_EXTENDED",
  "BOOKING_CANCELLED",
  "BOOKING_REMINDER",
  "BOOKING_CHECKED_OUT",
  "BOOKING_DUE_TODAY",
  "BOOKING_OVERDUE",
  "BOOKING_COMPLETED",
  "PAYMENT_RECEIVED",
  "INVOICE_ISSUED",
  "BOND_HELD",
  "BOND_RELEASED",
  "BOND_CAPTURED",
  "LEASE_AGREEMENT_COPY",
  "RETURN_PAPERWORK_COPY",
  "INSPECTION_REPORT_COPY",
  "PROFILE_UPDATED_SELF",
  "PROFILE_UPDATED_STAFF",
  "LICENCE_EXPIRING",
  "MARKETING_PROMOTIONAL",
  "MARKETING_NEWSLETTER",
  "MARKETING_WINBACK",
  "MARKETING_BIRTHDAY",
  "MARKETING_ANNIVERSARY",
  "CUSTOM",
] as const;

type Props = {
  template?: {
    id: string;
    key: string;
    type: string | null;
    category: string;
    name: string;
    description: string | null;
    channels: string[];
    subject: string | null;
    bodyTemplate: string;
    emailBodyHtml: string | null;
    format: TemplateFormat;
    variables: string[];
  };
};

export function TemplateEditor({ template }: Props) {
  const router = useRouter();
  const [key, setKey] = useState(template?.key ?? "");
  const [type, setType] = useState(template?.type ?? "");
  const [category, setCategory] = useState(template?.category ?? "TRANSACTIONAL");
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [channels, setChannels] = useState<string[]>(template?.channels ?? ["EMAIL"]);
  const [subject, setSubject] = useState(template?.subject ?? "");
  const [body, setBody] = useState(template?.bodyTemplate ?? "");
  const [emailBodyHtml, setEmailBodyHtml] = useState(template?.emailBodyHtml ?? "");
  const [format, setFormat] = useState<TemplateFormat>(template?.format ?? "PLAIN_TEXT");
  const [variables, setVariables] = useState<string[]>(template?.variables ?? []);
  const [sampleVars, setSampleVars] = useState<string>(
    '{"firstName": "Alex", "bookingReference": "SCT-20260420-0001"}',
  );

  const save = trpc.communication.templateUpsert.useMutation({
    onSuccess: (t) => router.push(`/admin/notification-templates/${t.id}`),
  });

  const previewVars = useMemo(() => {
    try {
      const parsed = JSON.parse(sampleVars);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
    } catch {
      return {};
    }
  }, [sampleVars]);

  const preview = trpc.communication.templatePreview.useQuery(
    { bodyTemplate: body, subject, format, variables: previewVars },
    { enabled: body.length > 0 },
  );
  const emailHtmlPreview = trpc.communication.templatePreview.useQuery(
    { bodyTemplate: emailBodyHtml, subject, format: "HTML", variables: previewVars },
    { enabled: emailBodyHtml.length > 0 },
  );

  const toggleChannel = (c: string) =>
    setChannels((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  const canSave = !!name && !!key && !!body && channels.length > 0;
  const emailChannelActive = channels.includes("EMAIL");

  // When the author removes EMAIL as a channel, HTML format stops making
  // sense (SMS/push are plain-text-only). Snap back to PLAIN_TEXT so they
  // don't accidentally save an HTML body that will never render.
  const handleFormatChange = (f: TemplateFormat) => {
    if (f === "HTML" && !emailChannelActive) return;
    setFormat(f);
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-2">
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Key (unique)</Label>
          <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="booking-confirmed" />
        </div>
        <div className="space-y-2">
          <Label>Type</Label>
          <Select value={type || undefined} onValueChange={setType}>
            <SelectTrigger>
              <SelectValue placeholder="Unbound / custom" />
            </SelectTrigger>
            <SelectContent>
              {TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Category</Label>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Description</Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="When this template is sent and to whom"
          />
        </div>
        <div className="space-y-2">
          <Label>Channels</Label>
          <div className="flex flex-wrap gap-2">
            {CHANNELS.map((c) => {
              const active = channels.includes(c);
              return (
                <Button
                  key={c}
                  type="button"
                  size="sm"
                  variant={active ? "default" : "secondary"}
                  onClick={() => toggleChannel(c)}
                >
                  {c}
                </Button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label>Subject</Label>
        <Input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Your booking {{bookingReference}} is confirmed"
        />
      </div>

      <BodyEditor
        format={format}
        onFormatChange={handleFormatChange}
        body={body}
        onBodyChange={setBody}
        subject={preview.data?.subject ?? subject}
        preview={preview.data}
        variables={variables}
        allowHtml={emailChannelActive}
        label={
          emailChannelActive && channels.some((c) => c !== "EMAIL")
            ? "Short body (SMS / in-app / push / plain-text fallback)"
            : "Body"
        }
      />

      {emailChannelActive && (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Email HTML body</div>
              <p className="text-xs text-muted-foreground">
                Rich HTML used when the EMAIL channel sends. Leave blank to fall back to the short body above.
              </p>
            </div>
            {emailBodyHtml && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setEmailBodyHtml("")}
              >
                Clear override
              </Button>
            )}
          </div>
          <BodyEditor
            format="HTML"
            onFormatChange={() => {}}
            body={emailBodyHtml}
            onBodyChange={setEmailBodyHtml}
            subject={emailHtmlPreview.data?.subject ?? subject}
            preview={emailHtmlPreview.data}
            variables={variables}
            htmlOnly
            label="Email HTML body"
            placeholder="<p>Hi {{firstName}},</p>&#10;<p>Your booking is confirmed.</p>"
          />
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Known variables (comma-separated)</Label>
          <Input
            value={variables.join(", ")}
            onChange={(e) =>
              setVariables(
                e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
            placeholder="firstName, bookingReference"
          />
        </div>
        <div className="space-y-2">
          <Label>Sample variables (JSON)</Label>
          <textarea
            className="min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
            value={sampleVars}
            onChange={(e) => setSampleVars(e.target.value)}
          />
        </div>
      </div>

      <div className="hidden gap-2 md:flex">
        <Button
          disabled={!canSave || save.isPending}
          onClick={() =>
            save.mutate({
              id: template?.id,
              key,
              type: (type || undefined) as Parameters<typeof save.mutate>[0]["type"],
              category: category as (typeof CATEGORIES)[number],
              name,
              description: description || undefined,
              channels: channels as Parameters<typeof save.mutate>[0]["channels"],
              subject: subject || undefined,
              bodyTemplate: body,
              emailBodyHtml: emailBodyHtml.trim() ? emailBodyHtml : null,
              format,
              variables,
              isActive: true,
            })
          }
        >
          {save.isPending ? "Saving…" : template ? "Save changes" : "Create template"}
        </Button>
        <Button variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>

      <MobileBottomBar>
        <Button
          className="flex-1"
          disabled={!canSave || save.isPending}
          onClick={() =>
            save.mutate({
              id: template?.id,
              key,
              type: (type || undefined) as Parameters<typeof save.mutate>[0]["type"],
              category: category as (typeof CATEGORIES)[number],
              name,
              description: description || undefined,
              channels: channels as Parameters<typeof save.mutate>[0]["channels"],
              subject: subject || undefined,
              bodyTemplate: body,
              emailBodyHtml: emailBodyHtml.trim() ? emailBodyHtml : null,
              format,
              variables,
              isActive: true,
            })
          }
        >
          {save.isPending ? "Saving…" : template ? "Save changes" : "Create template"}
        </Button>
      </MobileBottomBar>
    </div>
  );
}
