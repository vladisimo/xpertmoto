import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ENV_KEY = "NEXT_PUBLIC_MAP_STYLE_URL";

// MAP_STYLE_URL reads NEXT_PUBLIC_MAP_STYLE_URL at module-eval time, so each
// case mutates the env then re-imports the module fresh.
async function loadStyleUrl(): Promise<string> {
  vi.resetModules();
  const mod = await import("@/lib/maps/style");
  return mod.MAP_STYLE_URL;
}

describe("MAP_STYLE_URL", () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env[ENV_KEY];
  });

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_KEY];
    else process.env[ENV_KEY] = original;
  });

  it("defaults to the OpenFreeMap community style when the env var is unset", async () => {
    delete process.env[ENV_KEY];
    expect(await loadStyleUrl()).toBe("https://tiles.openfreemap.org/styles/liberty");
  });

  it("uses NEXT_PUBLIC_MAP_STYLE_URL when a keyed provider is configured", async () => {
    process.env[ENV_KEY] = "https://api.maptiler.com/maps/streets-v2/style.json?key=abc123";
    expect(await loadStyleUrl()).toBe(
      "https://api.maptiler.com/maps/streets-v2/style.json?key=abc123",
    );
  });
});
