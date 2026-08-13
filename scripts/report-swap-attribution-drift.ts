/**
 * Report-only: swap-aware re-attribution check for infringements and tolls.
 *
 * Cause: the toll/infringement matcher used to be swap-blind — it attributed
 * an event to whichever booking's CURRENT `vehicleId` matched, ignoring that
 * committed mid-hire swaps overwrite that column. An event on a vehicle that
 * was swapped off a booking before the offence time could be pinned on the
 * wrong renter (and a false nomination to Revenue NSW is a criminal offence),
 * while events on the swapped-in vehicle went unbilled. The matcher is now
 * swap-aware (`resolveBookingForVehicleAt`); this script re-runs it over the
 * HISTORY and reports every linked Infringement — Linkt-sourced TOLL rows
 * included, they are Infringement rows too — whose stored booking/customer
 * link disagrees with the swap-aware answer at the offence timestamp
 * (`offenceDate`, the same field the live matcher uses).
 *
 * PURE REPORT — no writes, no --apply. Corrections go through the manual
 * nomination workflow, never a bulk update.
 *
 * Usage:
 *   npx tsx scripts/report-swap-attribution-drift.ts                 # full report
 *   npx tsx scripts/report-swap-attribution-drift.ts --booking-id X  # events linked to one booking (id or reference)
 */
import { PrismaClient } from "@prisma/client";

import { resolveBookingForVehicleAt } from "@/server/services/booking-matcher";

const p = new PrismaClient();

type Args = {
  bookingId?: string;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--booking-id") {
      const v = argv[++i];
      if (!v) throw new Error("--booking-id requires a value");
      args.bookingId = v;
    } else {
      throw new Error(`unknown argument: ${a} (this script is report-only; there is no --apply)`);
    }
  }
  return args;
}

const when = (d: Date) =>
  d.toLocaleString("en-AU", { timeZone: "Australia/Brisbane", hour12: false });

