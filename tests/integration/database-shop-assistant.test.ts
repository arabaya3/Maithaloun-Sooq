import type { LanguageModelV4, LanguageModelV4Content } from "@ai-sdk/provider";
import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { rankBestSellers } from "@/features/catalog/infrastructure/best-sellers";
import { listStorefrontCategories } from "@/features/catalog/infrastructure/category-queries";
import { PostgresProductRepository } from "@/features/catalog/infrastructure/postgres-product-repository";
import { OrderService } from "@/features/orders/application/order-service";
import { StoreContactService } from "@/features/orders/application/store-contact-service";
import { createAiTurn } from "@/features/shop-assistant/application/shop-assistant-ai";
import {
  ShopAssistantService,
  type AiTurn,
} from "@/features/shop-assistant/application/shop-assistant-service";
import { encodeCartCode } from "@/features/shop-assistant/domain/cart-code";
import { SimulatorSender } from "@/features/shop-assistant/infrastructure/cloud-api";
import * as schema from "@/server/db/schema";
import {
  resetTestDatabase,
  testDatabaseConnection,
} from "@/test/test-database";

import { createOwnerActor } from "./support";

const { db, client } = testDatabaseConnection;
const productRepository = new PostgresProductRepository(db);
const STORE = "https://maytha.example";
const CUSTOMER = "+970591234567";

const line = (productId: string, quantity: number) => ({
  productId,
  variantId: `${productId}--default`,
  quantity,
});

let counter = 0;
const inbound = (text: string, from = CUSTOMER) => ({
  provider: "whatsapp",
  providerMessageId: `wamid.${++counter}`,
  fromE164: from,
  text,
  receivedAt: new Date(),
});

// An AI turn that only does what the test scripts, through the same context the real model gets.
function scripted(
  steps: ((context: Parameters<AiTurn>[0]) => Promise<string>)[],
): AiTurn {
  let index = 0;
  return async (context) => {
    const step = steps[index++];
    if (!step) throw new Error("no scripted step");
    return step(context);
  };
}

async function orderCount() {
  const [row] = await db.select({ value: count() }).from(schema.orders);
  return row!.value;
}

beforeAll(async () => {
  await resetTestDatabase();
  await new StoreContactService(db).setWhatsAppNumber(
    await createOwnerActor(),
    { countryCode: "972", nationalNumber: "0599105456" },
  );
});

beforeEach(async () => {
  await client.unsafe("TRUNCATE TABLE shop_conversations, orders CASCADE");
});

afterAll(async () => {
  await client.end();
});

