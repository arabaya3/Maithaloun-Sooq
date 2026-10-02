import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { CustomerAccountService } from "@/features/accounts/application/customer-account-service";
import { CustomerAuthService } from "@/features/accounts/application/customer-auth-service";
import { CustomerFavoritesService } from "@/features/accounts/application/customer-favorites-service";
import { CustomerOrdersService } from "@/features/accounts/application/customer-orders-service";
import type { PhoneOtpProvider } from "@/features/accounts/application/otp-provider";
import { PostgresRateLimiter } from "@/features/admin/auth/postgres-rate-limiter";
import { PostgresProductRepository } from "@/features/catalog/infrastructure/postgres-product-repository";
import { OrderService } from "@/features/orders/application/order-service";
import * as schema from "@/server/db/schema";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

import { checkoutRequest } from "./support";

const { db, client } = testDatabaseConnection;
const CODE = "246810";
const PHONE = "+970591234567";
const OTHER_PHONE = "+970598887777";

const sent: string[] = [];
const provider: PhoneOtpProvider = {
  send: async (phone) => {
    sent.push(phone);
    return true;
  },
  verify: async (_phone, code) => code === CODE,
};
const auth = new CustomerAuthService(
  db,
  new PostgresRateLimiter(db),
  provider,
  "integration-pepper-0123456789abcdef0123456789",
);
const accounts = new CustomerAccountService(db);
const favorites = new CustomerFavoritesService(db);
const customerOrders = new CustomerOrdersService(db);
const orderService = new OrderService(db);
const catalog = new PostgresProductRepository(db);

async function signIn(phone = PHONE, previousToken: string | null = null) {
  const result = await auth.verifyCode({
    phoneE164: phone,
    code: CODE,
    networkKey: null,
    previousToken,
  });
  if (result.status !== "verified") throw new Error(result.status);
  const actor = await auth.lookup(result.rawToken);
  return { ...result, actor: actor! };
}

beforeAll(async () => {
  await resetTestDatabase();
});

beforeEach(async () => {
  sent.length = 0;
  await client.unsafe(
    "TRUNCATE TABLE orders, customer_sessions, customer_addresses, customer_favorites, customer_order_links, rate_limit_buckets CASCADE",
  );
  await client.unsafe(
    "ALTER TABLE customer_account_events DISABLE TRIGGER customer_account_events_append_only",
  );
  await client.unsafe("DELETE FROM customer_account_events");
  await client.unsafe(
    "ALTER TABLE customer_account_events ENABLE TRIGGER customer_account_events_append_only",
  );
  await client.unsafe("DELETE FROM customer_accounts");
  await db.update(schema.productVariants).set({ availability: "available" });
});

afterAll(async () => {
  await client.end();
});

describe("phone sign-in", () => {
  it("creates the account on first verification and reuses it afterwards", async () => {
    const first = await signIn();
    expect(first.created).toBe(true);
    const second = await signIn();
    expect(second.created).toBe(false);
    expect(second.actor.id).toBe(first.actor.id);
    const [{ total }] = await db
      .select({ total: count() })
      .from(schema.customerAccounts);
    expect(total).toBe(1);
  });

  it("rotates the session on login so a planted token stops working", async () => {
    const planted = await signIn();
    const fresh = await signIn(PHONE, planted.rawToken);
    expect(fresh.rawToken).not.toBe(planted.rawToken);
    expect(await auth.lookup(planted.rawToken)).toBeNull();
    expect(await auth.lookup(fresh.rawToken)).not.toBeNull();
  });

  it("rejects wrong codes and then rate-limits verification per phone", async () => {
    const attempt = () =>
      auth.verifyCode({
        phoneE164: PHONE,
        code: "000000",
        networkKey: null,
        previousToken: null,
      });
    for (let index = 0; index < 5; index += 1) {
      expect((await attempt()).status).toBe("invalid");
    }
    expect((await attempt()).status).toBe("rate_limited");
    expect(
      (
        await auth.verifyCode({
          phoneE164: PHONE,
          code: CODE,
          networkKey: null,
          previousToken: null,
        })
      ).status,
    ).toBe("rate_limited");
  });

  it("answers code requests identically and caps sends per phone and network", async () => {
    expect(await auth.requestCode("+15551234567", "10.0.0.1")).toBe("sent");
    expect(sent).toEqual([]);
    for (let index = 0; index < 3; index += 1) {
      expect(await auth.requestCode(PHONE, "10.0.0.1")).toBe("sent");
    }
    expect(await auth.requestCode(PHONE, "10.0.0.1")).toBe("rate_limited");
    expect(sent).toHaveLength(3);
  });

  it("expires idle sessions and signs out everywhere on request", async () => {
    const { rawToken, actor } = await signIn();
    const other = await signIn();
    const later = new Date(Date.now() + 31 * 24 * 60 * 60 * 1_000);
    expect(await auth.lookup(rawToken, later)).toBeNull();
    await auth.logoutAll(actor.id);
    expect(await auth.lookup(other.rawToken)).toBeNull();
    expect(await auth.lookup("not-a-token")).toBeNull();
  });

  it("is unavailable without a configured provider", async () => {
    const disabled = new CustomerAuthService(
      db,
      new PostgresRateLimiter(db),
      null,
      "integration-pepper-0123456789abcdef0123456789",
    );
    expect(await disabled.requestCode(PHONE, null)).toBe("unavailable");
  });
});