type Verdict = "OK" | "MISMATCH" | "AMBIGUOUS" | "NO_RENTER";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`\nSwap-aware infringement/toll attribution drift — REPORT ONLY (no writes)\n`);

  // Only vehicles that ever took part in a committed swap can have drifted:
  // the old matcher was only wrong when a swap moved a vehicle on/off a
  // booking mid-hire.
  const swapLegs = await p.bookingSwap.findMany({
    where: { status: "COMMITTED", deletedAt: null },
    select: { outgoingVehicleId: true, incomingVehicleId: true },
  });
  const swappedVehicleIds = new Set<string>();
  for (const leg of swapLegs) {
    swappedVehicleIds.add(leg.outgoingVehicleId);
    if (leg.incomingVehicleId) swappedVehicleIds.add(leg.incomingVehicleId);
  }
  if (swappedVehicleIds.size === 0) {
    console.log("No committed swaps — the swap-blind matcher cannot have mis-attributed anything.\n");
    return;
  }

  const infringements = await p.infringement.findMany({
    where: {
      deletedAt: null,
      vehicleId: { in: [...swappedVehicleIds] },
      OR: [{ bookingId: { not: null } }, { customerId: { not: null } }],
      ...(args.bookingId
        ? {
            booking: {
              is: { OR: [{ id: args.bookingId }, { bookingReference: args.bookingId }] },
            },
          }
        : {}),
    },
    select: {
      id: true,
      type: true,
      issuer: true,
      referenceNumber: true,
      vehicleId: true,
      offenceDate: true,
      status: true,
      bookingId: true,
      customerId: true,
      nominatedAt: true,
      vehicle: { select: { rego: true, internalCode: true } },
      booking: { select: { bookingReference: true } },
    },
    orderBy: { offenceDate: "asc" },
  });

  if (infringements.length === 0) {
    console.log(
      `Scanned ${swappedVehicleIds.size} swap-involved vehicle(s): no linked infringements/tolls on them.\n`,
    );
    return;
  }

  const counts = new Map<Verdict, number>();
  const byStatus = new Map<string, { total: number; flagged: number }>();
  const bump = (verdict: Verdict, status: string) => {
    counts.set(verdict, (counts.get(verdict) ?? 0) + 1);
    const bucket = byStatus.get(status) ?? { total: 0, flagged: 0 };
    bucket.total++;
    if (verdict !== "OK") bucket.flagged++;
    byStatus.set(status, bucket);
  };

  for (const inf of infringements) {
    const label =
      `${inf.type} ${inf.referenceNumber} (${inf.issuer})  ${inf.vehicle.internalCode}/${inf.vehicle.rego}  ` +
      `${when(inf.offenceDate)}  [${inf.status}${inf.nominatedAt ? ", nominated" : ""}]`;
    const stored = `stored: booking ${inf.booking?.bookingReference ?? inf.bookingId ?? "-"}, customer ${inf.customerId ?? "-"}`;

    const resolution = await resolveBookingForVehicleAt(p, inf.vehicleId, inf.offenceDate);

    if (resolution.kind === "none") {
      bump("NO_RENTER", inf.status);
      console.log(`NO_RENTER  ${label}`);
      console.log(`           ${stored} — swap-aware matcher finds NO renter held this vehicle at the offence time`);
      continue;
    }
    if (resolution.kind === "ambiguous") {
      bump("AMBIGUOUS", inf.status);
      const storedAmongCandidates = resolution.candidates.some((c) => c.id === inf.bookingId);
      console.log(`AMBIGUOUS  ${label}`);
      console.log(
        `           ${stored} — overlapping candidates: ` +
          resolution.candidates
            .map((c) => `${c.bookingReference} (${c.customer.firstName} ${c.customer.lastName})`)
            .join(", ") +
          `${storedAmongCandidates ? " (stored link IS one of them)" : " (stored link is NOT among them)"}`,
      );
      continue;
    }

    const match = resolution.booking;
    const bookingAgrees = inf.bookingId === null || inf.bookingId === match.id;
    const customerAgrees = inf.customerId === null || inf.customerId === match.customerId;
    if (bookingAgrees && customerAgrees) {
      bump("OK", inf.status);
      continue;
    }
    bump("MISMATCH", inf.status);
    console.log(`MISMATCH   ${label}`);
    console.log(
      `           ${stored} — swap-aware match: booking ${match.bookingReference}, customer ` +
        `${match.customerId} (${match.customer.firstName} ${match.customer.lastName})`,
    );
  }

  const flagged =
    (counts.get("MISMATCH") ?? 0) + (counts.get("AMBIGUOUS") ?? 0) + (counts.get("NO_RENTER") ?? 0);
  console.log(
    `\nScanned ${infringements.length} linked infringement/toll row(s) on ${swappedVehicleIds.size} ` +
      `swap-involved vehicle(s): ${counts.get("OK") ?? 0} agree, ${counts.get("MISMATCH") ?? 0} mismatched, ` +
      `${counts.get("AMBIGUOUS") ?? 0} ambiguous, ${counts.get("NO_RENTER") ?? 0} no-renter.`,
  );
  console.log(`By status:`);
  for (const [status, bucket] of [...byStatus.entries()].sort()) {
    console.log(`  ${status}: ${bucket.total} row(s), ${bucket.flagged} flagged`);
  }
  if (flagged > 0) {
    console.log(
      `\nThis report changes nothing. Corrections go through the MANUAL nomination workflow ` +
        `(Fleet → Infringements / Nominations): re-link the row after human review, regenerate the ` +
        `nomination artefacts, and lodge a correction or withdrawal with the issuer where a ` +
        `nomination already went out. Never bulk-update these links.\n`,
    );
  } else {
    console.log(`\nNo drift found — stored links all agree with the swap-aware matcher.\n`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await p.$disconnect();
  });