describe("shop assistant", () => {
  it("places exactly one order only after the customer's yes to the exact summary", async () => {
    const sender = new SimulatorSender();
    const service = new ShopAssistantService(
      db,
      new OrderService(db),
      scripted([
        async (context) => {
          await context.saveCart([line("general-cleaner", 2)]);
          const prepared = await context.prepareOrder({
            name: "سلمى",
            deliveryNote: "حارة الجامع قرب الدوار",
          });
          expect(prepared.ok).toBe(true);
          return "the model's own words are replaced by the summary";
        },
      ]),
      STORE,
      { realOrdersEnabled: () => true },
    );

    const summary = await service.handleInbound(
      inbound("بدي ٢ منظف عام، اسمي سلمى"),
      sender,
    );
    expect(summary.handled).toBe("ai");
    expect(summary.replies[0]).toContain("الإجمالي");
    expect(summary.replies[0]).not.toContain("replaced");
    expect(await orderCount()).toBe(0);

    const yes = inbound("نعم");
    const placed = await service.handleInbound(yes, sender);
    expect(placed.handled).toBe("order");
    expect(await orderCount()).toBe(1);

    // The provider redelivers the same yes: nothing happens.
    expect((await service.handleInbound(yes, sender)).handled).toBe(
      "duplicate",
    );
    // A second yes is not a confirmation any more (the cart is empty); the AI gets it, and fails safely.
    expect((await service.handleInbound(inbound("نعم"), sender)).handled).toBe(
      "fallback",
    );
    expect(await orderCount()).toBe(1);

    const [order] = await db.select().from(schema.orders);
    expect(order).toMatchObject({
      status: "pending",
      checkoutChannel: "whatsapp",
      whatsappPhoneE164: CUSTOMER,
      isTest: false,
      customerName: "سلمى",
    });
    const priced = summary.replies[0]!;
    expect(priced).toContain(
      (order!.finalTotalAgorot! / 100).toFixed(2).replace(/\.00$/, ""),
    );
  });

  it("ignores a late or replayed yes", async () => {
    const service = new ShopAssistantService(
      db,
      new OrderService(db),
      scripted([
        async (context) => {
          await context.saveCart([line("general-cleaner", 1)]);
          await context.prepareOrder({ name: "سلمى", deliveryNote: null });
          return "";
        },
      ]),
      STORE,
    );
    const sender = new SimulatorSender();
    await service.handleInbound(inbound("بدي منظف"), sender);
    const late = {
      ...inbound("نعم"),
      receivedAt: new Date(Date.now() - 7 * 60 * 60 * 1000),
    };
    expect((await service.handleInbound(late, sender)).handled).toBe("stale");
    expect(sender.sent).toHaveLength(1);
    expect(await orderCount()).toBe(0);
  });

  it("never places a real order while real ordering is switched off", async () => {
    const sender = new SimulatorSender();
    const service = new ShopAssistantService(
      db,
      new OrderService(db),
      scripted([
        async (context) => {
          await context.saveCart([line("general-cleaner", 1)]);
          await context.prepareOrder({ name: "سلمى", deliveryNote: null });
          return "";
        },
      ]),
      STORE,
    );
    await service.handleInbound(inbound("بدي منظف"), sender);
    const yes = await service.handleInbound(inbound("نعم"), sender);
    expect(yes.handled).toBe("human");
    expect(yes.replies[0]).toContain("فريق المتجر");
    expect(await orderCount()).toBe(0);
    const [conversation] = await service.conversations();
    expect(conversation).toMatchObject({ botPaused: true, isTest: false });
    expect(conversation!.humanRequestedAt).not.toBeNull();
    // The cart and its summary stay, so the owner sees exactly what the customer confirmed.
    expect(conversation!.cart).toMatchObject([line("general-cleaner", 1)]);
  });

  it("needs a fresh yes after the cart changes", async () => {
    const service = new ShopAssistantService(
      db,
      new OrderService(db),
      scripted([
        async (context) => {
          await context.saveCart([line("general-cleaner", 1)]);
          await context.prepareOrder({ name: "سلمى", deliveryNote: null });
          return "";
        },
        async (context) => {
          await context.saveCart([line("general-cleaner", 3)]);
          return "تم التعديل";
        },
      ]),
      STORE,
    );
    const sender = new SimulatorSender();
    await service.handleInbound(inbound("بدي منظف"), sender);
    await service.handleInbound(inbound("خليها ٣"), sender);
    expect((await service.handleInbound(inbound("نعم"), sender)).handled).toBe(
      "fallback",
    );
    expect(await orderCount()).toBe(0);
  });

  it("hands over to a person and stays silent until the owner resumes", async () => {
    const turns: string[] = [];
    const service = new ShopAssistantService(
      db,
      new OrderService(db),
      async (_context, text) => {
        turns.push(text);
        return "رد";
      },
      STORE,
    );
    const sender = new SimulatorSender();
    const handed = await service.handleInbound(
      inbound("بدي احكي مع حدا من المحل"),
      sender,
    );
    expect(handed.handled).toBe("human");
    expect(
      (await service.handleInbound(inbound("مرحبا"), sender)).handled,
    ).toBe("paused");
    expect(turns).toEqual([]);

    const [conversation] = await service.conversations();
    expect(conversation!.humanRequestedAt).not.toBeNull();
    await service.ownerReply(
      conversation!.id,
      "أهلاً، معك صاحبة المحل",
      sender,
    );
    expect(sender.sent.at(-1)).toEqual({
      to: CUSTOMER,
      text: "أهلاً، معك صاحبة المحل",
    });
    await service.setPaused(conversation!.id, false);
    expect(
      (await service.handleInbound(inbound("شكراً"), sender)).handled,
    ).toBe("ai");
    const authors = (await service.messages(conversation!.id)).map(
      (message) => message.author,
    );
    expect(authors).toContain("owner");
  });

  it("restores and re-prices a cart sent from the website", async () => {
    const service = new ShopAssistantService(
      db,
      new OrderService(db),
      scripted([]),
      STORE,
    );
    const code = encodeCartCode([line("general-cleaner", 2)]);
    const restored = await service.handleInbound(
      inbound(`مرحباً MAYTHA\nرمز السلة: ${code}`),
      new SimulatorSender(),
    );
    expect(restored.handled).toBe("cart");
    expect(restored.replies[0]).toContain("الإجمالي");
    expect(await orderCount()).toBe(0);
  });

  it("drives the real tools from a model and never lets the model set a price", async () => {
    const [product] = (await productRepository.list()).filter(
      (item) => item.id === "general-cleaner",
    );
    expect(product).toBeDefined();
    const variant = product!.variants[0]!;
    const responses: LanguageModelV4Content[][] = [
      [
        {
          type: "tool-call",
          toolCallId: "1",
          toolName: "searchProducts",
          input: JSON.stringify({ query: "منظف" }),
        },
      ],
      [
        {
          type: "tool-call",
          toolCallId: "2",
          toolName: "addToCart",
          input: JSON.stringify({
            productId: product!.id,
            variantId: variant.id,
            quantity: 2,
            priceAgorot: 1,
          }),
        },
      ],
      [{ type: "text", text: "أضفتها للسلة." }],
    ];
    let call = 0;
    const model: LanguageModelV4 = {
      specificationVersion: "v4",
      provider: "test",
      modelId: "scripted",
      supportedUrls: {},
      async doGenerate() {
        const content = responses[call++] ?? [{ type: "text", text: "" }];
        return {
          content,
          finishReason: {
            unified: content[0]!.type === "tool-call" ? "tool-calls" : "stop",
            raw: undefined,
          },
          usage: {
            inputTokens: {
              total: 1,
              noCache: 1,
              cacheRead: undefined,
              cacheWrite: undefined,
            },
            outputTokens: { total: 1, text: 1, reasoning: undefined },
          },
          warnings: [],
        };
      },
      async doStream() {
        throw new Error("not used");
      },
    };
    const service = new ShopAssistantService(
      db,
      new OrderService(db),
      createAiTurn(
        () => model,
        async () => ({
          products: await productRepository.list(),
          categories: await listStorefrontCategories(db),
        }),
        STORE,
      ),
      STORE,
    );
    const result = await service.handleInbound(
      inbound("بدي منظف"),
      new SimulatorSender(),
    );
    expect(result).toEqual({ handled: "ai", replies: ["أضفتها للسلة."] });
    const [conversation] = await db.select().from(schema.shopConversations);
    expect(conversation!.cart).toEqual([
      {
        productId: product!.id,
        variantId: variant.id,
        sellingUnitId: expect.any(String),
        unitsPerSale: 1,
        quantity: 2,
      },
    ]);
    expect(JSON.stringify(conversation!.cart)).not.toContain("price");
    expect(await orderCount()).toBe(0);
  });

  it("keeps simulator conversations and their orders marked as tests", async () => {
    const service = new ShopAssistantService(
      db,
      new OrderService(db),
      scripted([
        async (context) => {
          await context.saveCart([line("general-cleaner", 1)]);
          await context.prepareOrder({ name: "تجربة", deliveryNote: null });
          return "";
        },
      ]),
      STORE,
    );
    const sender = new SimulatorSender();
    await service.handleInbound(
      { ...inbound("بدي منظف", "sim-owner"), provider: "simulator" },
      sender,
    );
    await service.handleInbound(
      { ...inbound("نعم", "sim-owner"), provider: "simulator" },
      sender,
    );
    const [order] = await db.select().from(schema.orders);
    expect(order!.isTest).toBe(true);
    const [conversation] = await db
      .select()
      .from(schema.shopConversations)
      .where(eq(schema.shopConversations.customerE164, "sim-owner"));
    expect(conversation!.isTest).toBe(true);
    expect(
      await db
        .select()
        .from(schema.adminNotifications)
        .where(eq(schema.adminNotifications.orderId, order!.id)),
    ).toEqual([]);
    expect(await rankBestSellers(db, 10)).toEqual([]);
  });
});
