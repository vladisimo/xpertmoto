import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UseCaseTabs } from "@/components/fleet/use-case-tabs";
import { ALL_TAB } from "@/lib/fleet-use-cases";

const { replace } = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams("use=commuting"),
}));

afterEach(() => {
  cleanup();
  replace.mockReset();
});

describe("UseCaseTabs a11y shape", () => {
  it("does not claim to be a tab interface (no tabpanel exists)", () => {
    render(<UseCaseTabs active="COMMUTING" includeAll />);

    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryAllByRole("tablist")).toHaveLength(0);
    expect(
      document.querySelectorAll("[aria-controls]"),
    ).toHaveLength(0);
  });

  it("exposes the filters as a labelled group of toggle buttons", () => {
    render(<UseCaseTabs active="COMMUTING" includeAll />);

    const group = screen.getByRole("group", { name: "Filter the fleet by use case" });
    expect(group).toBeDefined();

    // "All" + the four use cases.
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual([
      "All",
      "Adventure",
      "Commuting",
      "Practice",
      "Delivery",
    ]);
  });

  it("marks only the active filter as pressed", () => {
    render(<UseCaseTabs active="PRACTICE" includeAll />);

    const pressed = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
    expect(pressed[0]!.textContent).toBe("Practice");
    // The tab strip's active styling keys off data-state, not role=tab.
    expect(pressed[0]!.getAttribute("data-state")).toBe("active");
  });

  it("omits the All filter unless includeAll is set", () => {
    render(<UseCaseTabs active="COMMUTING" />);

    expect(screen.queryByRole("button", { name: "All" })).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(4);
  });
});

describe("UseCaseTabs behaviour", () => {
  it("hands the change to the parent when onChange is supplied", () => {
    const onChange = vi.fn();
    render(<UseCaseTabs active="COMMUTING" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "Adventure" }));

    expect(onChange).toHaveBeenCalledWith("ADVENTURE");
    expect(replace).not.toHaveBeenCalled();
  });

  it("syncs ?use= on /fleet when uncontrolled", () => {
    render(<UseCaseTabs active="COMMUTING" includeAll />);

    fireEvent.click(screen.getByRole("button", { name: "Delivery" }));
    expect(replace).toHaveBeenCalledWith("/fleet?use=delivery", { scroll: false });
  });

  it("drops ?use= for the All filter", () => {
    render(<UseCaseTabs active={ALL_TAB} includeAll />);

    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(replace).toHaveBeenCalledWith("/fleet", { scroll: false });
  });
});
