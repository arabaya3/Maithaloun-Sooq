import { describe, expect, it } from "vitest";

import {
  assertOwnerActor,
  AuthorizationError,
  type AdminActor,
} from "../domain/admin-actor";
import {
  assertSafeAuditState,
  redactOrderStatusAuditState,
  redactProductAuditState,
  redactServiceAreaAuditState,
} from "../domain/audit";
import { parseIlsToAgorot } from "@/shared/lib/parse-ils";
import {
  adminProductCreateSchema,
  adminProductUpdateSchema,
} from "../application/admin-catalog-service";
import { adminServiceAreaUpdateSchema } from "../application/admin-delivery-service";

const owner: AdminActor = {
  id: "11111111-1111-4111-8111-111111111111",
  username: "owner",
  displayName: "المالك",
  role: "owner",
  active: true,
};

describe("authorization enforcement", () => {
  it("rejects inactive or non-owner actors", () => {
    expect(() => assertOwnerActor(owner)).not.toThrow();
    expect(() => assertOwnerActor({ ...owner, active: false })).toThrow(
      AuthorizationError,
    );
  });
});

describe("money input parsing", () => {
  it("parses ILS to integer agorot without floating-point math", () => {
    expect(parseIlsToAgorot("7")).toBe(700);
    expect(parseIlsToAgorot("7.5")).toBe(750);
    expect(parseIlsToAgorot("0.00")).toBe(0);
    expect(parseIlsToAgorot("7,50")).toBe(750);
    expect(parseIlsToAgorot("7.555")).toBeNull();
    expect(parseIlsToAgorot("-1")).toBeNull();
    expect(parseIlsToAgorot("abc")).toBeNull();
  });
});

describe("nullable versus zero delivery fee", () => {
  it("keeps zero distinct from unknown", () => {
    const zero = adminServiceAreaUpdateSchema.parse({
      code: "maythalun",
      enabled: true,
      sortOrder: 1,
      deliveryFeeAgorot: 0,
    });
    const unknown = adminServiceAreaUpdateSchema.parse({
      code: "maythalun",
      enabled: true,
      sortOrder: 1,
      deliveryFeeAgorot: null,
    });
    expect(zero.deliveryFeeAgorot).toBe(0);
    expect(unknown.deliveryFeeAgorot).toBeNull();
    expect(
      adminServiceAreaUpdateSchema.safeParse({
        code: "maythalun",
        enabled: true,
        sortOrder: 1,
        deliveryFeeAgorot: -1,
      }).success,
    ).toBe(false);
  });
});

describe("admin product validation", () => {
  it("requires mandatory fields and keeps new products unavailable", () => {
    const created = adminProductCreateSchema.parse({
      domainId: "new-product",
      slug: "new-product",
      nameAr: "منتج جديد",
      priceAgorot: 500,
      categoryId: "home",
      availability: "available",
      sortOrder: 20,
      detailsStatus: "placeholder",
      placeholderVariant: "brush",
    });
    expect(created.domainId).toBe("new-product");
    expect(
      adminProductUpdateSchema.safeParse({
        ...created,
        slug: undefined,
        priceAgorot: 0,
      }).success,
    ).toBe(false);
  });
});

describe("audit redaction", () => {
  it("omits secrets, tokens, and customer PII", () => {
    const product = redactProductAuditState({
      domainId: "general-cleaner",
      slug: "general-cleaner-secret",
      nameAr: "منظف عام",
      latinName: "Secret",
      priceAgorot: 800,
      categoryId: "home",
      availability: "available",
      sortOrder: 1,
      detailsStatus: "verified",
      unit: "لتر",
      placeholderVariant: "general-cleaner",
    });
    const area = redactServiceAreaAuditState({
      code: "maythalun",
      enabled: true,
      sortOrder: 1,
      deliveryFeeAgorot: 0,
    });
    const order = redactOrderStatusAuditState({
      publicReference: "MS-abcdefghijklmnopqrstuvwx",
      status: "confirmed",
      version: 2,
    });

    for (const state of [product, area, order]) {
      assertSafeAuditState(state);
      expect(JSON.stringify(state)).not.toContain("password");
      expect(JSON.stringify(state)).not.toContain("token");
      expect(JSON.stringify(state)).not.toContain("address");
      expect(JSON.stringify(state)).not.toContain("059");
    }

    expect(() =>
      assertSafeAuditState({ passwordHash: "x", address: "y" }),
    ).toThrow("UNSAFE_AUDIT_STATE");
  });
});
