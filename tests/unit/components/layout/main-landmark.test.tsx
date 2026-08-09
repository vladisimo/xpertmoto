import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { render, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PublicMain } from "@/components/layout/public-main";

let pathname = "/";
vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

afterEach(cleanup);

/**
 * One `main` landmark per page (WCAG 1.3.1 / ARIA landmark practice).
 *
 * In this app the landmark is owned by the route group's *shell*, one level
 * below the root layout: `PublicMain` for `(public)`, `PortalShell` for
 * `(customer)`, `BackOfficeShell` for `(staff)`/`(admin)`. The route-group
 * `layout.tsx` files must not add one of their own — a `<main>` in a layout
 * that also renders a shell stacks two *visible* landmarks on every page of
 * that group, which is the failure mode this guard exists to catch.
 *
 * (`(auth)`, `(onboarding)` and `/portal-select` own their landmark at the
 * page level instead, so they contribute nothing here.)
 */
function collect(dir: string, match: (f: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collect(full, match));
    else if (match(full)) out.push(full);
  }
  return out;
}

/** `<main>` occurrences in real JSX — block/JSX comments stripped first. */
function mainCount(file: string): number {
  const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  return (src.match(/<main[\s/>]/g) ?? []).length;
}

describe("main landmark inventory", () => {
  it("is owned by exactly the three route-group shells, once each", () => {
    const shells = collect("src/components/layout", (f) => /\.tsx?$/.test(f))
      .filter((f) => mainCount(f) > 0)
      .sort();

    expect(shells).toEqual([
      "src/components/layout/back-office-shell.tsx",
      "src/components/layout/portal-shell.tsx",
      "src/components/layout/public-main.tsx",
    ]);
    for (const shell of shells) expect(mainCount(shell)).toBe(1);
  });

  it("is never declared by a layout.tsx", () => {
    const layouts = collect("src/app", (f) => f.endsWith("layout.tsx")).filter(
      (f) => mainCount(f) > 0,
    );
    expect(layouts).toEqual([]);
  });
});

describe("PublicMain", () => {
  it("renders a single main landmark", () => {
    pathname = "/fleet";
    render(<PublicMain>content</PublicMain>);
    expect(document.querySelectorAll("main")).toHaveLength(1);
  });

  // The landmark also carries the fixed-header offset, so the element and its
  // classes are a layout contract, not just a semantic one.
  it.each([
    ["/", "pt-20"],
    ["/booking", "pt-14"],
    ["/why-xpert", "pt-0"],
  ])("keeps the header offset for %s", (route, offset) => {
    pathname = route;
    render(<PublicMain>content</PublicMain>);
    const main = document.querySelector("main");
    expect(main?.className).toContain(offset);
    expect(main?.className).toContain("flex-1");
  });
});
