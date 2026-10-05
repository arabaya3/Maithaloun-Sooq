import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  CART_STORAGE_KEY,
  PREVIOUS_CART_STORAGE_KEY,
} from "@/features/cart/cart-store";
import { CheckoutForm } from "@/features/orders/components/checkout-form";
import { renderWithProviders } from "@/test/render-with-providers";
import {
  MockProductRepository,
  fixtureUuid,
  multipackClothFixture,
} from "@/test/mock-product-repository";

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
    PREVIOUS_CART_STORAGE_KEY,
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
    const fetchMock = vi.fn().mockResolvedValue({
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
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = await renderCheckout();

    await user.click(screen.getByRole("button", { name: "تأكيد الطلب" }));
    // Only identifiers and counts are sent; the server prices and checks stock itself.
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.items).toEqual([
      {
        productId: "general-cleaner",
        variantId: "general-cleaner--default",
        sellingUnitId: fixtureUuid("general-cleaner--default:single"),
        unitsPerSale: 1,
        quantity: 1,
      },
    ]);
    expect(push).toHaveBeenCalledWith(
      "/orders/MS-abcdefghijklmnopqrstuvwx/confirmation",
    );
    expect(
      screen.getByText("السلة فارغة. أضف منتجات أولاً."),
    ).toBeInTheDocument();
  });

  it("blocks submission while a line's way of buying needs review", async () => {
    const products = [multipackClothFixture({ blueFreePieces: 10 })];
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({
        version: 3,
        lines: [
          {
            productId: "test-cloth",
            variantId: "test-cloth--blue",
            sellingUnitId: fixtureUuid("test-cloth--blue:pack3"),
            unitsPerSale: 2,
            quantity: 1,
          },
        ],
      }),
    );
    renderWithProviders(
      <CheckoutForm products={products} serviceAreas={serviceAreas} />,
      { products },
    );
    expect(
      await screen.findByText(
        "تغيّرت طريقة شراء أحد المنتجات. راجع السلة واختر طريقة شراء متاحة.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "تأكيد الطلب" })).toBeDisabled();
  });
});
