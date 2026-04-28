"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Send } from "lucide-react";

import { BodyEditor, type TemplateFormat } from "@/components/communications/body-editor";
import { CommsTabs } from "@/components/communications/comms-tabs";
import { PageHeader } from "@/components/layout/page-header";
import { PageSection, PageShell } from "@/components/layout/page-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc/client";

type Audience = "SINGLE" | "SEGMENT" | "MANUAL";
type ChannelKey = "EMAIL" | "SMS" | "PUSH";

export default function ComposePage() {
  const [audience, setAudience] = useState<Audience>("SINGLE");
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [segmentId, setSegmentId] = useState<string>("");
  const [manualIds, setManualIds] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState<string>("");
  const [channels, setChannels] = useState<ChannelKey[]>(["EMAIL"]);
  const [type, setType] = useState<string>("CUSTOM");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [format, setFormat] = useState<TemplateFormat>("PLAIN_TEXT");
  const [templateVariables, setTemplateVariables] = useState<string[]>([]);
  const [result, setResult] = useState<{ sent: number; failed: number } | null>(null);

  const { data: templates } = trpc.communication.templateList.useQuery({ includeArchived: false });
  const { data: segments } = trpc.communication.segmentList.useQuery();
  const { data: customers } = trpc.staffCustomer.search.useQuery(
    { query: customerSearch.trim(), take: 20 },
    { enabled: customerSearch.length >= 2 },
  );

  const selectedSegment = useMemo(
    () => segments?.find((s) => s.id === segmentId) ?? null,
    [segments, segmentId],
  );
  const segmentPreview = trpc.communication.segmentMembers.useQuery(
    { id: segmentId, take: 10 },
    { enabled: audience === "SEGMENT" && !!segmentId },
  );

  const send = trpc.communication.composeSend.useMutation({
    onSuccess: (r) => {
      const sent = r.results.filter((x) => x.ok).length;
      setResult({ sent, failed: r.results.length - sent });
    },
  });

  // Stable sample vars: fill in each known template variable with a
  // placeholder value so the author sees a realistic preview.
  const previewVars = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const v of templateVariables) out[v] = `{sample:${v}}`;
    return out;
  }, [templateVariables]);

  const preview = trpc.communication.templatePreview.useQuery(
    { bodyTemplate: body, subject, format, variables: previewVars },
    { enabled: body.length > 0 },
  );

  function applyTemplate(id: string) {
    setTemplateId(id);
    const t = templates?.find((x) => x.id === id);
    if (t) {
      setSubject(t.subject ?? "");
      // Prefer the rich HTML email body when the template has one and
      // EMAIL is among the selected channels. Otherwise fall back to the
      // short plain body.
      if (t.emailBodyHtml && t.channels.includes("EMAIL")) {
        setBody(t.emailBodyHtml);
        setFormat("HTML");
      } else {
        setBody(t.bodyTemplate);
        setFormat(t.format);
      }
      setTemplateVariables(t.variables);
      if (t.type) setType(t.type);
      setChannels(t.channels.filter((c): c is ChannelKey => c === "EMAIL" || c === "SMS" || c === "PUSH"));
    }
  }

  function toggleChannel(c: ChannelKey) {
    setChannels((prev) => {
      const next = prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c];
      if (!next.includes("EMAIL") && format === "HTML") setFormat("PLAIN_TEXT");
      return next;
    });
  }

  const recipientIds = useMemo(() => {
    if (audience === "SINGLE") return selectedCustomerId ? [selectedCustomerId] : [];
    if (audience === "SEGMENT") return segmentPreview.data?.rows.map((r) => r.id) ?? [];
    return manualIds;
  }, [audience, selectedCustomerId, segmentPreview.data, manualIds]);

  const canSend =
    channels.length > 0 && body.length > 0 && recipientIds.length > 0 && !send.isPending;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operations · Compose"
        title="Compose message"
        description="Send a one-off notification to a customer, saved segment, or hand-picked list."
      />

      <CommsTabs />

      <PageSection>
        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <div className="space-y-5">
            <div className="space-y-2">
              <Label>Audience</Label>
              <div className="flex gap-2">
                {(["SINGLE", "SEGMENT", "MANUAL"] as const).map((a) => (
                  <Button
                    key={a}
                    type="button"
                    size="sm"
                    variant={audience === a ? "default" : "secondary"}
                    onClick={() => setAudience(a)}
                  >
                    {a === "SINGLE" ? "One customer" : a === "SEGMENT" ? "Segment" : "Manual list"}
                  </Button>
                ))}
              </div>
            </div>

            {audience === "SINGLE" && (
              <div className="space-y-2">
                <Label>Find customer</Label>
                <Input
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  placeholder="Search name, email, phone…"
                />
                {customers?.items && customers.items.length > 0 && (
                  <ul className="max-h-48 divide-y overflow-y-auto rounded-md border border-border">
                    {customers.items.map((c) => {
                      const active = selectedCustomerId === c.id;
                      return (
                        <li key={c.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedCustomerId(c.id)}
                            className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted ${active ? "bg-muted" : ""}`}
                          >
                            <span className="truncate">
                              {c.firstName} {c.lastName}
                            </span>
                            <span className="truncate text-xs text-muted-foreground">{c.email}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            {audience === "SEGMENT" && (
              <div className="space-y-2">
                <Label>Segment</Label>
                <Select value={segmentId || undefined} onValueChange={setSegmentId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose segment" />
                  </SelectTrigger>
                  <SelectContent>
                    {(segments ?? []).map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedSegment && segmentPreview.data && (
                  <p className="text-sm text-muted-foreground">
                    {segmentPreview.data.count} customers match this segment
                  </p>
                )}
              </div>
            )}

            {audience === "MANUAL" && (
              <div className="space-y-2">
                <Label>Customer IDs (one per line)</Label>
                <textarea
                  className="min-h-24 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={manualIds.join("\n")}
                  onChange={(e) =>
                    setManualIds(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean))
                  }
                  placeholder="clxy…&#10;clab…"
                />
                <p className="text-xs text-muted-foreground">{manualIds.length} recipients</p>
              </div>
            )}

            <div className="space-y-2">
              <Label>Channels</Label>
              <div className="flex gap-2">
                {(["EMAIL", "SMS", "PUSH"] as const).map((c) => {
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

            <div className="space-y-2">
              <Label>Template (optional)</Label>
              <Select value={templateId || undefined} onValueChange={applyTemplate}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick a template to prefill" />
                </SelectTrigger>
                <SelectContent>
                  {(templates ?? []).map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} · {t.category}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="compose-subject">Subject</Label>
              <Input
                id="compose-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Email subject"
              />
            </div>
            <BodyEditor
              format={format}
              onFormatChange={(f) => {
                if (f === "HTML" && !channels.includes("EMAIL")) return;
                setFormat(f);
              }}
              body={body}
              onBodyChange={setBody}
              subject={subject}
              preview={preview.data}
              variables={templateVariables}
              allowHtml={channels.includes("EMAIL")}
              placeholder="Supports {{firstName}}, {{bookingReference}}, etc."
            />

            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-muted-foreground" aria-hidden />
                {recipientIds.length} recipients · {channels.join(", ") || "no channel"} · type <code>{type}</code>
              </div>
              {result && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-emerald-700">{result.sent} sent</span>
                  <span className="text-muted-foreground">·</span>
                  <span className={result.failed > 0 ? "text-destructive" : "text-muted-foreground"}>
                    {result.failed} failed / suppressed
                  </span>
                </div>
              )}
              {send.error && (
                <div className="mt-2 flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-4 w-4" aria-hidden />
                  {send.error.message}
                </div>
              )}
            </div>

            <Button
              disabled={!canSend}
              onClick={() =>
                send.mutate({
                  customerIds: recipientIds,
                  type: type as Parameters<typeof send.mutate>[0]["type"],
                  channels,
                  subject: subject || undefined,
                  body,
                  format,
                  templateId: templateId || undefined,
                })
              }
            >
              <Send className="h-4 w-4" />
              {send.isPending ? "Sending…" : "Send now"}
            </Button>
          </div>
        </div>
      </PageSection>
    </PageShell>
  );
}
