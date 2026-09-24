import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CART_STORAGE_KEY } from "@/features/cart/cart-store";
import { CheckoutForm } from "@/features/orders/components/checkout-form";
import { renderWithProviders } from "@/test/render-with-providers";
import { MockProductRepository } from "@/test/mock-product-repository";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

const serviceAreas = [
  {
    code: "maythalun",
    nameAr: "ميثلون",
    enabled: true,
    sortOrder: 1,
    deliveryFeeAgorot: null,
  },
];

async function renderCheckout() {
  const products = await new MockProductRepository().list();
  window.localStorage.setItem(
    CART_STORAGE_KEY,
    JSON.stringify({
      version: 2,
      lines: [
        {
          productId: "general-cleaner",
          variantId: "general-cleaner--default",
          quantity: 1,
        },
      ],
    }),
  );
  renderWithProviders(
    <CheckoutForm products={products} serviceAreas={serviceAreas} />,
    { products },
  );
  const user = userEvent.setup();
  await user.type(
    await screen.findByRole("textbox", { name: "الاسم الكامل" }),
    "عميل تجريبي",
  );
  await user.type(
    screen.getByRole("textbox", { name: "الرقم المحلي" }),
    "0591234567",
  );
  await user.type(
    screen.getByRole("textbox", {
      name: "العنوان بالتفصيل أو أقرب نقطة دالة",
    }),
    "عنوان محلي مفصل للاختبار",
  );
  return user;
}

describe("checkout form", () => {
  it("preserves the cart when submission fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({
          ok: false,
          message: "تعذّر حفظ الطلب الآن.",
        }),
      }),
    );
    const user = await renderCheckout();

    expect(
      screen.getByText("التوصيل متاح حالياً داخل ميثلون فقط"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "تأكيد الطلب" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "تعذّر حفظ الطلب الآن.",
    );
    expect(screen.getByText("منظف عام Secret")).toBeInTheDocument();
    expect(screen.getByDisplayValue("عميل تجريبي")).toBeInTheDocument();
  });

  it("clears the cart only after a confirmed success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({
          ok: true,
          confirmation: {
            publicReference: "MS-abcdefghijklmnopqrstuvwx",
            status: "pending",
            itemsSubtotalAgorot: 700,
            deliveryFeeAgorot: null,
            finalTotalAgorot: null,
            paymentMethod: "cash_on_delivery",
            duplicate: false,
          },
        }),
      }),
    );
    const user = await renderCheckout();

    await user.click(screen.getByRole("button", { name: "تأكيد الطلب" }));
    expect(push).toHaveBeenCalledWith(
      "/orders/MS-abcdefghijklmnopqrstuvwx/confirmation",
    );
    expect(
      screen.getByText("السلة فارغة. أضف منتجات أولاً."),
    ).toBeInTheDocument();
  });
});
