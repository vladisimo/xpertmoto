import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BodyEditor, type BodyEditorProps } from "@/components/communications/body-editor";

afterEach(cleanup);

function renderEditor(overrides: Partial<BodyEditorProps> = {}) {
  const onFormatChange = vi.fn();
  render(
    <BodyEditor
      format="PLAIN_TEXT"
      onFormatChange={onFormatChange}
      body="Hi {{firstName}}"
      onBodyChange={vi.fn()}
      {...overrides}
    />,
  );
  return { onFormatChange };
}

describe("BodyEditor format switch", () => {
  it("is a labelled toggle group, not a tab interface", () => {
    renderEditor();

    // PLAIN_TEXT hides the Visual/Source tabs, so nothing on screen is a real
    // tab — and the format switch must not pretend to be one either.
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(document.querySelectorAll("[aria-controls]")).toHaveLength(0);

    const group = screen.getByRole("group", { name: "Body format" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent?.trim())).toEqual([
      "Plain text",
      "HTML",
    ]);
  });

  it("marks the current format as pressed", () => {
    renderEditor({ format: "HTML" });

    const group = screen.getByRole("group", { name: "Body format" });
    const pressed = within(group)
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-pressed") === "true");
    expect(pressed).toHaveLength(1);
    expect(pressed[0]!.textContent?.trim()).toBe("HTML");
  });

  it("reports the picked format to the parent", () => {
    const { onFormatChange } = renderEditor();

    const group = screen.getByRole("group", { name: "Body format" });
    fireEvent.click(within(group).getByRole("button", { name: "HTML" }));

    expect(onFormatChange).toHaveBeenCalledWith("HTML");
  });

  it("is hidden when the parent owns the format", () => {
    renderEditor({ allowHtml: false });
    expect(screen.queryByRole("group", { name: "Body format" })).toBeNull();
  });
});
