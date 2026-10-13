import { beforeEach, describe, expect, it, vi } from "vitest";

import { OrderCreationError } from "@/features/orders/application/order-service";

const { create, check } = vi.hoisted(() => ({
  create: vi.fn(),
  check: vi.fn(),
}));

vi.mock("@/features/orders/application/order-service-instance", () => ({
  orderService: { create },
}));
vi.mock(
  "@/features/orders/infrastructure/postgres-order-submission-guard",
  () => ({ createPostgresOrderSubmissionGuard: () => ({ check }) }),
);
vi.mock("@/server/db/db", () => ({ db: {} }));
vi.mock("@/server/env/env", () => ({
  getServerEnv: () => ({ ORDER_RATE_LIMIT_PEPPER: "test-pepper" }),
}));
vi.mock("@/features/admin/application/admin-services", () => ({
  adminNotificationService: { dispatchOrderNotification: vi.fn() },
}));
vi.mock("@/features/accounts/application/customer-session", () => ({
  getCustomerSession: async () => null,
}));

const { POST } = await import("./route");

const validBody = {
  idempotencyKey: "4f0c5c8e-3b1a-4c55-9a43-5a2c1d6f7e81",
  checkoutChannel: "web",
  customerName: "عميل تجريبي",
  whatsappCountryCode: "970",
  whatsappNationalNumber: "0591234567",
  serviceAreaCode: "maythalun",
  paymentMethod: "cash_on_delivery",
  honeypot: "",
  items: [
    {
      productId: "general-cleaner",
      variantId: "general-cleaner--default",
      quantity: 1,
    },
  ],
};

function post(body: unknown, locale?: string) {
  return POST(
    new Request("http://localhost/api/orders", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(locale ? { "x-maytha-locale": locale } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/orders language", () => {
  beforeEach(() => {
    create.mockReset();
    check.mockReset().mockResolvedValue({ allowed: true });
  });

  it("returns English validation messages when the form asks for English", async () => {
    const response = await post(
      { ...validBody, customerName: "", whatsappNationalNumber: "12" },
      "en",
    );
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.message).toBe("Please check the highlighted fields.");
    expect(json.fieldErrors.customerName[0]).toBe("Enter your full name.");
    expect(json.fieldErrors.whatsappNationalNumber).toEqual([
      "Enter a valid WhatsApp number.",
    ]);
    expect(create).not.toHaveBeenCalled();
  });

  it("keeps Arabic without the header or with an unknown language", async () => {
    for (const locale of [undefined, "fr"]) {
      const response = await post({ ...validBody, customerName: "" }, locale);
      const json = await response.json();
      expect(json.message).toBe("يرجى مراجعة الحقول المطلوبة.");
      expect(json.fieldErrors.customerName[0]).toBe("أدخل الاسم الكامل.");
    }
  });

  it("returns an English order error for a stock conflict", async () => {
    create.mockRejectedValue(new OrderCreationError("insufficient_stock"));
    const response = await post(validBody, "en");
    expect(response.status).toBe(409);
    expect((await response.json()).message).toBe(
      "The quantity requested for one of the products is more than we have in stock. Reduce it and try again.",
    );
  });

  it("returns an English rate-limit message and creates nothing", async () => {
    check.mockResolvedValue({ allowed: false, reason: "rate_limited" });
    const response = await post(validBody, "en");
    expect(response.status).toBe(429);
    expect((await response.json()).message).toBe(
      "Your order couldn’t be sent right now. Please try again later.",
    );
    expect(create).not.toHaveBeenCalled();
  });
});
