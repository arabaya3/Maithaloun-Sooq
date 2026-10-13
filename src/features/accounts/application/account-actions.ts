"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { customerAccountsEnabled } from "@/features/accounts/domain/account-config";
import { productRepository } from "@/features/catalog/infrastructure/product-repository";
import {
  WHATSAPP_COUNTRY_CODES,
  normalizeWhatsAppPhone,
  isSupportedWhatsAppE164,
} from "@/features/orders/domain/phone";
import { getMessages } from "@/i18n/server";

import {
  CustomerAccountError,
  type CustomerProfile,
} from "./customer-account-service";
import type { CustomerActor } from "./customer-auth-service";
import type { ReorderReview } from "./customer-orders-service";
import {
  customerAccountService,
  customerAuthService,
  customerFavoritesService,
  customerOrdersService,
} from "./customer-services";
import {
  clearCustomerSessionCookie,
  customerNetworkKey,
  getCustomerSession,
  isTrustedCustomerMutation,
  readCustomerSessionToken,
  writeCustomerSessionCookie,
} from "./customer-session";

type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };

// Actions post to the page URL, so the proxy's locale header applies here too.
async function errors() {
  return (await getMessages()).account.errors;
}

async function guard(): Promise<string | null> {
  if (!customerAccountsEnabled()) return (await errors()).unavailable;
  if (!(await isTrustedCustomerMutation())) return (await errors()).failed;
  return null;
}

async function requireCustomer(): Promise<
  { actor: CustomerActor; problem: null } | { actor: null; problem: string }
> {
  const problem = await guard();
  if (problem) return { actor: null, problem };
  const actor = await getCustomerSession();
  return actor
    ? { actor, problem: null }
    : { actor: null, problem: (await errors()).signedOut };
}

const phoneFormSchema = z.object({
  countryCode: z.enum(WHATSAPP_COUNTRY_CODES),
  nationalNumber: z.string().max(24),
});

export async function requestLoginCodeAction(
  input: unknown,
): Promise<Result<{ phoneE164: string }>> {
  const problem = await guard();
  if (problem) return { ok: false, message: problem };
  const parsed = phoneFormSchema.safeParse(input);
  const phoneE164 = parsed.success
    ? normalizeWhatsAppPhone(
        parsed.data.countryCode,
        parsed.data.nationalNumber,
      )
    : null;
  const text = await errors();
  if (!phoneE164) {
    return { ok: false, message: text.invalidPhone };
  }
  const result = await customerAuthService.requestCode(
    phoneE164,
    await customerNetworkKey(),
  );
  if (result === "unavailable") {
    return { ok: false, message: text.unavailable };
  }
  if (result === "rate_limited") {
    return { ok: false, message: text.tooManyCodes };
  }
  return { ok: true, phoneE164 };
}

const verifySchema = z.object({
  phoneE164: z.string().refine(isSupportedWhatsAppE164),
  code: z.string().trim(),
});

export async function verifyLoginCodeAction(
  input: unknown,
): Promise<Result<{ created: boolean }>> {
  const problem = await guard();
  if (problem) return { ok: false, message: problem };
  const parsed = verifySchema.safeParse(input);
  const text = await errors();
  if (!parsed.success) {
    return { ok: false, message: text.invalidCode };
  }
  const result = await customerAuthService.verifyCode({
    phoneE164: parsed.data.phoneE164,
    code: parsed.data.code,
    networkKey: await customerNetworkKey(),
    previousToken: await readCustomerSessionToken(),
  });
  if (result.status === "verified") {
    await writeCustomerSessionCookie(result.rawToken);
    revalidatePath("/", "layout");
    return { ok: true, created: result.created };
  }
  const messages = {
    invalid: text.invalidCode,
    rate_limited: text.tooManyAttempts,
    unavailable: text.unavailable,
  } as const;
  return { ok: false, message: messages[result.status] };
}

