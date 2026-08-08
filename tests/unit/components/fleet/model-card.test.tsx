import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ModelCard, type ModelCardProps } from "@/components/fleet/model-card";

afterEach(cleanup);

const BASE: ModelCardProps = {
  slug: "honda-cb500x",
  make: "Honda",
  model: "CB500X",
  year: 2024,
  tagline: "Lightweight adventure tourer",
  imageSrc: "/uploads/cb500x.png",
  licenceBadge: "A2",
  lamsApproved: true,
  dailyRate: 89,
  availableCount: 5,
  specs: { engineCapacityCc: 471, dryWeightKg: 199.5, seatHeightMm: 830 },
  bookHref: "/booking?categoryId=cat-1",
};

function renderCard(overrides: Partial<ModelCardProps> = {}) {
  return render(<ModelCard {...BASE} {...overrides} />);
}

describe("ModelCard availability pill", () => {
  it("shows the count when several are available", () => {
    renderCard({ availableCount: 5 });
    expect(screen.getByText("5 available")).toBeDefined();
  });

  it("shows a scarcity message for 1–2 left", () => {
    renderCard({ availableCount: 1 });
    expect(screen.getByText("Only 1 left")).toBeDefined();
  });

  it("shows no pill when none are available", () => {
    renderCard({ availableCount: 0 });
    expect(screen.queryByText("Join waitlist")).toBeNull();
    expect(screen.queryByText(/available$/)).toBeNull();
    expect(screen.queryByText(/left$/)).toBeNull();
  });
});

describe("ModelCard content", () => {
  it("renders the tagline", () => {
    renderCard();
    expect(screen.getByText("Lightweight adventure tourer")).toBeDefined();
  });

  it("surfaces the at-a-glance specs when provided", () => {
    renderCard();
    expect(screen.getByText("471cc")).toBeDefined();
    expect(screen.getByText("200kg")).toBeDefined(); // 199.5 rounds to 200
    expect(screen.getByText("830mm")).toBeDefined();
  });

  it("omits the specs row entirely when no specs are passed (home preview)", () => {
    renderCard({ specs: null });
    expect(screen.queryByText("471cc")).toBeNull();
    expect(screen.queryByText(/cc$/)).toBeNull();
  });

  it("hides spec items that have no value", () => {
    renderCard({ specs: { engineCapacityCc: 471, dryWeightKg: null, seatHeightMm: null } });
    expect(screen.getByText("471cc")).toBeDefined();
    expect(screen.queryByText(/kg$/)).toBeNull();
    expect(screen.queryByText(/mm$/)).toBeNull();
  });

  it("hides the engine chip when the model has no capacity of its own", () => {
    // frontend-test-findings #8: the category's coarse figure is never
    // substituted — the chip just drops out of the glance row.
    renderCard({ specs: { engineCapacityCc: null, dryWeightKg: 199.5, seatHeightMm: 830 } });
    expect(screen.queryByText(/cc$/)).toBeNull();
    expect(screen.getByText("200kg")).toBeDefined();
    expect(screen.getByText("830mm")).toBeDefined();
  });

  it("links the Book now CTA to the booking href", () => {
    renderCard();
    const cta = screen.getByRole("link", { name: /book now/i });
    expect(cta.getAttribute("href")).toBe("/booking?categoryId=cat-1");
  });

  it("renders the same details in the overlay layout", () => {
    renderCard({ layout: "overlay", availableCount: 1 });
    expect(screen.getByText("CB500X")).toBeDefined();
    expect(screen.getByText("Lightweight adventure tourer")).toBeDefined();
    expect(screen.getByText("471cc")).toBeDefined();
    expect(screen.getByText("Only 1 left")).toBeDefined();
    expect(
      screen.getByRole("link", { name: /book now/i }).getAttribute("href"),
    ).toBe("/booking?categoryId=cat-1");
  });

  it("falls back gracefully when there is no image", () => {
    renderCard({ imageSrc: null });
    expect(screen.getByText("Photo coming soon")).toBeDefined();
    // model name still rendered in the footer
    const detailLinks = screen.getAllByRole("link", { name: /CB500X/i });
    expect(detailLinks.length).toBeGreaterThan(0);
  });
});
