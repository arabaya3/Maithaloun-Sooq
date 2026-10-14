import "server-only";

import { createHash } from "node:crypto";

import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

import {
  publicQuote,
  type PublicQuote,
} from "@/features/commerce/public-quote";
import {
  CartPricingError,
  priceCart,
} from "@/features/orders/application/cart-pricing";
import {
  OrderCreationError,
  type OrderService,
} from "@/features/orders/application/order-service";
import { checkoutRequestSchema } from "@/features/orders/domain/checkout-request";
import * as schema from "@/server/db/schema";

import { decodeCartCode } from "../domain/cart-code";
import {
  assistantCartSchema,
  type AssistantCartLine,
} from "../domain/conversation-cart";
import {
  asksForHuman,
  isAffirmation,
  messageLocale,
} from "../domain/message-intent";
import { replies } from "../domain/replies";
import type { InboundMessage, MessageSender } from "../domain/transport";

type Database = PostgresJsDatabase<typeof schema>;
export type Conversation = typeof schema.shopConversations.$inferSelect;
type Locale = "ar" | "en";

// Spending and abuse limits: a conversation answers at most this many messages an hour.
export const MAX_REPLIES_PER_HOUR = 30;

/** What the AI turn may change; everything that touches money or orders goes through these. */
export interface AssistantTurnContext {
  conversation: Conversation;
  locale: Locale;
  history: { role: "user" | "assistant"; content: string }[];
  readCart(): AssistantCartLine[];
  saveCart(cart: AssistantCartLine[]): Promise<void>;
  quoteCart(): Promise<
    { ok: true; quote: PublicQuote } | { ok: false; code: string }
  >;
  prepareOrder(details: {
    name: string;
    deliveryNote: string | null;
  }): Promise<{ ok: true; message: string } | { ok: false; code: string }>;
  requestHuman(): Promise<string>;
  /** A reply that must be sent word for word (order summary), replacing the AI's own text. */
  exactReply: string | null;
}

export type AiTurn = (
  context: AssistantTurnContext,
  text: string,
) => Promise<string>;

export interface HandleResult {
  handled:
    | "duplicate"
    | "paused"
    | "human"
    | "order"
    | "cart"
    | "ai"
    | "limited"
    | "fallback";
  replies: string[];
}

function phoneParts(
  e164: string,
): { countryCode: "970" | "972"; national: string } | null {
  const match = /^\+(970|972)(5\d{8})$/.exec(e164);
  return match
    ? { countryCode: match[1] as "970" | "972", national: `0${match[2]}` }
    : null;
}

export class ShopAssistantService {
  constructor(
    private readonly database: Database,
    private readonly orders: OrderService,
    private readonly aiTurn: AiTurn,
    private readonly storeUrl: string,
  ) {}

  async handleInbound(
    inbound: InboundMessage,
    sender: MessageSender,
  ): Promise<HandleResult> {
    const test = inbound.provider === "simulator";
    const conversation = await this.conversationFor(inbound.fromE164, test);

    // A provider may deliver the same message twice: the unique id makes the second one a no-op.
    const [stored] = await this.database
      .insert(schema.shopMessages)
      .values({
        conversationId: conversation.id,
        direction: "in",
        author: "customer",
        body: inbound.text.slice(0, 4000),
        provider: inbound.provider,
        providerMessageId: inbound.providerMessageId,
      })
      .onConflictDoNothing()
      .returning({ id: schema.shopMessages.id });
    if (!stored) return { handled: "duplicate", replies: [] };

    await this.database
      .update(schema.shopConversations)
      .set({ lastInboundAt: inbound.receivedAt, updatedAt: new Date() })
      .where(eq(schema.shopConversations.id, conversation.id));

    const locale = messageLocale(inbound.text);
    const send = (text: string) => this.send(conversation, sender, text);

    // The owner is talking to this customer: the assistant stays silent.
    if (conversation.botPaused) return { handled: "paused", replies: [] };

    if (asksForHuman(inbound.text)) {
      const text = await this.handOver(conversation, locale);
      await send(text);
      return { handled: "human", replies: [text] };
    }

    if (await this.overHourlyLimit(conversation.id)) {
      return { handled: "limited", replies: [] };
    }

    // A clear "yes" right after the summary places the order; the AI is not involved.
    if (
      conversation.awaitingConfirmationVersion !== null &&
      conversation.awaitingConfirmationVersion === conversation.cartVersion &&
      isAffirmation(inbound.text)
    ) {
      const text = await this.placeOrder(conversation, locale);
      await send(text);
      return { handled: "order", replies: [text] };
    }

    // The website's WhatsApp message carries the exact cart: restore and re-price it.
    const restored = decodeCartCode(inbound.text);
    if (restored) {
      await this.writeCart(conversation, restored);
      const priced = await this.quote(restored);
      const text = priced.ok
        ? replies.cartRestored(priced.quote, locale)
        : replies.cartProblem(priced.code, locale);
      await send(text);
      return { handled: "cart", replies: [text] };
    }

    const fresh = await this.reload(conversation.id);
    const context = this.turnContext(
      fresh,
      locale,
      await this.history(fresh.id),
    );
    let text: string;
    try {
      text = await this.aiTurn(context, inbound.text);
      text = context.exactReply ?? text;
    } catch {
      text = replies.unavailable(locale);
      await send(text);
      return { handled: "fallback", replies: [text] };
    }
    if (!text.trim()) text = replies.unavailable(locale);
    await send(text);
    return { handled: "ai", replies: [text] };
  }

