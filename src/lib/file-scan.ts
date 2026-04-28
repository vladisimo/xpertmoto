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
 * Default (no provider set): returns `{ clean: true, via: "bypass" }` so
 * dev/local uploads keep working. In production, wire one of the above.
 */

export type FileScanResult =
  | { clean: true; via: "bypass" | "clamav" | "vt" }
  | { clean: false; via: "clamav" | "vt"; reason: string };

export async function scanForMalware(
  buffer: Buffer,
  meta: { filename: string; contentType: string },
): Promise<FileScanResult> {
  const provider = process.env.FILE_SCAN_PROVIDER?.toLowerCase();
  if (!provider || provider === "bypass") {
    if (process.env.NODE_ENV === "production") {
      logger.warn(
        { filename: meta.filename, contentType: meta.contentType, size: buffer.byteLength },
        "file upload: malware scan bypassed (FILE_SCAN_PROVIDER not set)",
      );
    }
    return { clean: true, via: "bypass" };
  }
  if (provider === "clamav") {
    return scanViaClamAv(buffer);
  }
  if (provider === "vt") {
    return scanViaVirusTotal(buffer);
  }
  logger.warn({ provider }, "file-scan: unknown provider, bypassing");
  return { clean: true, via: "bypass" };
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

async function scanViaVirusTotal(_buffer: Buffer): Promise<FileScanResult> {
  // Not implemented — placeholder. VirusTotal requires uploading the file
  // to their API and polling for results, which is async and has rate
  // limits on free tier. If we adopt this path, add a background job that
  // hashes the file, checks for a cached verdict, and uploads on miss.
  logger.warn("virus-total scanner: not yet implemented, bypassing");
  return { clean: true, via: "bypass" };
}
