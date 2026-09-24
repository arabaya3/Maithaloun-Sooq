export const ACTIVE_SERVICE_AREA_CODE = "maythalun" as const;
export const ACTIVE_SERVICE_AREA_NAME_AR = "ميثلون" as const;
export const FREE_DELIVERY_THRESHOLD_AGOROT = 5000;
export const STANDARD_DELIVERY_FEE_AGOROT = 500;

export function calculateDeliveryFeeAgorot(
  merchandiseSubtotalAgorot: number,
): number {
  if (
    !Number.isInteger(merchandiseSubtotalAgorot) ||
    merchandiseSubtotalAgorot < 0
  ) {
    throw new RangeError("Invalid merchandise subtotal");
  }

  return merchandiseSubtotalAgorot >= FREE_DELIVERY_THRESHOLD_AGOROT
    ? 0
    : STANDARD_DELIVERY_FEE_AGOROT;
}

export function amountUntilFreeDeliveryAgorot(
  merchandiseSubtotalAgorot: number,
): number {
  if (
    !Number.isInteger(merchandiseSubtotalAgorot) ||
    merchandiseSubtotalAgorot < 0
  ) {
    throw new RangeError("Invalid merchandise subtotal");
  }

  if (merchandiseSubtotalAgorot >= FREE_DELIVERY_THRESHOLD_AGOROT) {
    return 0;
  }

  return FREE_DELIVERY_THRESHOLD_AGOROT - merchandiseSubtotalAgorot;
}

export function isActiveServiceAreaCode(code: string): boolean {
  return code === ACTIVE_SERVICE_AREA_CODE;
}
