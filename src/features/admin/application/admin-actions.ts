"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  clearAdminSessionCookie,
  getLoginRedirectTarget,
  getTrustedNetworkKey,
  readAdminSessionToken,
  requireTrustedAdminMutation,
  writeAdminSessionCookie,
} from "@/features/admin/auth/admin-session";
import { LOGIN_FAILURE_MESSAGE } from "@/features/admin/auth/login-policy";
import { loginService } from "@/features/admin/auth/login-service-instance";
import {
  isTrustedMutationOrigin,
  isTrustedMutationSite,
} from "@/features/admin/auth/trusted-origin";
import { getServerEnv } from "@/server/env/env";
import { adminSessionService } from "@/features/admin/auth/session-service-instance";
import {
  adminCatalogService,
  adminDeliveryService,
  adminOrderService,
} from "@/features/admin/application/admin-services";
import {
  mapDeliveryAdminError,
  mapOrderAdminError,
  mapProductAdminError,
} from "@/features/admin/application/admin-action-errors";
import { isOrderStatus } from "@/features/orders/domain/order-status";
import { parseIlsToAgorot } from "@/shared/lib/parse-ils";
import { db } from "@/server/db/db";
import { adminAuditEvents } from "@/server/db/schema";

export async function loginAction(
  formData: FormData,
): Promise<{ ok: false; message: string }> {
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  const honeypot = String(formData.get("website") ?? "");
  const nextPath = getLoginRedirectTarget(String(formData.get("next") ?? ""));
  const encoded = new TextEncoder().encode(`${username}${password}${honeypot}`);
  const requestHeaders = await headers();
  const { APP_ORIGIN } = getServerEnv();
  if (
    !isTrustedMutationOrigin(requestHeaders.get("origin"), APP_ORIGIN) ||
    !isTrustedMutationSite(requestHeaders.get("sec-fetch-site"))
  ) {
    return { ok: false, message: LOGIN_FAILURE_MESSAGE };
  }

  const result = await loginService.login({
    username,
    password,
    honeypot,
    requestSize: encoded.byteLength,
    networkKey: getTrustedNetworkKey(requestHeaders),
    currentToken: await readAdminSessionToken(),
  });

  if (!result.ok) {
    return { ok: false, message: LOGIN_FAILURE_MESSAGE };
  }

  await writeAdminSessionCookie(result.rawToken);
  redirect(nextPath);
}

export async function logoutAction(): Promise<void> {
  const actor = await requireTrustedAdminMutation();
  const token = await readAdminSessionToken();
  if (token) {
    await adminSessionService.revokeByToken(token);
  }
  await db.insert(adminAuditEvents).values({
    adminUserId: actor.id,
    actionType: "logout",
    entityType: "admin_user",
    entityId: actor.username,
    beforeState: { username: actor.username },
    afterState: null,
  });
  await clearAdminSessionCookie();
  redirect("/admin/login");
}

export async function updateOrderStatusAction(
  formData: FormData,
): Promise<{ ok: false; message: string } | null> {
  const actor = await requireTrustedAdminMutation();
  const publicReference = String(formData.get("publicReference") ?? "");
  const nextStatus = String(formData.get("nextStatus") ?? "");
  const expectedVersion = Number(formData.get("expectedVersion"));
  const reason = String(formData.get("reason") ?? "");
  if (!isOrderStatus(nextStatus)) {
    return { ok: false, message: "تعذّر تحديث حالة الطلب." };
  }

  try {
    await adminOrderService.changeStatus(actor, {
      publicReference,
      nextStatus,
      expectedVersion,
      reason,
    });
  } catch (error) {
    return { ok: false, message: mapOrderAdminError(error) };
  }

  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/orders/${publicReference}`);
  redirect(`/admin/orders/${publicReference}`);
}

export async function updateProductAction(
  formData: FormData,
): Promise<{ ok: false; message: string } | null> {
  const actor = await requireTrustedAdminMutation();
  const domainId = String(formData.get("domainId") ?? "");
  const priceAgorot = parseIlsToAgorot(String(formData.get("priceIls") ?? ""));
  if (priceAgorot === null || priceAgorot <= 0) {
    return { ok: false, message: "أدخل سعراً صالحاً بالشيكل." };
  }

  let slug: string;
  try {
    ({ slug } = await adminCatalogService.update(actor, {
      domainId,
      nameAr: String(formData.get("nameAr") ?? ""),
      latinName: optional(formData.get("latinName")),
      priceAgorot,
      categoryId: String(formData.get("categoryId") ?? "") as never,
      availability: String(formData.get("availability") ?? "") as never,
      sortOrder: Number(formData.get("sortOrder")),
      description: optional(formData.get("description")),
      usageNotes: optional(formData.get("usageNotes")),
      unit: optional(formData.get("unit")),
      detailsStatus: String(formData.get("detailsStatus") ?? "") as never,
      placeholderVariant: String(
        formData.get("placeholderVariant") ?? "",
      ) as never,
    }));
  } catch (error) {
    return { ok: false, message: mapProductAdminError(error) };
  }

  revalidatePath("/");
  revalidatePath("/cart");
  revalidatePath("/checkout");
  revalidatePath(`/products/${slug}`);
  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${domainId}`);
  redirect(`/admin/products/${domainId}`);
}

