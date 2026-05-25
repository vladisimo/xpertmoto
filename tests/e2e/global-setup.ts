import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

export default async function globalSetup(): Promise<void> {
  const authDir = path.resolve(__dirname, ".auth");
  fs.mkdirSync(authDir, { recursive: true });

  if (process.env.E2E_NO_RESEED === "1") {
    console.log("[global-setup] E2E_NO_RESEED=1 — skipping DB reseed");
    return;
  }

  const sshHost = process.env.E2E_SSH_HOST;
  if (sshHost) {
    console.log(`[global-setup] reseeding test DB on ${sshHost}`);
    execSync(`ssh ${sshHost} "cd ~/scootering && npm run db:reset:e2e"`, {
      stdio: "inherit",
    });
    return;
  }

  // Local e2e profile: reseed the isolated xpertmoto_e2e database in-process.
  // `npm run test:e2e:local` reseeds up front and sets E2E_NO_RESEED=1, so this
  // only fires for a bare `E2E_DB=1 playwright test` invocation.
  if (process.env.E2E_DB === "1") {
    console.log("[global-setup] E2E_DB=1 — reseeding local xpertmoto_e2e database");
    execSync("npm run db:reset:e2e", { stdio: "inherit" });
    return;
  }

  console.log(
    "[global-setup] no E2E_SSH_HOST and E2E_DB unset — skipping DB reseed (running against the dev DB)",
  );
}
