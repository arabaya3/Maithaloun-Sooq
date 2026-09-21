import { beforeEach, describe, expect, it, vi } from "vitest";

import { AdminCatalogError } from "@/features/admin/application/admin-catalog-service";
import { AdminDeliveryError } from "@/features/admin/application/admin-delivery-service";
import { AdminOrderError } from "@/features/admin/application/admin-order-service";
import {
  mapDeliveryAdminError,
  mapOrderAdminError,
  mapProductAdminError,
} from "@/features/admin/application/admin-action-errors";
import type { AdminActor } from "@/features/admin/domain/admin-actor";

const redirectMock = vi.fn((url: string): never => {
  throw Object.assign(new Error(`NEXT_REDIRECT:${url}`), {
    digest: `NEXT_REDIRECT;replace;${url};303;`,
  });
});
const revalidatePathMock = vi.fn();
const requireTrustedAdminMutationMock = vi.fn();
const changeStatusMock = vi.fn();
const updateProductMock = vi.fn();
const createProductMock = vi.fn();
const updateServiceAreaMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => revalidatePathMock(path),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("@/features/admin/auth/admin-session", () => ({
  clearAdminSessionCookie: vi.fn(),
  getLoginRedirectTarget: vi.fn((value: string) => value || "/admin"),
  getTrustedNetworkKey: vi.fn(() => null),
  readAdminSessionToken: vi.fn(async () => null),
  requireTrustedAdminMutation: () => requireTrustedAdminMutationMock(),
  writeAdminSessionCookie: vi.fn(),
}));

vi.mock("@/features/admin/auth/login-service-instance", () => ({
  loginService: { login: vi.fn() },
}));

vi.mock("@/features/admin/auth/session-service-instance", () => ({
  adminSessionService: { revokeByToken: vi.fn() },
}));

vi.mock("@/server/env/env", () => ({
  getServerEnv: () => ({
    APP_ORIGIN: "http://localhost:3000",
    trustProxy: false,
  }),
}));

vi.mock("@/server/db/db", () => ({
  db: { insert: vi.fn(() => ({ values: vi.fn() })) },
}));

vi.mock("@/features/admin/application/admin-services", () => ({
  adminOrderService: {
    changeStatus: (...args: unknown[]) => changeStatusMock(...args),
  },
  adminCatalogService: {
    update: (...args: unknown[]) => updateProductMock(...args),
    create: (...args: unknown[]) => createProductMock(...args),
  },
  adminDeliveryService: {
    update: (...args: unknown[]) => updateServiceAreaMock(...args),
  },
}));

const actor: AdminActor = {
  id: "11111111-1111-4111-8111-111111111111",
  username: "owner",
  displayName: "المالك",
  role: "owner",
  active: true,
};

const {
  createProductAction,
  updateOrderStatusAction,
  updateProductAction,
  updateServiceAreaAction,
} = await import("./admin-actions");

function expectRedirect(url: string, error: unknown) {
  expect(error).toBeInstanceOf(Error);
  expect(String(error)).toContain(`NEXT_REDIRECT:${url}`);
  expect(redirectMock).toHaveBeenCalledWith(url);
}

beforeEach(() => {
  redirectMock.mockClear();
  revalidatePathMock.mockClear();
  requireTrustedAdminMutationMock.mockReset();
  requireTrustedAdminMutationMock.mockResolvedValue(actor);
  changeStatusMock.mockReset();
  updateProductMock.mockReset();
  createProductMock.mockReset();
  updateServiceAreaMock.mockReset();
});

