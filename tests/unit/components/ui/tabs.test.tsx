import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  tabsListClassName,
  tabsTriggerClassName,
} from "@/components/ui/tabs";

afterEach(cleanup);

describe("Tabs primitives", () => {
  it("still wires role=tab to a real tabpanel", () => {
    render(
      <Tabs value="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Panel A</TabsContent>
      </Tabs>,
    );

    const trigger = screen.getByRole("tab");
    const controls = trigger.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    expect(document.getElementById(controls!)?.getAttribute("role")).toBe("tabpanel");
  });

  it("renders the exported class strings, so nav-style bars can reuse them", () => {
    render(
      <Tabs value="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Panel A</TabsContent>
      </Tabs>,
    );

    const list = screen.getByRole("tablist");
    const trigger = screen.getByRole("tab");
    for (const cls of tabsListClassName.split(" ")) {
      expect(list.className).toContain(cls);
    }
    for (const cls of tabsTriggerClassName.split(" ")) {
      expect(trigger.className).toContain(cls);
    }
  });
});

/**
 * Static guard for frontend-test-findings #18: a `TabsTrigger` announces
 * `role="tab"` + `aria-controls`, so a file that renders one without a
 * `TabsContent` ships an aria-controls pointing at nothing. Bars that
 * navigate or set a query param instead must use nav/toggle markup with the
 * exported class strings above.
 */
const SRC = path.resolve(process.cwd(), "src");

/**
 * Two `?tab=` entity-detail bars are still on the broken shape — they live
 * under `src/app/**`, outside the scope the rest of this fix shipped in, and
 * need the same nav/toggle treatment. Listed so the guard below still catches
 * anything *new*.
 */
const KNOWN_DANGLING = [
  "app/(staff)/staff/customers/[id]/page.tsx",
  "app/(staff)/staff/fleet/vehicles/[id]/page.tsx",
];

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(full);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [full] : [];
  });
}

describe("no role=tab without a tabpanel", () => {
  it("no new file renders a TabsTrigger without a TabsContent", () => {
    const dangling = tsxFiles(SRC)
      .filter((file) => {
        const source = readFileSync(file, "utf8");
        return source.includes("<TabsTrigger") && !source.includes("<TabsContent");
      })
      .map((file) => path.relative(SRC, file).split(path.sep).join("/"));

    expect(dangling.filter((f) => !KNOWN_DANGLING.includes(f))).toEqual([]);
  });
});