export async function createProductAction(
  formData: FormData,
): Promise<{ ok: false; message: string } | null> {
  const actor = await requireTrustedAdminMutation();
  const domainId = String(formData.get("domainId") ?? "");
  const priceAgorot = parseIlsToAgorot(String(formData.get("priceIls") ?? ""));
  if (priceAgorot === null || priceAgorot <= 0) {
    return { ok: false, message: "أدخل سعراً صالحاً بالشيكل." };
  }

  try {
    await adminCatalogService.create(actor, {
      domainId,
      slug: String(formData.get("slug") ?? ""),
      nameAr: String(formData.get("nameAr") ?? ""),
      latinName: optional(formData.get("latinName")),
      priceAgorot,
      categoryId: String(formData.get("categoryId") ?? "") as never,
      availability: "unavailable",
      sortOrder: Number(formData.get("sortOrder")),
      description: optional(formData.get("description")),
      usageNotes: optional(formData.get("usageNotes")),
      unit: optional(formData.get("unit")),
      detailsStatus: String(formData.get("detailsStatus") ?? "") as never,
      placeholderVariant: String(
        formData.get("placeholderVariant") ?? "",
      ) as never,
    });
  } catch (error) {
    return { ok: false, message: mapProductAdminError(error) };
  }

  revalidatePath("/");
  revalidatePath("/admin/products");
  redirect(`/admin/products/${domainId}`);
}

export async function updateServiceAreaAction(
  formData: FormData,
): Promise<{ ok: false; message: string } | null> {
  const actor = await requireTrustedAdminMutation();
  const code = String(formData.get("code") ?? "");
  const feeMode = String(formData.get("feeMode") ?? "");
  const deliveryFeeAgorot =
    feeMode === "unknown"
      ? null
      : parseIlsToAgorot(String(formData.get("deliveryFeeIls") ?? ""));
  if (feeMode !== "unknown" && deliveryFeeAgorot === null) {
    return {
      ok: false,
      message: "أدخل تكلفة توصيل صالحة أو اتركها غير معروفة.",
    };
  }

  try {
    await adminDeliveryService.update(actor, {
      code,
      enabled: String(formData.get("enabled") ?? "") === "true",
      sortOrder: Number(formData.get("sortOrder")),
      deliveryFeeAgorot,
    });
  } catch (error) {
    return {
      ok: false,
      message: mapDeliveryAdminError(error),
    };
  }

  revalidatePath("/");
  revalidatePath("/checkout");
  revalidatePath("/admin/delivery-areas");
  redirect("/admin/delivery-areas");
}

