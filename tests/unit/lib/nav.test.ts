import { describe, it, expect } from "vitest";
import {
  BACK_OFFICE_NAV,
  canAccessChildHref,
  visibleChildren,
  type BackOfficeNavItem,
  type UserRole,
} from "@/lib/nav";

/**
 * Sub-pages gated tighter than their section. Both read through
 * `managerProcedure` endpoints, so STAFF must not be offered them — the nav
 * gate is the single declaration both nav surfaces filter on.
 */
const MANAGER_ONLY_CHILDREN = [
  "/staff/communications/campaigns",
  "/staff/communications/segments",
];

const COMMS = BACK_OFFICE_NAV.find(
  (i) => i.href === "/staff/communications",
) as BackOfficeNavItem;

const hrefs = (item: BackOfficeNavItem, role: UserRole | undefined) =>
  visibleChildren(item, role).map((c) => c.href);

const allHrefs = (item: BackOfficeNavItem) => (item.children ?? []).map((c) => c.href);

describe("back-office nav child role gates", () => {
  it("gates exactly the known manager-only sub-pages", () => {
    const gated = BACK_OFFICE_NAV.flatMap((item) =>
      (item.children ?? []).filter((c) => c.allowedRoles).map((c) => c.href),
    );
    expect(gated.sort()).toEqual([...MANAGER_ONLY_CHILDREN].sort());
  });

  it("hides Campaigns and Segments — and only those — from STAFF", () => {
    expect(hrefs(COMMS, "STAFF")).toEqual(
      allHrefs(COMMS).filter((h) => !MANAGER_ONLY_CHILDREN.includes(h)),
    );
    expect(allHrefs(COMMS).length - hrefs(COMMS, "STAFF").length).toBe(2);
  });

  it("keeps them for MANAGER and above", () => {
    for (const role of ["MANAGER", "ADMIN", "SUPER_ADMIN"] as const) {
      expect(hrefs(COMMS, role), `children for ${role}`).toEqual(allHrefs(COMMS));
    }
  });

  it("leaves every other section's children untouched for every role", () => {
    const roles: UserRole[] = ["STAFF", "MANAGER", "ADMIN", "SUPER_ADMIN"];
    for (const item of BACK_OFFICE_NAV) {
      if (item.href === COMMS.href) continue;
      for (const role of roles) {
        expect(hrefs(item, role), `${item.label} children for ${role}`).toEqual(allHrefs(item));
      }
    }
  });

  it("treats un-gated hrefs as inheriting their parent section", () => {
    expect(canAccessChildHref("/staff/communications/compose", "STAFF")).toBe(true);
    expect(canAccessChildHref("/staff/fleet/vehicles", "STAFF")).toBe(true);
    // Routes outside the nav (the section top bar carries a few) never gate.
    expect(canAccessChildHref("/staff/fleet/depots", "STAFF")).toBe(true);
  });

  it("gates a route the viewer's role is unknown for", () => {
    expect(canAccessChildHref("/staff/communications/campaigns", undefined)).toBe(false);
    expect(canAccessChildHref("/staff/communications/campaigns", "CUSTOMER")).toBe(false);
    expect(canAccessChildHref("/staff/communications/compose", undefined)).toBe(true);
  });
});
