/**
 * One-shot backfill: give every back-office user (STAFF/MANAGER/ADMIN/
 * SUPER_ADMIN) a CustomerProfile so they can personally rent.
 *
 * Customer identity is profile-based, not role-based (see
 * src/lib/customer-identity.ts). New back-office users get a profile at
 * creation (admin.inviteStaff + seeds); this backfills the ones created
 * before that change.
 *
 * Profiles are created BARE (only userId): backfilled staff are NOT
 * auto-onboarded — they complete the same licence + signed-agreement
 * onboarding wizard on first customer-portal entry before they can book.
 *
 * Idempotent: the `customerProfile is null` filter skips users already
 * backfilled, so re-running is safe.
 *
 * Flags:
 *   --apply       actually write changes (default: dry-run)
 *   --limit N     process only the first N candidates
 */
import { PrismaClient, UserRole } from "@prisma/client";

const p = new PrismaClient();

const BACK_OFFICE_ROLES: UserRole[] = [
  UserRole.STAFF,
  UserRole.MANAGER,
  UserRole.ADMIN,
  UserRole.SUPER_ADMIN,
];

type Args = { apply: boolean; limit?: number };

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") args.apply = true;
    else if (a === "--limit") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`--limit requires a positive integer, got ${argv[i]}`);
      }
      args.limit = n;
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const candidates = await p.user.findMany({
    where: {
      role: { in: BACK_OFFICE_ROLES },
      customerProfile: { is: null },
      deletedAt: null,
    },
    select: { id: true, email: true, role: true },
    orderBy: { createdAt: "asc" },
    ...(args.limit ? { take: args.limit } : {}),
  });

  console.log(
    `${args.apply ? "APPLY" : "DRY-RUN"}: ${candidates.length} back-office user(s) without a CustomerProfile`,
  );

  let created = 0;
  for (const u of candidates) {
    if (args.apply) {
      await p.customerProfile.create({ data: { userId: u.id } });
      created++;
      console.log(`  created profile for ${u.email} (${u.role})`);
    } else {
      console.log(`  would create profile for ${u.email} (${u.role})`);
    }
  }

  console.log(
    args.apply
      ? `Done: created ${created} profile(s).`
      : `Dry-run complete. Re-run with --apply to create ${candidates.length} profile(s).`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await p.$disconnect();
  });
