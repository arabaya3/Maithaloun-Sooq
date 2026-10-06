import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import AdminTodayError from "./error";

describe("today error state", () => {
  it("explains in Arabic, shows the support reference and retries", async () => {
    const reset = vi.fn();
    render(
      <AdminTodayError
        error={Object.assign(new Error("db down"), { digest: "a1b2c3" })}
        reset={reset}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "تعذّر تحميل مهام اليوم",
    );
    expect(screen.getByText("a1b2c3")).toBeVisible();
    expect(screen.queryByText("db down")).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "إعادة المحاولة" }),
    );
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
