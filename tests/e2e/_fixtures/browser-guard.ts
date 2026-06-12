import { test as base, type BrowserContext } from "@playwright/test";

/**
 * Browser-issue guard — captures console errors, uncaught page exceptions,
 * failed same-origin requests and same-origin HTTP >= 400 responses on every
 * page of every context a test opens, then (depending on mode) fails the test
 * or annotates it after the body finishes.
 *
 * This is the passive "dead button" detector: a click handler that throws, a
 * tRPC mutation that 500s, or a broken RSC payload all surface here even when
 * the spec's own assertions never look at them.
 *
 * Modes (per-file via `test.use({ guardMode: "strict" })`, globally via the
 * E2E_GUARD env var):
 *  - "strict": throw after the test if non-allowlisted issues were captured
 *    (only when the test otherwise passed, so guard noise never masks a real
 *    assertion failure).
 *  - "report": attach issues as JSON + annotation, never fail. Default while
 *    pre-existing noise is being triaged.
 *  - "off": capture nothing.
 */

export type GuardMode = "off" | "report" | "strict";

export type BrowserIssue = {
  kind: "console-error" | "pageerror" | "request-failed" | "http-error";
  text: string;
  /** Request URL for network issues. */
  url?: string;
  /** Page the issue happened on. */
  pageUrl: string;
  status?: number;
};

/** Allowlist rules can scope by kind and (for http-error) by status. */
export type AllowRule = {
  pattern: RegExp;
  kinds?: BrowserIssue["kind"][];
  statuses?: number[];
};

// Third-party noise and expected auth probes only. NEVER allowlist a
// same-origin /api/trpc 4xx/5xx here — that is exactly the broken-sequence
// signal this guard exists to catch. Spec-specific expected errors belong in
// a per-file `test.use({ guardAllow: [...DEFAULT_ALLOWLIST, ...] })`.
export const DEFAULT_ALLOWLIST: AllowRule[] = [
  { pattern: /posthog/i },
  { pattern: /sentry/i },
  { pattern: /js\.stripe\.com|[a-z]+\.stripe\.com|stripe\.network/i },
  // MapLibre basemap tiles / glyphs / sprites from third-party tile hosts.
  { pattern: /\.(pbf|mvt)(\?|$)|tiles?\.|maptiler|openfreemap|basemaps|demotiles/i },
  // Browsers request /favicon.ico unconditionally; the icon comes from the
  // tenant's branding.faviconUrl setting, unset in the e2e org settings.
  { pattern: /favicon\.ico|apple-touch-icon|\.well-known/i },
  // NextAuth probes: unauthenticated session checks and wrong-credential
  // submissions respond 401 by design (auth specs assert the UX separately).
  { pattern: /\/api\/auth\/(session|csrf|providers|callback\/credentials)/, statuses: [401] },
  // session.whoAmI / customer.me 401/403 probes — the identify components
  // (posthog/sentry) and wizard step 4 fire these for guests (401
  // UNAUTHORIZED, documented as "the desired no-op") and for un-onboarded
  // users on /onboarding (403 "Onboarding required" from protectedProcedure).
  // Only those are expected; a 5xx on these still fails. Flagged in
  // docs/frontend-test-findings.md #1 as a candidate for
  // publicProcedure-returning-null post-launch.
  { pattern: /\/api\/trpc\/(session\.whoAmI|customer\.me)/, statuses: [401, 403] },
  {
    pattern: /40[13] \((unauthorized|forbidden)\).*\/api\/trpc\/(session\.whoAmI|customer\.me)/i,
    kinds: ["console-error"],
  },
  // Next.js aborts in-flight RSC/prefetch fetches on navigation; not a bug.
  { pattern: /net::ERR_ABORTED/, kinds: ["request-failed"] },
  // Same abort class, surfaced through next-auth instead: SessionProvider's
  // getSession() fetch gets killed by the next navigation (frequent on slow
  // CI runners during route sweeps) and authjs logs ClientFetchError. A
  // genuinely broken /api/auth/session still fails via http-error capture.
  { pattern: /ClientFetchError: Failed to fetch/, kinds: ["console-error"] },
  // Sentry tunnel route — forwards envelopes to sentry.io and 500s when the
  // upstream is unreachable/rate-limited. Monitoring infrastructure, not app
  // function; the should-degrade-gracefully issue is tracked in
  // docs/frontend-test-findings.md.
  { pattern: /\/monitoring(\?|$)/ },
  { pattern: /Download the React DevTools/i, kinds: ["console-error"] },
  // Dev-server chatter (suite runs against `next dev`).
  { pattern: /\[Fast Refresh\]|webpack-hmr|hot-update|__nextjs_original-stack-frame/i },
];

