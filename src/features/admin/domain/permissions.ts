import {
  AuthorizationError,
  type AdminActor,
  type AdminRole,
} from "./admin-actor";

export const permissions = [
  "stock.view",
  "stock.costs",
  "stock.adjust",
  "purchase.record",
  "purchase.import",
  "suppliers.manage",
  "suppliers.balances",
  "pricing.review",
  "sales.record",
  "payments.record",
  "customers.view",
  "ledger.correct",
  "reminders.manage",
  "reports.view",
  "settings.manage",
] as const;
export type Permission = (typeof permissions)[number];

const operatorPermissions: ReadonlySet<Permission> = new Set([
  "stock.view",
  "purchase.record",
  "suppliers.manage",
  "sales.record",
  "payments.record",
  "customers.view",
  "reminders.manage",
]);

export const permissionMatrix: Record<AdminRole, ReadonlySet<Permission>> = {
  owner: new Set(permissions),
  operator: operatorPermissions,
};

export function can(actor: AdminActor, permission: Permission): boolean {
  return actor.active && permissionMatrix[actor.role].has(permission);
}

export function assertPermission(
  actor: AdminActor,
  permission: Permission,
): void {
  if (!can(actor, permission)) throw new AuthorizationError();
}
