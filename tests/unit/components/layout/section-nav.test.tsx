import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SectionTopBar } from "@/components/layout/section-nav";
import { BackOfficeRoleProvider } from "@/components/layout/back-office-role";
import type { UserRole } from "@/lib/nav";

vi.mock("next/navigation", () => ({
  usePathname: () => "/staff/communications",
}));

afterEach(cleanup);

function renderCommsBar(role: UserRole | undefined) {
  return render(
    <BackOfficeRoleProvider role={role}>
      <SectionTopBar section="comms" />
    </BackOfficeRoleProvider>,
  );
}

const link = (href: string) => document.querySelector(`a[href="${href}"]`);

describe("SectionTopBar role gating", () => {
  it("omits the manager-only Communications tabs for STAFF", () => {
    renderCommsBar("STAFF");
    expect(link("/staff/communications/campaigns")).toBeNull();
    expect(link("/staff/communications/segments")).toBeNull();
    // The rest of the section still renders.
    expect(link("/staff/communications/compose")).not.toBeNull();
    expect(link("/staff/communications/templates")).not.toBeNull();
    expect(screen.getByText("Log")).toBeDefined();
  });

  it("renders them for MANAGER", () => {
    renderCommsBar("MANAGER");
    expect(link("/staff/communications/campaigns")).not.toBeNull();
    expect(link("/staff/communications/segments")).not.toBeNull();
  });

  it("hides them when no role is in context", () => {
    renderCommsBar(undefined);
    expect(link("/staff/communications/campaigns")).toBeNull();
    expect(link("/staff/communications/compose")).not.toBeNull();
  });
});
