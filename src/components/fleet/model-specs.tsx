import { SpecTable, type SpecRow } from "@/components/marketing/spec-table";

export interface ModelSpecsInput {
  engineCapacityCc: number | null;
  enginePowerKw: number | string | null;
  engineTorqueNm: number | string | null;
  dryWeightKg: number | string | null;
  fuelTankLitres: number | string | null;
  fuelType: string | null;
  topSpeedKmh: number | null;
  seatHeightMm: number | null;
  tyreFront: string | null;
  tyreRear: string | null;
  serviceIntervalKm: number | null;
  serviceIntervalMonths: number | null;
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function buildSpecRows(input: ModelSpecsInput): SpecRow[] {
  const rows: SpecRow[] = [];
  if (input.engineCapacityCc != null) rows.push({ label: "Engine", value: `${input.engineCapacityCc} cc` });
  const power = toNumber(input.enginePowerKw);
  if (power != null) rows.push({ label: "Power", value: `${power.toFixed(1)} kW` });
  const torque = toNumber(input.engineTorqueNm);
  if (torque != null) rows.push({ label: "Torque", value: `${torque.toFixed(1)} Nm` });
  const weight = toNumber(input.dryWeightKg);
  if (weight != null) rows.push({ label: "Dry weight", value: `${weight.toFixed(0)} kg` });
  if (input.seatHeightMm != null) rows.push({ label: "Seat height", value: `${input.seatHeightMm} mm` });
  const tank = toNumber(input.fuelTankLitres);
  if (tank != null) rows.push({ label: "Fuel tank", value: `${tank.toFixed(1)} L` });
  if (input.fuelType) rows.push({ label: "Fuel", value: input.fuelType });
  if (input.topSpeedKmh != null) rows.push({ label: "Top speed", value: `${input.topSpeedKmh} km/h` });
  if (input.tyreFront) rows.push({ label: "Front tyre", value: input.tyreFront });
  if (input.tyreRear) rows.push({ label: "Rear tyre", value: input.tyreRear });
  if (input.serviceIntervalKm != null)
    rows.push({ label: "Service interval", value: `${input.serviceIntervalKm.toLocaleString()} km` });
  if (input.serviceIntervalMonths != null && input.serviceIntervalKm == null)
    rows.push({ label: "Service interval", value: `${input.serviceIntervalMonths} months` });
  return rows;
}

export function ModelSpecs({ input }: { input: ModelSpecsInput }) {
  const rows = buildSpecRows(input);
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Full technical specs for this model are being verified — ask our team for details.
      </p>
    );
  }
  return <SpecTable rows={rows} />;
}
