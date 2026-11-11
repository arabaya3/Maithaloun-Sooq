import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceNav } from "./workspace-nav";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", window.location.pathname);
});

describe("links to collapsed workspace sections", () => {
  function view() {
    return render(
      <>
        <WorkspaceNav
          label="أقسام الملف"
          sections={[{ id: "profile", label: "البيانات" }]}
        />
        <details id="profile">
          <summary>بيانات الزبون</summary>
          <p>تفاصيل الملف</p>
        </details>
      </>,
    );
  }
  it("reveals a section when its navigation link is clicked", async () => {
    view();
    await userEvent
      .setup()
      .click(screen.getByRole("link", { name: "البيانات" }));
    expect(document.querySelector("details")?.open).toBe(true);
  });
  it("reveals the section targeted by a direct bookmark", () => {
    window.history.replaceState(null, "", "#profile");
    view();
    expect(document.querySelector("details")?.open).toBe(true);
  });
});
