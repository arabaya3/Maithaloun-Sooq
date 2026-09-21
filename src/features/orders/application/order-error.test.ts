import { describe, expect, it } from "vitest";

import { mapOrderCreationError } from "./order-error";

describe("safe order error mapping", () => {
  it("returns useful domain messages without internal details", () => {
    expect(mapOrderCreationError("unknown_product")).toEqual({
      status: 409,
      message: "تحتوي السلة على منتج لم يعد متاحاً. حدّث السلة وحاول مجدداً.",
    });
    expect(mapOrderCreationError("database_error")).toEqual({
      status: 503,
      message: "تعذّر حفظ الطلب الآن. لم يتم إنشاء طلب جديد.",
    });
  });
});
