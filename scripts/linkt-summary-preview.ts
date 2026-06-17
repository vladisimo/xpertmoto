/**
 * Ad-hoc: render the weekly Linkt toll-summary digest against the dev DB so
 * you can eyeball it without waiting for the Monday cron. Writes the branded
 * HTML to /tmp and prints the headline stats + plain-text part.
 *
 *   tsx scripts/linkt-summary-preview.ts
 *
 * Mirrors the prop-building in src/server/jobs/linkt-summary.ts.
 */
import * as path from "path";
import * as fs from "fs";
import * as dotenv from "dotenv";
dotenv.config({ path: path.resolve(__dirname, "../.env") });

import { createElement } from "react";
import { PrismaClient } from "@prisma/client";
import { render } from "@react-email/render";

import { getTollSummaryStats, type TollSummaryRow } from "../src/server/services/linkt";
import { formatCurrency } from "../src/lib/utils";
import { getBranding } from "../src/lib/branding";
import LinktSyncSummary from "../emails/linkt-sync-summary";

const STATUS_LABEL: Record<TollSummaryRow["status"], string> = {
  MATCHED: "Matched",
  NO_BOOKING: "No booking",
  UNMATCHED: "Unmatched",
};

const fmtDateTime = (d: Date) =>
  d.toLocaleString("en-AU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });

async function main() {
  const prisma = new PrismaClient();
  try {
    const now = new Date();
    const stats = await getTollSummaryStats(prisma, { now });
    const since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const { siteName } = await getBranding();
    const healthy = stats.lastSync?.status === "SUCCESS" && stats.unmatchedToBooking === 0;

    const props = {
      siteName,
      periodLabel: `${fmtDate(since)} – ${fmtDate(now)}`,
      totalTolls: stats.totalTolls.toLocaleString("en-AU"),
      matchedToBooking: stats.matchedToBooking.toLocaleString("en-AU"),
      unmatchedToBooking: stats.unmatchedToBooking.toLocaleString("en-AU"),
      withPlate: stats.withPlate.toLocaleString("en-AU"),
      withoutPlate: stats.withoutPlate.toLocaleString("en-AU"),
      lastSyncStatus: stats.lastSync?.status ?? null,
      lastSyncAt: stats.lastSync?.finishedAt ? fmtDateTime(stats.lastSync.finishedAt) : null,
      healthy,
      truncated: stats.recentTruncated,
      rows: stats.recent.map((r) => ({
        date: fmtDateTime(r.eventAt),
        plate: r.plate,
        location: r.tollpoint,
        amount: formatCurrency(r.amountCents / 100),
        status: STATUS_LABEL[r.status],
        booking: r.matchedBooking,
      })),
      portalUrl: `${(process.env.APP_URL ?? "https://xpertmoto.com.au").replace(/\/$/, "")}/staff/fleet?tab=tolls`,
    };

    const html = await render(createElement(LinktSyncSummary, props));
    const out = "/tmp/linkt-toll-summary-preview.html";
    fs.writeFileSync(out, html);

    console.log("\n=== Weekly toll summary — headline stats ===");
    console.log(`Total tolls:               ${props.totalTolls}`);
    console.log(`Matched to a booking:      ${props.matchedToBooking}`);
    console.log(`Not matched to a booking:  ${props.unmatchedToBooking}`);
    console.log(`With a registration plate: ${props.withPlate}`);
    console.log(`No registration plate:     ${props.withoutPlate}`);
    console.log(
      `Last sync:                 ${props.lastSyncStatus ?? "—"}${props.lastSyncAt ? ` (${props.lastSyncAt})` : ""}`,
    );
    console.log(`Last-7-day rows:           ${props.rows.length}${props.truncated ? " (capped)" : ""}`);
    console.log(`\nRendered HTML → ${out}  (open in a browser)\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
