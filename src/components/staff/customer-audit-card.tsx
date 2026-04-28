"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertOctagon, AlertTriangle, Info, ShieldCheck, Wrench } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { StatShell } from "@/components/ui/stat-shell";
import {
  CUSTOMER_AUDIT_CHECKS,
  type CustomerAuditCheckKey,
  type CustomerAuditRemedy,
  type CustomerAuditSeverity,
} from "@/server/services/customer-audit";
import { CustomerFixSheet, type CustomerFixTarget } from "./customer-fix-sheet";

type SeverityFilter = "all" | CustomerAuditSeverity;
type CheckFilter = "all" | CustomerAuditCheckKey;

type IssueRow = {
  customerId: string;
  firstName: string;
  lastName: string;
  email: string;
  checkKey: CustomerAuditCheckKey;
  severity: CustomerAuditSeverity;
  remedy: CustomerAuditRemedy;
  label: string;
  description: string;
  detectedAt: string | null;
  daysDelta: number | null;
};

type CustomerGroup = {
  customerId: string;
  firstName: string;
  lastName: string;
  email: string;
  issues: IssueRow[];
  worstSeverity: CustomerAuditSeverity;
};

const SEVERITY_BADGE: Record<CustomerAuditSeverity, { status: StatusKey; label: string }> = {
  critical: { status: "URGENT", label: "Critical" },
  warning:  { status: "HIGH",   label: "Warning"  },
  info:     { status: "LOW",    label: "Info"     },
};

const SEVERITY_RANK: Record<CustomerAuditSeverity, number> = { critical: 0, warning: 1, info: 2 };

function formatDetected(row: IssueRow): string {
  if (row.daysDelta != null) {
    if (row.daysDelta < 0) return `${Math.abs(row.daysDelta)}d overdue`;
    if (row.daysDelta === 0) return "Due today";
    return `in ${row.daysDelta}d`;
  }
  return "—";
}

