"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireTrustedAdminMutation } from "@/features/admin/auth/admin-session";
import { AuthorizationError } from "@/features/admin/domain/admin-actor";
import { parseUnitsPerSale } from "@/features/catalog/domain/selling-unit";
import { parseIlsToAgorot } from "@/shared/lib/parse-ils";

import { sellingUnitService } from "./admin-services";
import {
  SellingUnitError,
  sellingUnitErrorMessages,
  type SellingUnitErrorCode,
} from "./selling-unit-service";

export type SellingUnitField =
  "labelAr" | "unitsPerSale" | "price" | "sku" | "barcode";

export type SellingUnitActionResult =
  { ok: true } | { ok: false; message: string; field?: SellingUnitField };

const fieldOf: Partial<Record<SellingUnitErrorCode, SellingUnitField>> = {
  invalid_label: "labelAr",
  duplicate_label: "labelAr",
  invalid_units: "unitsPerSale",
  duplicate_units: "unitsPerSale",
  invalid_price: "price",
  duplicate_sku: "sku",
  duplicate_barcode: "barcode",
};

const productId = z.string().regex(/^[a-z0-9-]{1,80}$/);
const variantId = z.string().regex(/^[a-z0-9-]{1,100}$/);
const version = z.number().int().positive();

async function run(
  productDomainId: string,
  action: () => Promise<unknown>,
): Promise<SellingUnitActionResult> {
  try {
    await action();
  } catch (error) {
    if (error instanceof SellingUnitError) {
      return {
        ok: false,
        message: sellingUnitErrorMessages[error.code],
        field: fieldOf[error.code],
      };
    }
    if (error instanceof AuthorizationError) {
      return { ok: false, message: "هذا الإجراء للمالك فقط." };
    }
    if (error instanceof z.ZodError) {
      return { ok: false, message: "البيانات غير صالحة. حدّث الصفحة." };
    }
    return { ok: false, message: "تعذّر الحفظ. حاول مرة أخرى." };
  }
  revalidatePath(`/admin/products/${productDomainId}`);
  revalidatePath("/", "layout");
  return { ok: true };
}

// The typed values are parsed here so the owner gets the exact Arabic message for each field.
function parseFields(input: {
  labelAr: string;
  unitsPerSale: string;
  price: string;
  sku: string;
  barcode: string;
}) {
  const unitsPerSale = parseUnitsPerSale(input.unitsPerSale);
  if (unitsPerSale === null) throw new SellingUnitError("invalid_units");
  const priceAgorot = parseIlsToAgorot(input.price);
  if (priceAgorot === null || priceAgorot <= 0) {
    throw new SellingUnitError("invalid_price");
  }
  return {
    labelAr: input.labelAr,
    unitsPerSale,
    priceAgorot,
    sku: input.sku,
    barcode: input.barcode,
  };
}

export async function createSellingUnitAction(input: {
  productDomainId: string;
  variantDomainId: string;
  labelAr: string;
  unitsPerSale: string;
  price: string;
  sku: string;
  barcode: string;
  isDefault: boolean;
}): Promise<SellingUnitActionResult> {
  const actor = await requireTrustedAdminMutation();
  const domainId = productId.parse(input.productDomainId);
  return run(domainId, async () => {
    const fields = parseFields(input);
    await sellingUnitService.create(
      actor,
      variantId.parse(input.variantDomainId),
      { ...fields, isDefault: input.isDefault === true },
    );
  });
}

export async function updateSellingUnitAction(input: {
  productDomainId: string;
  unitId: string;
  version: number;
  labelAr: string;
  unitsPerSale: string;
  price: string;
  sku: string;
  barcode: string;
}): Promise<SellingUnitActionResult> {
  const actor = await requireTrustedAdminMutation();
  const domainId = productId.parse(input.productDomainId);
  return run(domainId, async () => {
    const fields = parseFields(input);
    await sellingUnitService.update(
      actor,
      z.uuid().parse(input.unitId),
      version.parse(input.version),
      fields,
    );
  });
}

export async function sellingUnitStateAction(input: {
  productDomainId: string;
  unitId: string;
  version: number;
  action: "default" | "archive" | "restore" | "delete";
}): Promise<SellingUnitActionResult> {
  const actor = await requireTrustedAdminMutation();
  const domainId = productId.parse(input.productDomainId);
  const unitId = z.uuid().parse(input.unitId);
  const expected = version.parse(input.version);
  return run(domainId, async () => {
    if (input.action === "default")
      await sellingUnitService.setDefault(actor, unitId, expected);
    else if (input.action === "archive")
      await sellingUnitService.setArchived(actor, unitId, expected, true);
    else if (input.action === "restore")
      await sellingUnitService.setArchived(actor, unitId, expected, false);
    else if (input.action === "delete")
      await sellingUnitService.delete(actor, unitId, expected);
    else throw new z.ZodError([]);
  });
}
