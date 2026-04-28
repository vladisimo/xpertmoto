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
  if (!sshHost) {
    console.log(
      "[global-setup] E2E_SSH_HOST unset — skipping DB reseed (assuming dev DB on the other end of the tunnel)",
    );
    return;
  }

  console.log(`[global-setup] reseeding test DB on ${sshHost}`);
  execSync(`ssh ${sshHost} "cd ~/scootering && npm run db:reset:e2e"`, {
    stdio: "inherit",
  });
}