  async setPaused(conversationId: string, paused: boolean): Promise<void> {
    await this.database
      .update(schema.shopConversations)
      .set({
        botPaused: paused,
        ...(paused ? {} : { humanRequestedAt: null }),
        updatedAt: new Date(),
      })
      .where(eq(schema.shopConversations.id, conversationId));
  }

  /** The owner's own reply from the admin page; it is sent and stored, and the bot stays paused. */
  async ownerReply(
    conversationId: string,
    text: string,
    sender: MessageSender,
  ): Promise<void> {
    const conversation = await this.reload(conversationId);
    await this.setPaused(conversationId, true);
    await this.send(conversation, sender, text, "owner");
  }

  private turnContext(
    conversation: Conversation,
    locale: Locale,
    history: AssistantTurnContext["history"],
  ): AssistantTurnContext {
    let current = conversation;
    let cart = this.parseCart(conversation.cart);
    const context: AssistantTurnContext = {
      conversation,
      locale,
      history,
      exactReply: null,
      readCart: () => cart,
      saveCart: async (next) => {
        cart = next;
        current = await this.writeCart(current, next);
      },
      quoteCart: () => this.quote(cart),
      prepareOrder: async (details) => {
        if (!cart.length) return { ok: false, code: "empty_cart" };
        if (!phoneParts(current.customerE164) && !current.isTest) {
          context.exactReply = replies.unsupportedNumber(locale, this.storeUrl);
          return { ok: false, code: "unsupported_number" };
        }
        const priced = await this.quote(cart);
        if (!priced.ok) return priced;
        const [updated] = await this.database
          .update(schema.shopConversations)
          .set({
            customerName: details.name.slice(0, 120),
            deliveryNote: details.deliveryNote?.slice(0, 300) ?? null,
            awaitingConfirmationVersion: current.cartVersion,
            updatedAt: new Date(),
          })
          .where(eq(schema.shopConversations.id, current.id))
          .returning();
        current = updated!;
        const message = replies.confirmPrompt(priced.quote, details, locale);
        context.exactReply = message;
        return { ok: true, message };
      },
      requestHuman: async () => {
        const text = await this.handOver(current, locale);
        context.exactReply = text;
        return text;
      },
    };
    return context;
  }

  private async placeOrder(
    conversation: Conversation,
    locale: Locale,
  ): Promise<string> {
    const cart = this.parseCart(conversation.cart);
    const phone =
      phoneParts(conversation.customerE164) ??
      (conversation.isTest
        ? { countryCode: "970" as const, national: "0590000000" }
        : null);
    if (!phone) return replies.unsupportedNumber(locale, this.storeUrl);
    // One key per conversation and cart version: a repeated "yes" returns the same order.
    const idempotencyKey = createHash("sha256")
      .update(`shop-assistant:${conversation.id}:${conversation.cartVersion}`)
      .digest("hex");
    try {
      const order = await this.orders.create(
        checkoutRequestSchema.parse({
          idempotencyKey: toUuid(idempotencyKey),
          customerName:
            conversation.customerName ??
            (locale === "ar" ? "عميل واتساب" : "WhatsApp customer"),
          whatsappCountryCode: phone.countryCode,
          whatsappNationalNumber: phone.national,
          serviceAreaCode: "maythalun",
          ...(conversation.deliveryNote && conversation.deliveryNote.length >= 8
            ? { deliveryAddress: conversation.deliveryNote }
            : {}),
          customerNote:
            conversation.deliveryNote && conversation.deliveryNote.length < 8
              ? conversation.deliveryNote
              : locale === "ar"
                ? "طلب مؤكد عبر مساعد واتساب"
                : "Confirmed with the WhatsApp assistant",
          checkoutChannel: "whatsapp",
          paymentMethod: "cash_on_delivery",
          honeypot: "",
          items: cart,
        }),
        { customerAccountId: null },
        { test: conversation.isTest, confirmedInChat: true },
      );
      const [orderRow] = await this.database
        .select({ id: schema.orders.id })
        .from(schema.orders)
        .where(eq(schema.orders.publicReference, order.publicReference))
        .limit(1);
      await this.database
        .update(schema.shopConversations)
        .set({
          cart: [],
          cartVersion: sql`${schema.shopConversations.cartVersion} + 1`,
          awaitingConfirmationVersion: null,
          lastOrderId: orderRow?.id ?? null,
          updatedAt: new Date(),
        })
        .where(eq(schema.shopConversations.id, conversation.id));
      return replies.orderPlaced(order.publicReference, locale);
    } catch (error) {
      if (error instanceof OrderCreationError) {
        await this.database
          .update(schema.shopConversations)
          .set({ awaitingConfirmationVersion: null, updatedAt: new Date() })
          .where(eq(schema.shopConversations.id, conversation.id));
        return replies.cartProblem(error.code, locale);
      }
      throw error;
    }
  }

