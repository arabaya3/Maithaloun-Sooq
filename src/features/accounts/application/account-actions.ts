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

const UNAVAILABLE = "تسجيل الدخول غير متاح حالياً. يمكنك متابعة الطلب كضيف.";
const SIGNED_OUT = "انتهت الجلسة. سجّل الدخول من جديد.";
const FAILED = "تعذّر حفظ التغيير. حاول مرة أخرى.";

async function guard(): Promise<string | null> {
  if (!customerAccountsEnabled()) return UNAVAILABLE;
  if (!(await isTrustedCustomerMutation())) return FAILED;
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
    : { actor: null, problem: SIGNED_OUT };
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
  if (!phoneE164) {
    return { ok: false, message: "اكتب رقم جوال صحيح يبدأ بـ 05." };
  }
  const result = await customerAuthService.requestCode(
    phoneE164,
    await customerNetworkKey(),
  );
  if (result === "unavailable") return { ok: false, message: UNAVAILABLE };
  if (result === "rate_limited") {
    return {
      ok: false,
      message: "طلبت رموزاً كثيرة. انتظر قليلاً ثم حاول مرة أخرى.",
    };
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
  if (!parsed.success) {
    return { ok: false, message: "الرمز غير صحيح أو انتهت صلاحيته." };
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
    invalid: "الرمز غير صحيح أو انتهت صلاحيته.",
    rate_limited: "محاولات كثيرة. انتظر قليلاً ثم اطلب رمزاً جديداً.",
    unavailable: UNAVAILABLE,
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

function accountError(error: unknown): { ok: false; message: string } {
  if (error instanceof CustomerAccountError) {
    const messages = {
      not_found: SIGNED_OUT,
      invalid_input: "راجع الحقول المطلوبة.",
      address_limit: "يمكن حفظ 5 عناوين كحد أقصى.",
    } as const;
    return { ok: false, message: messages[error.code] };
  }
  return { ok: false, message: FAILED };
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
    return { ok: false, message: FAILED };
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
    return { ok: false, message: FAILED };
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
  if (confirmation.trim() !== "حذف") {
    return { ok: false, message: "اكتب كلمة «حذف» لتأكيد حذف الحساب." };
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
  return saved ? { ok: true } : { ok: false, message: FAILED };
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
    return { ok: false, message: "الطلب غير موجود." };
  }
  const review = await customerOrdersService.reorderReview(
    actor.id,
    publicReference,
    await productRepository.list(),
  );
  return review
    ? { ok: true, review }
    : { ok: false, message: "الطلب غير موجود." };
}