function groupByCustomer(rows: IssueRow[]): CustomerGroup[] {
  const map = new Map<string, CustomerGroup>();
  for (const r of rows) {
    let group = map.get(r.customerId);
    if (!group) {
      group = {
        customerId: r.customerId,
        firstName: r.firstName,
        lastName: r.lastName,
        email: r.email,
        issues: [],
        worstSeverity: r.severity,
      };
      map.set(r.customerId, group);
    }
    group.issues.push(r);
    if (SEVERITY_RANK[r.severity] < SEVERITY_RANK[group.worstSeverity]) {
      group.worstSeverity = r.severity;
    }
  }
  const groups = Array.from(map.values());
  for (const g of groups) {
    g.issues.sort((a, b) => {
      const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (sev !== 0) return sev;
      return a.label.localeCompare(b.label);
    });
  }
  groups.sort((a, b) => {
    const sev = SEVERITY_RANK[a.worstSeverity] - SEVERITY_RANK[b.worstSeverity];
    if (sev !== 0) return sev;
    return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`);
  });
  return groups;
}

const CHECK_OPTIONS: { value: CheckFilter; label: string }[] = [
  { value: "all", label: "All checks" },
  ...Object.values(CUSTOMER_AUDIT_CHECKS).map((c) => ({
    value: c.key as CheckFilter,
    label: c.label,
  })),
];

export function CustomerAuditCard() {
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [checkKey, setCheckKey] = useState<CheckFilter>("all");
  const [search, setSearch] = useState("");
  const [includeAll, setIncludeAll] = useState(false);
  const [fixTarget, setFixTarget] = useState<CustomerFixTarget | null>(null);

  const auditQuery = trpc.staffCustomer.audit.useQuery({
    ...(severity !== "all" ? { severity } : {}),
    ...(checkKey !== "all" ? { checkKey } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
    includeAll,
  });

  const summary = auditQuery.data?.summary;
  const groups = useMemo(
    () => groupByCustomer((auditQuery.data?.issues ?? []) as IssueRow[]),
    [auditQuery.data],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 space-y-4 px-6 pt-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiTile
            title="Critical"
            value={summary?.critical ?? 0}
            icon={<AlertOctagon className="h-4 w-4" />}
            tone="danger"
          />
          <KpiTile
            title="Warnings"
            value={summary?.warning ?? 0}
            icon={<AlertTriangle className="h-4 w-4" />}
            tone="warning"
          />
          <KpiTile
            title="Info"
            value={summary?.info ?? 0}
            icon={<Info className="h-4 w-4" />}
            tone="info"
          />
          <KpiTile
            title="Customers affected"
            value={summary?.customersWithIssues ?? 0}
            suffix={summary ? ` of ${summary.totalActive}` : undefined}
            icon={<ShieldCheck className="h-4 w-4" />}
            tone="neutral"
          />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:flex-wrap">
          <div className="w-full sm:max-w-xs">
            <Input
              placeholder="Search name, email, phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={severity} onValueChange={(v) => setSeverity(v as SeverityFilter)}>
              <SelectTrigger className="w-[11rem]">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All severities</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
                <SelectItem value="warning">Warning</SelectItem>
                <SelectItem value="info">Info</SelectItem>
              </SelectContent>
            </Select>
            <Select value={checkKey} onValueChange={(v) => setCheckKey(v as CheckFilter)}>
              <SelectTrigger className="w-[16rem]">
                <SelectValue placeholder="Check" />
              </SelectTrigger>
              <SelectContent>
                {CHECK_OPTIONS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant={includeAll ? "default" : "secondary"}
              size="sm"
              onClick={() => setIncludeAll((v) => !v)}
              title={
                includeAll
                  ? "Auditing every active customer (slower)"
                  : "Auditing customers active in the last 12 months"
              }
            >
              {includeAll ? "Scope: all customers" : "Scope: active 12mo"}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-6 py-4">
        <div className="flex min-h-0 flex-1 flex-col overflow-auto rounded-md border">
          {auditQuery.isLoading ? (
            <AuditSkeleton />
          ) : groups.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              {auditQuery.data && auditQuery.data.summary.customersWithIssues === 0
                ? "All customers in scope pass audit — nothing to action."
                : "No issues match the current filters."}
            </div>
          ) : (
            <ul className="divide-y">
              {groups.map((g) => (
                <li key={g.customerId}>
                  <CustomerGroupHeader group={g} />
                  <ul className="divide-y">
                    {g.issues.map((issue) => (
                      <li key={`${g.customerId}:${issue.checkKey}`}>
                        <IssueRowView
                          issue={issue}
                          onFix={() =>
                            setFixTarget({
                              customerId: g.customerId,
                              customerName: `${g.firstName} ${g.lastName}`,
                              remedy: issue.remedy,
                              label: issue.label,
                            })
                          }
                        />
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <CustomerFixSheet target={fixTarget} onClose={() => setFixTarget(null)} />
    </div>
  );
}

function CustomerGroupHeader({ group }: { group: CustomerGroup }) {
  const badge = SEVERITY_BADGE[group.worstSeverity];
  return (
    <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b bg-muted/60 px-4 py-2.5 backdrop-blur">
      <div className="min-w-0 flex items-center gap-3">
        <Link
          href={`/staff/customers/${group.customerId}`}
          className="font-medium text-foreground hover:underline"
        >
          {group.firstName} {group.lastName}
        </Link>
        <span className="truncate text-sm text-muted-foreground">{group.email}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <StatusBadge status={badge.status} label={badge.label} />
        <span className="text-xs tabular-nums text-muted-foreground">
          {group.issues.length} issue{group.issues.length === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}

function IssueRowView({ issue, onFix }: { issue: IssueRow; onFix: () => void }) {
  const badge = SEVERITY_BADGE[issue.severity];
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30">
      <div className="w-[6.5rem] shrink-0">
        <StatusBadge status={badge.status} label={badge.label} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{issue.label}</div>
        <div className="truncate text-xs text-muted-foreground">{issue.description}</div>
      </div>
      <div className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {formatDetected(issue)}
      </div>
      <Button variant="secondary" size="sm" onClick={onFix}>
        <Wrench className="h-3.5 w-3.5" />
        Fix
      </Button>
    </div>
  );
}

function AuditSkeleton() {
  return (
    <div className="divide-y">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i}>
          <div className="border-b bg-muted/60 px-4 py-2.5">
            <div className="h-4 w-64 animate-pulse rounded bg-muted" />
          </div>
          {Array.from({ length: 2 }).map((__, j) => (
            <div key={j} className="px-4 py-3">
              <div className="h-4 w-full max-w-lg animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function KpiTile({
  title,
  value,
  suffix,
  icon,
  tone,
}: {
  title: string;
  value: number;
  suffix?: string;
  icon: React.ReactNode;
  tone: "danger" | "warning" | "info" | "neutral";
}) {
  const numberTone = tone === "danger" ? "text-destructive" : "text-foreground";
  const iconTone = tone === "danger" ? "text-destructive" : "text-muted-foreground";

  return (
    <StatShell title={title} icon={<span className={iconTone}>{icon}</span>}>
      <div className="flex items-baseline gap-1.5">
        <span className={`font-display text-3xl font-semibold tabular-nums ${numberTone}`}>
          {value.toLocaleString()}
        </span>
        {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
      </div>
    </StatShell>
  );
}