describe("profile and addresses", () => {
  it("keeps one default address, caps the list and refuses another customer's address", async () => {
    const { actor } = await signIn();
    const stranger = await signIn(OTHER_PHONE);
    await accounts.saveAddress(actor.id, {
      label: "البيت",
      address: "ميثلون الحي الغربي قرب المسجد",
    });
    await accounts.saveAddress(actor.id, {
      label: "الشغل",
      address: "ميثلون الشارع الرئيسي",
      isDefault: true,
    });
    let profile = await accounts.profile(actor.id);
    expect(
      profile.addresses.map((entry) => [entry.label, entry.isDefault]),
    ).toEqual([
      ["الشغل", true],
      ["البيت", false],
    ]);
    for (let index = 0; index < 3; index += 1) {
      await accounts.saveAddress(actor.id, {
        label: `عنوان ${index}`,
        address: "ميثلون عنوان إضافي مفصل",
      });
    }
    await expect(
      accounts.saveAddress(actor.id, {
        label: "زائد",
        address: "ميثلون عنوان سادس مفصل",
      }),
    ).rejects.toMatchObject({ code: "address_limit" });
    profile = await accounts.profile(actor.id);
    await expect(
      accounts.saveAddress(
        stranger.actor.id,
        { label: "سرقة", address: "عنوان شخص آخر مفصل" },
        profile.addresses[0]!.id,
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    await accounts.deleteAddress(stranger.actor.id, profile.addresses[0]!.id);
    expect((await accounts.profile(actor.id)).addresses).toHaveLength(5);
  });

  it("stores the personalization preference off by default", async () => {
    const { actor } = await signIn();
    expect((await accounts.profile(actor.id)).personalizationEnabled).toBe(
      false,
    );
    await accounts.updateProfile(actor.id, {
      displayName: "سعاد",
      whatsappE164: "+972591112222",
      personalizationEnabled: true,
    });
    const profile = await accounts.profile(actor.id);
    expect(profile).toMatchObject({
      displayName: "سعاد",
      whatsappE164: "+972591112222",
      personalizationEnabled: true,
    });
    await expect(
      accounts.updateProfile(actor.id, { whatsappE164: "0591112222" }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("favourites", () => {
  it("merges device favourites idempotently without duplicates or unknown products", async () => {
    const { actor } = await signIn();
    const stranger = await signIn(OTHER_PHONE);
    await favorites.set(actor.id, "carpet-brush", true);
    const first = await favorites.merge(actor.id, [
      "general-cleaner",
      "general-cleaner",
      "carpet-brush",
      "not-a-product",
    ]);
    expect(first).toEqual({ added: 1, total: 2 });
    expect(await favorites.merge(actor.id, ["general-cleaner"])).toEqual({
      added: 0,
      total: 2,
    });
    expect(await favorites.list(actor.id)).toEqual([
      "carpet-brush",
      "general-cleaner",
    ]);
    expect(await favorites.list(stranger.actor.id)).toEqual([]);
    expect(await favorites.merge(actor.id, "garbage")).toEqual({
      added: 0,
      total: 0,
    });
    await favorites.set(actor.id, "carpet-brush", false);
    expect(await favorites.list(actor.id)).toEqual(["general-cleaner"]);
  });

  it("names saved products that are no longer shown in the store", async () => {
    const { actor } = await signIn();
    await favorites.set(actor.id, "general-cleaner", true);
    expect(
      await favorites.retiredNames(actor.id, new Set(["carpet-brush"])),
    ).toHaveLength(1);
  });
});

describe("orders", () => {
  it("links checkout orders to the signed-in account and keeps guests unlinked", async () => {
    const { actor } = await signIn();
    const owned = await orderService.create(
      checkoutRequest([{ productId: "general-cleaner", quantity: 1 }]),
      { customerAccountId: actor.id },
    );
    await orderService.create(
      checkoutRequest([{ productId: "carpet-brush", quantity: 1 }]),
    );
    const history = await customerOrders.history(actor.id);
    expect(history.map((order) => order.publicReference)).toEqual([
      owned.publicReference,
    ]);
    expect(history[0]!.items[0]!.quantity).toBe(1);
  });

  it("lets only the verified phone claim past guest orders, once", async () => {
    await orderService.create(
      checkoutRequest([{ productId: "general-cleaner", quantity: 2 }]),
    );
    const intruder = await signIn(OTHER_PHONE);
    expect(await customerOrders.claimableCount(OTHER_PHONE)).toBe(0);
    expect(await customerOrders.claim(intruder.actor.id, PHONE)).toBe(0);
    expect(await customerOrders.claim(intruder.actor.id, OTHER_PHONE)).toBe(0);

    const owner = await signIn();
    expect(await customerOrders.claimableCount(PHONE)).toBe(1);
    expect(await customerOrders.claim(owner.actor.id, PHONE)).toBe(1);
    expect(await customerOrders.claim(owner.actor.id, PHONE)).toBe(0);
    expect(await customerOrders.history(owner.actor.id)).toHaveLength(1);
    expect(await customerOrders.history(intruder.actor.id)).toHaveLength(0);
    const events = await db
      .select({ type: schema.customerAccountEvents.type })
      .from(schema.customerAccountEvents)
      .where(eq(schema.customerAccountEvents.accountId, owner.actor.id));
    expect(events.map((event) => event.type)).toContain("orders_claimed");
  });

  it("reviews a reorder against current prices and availability", async () => {
    const { actor } = await signIn();
    const order = await orderService.create(
      checkoutRequest([
        { productId: "general-cleaner", quantity: 1 },
        { productId: "carpet-brush", quantity: 2 },
        { productId: "dolphin-bleach", quantity: 1 },
      ]),
      { customerAccountId: actor.id },
    );
    await db
      .update(schema.productVariants)
      .set({ priceAgorot: 950 })
      .where(eq(schema.productVariants.domainId, "general-cleaner--default"));
    await db
      .update(schema.productVariants)
      .set({ availability: "unavailable" })
      .where(eq(schema.productVariants.domainId, "carpet-brush--default"));

    const review = await customerOrders.reorderReview(
      actor.id,
      order.publicReference,
      await catalog.list(),
    );
    const byProduct = Object.fromEntries(
      review!.lines.map((line) => [line.productId, line]),
    );
    expect(review!.needsReview).toBe(true);
    expect(byProduct["general-cleaner"]).toMatchObject({
      status: "price_changed",
      currentUnitPriceAgorot: 950,
    });
    expect(byProduct["carpet-brush"]).toMatchObject({
      status: "unavailable",
      currentUnitPriceAgorot: null,
    });
    expect(byProduct["dolphin-bleach"]!.status).toBe("same");

    const stranger = await signIn(OTHER_PHONE);
    expect(
      await customerOrders.reorderReview(
        stranger.actor.id,
        order.publicReference,
        await catalog.list(),
      ),
    ).toBeNull();
    await db
      .update(schema.productVariants)
      .set({ priceAgorot: 700 })
      .where(eq(schema.productVariants.domainId, "general-cleaner--default"));
  });
});

describe("account deletion", () => {
  it("removes personal data and links but keeps orders, and frees the phone", async () => {
    const { actor, rawToken } = await signIn();
    await accounts.saveAddress(actor.id, {
      label: "البيت",
      address: "ميثلون الحي الغربي قرب المسجد",
    });
    await favorites.set(actor.id, "general-cleaner", true);
    await orderService.create(
      checkoutRequest([{ productId: "general-cleaner", quantity: 1 }]),
      { customerAccountId: actor.id },
    );

    await accounts.deleteAccount(actor.id);
    expect(await auth.lookup(rawToken)).toBeNull();
    const [row] = await db
      .select()
      .from(schema.customerAccounts)
      .where(eq(schema.customerAccounts.id, actor.id));
    expect(row).toMatchObject({
      phoneE164: null,
      displayName: null,
      whatsappE164: null,
    });
    expect(row!.deletedAt).not.toBeNull();
    const [{ total: ordersLeft }] = await db
      .select({ total: count() })
      .from(schema.orders);
    expect(ordersLeft).toBe(1);
    for (const table of [
      schema.customerOrderLinks,
      schema.customerFavorites,
      schema.customerAddresses,
    ]) {
      const [{ total }] = await db.select({ total: count() }).from(table);
      expect(total).toBe(0);
    }

    const again = await signIn();
    expect(again.created).toBe(true);
    expect(again.actor.id).not.toBe(actor.id);
    expect(await customerOrders.claimableCount(PHONE)).toBe(1);
  });

  it("keeps the account event trail append-only", async () => {
    const { actor } = await signIn();
    await expect(
      db
        .delete(schema.customerAccountEvents)
        .where(eq(schema.customerAccountEvents.accountId, actor.id)),
    ).rejects.toThrow();
  });
});
