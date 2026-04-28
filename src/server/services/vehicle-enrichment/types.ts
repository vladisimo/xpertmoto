import type { SpecConfidence, VehicleModelDocumentType } from "@prisma/client";

/** Parsed spec fields. All optional — a recipe returns only what it found. */
export type SpecFields = {
  engineCapacityCc?: number;
  enginePowerKw?: number;
  engineTorqueNm?: number;
  dryWeightKg?: number;
  fuelTankLitres?: number;
  fuelType?: string;
  topSpeedKmh?: number;
  seatHeightMm?: number;
  tyreFront?: string;
  tyreRear?: string;
  serviceIntervalKm?: number;
  serviceIntervalMonths?: number;
};

export type SpecResult = {
  fields: SpecFields;
  sourceUrl: string;
  sourceName: string;
  confidence: SpecConfidence;
};

export type DocumentCandidate = {
  type: VehicleModelDocumentType;
  title: string;
  sourceUrl: string;
  language?: string;
};

export type VehicleModelSeed = {
  make: string;
  model: string;
  year: number;
};

export type SourceRecipe = {
  /** Human-readable name for provenance ("Honda Australia"). */
  name: string;
  /** Fetch and parse spec fields. Returns null if the source is unreachable. */
  fetchSpecs(input: VehicleModelSeed): Promise<SpecResult | null>;
  /** Enumerate candidate documents. Each URL still has to pass the allowlist. */
  listDocuments(input: VehicleModelSeed): Promise<DocumentCandidate[]>;
};
