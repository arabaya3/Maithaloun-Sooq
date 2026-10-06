import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AdminGlobalSearch } from "./admin-global-search";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const groups = [
  {
    key: "products",
    label: "المنتجات",
    hits: [
      {
        id: "general-cleaner",
        label: "منظف عام",
        detail: null,
        href: "/admin/products/general-cleaner",
      },
    ],
  },
  {
    key: "customers",
    label: "الزبائن",
    hits: [
      { id: "c1", label: "منى", detail: null, href: "/admin/customers/c1" },
    ],
  },
];

function respond(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window.localStorage.clear();
  push.mockReset();
  fetchMock = vi.fn(() => respond({ ok: true, groups }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("admin global search", () => {
  it("waits for typing to pause, sends one request and groups the results", async () => {
    const user = userEvent.setup();
    render(<AdminGlobalSearch />);
    await user.type(screen.getByRole("combobox"), "منظف");
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /منظف عام/ })).toBeVisible(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(
      `/admin/api/search?q=${encodeURIComponent("منظف")}`,
    );
    expect(screen.getByRole("group", { name: "المنتجات" })).toBeVisible();
    expect(screen.getByRole("group", { name: "الزبائن" })).toBeVisible();
  });

  it("cancels the request of an older query", async () => {
    const user = userEvent.setup();
    const signals: AbortSignal[] = [];
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      signals.push(init.signal!);
      return new Promise(() => {});
    });
    render(<AdminGlobalSearch />);
    const input = screen.getByRole("combobox");
    await user.type(input, "من");
    await waitFor(() => expect(signals).toHaveLength(1));
    await user.type(input, "ظف");
    await waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[0]!.aborted).toBe(true);
    expect(signals[1]!.aborted).toBe(false);
  });

  it("moves through results with the keyboard and opens the chosen one", async () => {
    const user = userEvent.setup();
    render(<AdminGlobalSearch />);
    const input = screen.getByRole("combobox");
    await user.type(input, "منظف");
    await screen.findByRole("option", { name: /منى/ });
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(screen.getByRole("option", { name: /منى/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(input).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: /منى/ }).id,
    );
    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/admin/customers/c1");
  });

  it("remembers a search on this device and offers it next time", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<AdminGlobalSearch />);
    await user.type(screen.getByRole("combobox"), "منظف");
    await user.click(await screen.findByRole("option", { name: /منظف عام/ }));
    unmount();
    render(<AdminGlobalSearch />);
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByRole("button", { name: "منظف" }));
    expect(screen.getByRole("combobox")).toHaveValue("منظف");
  });

  it("explains an empty result and a failure, and retries on request", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementationOnce(() => respond({ ok: true, groups: [] }));
    render(<AdminGlobalSearch />);
    const input = screen.getByRole("combobox");
    await user.type(input, "لاشيء");
    expect(await screen.findByText(/لا توجد نتائج لـ/)).toBeVisible();

    fetchMock.mockImplementationOnce(() =>
      respond({ ok: false, message: "تعذّر البحث الآن. حاولي مرة أخرى." }, 500),
    );
    await user.type(input, "ه");
    expect(
      await screen.findByText("تعذّر البحث الآن. حاولي مرة أخرى."),
    ).toBeVisible();
    await act(async () => {
      await user.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    });
    expect(
      await screen.findByRole("option", { name: /منظف عام/ }),
    ).toBeVisible();
  });

  it("asks for two letters before searching", async () => {
    const user = userEvent.setup();
    render(<AdminGlobalSearch />);
    await user.type(screen.getByRole("combobox"), "م");
    expect(screen.getByText(/اكتبي حرفين على الأقل/)).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
