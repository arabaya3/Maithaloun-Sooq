import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Meta access tokens are stored encrypted (AES-256-GCM) with a key that lives only in the server
 * environment (SOCIAL_TOKEN_KEY, 32 bytes as base64). A database dump alone never reveals a token.
 */
const VERSION = "v1";

export class TokenVaultError extends Error {
  constructor(
    readonly code: "KEY_MISSING" | "KEY_INVALID" | "CIPHERTEXT_INVALID",
  ) {
    super(code);
    this.name = "TokenVaultError";
  }
}

export function parseVaultKey(raw: string | undefined): Buffer {
  if (!raw) throw new TokenVaultError("KEY_MISSING");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new TokenVaultError("KEY_INVALID");
  return key;
}

export function sealToken(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, body]
    .map((part) =>
      typeof part === "string" ? part : part.toString("base64url"),
    )
    .join(".");
}

export function openToken(sealed: string, key: Buffer): string {
  const [version, iv, tag, body] = sealed.split(".");
  if (version !== VERSION || !iv || !tag || !body) {
    throw new TokenVaultError("CIPHERTEXT_INVALID");
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(body, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new TokenVaultError("CIPHERTEXT_INVALID");
  }
}

/** The last characters only, so the settings page can show which token is stored. */
export function tokenHint(token: string): string {
  return `…${token.slice(-4)}`;
}
