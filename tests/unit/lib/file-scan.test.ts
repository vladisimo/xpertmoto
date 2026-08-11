import { EventEmitter } from "node:events";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// The clamav path lazily imports node:net; this fake socket lets the tests
// drive the INSTREAM response without a daemon.
class FakeSocket extends EventEmitter {
  write = vi.fn();
}
const sockets: FakeSocket[] = [];
const createConnection = vi.fn((_opts: unknown, onConnect: () => void) => {
  const socket = new FakeSocket();
  sockets.push(socket);
  // Real sockets connect on a later tick — firing synchronously would run
  // the caller's connect callback before it holds the socket handle.
  queueMicrotask(onConnect);
  return socket;
});
vi.mock("node:net", () => ({
  createConnection: (opts: unknown, onConnect: () => void) => createConnection(opts, onConnect),
}));

import { scanForMalware } from "@/lib/file-scan";
import { logger } from "@/lib/logger";

const warn = vi.mocked(logger.warn);
const error = vi.mocked(logger.error);

const FILE = Buffer.from("hello");
const META = { filename: "licence.jpg", contentType: "image/jpeg" };

beforeEach(() => {
  vi.clearAllMocks();
  sockets.length = 0;
});
afterEach(() => vi.unstubAllEnvs());

describe("scanForMalware — no scanner configured", () => {
  it("rejects the upload in production when FILE_SCAN_PROVIDER is unset", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FILE_SCAN_PROVIDER", undefined);
    vi.stubEnv("FILE_SCAN_ALLOW_UNSCANNED", undefined);

    const result = await scanForMalware(FILE, META);

    expect(result).toEqual({
      clean: false,
      via: "bypass",
      reason: "scanner-not-configured",
    });
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("rejects the unimplemented vt stub in production too", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FILE_SCAN_PROVIDER", "vt");
    vi.stubEnv("FILE_SCAN_ALLOW_UNSCANNED", undefined);

    const result = await scanForMalware(FILE, META);

    expect(result).toEqual({ clean: false, via: "vt", reason: "scanner-not-configured" });
  });

  it("rejects an unknown provider in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FILE_SCAN_PROVIDER", "sophos");

    const result = await scanForMalware(FILE, META);

    expect(result.clean).toBe(false);
  });

  it("passes the file in production when FILE_SCAN_ALLOW_UNSCANNED=1, warning per upload", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FILE_SCAN_PROVIDER", undefined);
    vi.stubEnv("FILE_SCAN_ALLOW_UNSCANNED", "1");

    const result = await scanForMalware(FILE, META);

    expect(result).toEqual({ clean: true, via: "bypass" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it("passes the file in development without the escape hatch", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FILE_SCAN_PROVIDER", undefined);
    vi.stubEnv("FILE_SCAN_ALLOW_UNSCANNED", undefined);

    const result = await scanForMalware(FILE, META);

    expect(result).toEqual({ clean: true, via: "bypass" });
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

describe("scanForMalware — clamav", () => {
  async function connectedSocket(): Promise<FakeSocket> {
    await vi.waitFor(() => expect(sockets).toHaveLength(1));
    const socket = sockets[0];
    if (!socket) throw new Error("clamav socket was never opened");
    return socket;
  }

  async function scanWithClamAvResponse(response: string) {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FILE_SCAN_PROVIDER", "clamav");
    const pending = scanForMalware(FILE, META);
    const socket = await connectedSocket();
    socket.emit("data", Buffer.from(response));
    socket.emit("end");
    return pending;
  }

  it("passes a clean file", async () => {
    await expect(scanWithClamAvResponse("stream: OK\0")).resolves.toEqual({
      clean: true,
      via: "clamav",
    });
  });

  it("rejects a detection, reporting what the daemon said", async () => {
    const result = await scanWithClamAvResponse("stream: Eicar-Test-Signature FOUND");

    expect(result.clean).toBe(false);
    expect(result).toMatchObject({ via: "clamav" });
    expect(result.clean === false && result.reason).toContain("Eicar-Test-Signature");
  });

  it("fails closed when the daemon is unreachable", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FILE_SCAN_PROVIDER", "clamav");
    const pending = scanForMalware(FILE, META);
    const socket = await connectedSocket();
    socket.emit("error", new Error("ECONNREFUSED"));

    await expect(pending).resolves.toEqual({
      clean: false,
      via: "clamav",
      reason: "scanner-unavailable",
    });
  });
});