export async function upsertProductVariantAction(
  formData: FormData,
): Promise<{ ok: false; message: string } | null> {
  const actor = await requireTrustedAdminMutation();
  const productDomainId = String(formData.get("productDomainId") ?? "");
  const priceAgorot = parseIlsToAgorot(String(formData.get("priceIls") ?? ""));
  if (priceAgorot === null || priceAgorot < 0) {
    return { ok: false, message: "أدخل سعراً صالحاً بالشيكل." };
  }

  const attributeKeys = formData.getAll("attrKey").map(String);
  const attributeValues = formData.getAll("attrValue").map(String);
  const attributes = attributeKeys
    .map((key, index) => ({
      key: key.trim(),
      value: (attributeValues[index] ?? "").trim(),
    }))
    .filter((pair) => pair.key && pair.value);

  const imageMode = String(formData.get("imageMode") ?? "placeholder");
  const imageWidthRaw = String(formData.get("imageWidth") ?? "").trim();
  const imageHeightRaw = String(formData.get("imageHeight") ?? "").trim();

  try {
    await adminCatalogService.upsertVariant(actor, {
      productDomainId,
      variantDomainId: String(formData.get("variantDomainId") ?? ""),
      labelAr: String(formData.get("labelAr") ?? ""),
      attributes,
      priceAgorot,
      availability: String(formData.get("availability") ?? "") as never,
      sortOrder: Number(formData.get("sortOrder")),
      isDefault: String(formData.get("isDefault") ?? "") === "true",
      imageMode: imageMode as "placeholder" | "image",
      placeholderVariant:
        imageMode === "placeholder"
          ? (String(formData.get("placeholderVariant") ?? "") as never)
          : undefined,
      imageSrc:
        imageMode === "image" ? optional(formData.get("imageSrc")) : undefined,
      imageAlt:
        imageMode === "image" ? optional(formData.get("imageAlt")) : undefined,
      imageWidth:
        imageMode === "image" && imageWidthRaw
          ? Number(imageWidthRaw)
          : undefined,
      imageHeight:
        imageMode === "image" && imageHeightRaw
          ? Number(imageHeightRaw)
          : undefined,
    });
  } catch (error) {
    return { ok: false, message: mapProductAdminError(error) };
  }

  revalidatePath("/");
  revalidatePath("/cart");
  revalidatePath("/checkout");
  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${productDomainId}`);
  redirect(`/admin/products/${productDomainId}`);
}

export async function deactivateProductVariantAction(
  formData: FormData,
): Promise<{ ok: false; message: string } | null> {
  const actor = await requireTrustedAdminMutation();
  const productDomainId = String(formData.get("productDomainId") ?? "");

  try {
    await adminCatalogService.deactivateVariant(actor, {
      productDomainId,
      variantDomainId: String(formData.get("variantDomainId") ?? ""),
    });
  } catch (error) {
    return { ok: false, message: mapProductAdminError(error) };
  }

  revalidatePath("/");
  revalidatePath("/cart");
  revalidatePath("/checkout");
  revalidatePath("/admin/products");
  revalidatePath(`/admin/products/${productDomainId}`);
  redirect(`/admin/products/${productDomainId}`);
}

export async function upsertProductSpecificationAction(
  formData: FormData,
): Promise<{ ok: false; message: string } | null> {
  const actor = await requireTrustedAdminMutation();
  const productDomainId = String(formData.get("productDomainId") ?? "");
  const specificationId = optional(formData.get("specificationId"));

  try {
    await adminCatalogService.upsertSpecification(actor, {
      productDomainId,
      specificationId,
      labelAr: String(formData.get("labelAr") ?? ""),
      valueAr: String(formData.get("valueAr") ?? ""),
      sortOrder: Number(formData.get("sortOrder")),
    });
  } catch (error) {
    return { ok: false, message: mapProductAdminError(error) };
  }

  revalidatePath("/");
  revalidatePath(`/admin/products/${productDomainId}`);
  redirect(`/admin/products/${productDomainId}`);
}

export async function removeProductSpecificationAction(
  formData: FormData,
): Promise<{ ok: false; message: string } | null> {
  const actor = await requireTrustedAdminMutation();
  const productDomainId = String(formData.get("productDomainId") ?? "");

  try {
    await adminCatalogService.removeSpecification(actor, {
      productDomainId,
      specificationId: String(formData.get("specificationId") ?? ""),
    });
  } catch (error) {
    return { ok: false, message: mapProductAdminError(error) };
  }

  revalidatePath("/");
  revalidatePath(`/admin/products/${productDomainId}`);
  redirect(`/admin/products/${productDomainId}`);
}

function optional(value: FormDataEntryValue | null): string | undefined {
  const text = String(value ?? "").trim();
  return text ? text : undefined;
}
