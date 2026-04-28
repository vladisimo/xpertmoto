export type DepreciationInput = {
  purchasePrice: number;
  purchaseDate: Date;
  method: "STRAIGHT_LINE" | "DIMINISHING_VALUE";
  rate: number; // percent per year, e.g. 15
  asOf?: Date;
};

export type DepreciationResult = {
  ageYears: number;
  depreciation: number;
  bookValue: number;
};

export function calcDepreciation(input: DepreciationInput): DepreciationResult {
  const asOf = input.asOf ?? new Date();
  const ageMs = Math.max(0, asOf.getTime() - input.purchaseDate.getTime());
  const ageYears = ageMs / (365.25 * 86400000);
  const r = input.rate / 100;

  if (input.method === "STRAIGHT_LINE") {
    const dep = Math.min(input.purchasePrice, input.purchasePrice * r * ageYears);
    return {
      ageYears: round2(ageYears),
      depreciation: round2(dep),
      bookValue: round2(Math.max(0, input.purchasePrice - dep)),
    };
  }
  // Diminishing value
  const bv = input.purchasePrice * Math.pow(1 - r, ageYears);
  return {
    ageYears: round2(ageYears),
    depreciation: round2(input.purchasePrice - bv),
    bookValue: round2(bv),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
