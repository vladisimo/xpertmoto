export type LicenceClassToken = {
  /** Original code as printed, normalised to uppercase with collapsed whitespace. */
  code: string;
  /** Human-readable description, or `null` if the code is unknown. */
  label: string | null;
};

const LOOKUP: Record<string, string> = {
  C: "Car",
  "C LRN": "Car Learner",
  CL: "Car Learner",
  "C P1": "Car Provisional (P1)",
  "C P2": "Car Provisional (P2)",
  R: "Motorbike",
  RE: "Motorbike (restricted)",
  "R LRN": "Motorbike Learner",
  RL: "Motorbike Learner",
  "R DATE": "Motorbike (provisional)",
  RD: "Motorbike (provisional)",
  LR: "Light Rigid",
  MR: "Medium Rigid",
  HR: "Heavy Rigid",
  HC: "Heavy Combination",
  MC: "Multi-Combination",
};

function normalise(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/-/g, " ")
    .replace(/\s+/g, " ");
}

export function parseLicenceClasses(
  raw: string | null | undefined,
): LicenceClassToken[] {
  if (!raw) return [];
  return raw
    .split(/[,/]/)
    .map((part) => normalise(part))
    .filter((part) => part.length > 0)
    .map((code) => ({ code, label: LOOKUP[code] ?? null }));
}

export function formatLicenceClasses(raw: string | null | undefined): string {
  const tokens = parseLicenceClasses(raw);
  if (tokens.length === 0) return "";
  return tokens
    .map((t) => (t.label ? `${t.code} (${t.label})` : t.code))
    .join(", ");
}
