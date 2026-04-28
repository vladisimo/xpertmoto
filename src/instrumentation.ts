// Background schedulers used to start from this instrumentation hook, but
// they now live in a dedicated `npm run worker` process (src/server/jobs/
// worker.ts) so the Next.js server can stay free of BullMQ's Node-only
// dependencies (ioredis, child_process, crypto, playwright) that webpack
// cannot bundle. To re-enable inline scheduling for single-process dev,
// spawn the worker separately or run it in a detached Node subprocess.
export async function register() {
  // intentionally empty — see comment above
}
