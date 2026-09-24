export const auditActionTypes = [
  "login",
  "logout",
  "password_change",
  "product_create",
  "product_update",
  "product_variant_create",
  "product_variant_update",
  "product_variant_deactivate",
  "product_specification_create",
  "product_specification_update",
  "product_specification_remove",
  "service_area_update",
  "order_status_change",
] as const;

export type AuditActionType = (typeof auditActionTypes)[number];

export const auditEntityTypes = [
  "admin_user",
  "product",
  "product_variant",
  "product_specification",
  "service_area",
  "order",
] as const;

export type AuditEntityType = (typeof auditEntityTypes)[number];

export type AuditState = Record<string, string | number | boolean | null>;

export function redactProductAuditState(input: {
  domainId: string;
  slug: string;
  nameAr: string;
  latinName: string | null;
  priceAgorot: number;
  categoryId: string;
  availability: string;
  sortOrder: number;
  detailsStatus: string;
  unit: string | null;
  placeholderVariant: string | null;
}): AuditState {
  return {
    domainId: input.domainId,
    slug: input.slug,
    nameAr: input.nameAr,
    latinName: input.latinName,
    priceAgorot: input.priceAgorot,
    categoryId: input.categoryId,
    availability: input.availability,
    sortOrder: input.sortOrder,
    detailsStatus: input.detailsStatus,
    unit: input.unit,
    placeholderVariant: input.placeholderVariant,
  };
}

export function redactProductVariantAuditState(input: {
  domainId: string;
  labelAr: string;
  priceAgorot: number;
  availability: string;
  sortOrder: number;
  isDefault: boolean;
  imageKind: string;
  placeholderVariant: string | null;
  imageSrc: string | null;
  attributes: Record<string, string>;
}): AuditState {
  const attributeKeys = Object.keys(input.attributes).sort().join(",");
  return {
    domainId: input.domainId,
    labelAr: input.labelAr,
    priceAgorot: input.priceAgorot,
    availability: input.availability,
    sortOrder: input.sortOrder,
    isDefault: input.isDefault,
    imageKind: input.imageKind,
    placeholderVariant: input.placeholderVariant,
    hasImageSrc: Boolean(input.imageSrc),
    attributeKeys: attributeKeys || null,
  };
}

export function redactProductSpecificationAuditState(input: {
  id: string;
  labelAr: string;
  valueAr: string;
  sortOrder: number;
}): AuditState {
  return {
    id: input.id,
    labelAr: input.labelAr,
    valueAr: input.valueAr,
    sortOrder: input.sortOrder,
  };
}

export function redactServiceAreaAuditState(input: {
  code: string;
  enabled: boolean;
  sortOrder: number;
  deliveryFeeAgorot: number | null;
}): AuditState {
  return {
    code: input.code,
    enabled: input.enabled,
    sortOrder: input.sortOrder,
    deliveryFeeAgorot: input.deliveryFeeAgorot,
  };
}

export function redactOrderStatusAuditState(input: {
  publicReference: string;
  status: string;
  version: number;
}): AuditState {
  return {
    publicReference: input.publicReference,
    status: input.status,
    version: input.version,
  };
}

export function assertSafeAuditState(state: AuditState | null): void {
  if (!state) return;
  const forbidden = [
    "password",
    "passwordHash",
    "token",
    "session",
    "address",
    "customerNote",
    "customerName",
    "customerFullName",
    "deliveryAddress",
    "landmark",
    "phone",
    "normalizedPhone",
    "whatsappPhone",
    "whatsappNational",
    "idempotencyKey",
    "requestFingerprint",
    "DATABASE_URL",
  ];
  for (const key of Object.keys(state)) {
    if (
      forbidden.some((item) => key.toLowerCase().includes(item.toLowerCase()))
    ) {
      throw new Error("UNSAFE_AUDIT_STATE");
    }
  }
}