describe("admin mutation actions", () => {
  it("redirects after a successful order-status update", async () => {
    changeStatusMock.mockResolvedValue({});
    const formData = new FormData();
    formData.set("publicReference", "MS-abcdefghijklmnopqrstuvwx");
    formData.set("nextStatus", "confirmed");
    formData.set("expectedVersion", "1");

    await expect(updateOrderStatusAction(formData)).rejects.toSatisfy(
      (error: unknown) => {
        expectRedirect("/admin/orders/MS-abcdefghijklmnopqrstuvwx", error);
        return true;
      },
    );
    expect(changeStatusMock).toHaveBeenCalledOnce();
  });

  it("redirects after a successful product update", async () => {
    updateProductMock.mockResolvedValue({
      product: { id: "general-cleaner" },
      slug: "general-cleaner-secret",
    });
    const formData = new FormData();
    formData.set("domainId", "general-cleaner");
    formData.set("nameAr", "منظف عام");
    formData.set("priceIls", "8.50");
    formData.set("categoryId", "home");
    formData.set("availability", "available");
    formData.set("sortOrder", "1");
    formData.set("detailsStatus", "verified");
    formData.set("placeholderVariant", "general-cleaner");

    await expect(updateProductAction(formData)).rejects.toSatisfy(
      (error: unknown) => {
        expectRedirect("/admin/products/general-cleaner", error);
        return true;
      },
    );
    expect(updateProductMock).toHaveBeenCalledOnce();
  });

  it("redirects after a successful product creation", async () => {
    createProductMock.mockResolvedValue({ id: "new-cleaner" });
    const formData = new FormData();
    formData.set("domainId", "new-cleaner");
    formData.set("slug", "new-cleaner");
    formData.set("nameAr", "منتج جديد");
    formData.set("priceIls", "5.00");
    formData.set("categoryId", "home");
    formData.set("sortOrder", "20");
    formData.set("detailsStatus", "placeholder");
    formData.set("placeholderVariant", "brush");

    await expect(createProductAction(formData)).rejects.toSatisfy(
      (error: unknown) => {
        expectRedirect("/admin/products/new-cleaner", error);
        return true;
      },
    );
    expect(createProductMock).toHaveBeenCalledOnce();
  });

  it("redirects after a successful delivery-area update", async () => {
    updateServiceAreaMock.mockResolvedValue({
      code: "maythalun",
      deliveryFeeAgorot: 300,
    });
    const formData = new FormData();
    formData.set("code", "maythalun");
    formData.set("enabled", "true");
    formData.set("sortOrder", "1");
    formData.set("feeMode", "known");
    formData.set("deliveryFeeIls", "3.00");

    await expect(updateServiceAreaAction(formData)).rejects.toSatisfy(
      (error: unknown) => {
        expectRedirect("/admin/delivery-areas", error);
        return true;
      },
    );
    expect(updateServiceAreaMock).toHaveBeenCalledOnce();
  });

  it("returns Arabic errors for validation and service failures", async () => {
    const invalidStatus = new FormData();
    invalidStatus.set("publicReference", "MS-abcdefghijklmnopqrstuvwx");
    invalidStatus.set("nextStatus", "delivered");
    invalidStatus.set("expectedVersion", "1");
    changeStatusMock.mockRejectedValue(
      new AdminOrderError("invalid_transition"),
    );
    await expect(updateOrderStatusAction(invalidStatus)).resolves.toEqual({
      ok: false,
      message: "لا يمكن نقل الطلب إلى هذه الحالة.",
    });
    expect(redirectMock).not.toHaveBeenCalled();

    const badPrice = new FormData();
    badPrice.set("domainId", "general-cleaner");
    badPrice.set("priceIls", "abc");
    await expect(updateProductAction(badPrice)).resolves.toEqual({
      ok: false,
      message: "أدخل سعراً صالحاً بالشيكل.",
    });

    const duplicate = new FormData();
    duplicate.set("domainId", "new-cleaner");
    duplicate.set("slug", "new-cleaner");
    duplicate.set("nameAr", "منتج");
    duplicate.set("priceIls", "5.00");
    duplicate.set("categoryId", "home");
    duplicate.set("sortOrder", "1");
    duplicate.set("detailsStatus", "placeholder");
    duplicate.set("placeholderVariant", "brush");
    createProductMock.mockRejectedValue(new AdminCatalogError("duplicate"));
    await expect(createProductAction(duplicate)).resolves.toEqual({
      ok: false,
      message: "معرّف المنتج أو الرابط مستخدم مسبقاً.",
    });

    const badFee = new FormData();
    badFee.set("code", "maythalun");
    badFee.set("enabled", "true");
    badFee.set("sortOrder", "1");
    badFee.set("feeMode", "known");
    badFee.set("deliveryFeeIls", "bad");
    await expect(updateServiceAreaAction(badFee)).resolves.toEqual({
      ok: false,
      message: "أدخل تكلفة توصيل صالحة أو اتركها غير معروفة.",
    });

    const missingArea = new FormData();
    missingArea.set("code", "missing");
    missingArea.set("enabled", "true");
    missingArea.set("sortOrder", "1");
    missingArea.set("feeMode", "unknown");
    updateServiceAreaMock.mockRejectedValue(
      new AdminDeliveryError("not_found"),
    );
    await expect(updateServiceAreaAction(missingArea)).resolves.toEqual({
      ok: false,
      message: "تعذّر حفظ منطقة التوصيل.",
    });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("maps order and product service errors without swallowing redirects", () => {
    expect(
      mapOrderAdminError(new AdminOrderError("concurrency_conflict")),
    ).toBe("تم تعديل الطلب من جلسة أخرى. حدّث الصفحة ثم حاول مجدداً.");
    expect(mapOrderAdminError(new AdminOrderError("not_found"))).toBe(
      "الطلب غير موجود.",
    );
    expect(mapProductAdminError(new AdminCatalogError("not_found"))).toBe(
      "المنتج غير موجود.",
    );
    expect(mapDeliveryAdminError(new AdminDeliveryError("invalid_input"))).toBe(
      "تعذّر حفظ منطقة التوصيل.",
    );
  });
});
