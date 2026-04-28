/**
 * Engagement helpers — pure, test-friendly functions shared by the
 * client-side detectors (rage-click tracking, scroll-depth bucketing)
 * and the server-side finalise pass that computes `engagementScore` +
 * `maxScrollDepth` columns on `VisitorSession`.
 */

/** Scroll-depth breakpoints reported as SCROLL_DEPTH events. */
export const SCROLL_DEPTH_BREAKPOINTS: readonly number[] = [25, 50, 75, 100];

/** Rage click thresholds. */
export const RAGE_CLICK_WINDOW_MS = 1_000;
export const RAGE_CLICK_MIN_CLICKS = 3;
export const RAGE_CLICK_COOLDOWN_MS = 3_000;

/** Dead-click observation window. */
export const DEAD_CLICK_OBSERVATION_MS = 500;

/**
 * Compute the current viewport scroll percentage. Returns 0 on
 * degenerate geometry (total document height smaller than viewport).
 * Clamped to 0..100.
 */
export function currentScrollPercentage(doc: {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}): number {
  const scrollable = Math.max(0, doc.scrollHeight - doc.clientHeight);
  if (scrollable <= 0) return 0;
  const pct = Math.round(((doc.scrollTop + doc.clientHeight) / doc.scrollHeight) * 100);
  return Math.min(100, Math.max(0, pct));
}

/**
 * Given a current scroll percentage and the set of breakpoints already
 * reported on this page, return the next breakpoint to emit (or null).
 * Breakpoints emit once per page load — the caller tracks reached
 * state and passes it in so this function stays pure.
 */
export function nextScrollBreakpoint(
  percentage: number,
  alreadyReported: ReadonlySet<number>,
): number | null {
  for (const bp of SCROLL_DEPTH_BREAKPOINTS) {
    if (percentage >= bp && !alreadyReported.has(bp)) return bp;
  }
  return null;
}

/**
 * Rage-click detector. Call `isRageClick` each time a click fires on
 * a given target; it returns true when the last N clicks on that
 * target arrived within RAGE_CLICK_WINDOW_MS. Caller is responsible
 * for state — this function is pure.
 */
export function isRageClick(clickTimestampsMs: readonly number[]): boolean {
  if (clickTimestampsMs.length < RAGE_CLICK_MIN_CLICKS) return false;
  const recent = clickTimestampsMs.slice(-RAGE_CLICK_MIN_CLICKS);
  const span = recent[recent.length - 1]! - recent[0]!;
  return span <= RAGE_CLICK_WINDOW_MS;
}

/**
 * Heuristic "is this element a meaningful click target?" — used by
 * the dead-click detector. Anything in the tag allowlist, or anything
 * with an `onclick` / `role="button"` / explicit `tabindex` is
 * considered interactive. Form controls always count.
 */
export function isInteractiveElement(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (["a", "button", "input", "select", "textarea", "label", "summary"].includes(tag)) return true;
  if (el instanceof HTMLElement && typeof el.onclick === "function") return true;
  const role = el.getAttribute("role");
  if (role && ["button", "link", "menuitem", "checkbox", "tab", "switch"].includes(role)) return true;
  const tabindex = el.getAttribute("tabindex");
  if (tabindex != null && Number(tabindex) >= 0) return true;
  return false;
}

/**
 * Engagement-score heuristic. Returns 0..100 reflecting a rough
 * "how engaged was this visitor" signal, composed from duration,
 * breadth (page views), depth (scroll depth), wizard progress, and
 * event volume (clicks + interactions). Tuned so a typical bounced
 * visitor scores <10, a browsing visitor ~30–50, an engaged
 * wizard-abandoner ~60–80, and a converter ~85+.
 */
export function scoreEngagement(input: {
  durationSeconds: number;
  totalPageViews: number;
  eventCount: number;
  maxScrollDepth: number | null;
  wizardHighestStep: number | null;
  converted: boolean;
}): number {
  if (input.converted) return 100;
  const duration = Math.min(25, Math.round(input.durationSeconds / 12));       // 0–25 (≈5m maxes)
  const pages = Math.min(15, input.totalPageViews * 3);                         // 0–15
  const depth = Math.min(20, Math.round((input.maxScrollDepth ?? 0) / 5));      // 0–20
  const wizard = Math.min(25, (input.wizardHighestStep ?? 0) * 5);              // 0–25 (6 steps × 5 capped at 25 = step 5+)
  const events = Math.min(15, input.eventCount);                                // 0–15
  const raw = duration + pages + depth + wizard + events;
  return Math.max(0, Math.min(100, raw));
}
