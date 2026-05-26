import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { TechStackGrid } from "@/components/marketing/tech-stack-grid";

afterEach(cleanup);

describe("TechStackGrid", () => {
  it("renders the heading and intro with the site name", () => {
    render(<TechStackGrid siteName="XPERT Moto" />);
    expect(screen.getByText("Built on a modern, typed stack")).toBeDefined();
    expect(screen.getByText(/XPERT Moto is built end to end in TypeScript/)).toBeDefined();
  });

  it("renders a sample of layer headings and versioned entries", () => {
    render(<TechStackGrid siteName="XPERT Moto" />);
    expect(screen.getByText("Framework & runtime")).toBeDefined();
    expect(screen.getByText("Database & ORM")).toBeDefined();
    expect(screen.getByText("Testing & QA")).toBeDefined();
    expect(screen.getByText("Next.js 16")).toBeDefined();
    expect(screen.getByText("Prisma 5")).toBeDefined();
  });
});