function isSameOrigin(url: string, baseURL: string): boolean {
  try {
    return new URL(url).origin === new URL(baseURL).origin;
  } catch {
    return false;
  }
}

/** Wire the capture listeners onto every current and future page of a context. */
export function attachGuard(
  context: BrowserContext,
  sink: BrowserIssue[],
  baseURL: string,
): void {
  const wire = (page: import("@playwright/test").Page) => {
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      // For "Failed to load resource" entries the message text omits the
      // resource; location().url carries it — required for allowlist matching.
      sink.push({
        kind: "console-error",
        text: msg.text(),
        url: msg.location().url || undefined,
        pageUrl: page.url(),
      });
    });
    page.on("pageerror", (err) => {
      sink.push({ kind: "pageerror", text: String(err), pageUrl: page.url() });
    });
    page.on("requestfailed", (req) => {
      if (!isSameOrigin(req.url(), baseURL)) return;
      sink.push({
        kind: "request-failed",
        text: req.failure()?.errorText ?? "failed",
        url: req.url(),
        pageUrl: page.url(),
      });
    });
    page.on("response", (res) => {
      if (!isSameOrigin(res.url(), baseURL) || res.status() < 400) return;
      const issue: BrowserIssue = {
        kind: "http-error",
        text: `HTTP ${res.status()} ${res.request().method()} ${res.url()}`,
        url: res.url(),
        pageUrl: page.url(),
        status: res.status(),
      };
      // For API errors, attach the request payload (synchronously available)
      // and try for the response body — a tRPC 400 without its zod message
      // is undebuggable from the test report alone.
      if (res.url().includes("/api/")) {
        const postData = res.request().postData();
        if (postData) issue.text += ` :: req=${postData.slice(0, 1_500)}`;
        void res
          .text()
          .then((body) => {
            issue.text += ` :: res=${body.slice(0, 600)}`;
          })
          .catch(() => {});
      }
      sink.push(issue);
    });
  };
  context.pages().forEach(wire);
  context.on("page", wire);
}

export function filterIssues(issues: BrowserIssue[], allow: AllowRule[]): BrowserIssue[] {
  return issues.filter(
    (i) =>
      !allow.some(
        (r) =>
          r.pattern.test(`${i.text} ${i.url ?? ""} ${i.pageUrl}`) &&
          (!r.kinds || r.kinds.includes(i.kind)) &&
          (!r.statuses || (i.status !== undefined && r.statuses.includes(i.status))),
      ),
  );
}

export type GuardFixtures = {
  guardMode: GuardMode;
  guardAllow: AllowRule[];
  browserIssues: BrowserIssue[];
};

export const test = base.extend<GuardFixtures & { _guardCheck: void }>({
  guardMode: [(process.env.E2E_GUARD as GuardMode) ?? "report", { option: true }],
  guardAllow: [DEFAULT_ALLOWLIST, { option: true }],
  browserIssues: async ({}, use) => {
    await use([]);
  },
  // Guard the default context (covers the plain `page` fixture and popups).
  context: async ({ context, browserIssues, baseURL }, use) => {
    if (baseURL) attachGuard(context, browserIssues, baseURL);
    await use(context);
  },
  // Auto fixture: set up before / torn down after every test body, even in
  // specs that never reference it. The check runs in teardown.
  _guardCheck: [
    async ({ browserIssues, guardMode, guardAllow }, use, testInfo) => {
      await use();
      if (guardMode === "off") return;
      const bad = filterIssues(browserIssues, guardAllow);
      if (bad.length === 0) return;
      await testInfo.attach("browser-issues.json", {
        body: JSON.stringify(bad, null, 2),
        contentType: "application/json",
      });
      const summary = bad
        .slice(0, 10)
        .map((i) => `  [${i.kind}${i.status ? ` ${i.status}` : ""}] ${i.text.slice(0, 300)} @ ${i.pageUrl}`)
        .join("\n");
      if (guardMode === "strict" && testInfo.status === testInfo.expectedStatus) {
        throw new Error(
          `Browser issues detected (${bad.length})${bad.length > 10 ? ", first 10" : ""}:\n${summary}`,
        );
      }
      testInfo.annotations.push({
        type: "browser-issues",
        description: `${bad.length} issue(s): ${bad[0]?.kind} ${bad[0]?.text.slice(0, 120)}`,
      });
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
