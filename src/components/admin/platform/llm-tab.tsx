"use client";

import { Brain, FileScan } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { PageSection } from "@/components/layout/page-section";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingBlock } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/utils";
import { KpiCard } from "./kpi-card";

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString("en-AU");
}

type ModelRow = {
  provider: string;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  costAud: number;
  kind?: string;
};

export function LlmTab() {
  const q = trpc.platform.llmSummary.useQuery();

  if (q.isLoading || !q.data) {
    return <LoadingBlock padded="md" />;
  }

  const { support, ocr } = q.data;

  return (
    <div className="space-y-6">
      <PageSection
        title="Tech support chatbot"
        description="Claude calls served by the in-app customer support assistant. Cost is the rolling sum of SupportCostLog AUD."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard
            title="Last 24 hours"
            primary={formatCurrency(support.costAud24h)}
            secondary={`${support.calls24h} call${support.calls24h === 1 ? "" : "s"}`}
            icon={Brain}
          />
          <KpiCard
            title="Last 7 days"
            primary={formatCurrency(support.costAud7d)}
            secondary={`${support.calls7d} calls`}
            icon={Brain}
          />
          <KpiCard
            title="Last 30 days"
            primary={formatCurrency(support.costAud30d)}
            secondary={`${support.calls30d} calls`}
            icon={Brain}
          />
        </div>
        <ByModelTable rows={support.byModel30d} />
      </PageSection>

      <PageSection
        title="Document OCR"
        description="Vision tool-use against licences and passports via src/server/services/document-extract.ts. Instrumented — costs now appear here per call."
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard
            title="Last 24 hours"
            primary={formatCurrency(ocr.costAud24h)}
            secondary={`${ocr.calls24h} call${ocr.calls24h === 1 ? "" : "s"}`}
            icon={FileScan}
          />
          <KpiCard
            title="Last 7 days"
            primary={formatCurrency(ocr.costAud7d)}
            secondary={`${ocr.calls7d} calls`}
            icon={FileScan}
          />
          <KpiCard
            title="Last 30 days"
            primary={formatCurrency(ocr.costAud30d)}
            secondary={`${ocr.calls30d} calls`}
            icon={FileScan}
          />
        </div>
        <ByModelTable rows={ocr.byModel30d} showKind />
      </PageSection>
    </div>
  );
}

function ByModelTable({ rows, showKind }: { rows: ModelRow[]; showKind?: boolean }) {
  return (
    <Card className="mt-4">
      <CardContent className="p-4">
        <div className="mb-3 text-sm font-semibold">By model · last 30 days</div>
        {rows.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No usage in the last 30 days.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Provider</TableHead>
                <TableHead>Model</TableHead>
                {showKind && <TableHead>Kind</TableHead>}
                <TableHead className="text-right">Calls</TableHead>
                <TableHead className="text-right">Input</TableHead>
                <TableHead className="text-right">Output</TableHead>
                <TableHead className="text-right">Cache read</TableHead>
                <TableHead className="text-right">Cache write</TableHead>
                <TableHead className="text-right">Cost (AUD)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={`${r.provider}:${r.model}:${r.kind ?? ""}:${i}`}>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {r.provider}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.model}</TableCell>
                  {showKind && (
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {r.kind ?? "—"}
                    </TableCell>
                  )}
                  <TableCell className="text-right tabular-nums">
                    {r.calls.toLocaleString("en-AU")}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatTokens(r.inputTokens)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatTokens(r.outputTokens)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatTokens(r.cachedInputTokens)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatTokens(r.cacheCreationTokens)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {formatCurrency(r.costAud)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
