import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  refreshAnalyticsConsent,
  setAnalyticsConsent,
} from "@/components/shared/analytics-consent";

/**
 * `next/script` is mocked so the PostHog snippet never executes in jsdom. The
 * mock reproduces the behaviour these tests depend on: the real component keys
 * a module-level load cache on `id`, so an inline script runs at most once per
 * page-load however often it re-renders (node_modules/next/dist/client/
 * script.js, `LoadCache`).
 */
const scriptState = vi.hoisted(() => ({
  loaded: new Set<string>(),
  executions: [] as { id: string; source: string }[],
}));

vi.mock("next/script", async () => {
  const { useEffect } = await import("react");
  return {
    default: function MockScript({
      id,
      children,
    }: {
      id?: string;
      children?: React.ReactNode;
    }) {
      const source = String(children ?? "");
      useEffect(() => {
        const key = id ?? source;
        if (scriptState.loaded.has(key)) return;
        scriptState.loaded.add(key);
        scriptState.executions.push({ id: key, source });
      }, [id, source]);
      return null;
    },
  };
});

const { PostHogProvider } = await import("@/components/shared/posthog-provider");

const KEY = "phc_test_key";
const HOST = "https://us.i.posthog.com";

/** The single recorded snippet execution — fails loudly if nothing loaded. */
function onlyExecution(): { id: string; source: string } {
  expect(scriptState.executions).toHaveLength(1);
  const execution = scriptState.executions[0];
  if (!execution) throw new Error("no snippet execution recorded");
  return execution;
}

function stubLoadedPostHog() {
  const posthog = {
    identify: vi.fn(),
    capture: vi.fn(),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
  };
  (window as { posthog?: unknown }).posthog = posthog;
  return posthog;
}

beforeEach(() => {
  window.localStorage.clear();
  refreshAnalyticsConsent();
  scriptState.loaded.clear();
  scriptState.executions.length = 0;
  delete (window as { posthog?: unknown }).posthog;
});

afterEach(cleanup);

describe("PostHogProvider consent gate", () => {
  it("does not load PostHog before the visitor answers the banner", () => {
    render(<PostHogProvider browserKey={KEY} host={HOST} />);
    expect(scriptState.executions).toHaveLength(0);
  });

  it("never loads PostHog after a decline, including across re-renders", () => {
    setAnalyticsConsent("denied");
    const { rerender } = render(<PostHogProvider browserKey={KEY} host={HOST} />);
    rerender(<PostHogProvider browserKey={KEY} host={HOST} />);
    expect(scriptState.executions).toHaveLength(0);
  });

  it("loads PostHog exactly once on accept and does not re-init on re-render", () => {
    const { rerender } = render(<PostHogProvider browserKey={KEY} host={HOST} />);
    expect(scriptState.executions).toHaveLength(0);

    act(() => setAnalyticsConsent("granted"));

    const execution = onlyExecution();
    expect(execution.id).toBe("posthog-init");
    expect(execution.source).toContain(`posthog.init('${KEY}'`);

    rerender(<PostHogProvider browserKey={KEY} host={HOST} />);
    act(() => setAnalyticsConsent("granted"));
    expect(scriptState.executions).toHaveLength(1);
  });

  it("keeps the privacy-maximal recorder config when it does load", () => {
    setAnalyticsConsent("granted");
    render(<PostHogProvider browserKey={KEY} host={HOST} />);

    const { source } = onlyExecution();
    expect(source).toContain('"maskAllInputs":true');
    expect(source).toContain('"maskTextSelector":"*"');
    expect(source).toContain(`"api_host":"${HOST}"`);
  });

  it("stays off when granted but no browser key is configured", () => {
    setAnalyticsConsent("granted");
    render(<PostHogProvider browserKey="" host={HOST} />);
    expect(scriptState.executions).toHaveLength(0);
  });

  it("opts capturing out when consent is withdrawn after PostHog loaded", () => {
    setAnalyticsConsent("granted");
    render(<PostHogProvider browserKey={KEY} host={HOST} />);
    const posthog = stubLoadedPostHog();

    act(() => setAnalyticsConsent("denied"));
    expect(posthog.opt_out_capturing).toHaveBeenCalledTimes(1);

    // Re-granting in the same page-load can't re-run the snippet, so the
    // provider opts back in through the SDK instead.
    act(() => setAnalyticsConsent("granted"));
    expect(posthog.opt_in_capturing).toHaveBeenCalledTimes(1);
    expect(scriptState.executions).toHaveLength(1);
  });
});
