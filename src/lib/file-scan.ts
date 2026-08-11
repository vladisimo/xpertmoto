import { logger } from "@/lib/logger";

/**
 * Pluggable virus/malware scan hook for uploaded files.
 *
 * Deployment options (pick whichever fits the infra):
 *   - Self-hosted ClamAV daemon via `clamd` on localhost:3310. Set
 *     `FILE_SCAN_PROVIDER=clamav` and `CLAMAV_HOST`/`CLAMAV_PORT`.
 *   - S3-native: hook into an S3 → Lambda scanner (e.g. bucketav) and
 *     tag the object `scan=clean` before it becomes readable.
 *   - External API: Sophos / Bitdefender / VirusTotal — set
 *     `FILE_SCAN_PROVIDER=vt` and `VT_API_KEY`.
 *
 * Default (no provider set): dev/local uploads pass through untouched so
 * nothing needs a scanner to boot. Production fails closed — an upload that
 * nothing actually scanned is rejected rather than waved through. Set
 * `FILE_SCAN_ALLOW_UNSCANNED=1` to keep the old pass-through behaviour on a
 * deployment that accepts the risk; every such upload is logged.
 */

export type FileScanResult =
  | { clean: true; via: "bypass" | "clamav" | "vt" }
  | { clean: false; via: "bypass" | "clamav" | "vt"; reason: string };

// Surfaced to the uploader by the API routes as "File rejected: <reason>",
// matching the token style of the clamav failure reasons below.
const UNSCANNED_REASON = "scanner-not-configured";

export async function scanForMalware(
  buffer: Buffer,
  meta: { filename: string; contentType: string },
): Promise<FileScanResult> {
  const provider = process.env.FILE_SCAN_PROVIDER?.toLowerCase();
  if (!provider || provider === "bypass") {
    return unscanned("bypass", buffer, meta, "FILE_SCAN_PROVIDER not set");
  }
  if (provider === "clamav") {
    return scanViaClamAv(buffer);
  }
  if (provider === "vt") {
    return scanViaVirusTotal(buffer, meta);
  }
  return unscanned("bypass", buffer, meta, `unknown provider "${provider}"`);
}

/**
 * Resolve an upload that no scanner looked at.
 *
 * Outside production nothing changes — the file passes, silently, so local
 * dev and tests don't need a scanner. In production the file is rejected with
 * the same shape a real detection produces, so callers surface it as the
 * usual 400 instead of a 500. `FILE_SCAN_ALLOW_UNSCANNED=1` opts back into
 * passing the file, and warns on every single upload so the gap is visible in
 * the logs rather than assumed to be covered.
 */
function unscanned(
  via: "bypass" | "vt",
  buffer: Buffer,
  meta: { filename: string; contentType: string },
  detail: string,
): FileScanResult {
  if (process.env.NODE_ENV !== "production") {
    return { clean: true, via };
  }
  const context = {
    filename: meta.filename,
    contentType: meta.contentType,
    size: buffer.byteLength,
    detail,
  };
  if (process.env.FILE_SCAN_ALLOW_UNSCANNED === "1") {
    logger.warn(
      context,
      "file upload: accepted UNSCANNED in production (FILE_SCAN_ALLOW_UNSCANNED=1)",
    );
    return { clean: true, via };
  }
  logger.error(
    context,
    "file upload: rejected — no malware scanner configured (set FILE_SCAN_PROVIDER)",
  );
  return { clean: false, via, reason: UNSCANNED_REASON };
}

async function scanViaClamAv(buffer: Buffer): Promise<FileScanResult> {
  try {
    // Lazy-require so the clamav-client dep isn't mandatory in dev.
    // Install via `npm i clamav.js` or `npm i @types/clamav.js` before enabling.
    const host = process.env.CLAMAV_HOST ?? "127.0.0.1";
    const port = Number(process.env.CLAMAV_PORT ?? 3310);
    // Minimal INSTREAM protocol. See https://linux.die.net/man/8/clamd
    const net = await import("node:net");
    return await new Promise<FileScanResult>((resolve) => {
      const socket = net.createConnection({ host, port }, () => {
        socket.write("zINSTREAM\0");
        const size = Buffer.alloc(4);
        size.writeUInt32BE(buffer.length, 0);
        socket.write(size);
        socket.write(buffer);
        const end = Buffer.alloc(4); // zero-length chunk = stream end
        socket.write(end);
      });
      let resp = "";
      socket.on("data", (chunk) => {
        resp += chunk.toString("utf8");
      });
      socket.on("end", () => {
        if (resp.includes("OK")) resolve({ clean: true, via: "clamav" });
        else {
          const match = /FOUND:?\s*([\w.-]+)/i.exec(resp);
          resolve({
            clean: false,
            via: "clamav",
            reason: match?.[1] ?? resp.trim(),
          });
        }
      });
      socket.on("error", (err) => {
        logger.error({ err: err.message }, "clamav: connection failed — failing closed");
        resolve({ clean: false, via: "clamav", reason: "scanner-unavailable" });
      });
    });
  } catch (err) {
    logger.error({ err }, "clamav: unexpected error");
    return { clean: false, via: "clamav", reason: "scanner-error" };
  }
}

async function scanViaVirusTotal(
  buffer: Buffer,
  meta: { filename: string; contentType: string },
): Promise<FileScanResult> {
  // Not implemented — placeholder. VirusTotal requires uploading the file
  // to their API and polling for results, which is async and has rate
  // limits on free tier. If we adopt this path, add a background job that
  // hashes the file, checks for a cached verdict, and uploads on miss.
  // Until then `vt` is not a configured scanner: same fail-closed rule.
  return unscanned("vt", buffer, meta, "virus-total scanner not yet implemented");
}
