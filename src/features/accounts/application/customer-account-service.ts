import "server-only";

import { and, asc, count, desc, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";

import { MAX_SAVED_ADDRESSES } from "@/features/accounts/domain/account-config";
import { isSupportedWhatsAppE164 } from "@/features/orders/domain/phone";
import * as schema from "@/server/db/schema";

type Database = PostgresJsDatabase<typeof schema>;

export class CustomerAccountError extends Error {
  constructor(readonly code: "not_found" | "invalid_input" | "address_limit") {
    super(code);
  }
}

export const profileInputSchema = z.object({
  displayName: z.string().trim().max(100).optional(),
  whatsappE164: z
    .string()
    .refine(isSupportedWhatsAppE164)
    .nullable()
    .optional(),
  personalizationEnabled: z.boolean().optional(),
});

export const addressInputSchema = z.object({
  label: z.string().trim().min(1).max(40),
  address: z.string().trim().min(5).max(500),
  landmark: z.string().trim().max(150).optional(),
  isDefault: z.boolean().default(false),
});

export interface CustomerAddress {
  id: string;
  label: string;
  address: string;
  landmark: string | null;
  isDefault: boolean;
}

export interface CustomerProfile {
  id: string;
  phoneE164: string;
  displayName: string | null;
  whatsappE164: string | null;
  personalizationEnabled: boolean;
  addresses: CustomerAddress[];
}

export class CustomerAccountService {
  constructor(private readonly database: Database) {}

  async profile(accountId: string): Promise<CustomerProfile> {
    const [account] = await this.database
      .select()
      .from(schema.customerAccounts)
      .where(
        and(
          eq(schema.customerAccounts.id, accountId),
          isNull(schema.customerAccounts.deletedAt),
        ),
      );
    if (!account?.phoneE164) throw new CustomerAccountError("not_found");
    const addresses = await this.database
      .select({
        id: schema.customerAddresses.id,
        label: schema.customerAddresses.label,
        address: schema.customerAddresses.address,
        landmark: schema.customerAddresses.landmark,
        isDefault: schema.customerAddresses.isDefault,
      })
      .from(schema.customerAddresses)
      .where(eq(schema.customerAddresses.accountId, accountId))
      .orderBy(
        desc(schema.customerAddresses.isDefault),
        asc(schema.customerAddresses.createdAt),
      );
    return {
      id: account.id,
      phoneE164: account.phoneE164,
      displayName: account.displayName,
      whatsappE164: account.whatsappE164,
      personalizationEnabled: account.personalizationEnabled,
      addresses,
    };
  }

  async updateProfile(accountId: string, input: unknown): Promise<void> {
    const parsed = profileInputSchema.safeParse(input);
    if (!parsed.success) throw new CustomerAccountError("invalid_input");
    const { displayName, whatsappE164, personalizationEnabled } = parsed.data;
    await this.database.transaction(async (transaction) => {
      const updated = await transaction
        .update(schema.customerAccounts)
        .set({
          ...(displayName === undefined
            ? {}
            : { displayName: displayName || null }),
          ...(whatsappE164 === undefined ? {} : { whatsappE164 }),
          ...(personalizationEnabled === undefined
            ? {}
            : { personalizationEnabled }),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.customerAccounts.id, accountId),
            isNull(schema.customerAccounts.deletedAt),
          ),
        )
        .returning({ id: schema.customerAccounts.id });
      if (!updated.length) throw new CustomerAccountError("not_found");
      await transaction.insert(schema.customerAccountEvents).values({
        accountId,
        type: "profile_updated",
        detail: {
          name: displayName !== undefined,
          whatsapp: whatsappE164 !== undefined,
          personalization: personalizationEnabled ?? "unchanged",
        },
      });
    });
  }

  async saveAddress(
    accountId: string,
    input: unknown,
    addressId?: string,
  ): Promise<void> {
    const parsed = addressInputSchema.safeParse(input);
    if (!parsed.success) throw new CustomerAccountError("invalid_input");
    const value = parsed.data;
    await this.database.transaction(async (transaction) => {
      await transaction
        .select({ id: schema.customerAccounts.id })
        .from(schema.customerAccounts)
        .where(eq(schema.customerAccounts.id, accountId))
        .for("update");
      const [{ total } = { total: 0 }] = await transaction
        .select({ total: count() })
        .from(schema.customerAddresses)
        .where(eq(schema.customerAddresses.accountId, accountId));
      if (!addressId && total >= MAX_SAVED_ADDRESSES) {
        throw new CustomerAccountError("address_limit");
      }
      const isDefault = value.isDefault || total === 0;
      if (isDefault) {
        await transaction
          .update(schema.customerAddresses)
          .set({ isDefault: false })
          .where(eq(schema.customerAddresses.accountId, accountId));
      }
      const fields = {
        label: value.label,
        address: value.address,
        landmark: value.landmark || null,
        isDefault,
        updatedAt: new Date(),
      };
      if (addressId) {
        const updated = await transaction
          .update(schema.customerAddresses)
          .set(fields)
          .where(
            and(
              eq(schema.customerAddresses.id, addressId),
              eq(schema.customerAddresses.accountId, accountId),
            ),
          )
          .returning({ id: schema.customerAddresses.id });
        if (!updated.length) throw new CustomerAccountError("not_found");
      } else {
        await transaction
          .insert(schema.customerAddresses)
          .values({ accountId, ...fields });
      }
    });
  }

  async deleteAddress(accountId: string, addressId: string): Promise<void> {
    await this.database
      .delete(schema.customerAddresses)
      .where(
        and(
          eq(schema.customerAddresses.id, addressId),
          eq(schema.customerAddresses.accountId, accountId),
        ),
      );
  }

  // Orders stay for financial records; the account's personal data, sessions and links go.
  async deleteAccount(accountId: string, now = new Date()): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const [account] = await transaction
        .select({ id: schema.customerAccounts.id })
        .from(schema.customerAccounts)
        .where(
          and(
            eq(schema.customerAccounts.id, accountId),
            isNull(schema.customerAccounts.deletedAt),
          ),
        )
        .for("update");
      if (!account) throw new CustomerAccountError("not_found");
      const links = await transaction
        .delete(schema.customerOrderLinks)
        .where(eq(schema.customerOrderLinks.accountId, accountId))
        .returning({ orderId: schema.customerOrderLinks.orderId });
      await transaction
        .delete(schema.customerFavorites)
        .where(eq(schema.customerFavorites.accountId, accountId));
      await transaction
        .delete(schema.customerAddresses)
        .where(eq(schema.customerAddresses.accountId, accountId));
      await transaction
        .delete(schema.customerSessions)
        .where(eq(schema.customerSessions.accountId, accountId));
      await transaction
        .update(schema.customerAccounts)
        .set({
          phoneE164: null,
          displayName: null,
          whatsappE164: null,
          personalizationEnabled: false,
          deletedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.customerAccounts.id, accountId));
      await transaction.insert(schema.customerAccountEvents).values({
        accountId,
        type: "account_deleted",
        detail: { ordersRetained: links.length },
      });
    });
  }
}