  private async handOver(
    conversation: Conversation,
    locale: Locale,
  ): Promise<string> {
    await this.database
      .update(schema.shopConversations)
      .set({
        botPaused: true,
        humanRequestedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.shopConversations.id, conversation.id));
    return replies.humanHandoff(locale);
  }

  private async quote(cart: readonly AssistantCartLine[]) {
    if (!cart.length) return { ok: false as const, code: "empty_cart" };
    try {
      return {
        ok: true as const,
        quote: publicQuote(await priceCart(this.database, cart), "ar"),
      };
    } catch (error) {
      if (error instanceof CartPricingError)
        return { ok: false as const, code: error.code };
      throw error;
    }
  }

  private async writeCart(
    conversation: Conversation,
    cart: AssistantCartLine[],
  ) {
    const [updated] = await this.database
      .update(schema.shopConversations)
      .set({
        cart,
        cartVersion: sql`${schema.shopConversations.cartVersion} + 1`,
        // Any change to the cart needs a fresh summary and a fresh "yes".
        awaitingConfirmationVersion: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.shopConversations.id, conversation.id))
      .returning();
    return updated!;
  }

  private parseCart(value: unknown): AssistantCartLine[] {
    const parsed = assistantCartSchema.safeParse(value);
    return parsed.success ? parsed.data : [];
  }

  private async conversationFor(
    e164: string,
    test: boolean,
  ): Promise<Conversation> {
    await this.database
      .insert(schema.shopConversations)
      .values({ customerE164: e164, isTest: test })
      .onConflictDoNothing();
    const [row] = await this.database
      .select()
      .from(schema.shopConversations)
      .where(eq(schema.shopConversations.customerE164, e164))
      .limit(1);
    return row!;
  }

  private async reload(id: string): Promise<Conversation> {
    const [row] = await this.database
      .select()
      .from(schema.shopConversations)
      .where(eq(schema.shopConversations.id, id))
      .limit(1);
    return row!;
  }

  private async history(
    conversationId: string,
  ): Promise<AssistantTurnContext["history"]> {
    const rows = await this.database
      .select({
        direction: schema.shopMessages.direction,
        body: schema.shopMessages.body,
      })
      .from(schema.shopMessages)
      .where(eq(schema.shopMessages.conversationId, conversationId))
      .orderBy(desc(schema.shopMessages.createdAt))
      .limit(13);
    // The newest inbound message is passed separately as the prompt.
    return rows
      .slice(1)
      .reverse()
      .map((row) => ({
        role:
          row.direction === "in" ? ("user" as const) : ("assistant" as const),
        content: row.body,
      }));
  }

  private async overHourlyLimit(conversationId: string): Promise<boolean> {
    const [row] = await this.database
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.shopMessages)
      .where(
        and(
          eq(schema.shopMessages.conversationId, conversationId),
          eq(schema.shopMessages.direction, "out"),
          sql`${schema.shopMessages.createdAt} > now() - interval '1 hour'`,
        ),
      );
    return (row?.count ?? 0) >= MAX_REPLIES_PER_HOUR;
  }

  private async send(
    conversation: Conversation,
    sender: MessageSender,
    text: string,
    author: "assistant" | "owner" = "assistant",
  ) {
    let providerMessageId: string | null = null;
    let deliveryStatus = "sent";
    try {
      ({ providerMessageId } = await sender.sendText(
        conversation.customerE164,
        text,
      ));
    } catch {
      deliveryStatus = "failed";
    }
    await this.database.insert(schema.shopMessages).values({
      conversationId: conversation.id,
      direction: "out",
      author,
      body: text,
      provider: sender.provider,
      providerMessageId,
      deliveryStatus,
    });
  }

  async conversations(limit = 50) {
    return this.database
      .select()
      .from(schema.shopConversations)
      .orderBy(
        desc(schema.shopConversations.humanRequestedAt),
        desc(schema.shopConversations.updatedAt),
      )
      .limit(limit);
  }

  async conversation(id: string): Promise<Conversation | null> {
    const [row] = await this.database
      .select()
      .from(schema.shopConversations)
      .where(eq(schema.shopConversations.id, id))
      .limit(1);
    return row ?? null;
  }

  async messages(conversationId: string) {
    return this.database
      .select()
      .from(schema.shopMessages)
      .where(eq(schema.shopMessages.conversationId, conversationId))
      .orderBy(asc(schema.shopMessages.createdAt));
  }
}

/** Formats 32 hex characters as an RFC 4122 shaped UUID, as the checkout schema expects. */
function toUuid(value: string): string {
  const hex = value
    .replace(/[^0-9a-f]/g, "")
    .padEnd(32, "0")
    .slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