export async function logoutAction(scope: "this" | "all"): Promise<Result> {
  const { actor, problem } = await requireCustomer();
  if (!actor) return { ok: false, message: problem };
  const token = await readCustomerSessionToken();
  if (scope === "all") await customerAuthService.logoutAll(actor.id);
  else if (token) await customerAuthService.logout(token);
  await clearCustomerSessionCookie();
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function loadProfileAction(): Promise<
  Result<{ profile: CustomerProfile }>
> {
  const { actor, problem } = await requireCustomer();
  if (!actor) return { ok: false, message: problem };
  return { ok: true, profile: await customerAccountService.profile(actor.id) };
}

async function accountError(
  error: unknown,
): Promise<{ ok: false; message: string }> {
  const text = await errors();
  if (error instanceof CustomerAccountError) {
    const messages = {
      not_found: text.signedOut,
      invalid_input: text.invalidInput,
      address_limit: text.addressLimit,
    } as const;
    return { ok: false, message: messages[error.code] };
  }
  return { ok: false, message: text.failed };
}

export async function updateProfileAction(input: unknown): Promise<Result> {
  const { actor, problem } = await requireCustomer();
  if (!actor) return { ok: false, message: problem };
  try {
    await customerAccountService.updateProfile(actor.id, input);
    revalidatePath("/account");
    return { ok: true };
  } catch (error) {
    return accountError(error);
  }
}

export async function saveAddressAction(
  input: unknown,
  addressId?: string,
): Promise<Result> {
  const { actor, problem } = await requireCustomer();
  if (!actor) return { ok: false, message: problem };
  if (addressId !== undefined && !z.uuid().safeParse(addressId).success) {
    return { ok: false, message: (await errors()).failed };
  }
  try {
    await customerAccountService.saveAddress(actor.id, input, addressId);
    revalidatePath("/account");
    return { ok: true };
  } catch (error) {
    return accountError(error);
  }
}

export async function deleteAddressAction(addressId: string): Promise<Result> {
  const { actor, problem } = await requireCustomer();
  if (!actor) return { ok: false, message: problem };
  if (!z.uuid().safeParse(addressId).success) {
    return { ok: false, message: (await errors()).failed };
  }
  await customerAccountService.deleteAddress(actor.id, addressId);
  revalidatePath("/account");
  return { ok: true };
}

export async function deleteAccountAction(
  confirmation: string,
): Promise<Result> {
  const { actor, problem } = await requireCustomer();
  if (!actor) return { ok: false, message: problem };
  const { account } = await getMessages();
  // The Arabic word is always accepted; English adds its own, case-insensitive.
  const typed = confirmation.trim();
  if (
    typed !== "حذف" &&
    typed.toLowerCase() !== account.deleteWord.toLowerCase()
  ) {
    return { ok: false, message: account.errors.confirmDelete };
  }
  try {
    await customerAccountService.deleteAccount(actor.id);
  } catch (error) {
    return accountError(error);
  }
  await clearCustomerSessionCookie();
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function setFavoriteAction(
  productId: string,
  favorite: boolean,
): Promise<Result> {
  const { actor, problem } = await requireCustomer();
  if (!actor) return { ok: false, message: problem };
  const saved = await customerFavoritesService.set(
    actor.id,
    productId,
    favorite,
  );
  return saved ? { ok: true } : { ok: false, message: (await errors()).failed };
}

export async function mergeFavoritesAction(
  productIds: unknown,
): Promise<Result<{ added: number; productIds: string[] }>> {
  const { actor, problem } = await requireCustomer();
  if (!actor) return { ok: false, message: problem };
  const { added } = await customerFavoritesService.merge(actor.id, productIds);
  return {
    ok: true,
    added,
    productIds: await customerFavoritesService.list(actor.id),
  };
}

export async function claimOrdersAction(): Promise<
  Result<{ claimed: number }>
> {
  const { actor, problem } = await requireCustomer();
  if (!actor) return { ok: false, message: problem };
  const claimed = await customerOrdersService.claim(actor.id, actor.phoneE164);
  revalidatePath("/account/orders");
  return { ok: true, claimed };
}

export async function reorderReviewAction(
  publicReference: string,
): Promise<Result<{ review: ReorderReview }>> {
  const { actor, problem } = await requireCustomer();
  if (!actor) return { ok: false, message: problem };
  if (!/^MS-[A-Za-z0-9_-]{24}$/.test(publicReference)) {
    return { ok: false, message: (await errors()).orderMissing };
  }
  const review = await customerOrdersService.reorderReview(
    actor.id,
    publicReference,
    await productRepository.list(),
  );
  return review
    ? { ok: true, review }
    : { ok: false, message: (await errors()).orderMissing };
}
