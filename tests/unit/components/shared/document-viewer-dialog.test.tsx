import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import {
  DocumentViewerButton,
  DocumentViewerDialog,
  guessKind,
} from "@/components/shared/document-viewer-dialog";

/**
 * The dialog renders into a Radix portal on document.body, so we query
 * the whole document rather than the render container. We avoid jest-dom
 * matchers (not wired into the shared setup) and assert against the DOM
 * directly.
 */
afterEach(cleanup);

const PDF_URL = "https://files.example.com/agreement.pdf";
const IMG_URL = "https://files.example.com/licence.png";
const ROUTE_URL = "/api/bookings/abc/rental-agreement?version=2";

describe("guessKind", () => {
  it("sniffs pdf, image, and other off the extension, ignoring query/hash", () => {
    expect(guessKind(PDF_URL)).toBe("pdf");
    expect(guessKind(`${PDF_URL}#view=FitH`)).toBe("pdf");
    expect(guessKind(`${PDF_URL}?X-Amz-Signature=xyz`)).toBe("pdf");
    expect(guessKind(IMG_URL)).toBe("image");
    expect(guessKind(ROUTE_URL)).toBe("other");
  });
});

describe("DocumentViewerDialog", () => {
  it("embeds an iframe for a PDF and exposes new-tab + download links to the file", () => {
    render(
      <DocumentViewerDialog open onOpenChange={() => {}} fileUrl={PDF_URL} title="Agreement A-1" />,
    );

    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toBe(PDF_URL);

    const newTab = screen.getByRole("link", { name: /new tab/i });
    const download = screen.getByRole("link", { name: /download/i });
    expect(newTab.getAttribute("href")).toBe(PDF_URL);
    expect(newTab.getAttribute("target")).toBe("_blank");
    expect(download.getAttribute("href")).toBe(PDF_URL);
    expect(download.hasAttribute("download")).toBe(true);
  });

  it("renders an <img> for an image url", () => {
    render(
      <DocumentViewerDialog open onOpenChange={() => {}} fileUrl={IMG_URL} title="Licence" />,
    );
    expect(document.querySelector("iframe")).toBeNull();
    const img = document.querySelector("img");
    expect(img?.getAttribute("src")).toBe(IMG_URL);
  });

  it("falls back to a download prompt for an unsniffable url", () => {
    render(
      <DocumentViewerDialog open onOpenChange={() => {}} fileUrl={ROUTE_URL} title="Doc" />,
    );
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByText(/can.t be previewed/i)).toBeTruthy();
  });

  it("honours the kind override so extensionless API routes still embed as PDF", () => {
    render(
      <DocumentViewerDialog
        open
        onOpenChange={() => {}}
        fileUrl={ROUTE_URL}
        title="Rental agreement"
        kind="pdf"
      />,
    );
    expect(document.querySelector("iframe")?.getAttribute("src")).toBe(ROUTE_URL);
  });
});

describe("DocumentViewerButton", () => {
  it("opens the dialog with the embedded PDF only after the button is clicked", async () => {
    const user = userEvent.setup();
    render(
      <DocumentViewerButton fileUrl={PDF_URL} title="Agreement A-1" kind="pdf">
        View PDF
      </DocumentViewerButton>,
    );

    // Closed initially — no iframe in the document.
    expect(document.querySelector("iframe")).toBeNull();

    await user.click(screen.getByRole("button", { name: /view pdf/i }));

    expect(document.querySelector("iframe")?.getAttribute("src")).toBe(PDF_URL);
  });
});
