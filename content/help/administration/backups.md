# Backups

Backups protect the business's data — bookings, customers, finance records — so
you can recover from a mistake, a failure or a disaster. This area shows the
backup state and restore points.

## What to check

- **Backups are running** on schedule and completing successfully.
- **Recent restore points** exist and span far enough back to be useful.
- You understand the **restore process** — ideally before you ever need it.

## Good practice

- **Verify, don't assume.** A backup you've never tested is a hope, not a plan.
  Periodically confirm a restore point is actually usable.
- **Know your window.** Be clear on how much data you could lose in a
  worst-case (the gap between backups) and whether that's acceptable.
- **Treat restores as serious.** Restoring overwrites current data — only do it
  deliberately, with a clear understanding of what you're replacing and why.

## If disaster strikes

1. Stop further changes that could compound the problem.
2. Identify the most recent good restore point from this area.
3. Follow your organisation's documented restore procedure.
4. Afterwards, check the **Audit Log** and **Platform** health to confirm the
   system is consistent.

Backups are a super-admin responsibility — keep them boringly reliable.
