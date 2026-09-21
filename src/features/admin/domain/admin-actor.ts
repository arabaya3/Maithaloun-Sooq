export const adminRoles = ["owner"] as const;
export type AdminRole = (typeof adminRoles)[number];

export interface AdminActor {
  id: string;
  username: string;
  displayName: string;
  role: AdminRole;
  active: boolean;
}

export class AuthorizationError extends Error {
  constructor() {
    super("UNAUTHORIZED");
    this.name = "AuthorizationError";
  }
}

export function assertOwnerActor(actor: AdminActor): void {
  if (!actor.active || actor.role !== "owner") {
    throw new AuthorizationError();
  }
}
