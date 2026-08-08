import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The backup-settings query resolves a tick after /admin/platform mounts, which
// is exactly the window in which the settings inputs used to mount with
// `value={undefined}` and flip to controlled. Drive that transition by hand.
const state = vi.hoisted(() => ({
  settings: undefined as
    | { schedule: string; retentionDays: number; alertOnFailure: boolean }
    | undefined,
}));

vi.mock("@/lib/trpc/client", () => {
  const noopMutation = () => ({ mutate: () => undefined, isPending: false });
  return {
    trpc: {
      backup: {
        list: { useQuery: () => ({ data: [], isLoading: false }) },
        summary: { useQuery: () => ({ data: undefined }) },
        getSettings: { useQuery: () => ({ data: state.settings }) },
        triggerManual: { useMutation: noopMutation },
        updateSettings: { useMutation: noopMutation },
      },
      platform: { databaseStats: { useQuery: () => ({ data: undefined }) } },
      useUtils: () => ({
        backup: {
          list: { invalidate: () => undefined },
          summary: { invalidate: () => undefined },
          getSettings: { invalidate: () => undefined },
        },
      }),
    },
  };
});

import { DatabaseTab } from "@/components/admin/platform/database-tab";

const SETTINGS = { schedule: "0 3 * * *", retentionDays: 30, alertOnFailure: true };

describe("DatabaseTab — backup settings mount controlled", () => {
  // React reports the controlled/uncontrolled flip through console.error.
  const consoleErrors: string[] = [];

  beforeEach(() => {
    state.settings = undefined;
    consoleErrors.length = 0;
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      consoleErrors.push(args.map(String).join(" "));
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("logs no uncontrolled→controlled switch when the settings query resolves", () => {
    const { rerender } = render(<DatabaseTab />);
    // Nothing to flip yet — the settings card is hidden until data arrives.
    expect(screen.queryByLabelText(/cron schedule/i)).toBeNull();

    state.settings = SETTINGS;
    rerender(<DatabaseTab />);

    const flips = consoleErrors.filter((msg) =>
      /uncontrolled input to be controlled/i.test(msg),
    );
    expect(flips).toEqual([]);
  });

  it("renders the resolved settings values", () => {
    state.settings = SETTINGS;
    render(<DatabaseTab />);
    expect(screen.getByLabelText(/cron schedule/i)).toHaveProperty(
      "value",
      SETTINGS.schedule,
    );
    expect(screen.getByLabelText(/retention \(days\)/i)).toHaveProperty(
      "value",
      String(SETTINGS.retentionDays),
    );
  });
});
