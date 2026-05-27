"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { CommsLogTable, type CommsLogRow } from "@/components/communications/comms-log-table";
import { CommsTabs } from "@/components/communications/comms-tabs";
import { CommunicationsStats } from "@/components/staff/communications-stats";
import { PageHeader } from "@/components/layout/page-header";
import { PageSection, PageShell } from "@/components/layout/page-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LoadingBlock } from "@/components/ui/spinner";
import { trpc } from "@/lib/trpc/client";

const CHANNELS = ["EMAIL", "SMS", "IN_APP", "PUSH"] as const;
const CATEGORIES = ["TRANSACTIONAL", "ACCOUNT", "OPERATIONAL", "MARKETING"] as const;
const STATUSES = ["SENT", "DELIVERED", "BOUNCED", "FAILED", "OPT_OUT", "UNSUBSCRIBED"] as const;

export default function CommsLogPage() {
  const [q, setQ] = useState("");
  const [channel, setChannel] = useState<string>("");
  const [category, setCategory] = useState<string>("");
  const [status, setStatus] = useState<string>("");

  const filters = useMemo(
    () => ({
      search: q.trim() || undefined,
      channel: channel ? (channel as (typeof CHANNELS)[number]) : undefined,
      category: category ? (category as (typeof CATEGORIES)[number]) : undefined,
      status: status ? (status as (typeof STATUSES)[number]) : undefined,
    }),
    [q, channel, category, status],
  );

  const { data, isLoading } = trpc.communication.logList.useQuery({ ...filters, take: 100 });
  const { data: stats, isLoading: statsLoading } = trpc.communication.stats.useQuery(
    { range: "today" },
    { staleTime: 30_000 },
  );

  const rows: CommsLogRow[] = (data?.items ?? []).map((l) => ({
    id: l.id,
    sentAt: l.sentAt.toString(),
    type: l.type,
    category: l.category,
    channel: l.channel,
    status: l.status,
    errorMessage: l.errorMessage,
    subject: l.subject,
    templateUsed: l.templateUsed,
    customer: l.customer
      ? {
          id: l.customer.id,
          name: `${l.customer.firstName} ${l.customer.lastName}`.trim() || l.customer.email || "—",
          email: l.customer.email,
          phone: l.customer.phone,
        }
      : null,
    campaign: l.campaign,
  }));

  return (
    <PageShell>
      <PageHeader
        eyebrow="Operations"
        title="Communications"
        description="Unified log of every outbound email, SMS, push, and in-app notification."
      />

      <CommsTabs />

      <CommunicationsStats data={stats} loading={statsLoading} />

      <PageSection flush>
        <div className="flex flex-wrap items-end gap-2">
          <div className="relative min-w-64 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search subject, body, email…"
              className="pl-9"
            />
          </div>

          <Select value={channel || undefined} onValueChange={(v) => setChannel(v === "__all" ? "" : v)}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All channels" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All channels</SelectItem>
              {CHANNELS.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={category || undefined} onValueChange={(v) => setCategory(v === "__all" ? "" : v)}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All categories</SelectItem>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={status || undefined} onValueChange={(v) => setStatus(v === "__all" ? "" : v)}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All statuses</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {(q || channel || category || status) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setQ("");
                setChannel("");
                setCategory("");
                setStatus("");
              }}
            >
              Clear
            </Button>
          )}
        </div>

        <CommsLogTable data={rows} />
        {isLoading && <LoadingBlock padded="sm" />}
      </PageSection>
    </PageShell>
  );
}
