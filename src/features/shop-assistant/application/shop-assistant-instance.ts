import "server-only";

import { createOpenAI } from "@ai-sdk/openai";

import { PostgresRateLimiter } from "@/features/admin/auth/postgres-rate-limiter";
import { storefrontCategories } from "@/features/catalog/infrastructure/category-repository";
import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import { orderService } from "@/features/orders/application/order-service-instance";
import { db } from "@/server/db/db";

import type { MessageSender } from "../domain/transport";
import { CloudApiSender } from "../infrastructure/cloud-api";
import { createAiTurn } from "./shop-assistant-ai";
import { ShopAssistantService } from "./shop-assistant-service";

const DAY_MS = 24 * 60 * 60 * 1000;

export function shopAssistantStoreUrl(): string {
  return (
    process.env.APP_ORIGIN?.trim() ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000")
  );
}

/** The live WhatsApp channel answers customers only when the owner switches it on. */
export function liveAssistantEnabled(): boolean {
  return process.env.SHOP_ASSISTANT === "on";
}

/** The sender for real WhatsApp replies, or null until the provider settings exist. */
export function liveSender(): MessageSender | null {
  const apiUrl = process.env.WHATSAPP_API_URL?.trim();
  const token = process.env.WHATSAPP_API_TOKEN?.trim();
  if (!apiUrl || !token) return null;
  return new CloudApiSender({
    apiUrl,
    token,
    authStyle: process.env.WHATSAPP_API_AUTH === "d360" ? "d360" : "bearer",
  });
}

function dailyAiLimit(): number {
  const value = Number(process.env.SHOP_ASSISTANT_DAILY_AI_TURNS);
  return Number.isInteger(value) && value > 0 ? value : 400;
}

const limiter = new PostgresRateLimiter(db);

const aiTurn = createAiTurn(
  () => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("AI_NOT_CONFIGURED");
    return createOpenAI({ apiKey })(
      process.env.SHOP_ASSISTANT_MODEL?.trim() ||
        process.env.OPENAI_ASSISTANT_MODEL?.trim() ||
        "gpt-4.1-mini",
    );
  },
  async () => {
    const [products, categories] = await Promise.all([
      productRepository.list(),
      storefrontCategories(),
    ]);
    return { products, categories };
  },
  shopAssistantStoreUrl(),
  // A daily cap on model calls for the whole shop keeps the bill bounded; over it, customers get the fallback reply.
  async () => {
    const { allowed } = await limiter.hit({
      scope: "shop-assistant:ai",
      keyHash: "all",
      limit: dailyAiLimit(),
      windowMs: DAY_MS,
    });
    if (!allowed) throw new Error("AI_DAILY_LIMIT");
  },
);

export const shopAssistantService = new ShopAssistantService(
  db,
  orderService,
  aiTurn,
  shopAssistantStoreUrl(),
  { realOrdersEnabled: () => process.env.SHOP_ASSISTANT_ORDERS === "on" },
);
