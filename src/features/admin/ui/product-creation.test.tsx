import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProductDangerZone } from "./product-danger-zone";
import {
  ClearProductDraft,
  MANUAL_DRAFT_KEY,
  ProductDraft,
} from "./product-draft";
import { ProductReadiness } from "./product-readiness";

vi.mock("@/features/admin/application/catalog-management-actions", () => ({
  archiveProductAction: vi.fn(async () => null),
  deleteProductAction: vi.fn(async () => null),
}));

beforeEach(() => {
  window.localStorage.clear();
});

describe("product readiness", () => {
  it("groups the server's publish problems by step and counts what is done", () => {
    render(
      <ProductReadiness
        publication="draft"
        hasOptions
        check={{
          ready: false,
          acceptedPlaceholder: true,
          problems: ["«أزرق»: أضيفي طريقة بيع واحدة على الأقل."],
          issues: [
            {
              step: "selling_units",
              message: "«أزرق»: أضيفي طريقة بيع واحدة على الأقل.",
            },
          ],
        }}
      />,
    );
    const region = screen.getByRole("region", { name: "جاهزية المنتج" });
    expect(region).toHaveTextContent("3 من 5 مكتملة");
    const units = within(region).getByRole("link", {
      name: "طرق البيع",
    }).parentElement!;
    expect(units).toHaveTextContent("يحتاج إكمال");
    expect(units).toHaveTextContent("أضيفي طريقة بيع واحدة على الأقل");
    expect(within(region).getByText(/صورة مؤقتة/)).toBeVisible();
    expect(
      within(region).getByRole("link", { name: "المراجعة والنشر" })
        .parentElement,
    ).toHaveTextContent("يُفتح النشر بعد إكمال النقاط في الأعلى");
  });

  it("says ready to publish once the server check passes", () => {
    render(
      <ProductReadiness
        publication="draft"
        hasOptions={false}
        check={{
          ready: true,
          acceptedPlaceholder: false,
          problems: [],
          issues: [],
        }}
      />,
    );
    expect(screen.getByText("5 من 5 مكتملة")).toBeVisible();
    expect(screen.getByText("جاهز للنشر")).toBeVisible();
  });
});

describe("manual product draft", () => {
  // Like the real name field: a controlled input that ignores plain value assignment.
  function Controlled() {
    const [value, setValue] = useState("");
    return (
      <label>
        الوصف
        <input
          name="description"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </label>
    );
  }

  function Form() {
    return (
      <ProductDraft>
        <form>
          <label>
            الاسم
            <input name="nameAr" />
          </label>
          <label>
            السعر
            <input name="priceIls" />
          </label>
          <Controlled />
          <input type="hidden" name="domainId" value="secret" />
        </form>
      </ProductDraft>
    );
  }

  it("saves typing on this device and offers it back after a reload", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Form />);
    await user.type(screen.getByLabelText("الاسم"), "منظف تجربة");
    await user.type(screen.getByLabelText("الوصف"), "للأرضيات");
    await screen.findByText(/حُفظت المسودة على هذا الجهاز/);
    const stored = JSON.parse(window.localStorage.getItem(MANUAL_DRAFT_KEY)!);
    expect(stored.fields).toEqual({
      nameAr: "منظف تجربة",
      priceIls: "",
      description: "للأرضيات",
    });
    unmount();

    render(<Form />);
    expect(screen.getByText(/لديك مسودة محفوظة/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "استعادة المسودة" }));
    expect(screen.getByLabelText("الاسم")).toHaveValue("منظف تجربة");
    expect(screen.getByLabelText("الوصف")).toHaveValue("للأرضيات");
    expect(screen.queryByText(/لديك مسودة محفوظة/)).toBeNull();
  });

  it("discards on request, and the new product's page clears a finished draft", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(
      MANUAL_DRAFT_KEY,
      JSON.stringify({
        savedAt: new Date().toISOString(),
        fields: { nameAr: "قديم" },
      }),
    );
    const { unmount } = render(<Form />);
    await user.click(screen.getByRole("button", { name: "تجاهلها" }));
    expect(window.localStorage.getItem(MANUAL_DRAFT_KEY)).toBeNull();
    unmount();

    window.localStorage.setItem(
      MANUAL_DRAFT_KEY,
      JSON.stringify({
        savedAt: new Date().toISOString(),
        fields: { nameAr: "تم" },
      }),
    );
    render(<ClearProductDraft />);
    expect(window.localStorage.getItem(MANUAL_DRAFT_KEY)).toBeNull();
  });
});

describe("product danger zone", () => {
  it("blocks permanent delete for a product with history and names what holds it", () => {
    render(
      <ProductDangerZone
        domainId="general-cleaner"
        name="منظف عام"
        archived={false}
        references={{ orders: 3, purchases: 1, sales: 0, stockMovements: 4 }}
      />,
    );
    expect(screen.getByText("طلبات: 3")).toBeVisible();
    expect(screen.getByText("حركات مخزون: 4")).toBeVisible();
    expect(screen.queryByText("فواتير بيع: 0")).toBeNull();
    expect(screen.queryByRole("button", { name: /حذف نهائي/ })).toBeNull();
    expect(screen.getByRole("button", { name: /أرشفة المنتج/ })).toBeVisible();
  });

  it("enables permanent delete only when the exact product name is typed", async () => {
    const user = userEvent.setup();
    render(
      <ProductDangerZone
        domainId="unused"
        name="منتج للحذف"
        archived={false}
        references={{ orders: 0, purchases: 0, sales: 0, stockMovements: 0 }}
      />,
    );
    const button = screen.getByRole("button", { name: /حذف نهائي/ });
    expect(button).toBeDisabled();
    const confirm = screen.getByLabelText(/للتأكيد اكتبي اسم المنتج/);
    await user.type(confirm, "منتج");
    expect(button).toBeDisabled();
    await user.type(confirm, " للحذف");
    expect(button).toBeEnabled();
  });
});
