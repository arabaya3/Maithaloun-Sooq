import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  CART_STORAGE_KEY,
  PREVIOUS_CART_STORAGE_KEY,
} from "@/features/cart/cart-store";
import { CheckoutForm } from "@/features/orders/components/checkout-form";
import { I18nProvider } from "@/i18n/i18n-provider";
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

async function renderCheckout(channel: "web" | "whatsapp" = "web") {
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
    <CheckoutForm
      products={products}
      serviceAreas={serviceAreas}
      channel={channel}
    />,
    { products },
  );
  const user = userEvent.setup();
  await user.type(
    await screen.findByRole("textbox", { name: "الاسم" }),
    "عميل تجريبي",
  );
  await user.type(
    screen.getByRole("textbox", { name: "الرقم المحلي" }),
    "0591234567",
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
    await user.click(
      screen.getByRole("button", { name: "إرسال الطلب عبر الموقع" }),
    );
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

    await user.click(
      screen.getByRole("button", { name: "إرسال الطلب عبر الموقع" }),
    );
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

  it("sends one order when the form is submitted twice in the same tick", async () => {
    let resolve: (value: unknown) => void = () => {};
    const fetchMock = vi.fn(() => new Promise((settle) => (resolve = settle)));
    vi.stubGlobal("fetch", fetchMock);
    await renderCheckout();
    const form = screen
      .getByRole("button", { name: "إرسال الطلب عبر الموقع" })
      .closest("form")!;

    form.requestSubmit();
    form.requestSubmit();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve({ json: async () => ({ ok: false, message: "x" }) });
    expect(await screen.findByRole("alert")).toHaveTextContent("x");
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
    expect(
      screen.getByRole("button", { name: "إرسال الطلب عبر الموقع" }),
    ).toBeDisabled();
  });
});

describe("checkout channels", () => {
  const success = () =>
    vi.fn().mockResolvedValue({
      json: async () => ({
        ok: true,
        confirmation: {
          publicReference: "MS-abcdefghijklmnopqrstuvwx",
          status: "awaiting_whatsapp",
          itemsSubtotalAgorot: 700,
          deliveryFeeAgorot: 500,
          finalTotalAgorot: 1200,
          paymentMethod: "cash_on_delivery",
          duplicate: false,
        },
      }),
    });

  it("asks only for a name and a WhatsApp number", async () => {
    vi.stubGlobal("fetch", success());
    await renderCheckout();
    expect(screen.queryByText(/العنوان/)).not.toBeInTheDocument();
    expect(screen.queryByText(/أقرب معلم/)).not.toBeInTheDocument();
    expect(screen.queryByText(/ملاحظات الطلب/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "مفتاح الدولة" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "بعد استلام الطلب سنتواصل معك عبر واتساب لتأكيد الطلب ومكان التوصيل داخل ميثلون.",
      ),
    ).toBeInTheDocument();
  });

  it("sends a WhatsApp order once, without an address, and hands off on the confirmation page", async () => {
    push.mockClear();
    const fetchMock = success();
    vi.stubGlobal("fetch", fetchMock);
    const user = await renderCheckout("whatsapp");
    expect(
      screen.queryByRole("button", { name: "إرسال الطلب عبر الموقع" }),
    ).not.toBeInTheDocument();
    const button = screen.getByRole("button", {
      name: "إرسال الطلب عبر واتساب",
    });
    await user.dblClick(button);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.checkoutChannel).toBe("whatsapp");
    expect(body).not.toHaveProperty("deliveryAddress");
    expect(body).not.toHaveProperty("landmark");
    expect(push).toHaveBeenCalledWith(
      "/orders/MS-abcdefghijklmnopqrstuvwx/confirmation?handoff=1",
    );
  });

  it("keeps the entered values and focuses the error summary on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        json: async () => ({
          ok: false,
          message: "رقم الواتساب غير صحيح.",
          fieldErrors: { whatsappNationalNumber: ["رقم الواتساب غير صحيح."] },
        }),
      }),
    );
    const user = await renderCheckout();
    await user.click(
      screen.getByRole("button", { name: "إرسال الطلب عبر الموقع" }),
    );
    const alert = await screen.findByRole("alert");
    await vi.waitFor(() => expect(alert).toHaveFocus());
    const phone = screen.getByRole("textbox", { name: "الرقم المحلي" });
    expect(phone).toHaveValue("0591234567");
    expect(phone).toHaveAttribute("aria-invalid", "true");
    expect(phone.getAttribute("aria-describedby")).toContain("whatsapp-error");
  });
});

describe("checkout form in English", () => {
  async function renderEnglishCheckout() {
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
      <I18nProvider locale="en">
        <CheckoutForm products={products} serviceAreas={serviceAreas} />
      </I18nProvider>,
      { products },
    );
    const user = userEvent.setup();
    await user.type(
      await screen.findByRole("textbox", { name: "Full name" }),
      "Test Customer",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Local number" }),
      "0591234567",
    );
    return user;
  }

  it("labels the form, summary and button in English", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await renderEnglishCheckout();

    expect(
      screen.getByRole("heading", { name: "Your details" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Country code" }),
    ).toBeVisible();
    expect(
      screen.getByRole("option", { name: "Palestine +970" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Payment method")).toBeInTheDocument();
    expect(screen.getByText("Subtotal")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Delivery is currently available within Maythaloun only",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Place order" })).toBeEnabled();
  });

  it("sends the locale header, shows English field errors and keeps the cart", async () => {
    push.mockClear();
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        ok: false,
        message: "Please check the highlighted fields.",
        fieldErrors: {
          whatsappNationalNumber: ["Invalid WhatsApp number."],
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = await renderEnglishCheckout();
    await user.click(screen.getByRole("button", { name: "Place order" }));

    expect(fetchMock.mock.calls[0]![1].headers).toMatchObject({
      "x-maytha-locale": "en",
    });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your order couldn’t be sent");
    expect(alert).toHaveTextContent("Please check the highlighted fields.");
    expect(screen.getByText("Invalid WhatsApp number.")).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByText("منظف عام Secret")).toBeInTheDocument();
  });

  it("goes to the English confirmation page after success", async () => {
    push.mockClear();
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
    const user = await renderEnglishCheckout();
    await user.click(screen.getByRole("button", { name: "Place order" }));
    expect(push).toHaveBeenCalledWith(
      "/en/orders/MS-abcdefghijklmnopqrstuvwx/confirmation",
    );
  });
});
