import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

const HASH_VERSION = "v1";
const HASH_ALGORITHM = "scrypt";
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_DK_LEN = 32;
const SALT_BYTES = 16;
const SCRYPT_OPTIONS = {
  N: SCRYPT_N,
  r: SCRYPT_R,
  p: SCRYPT_P,
  maxmem: 64 * 1024 * 1024,
} as const;

const ENCODED_PATTERN =
  /^v1\$scrypt\$n=16384,r=8,p=1,dk=32\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/;

export function validatePasswordPolicy(password: string): boolean {
  return (
    typeof password === "string" &&
    password.length >= PASSWORD_MIN_LENGTH &&
    password.length <= PASSWORD_MAX_LENGTH
  );
}

export async function hashPassword(password: string): Promise<string> {
  if (!validatePasswordPolicy(password)) {
    throw new Error("PASSWORD_POLICY");
  }

  const salt = randomBytes(SALT_BYTES);
  const derived = await scryptAsync(
    password,
    salt,
    SCRYPT_DK_LEN,
    SCRYPT_OPTIONS,
  );

  return [
    HASH_VERSION,
    HASH_ALGORITHM,
    `n=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P},dk=${SCRYPT_DK_LEN}`,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  if (typeof password !== "string" || password.length > PASSWORD_MAX_LENGTH) {
    return false;
  }

  const parsed = parseEncodedHash(encodedHash);
  if (!parsed) {
    await dummyScryptWork();
    return false;
  }

  const derived = await scryptAsync(
    password,
    parsed.salt,
    SCRYPT_DK_LEN,
    SCRYPT_OPTIONS,
  );
  if (derived.length !== parsed.hash.length) return false;
  return timingSafeEqual(derived, parsed.hash);
}

function parseEncodedHash(
  encodedHash: string,
): { salt: Buffer; hash: Buffer } | null {
  if (typeof encodedHash !== "string") return null;
  const match = ENCODED_PATTERN.exec(encodedHash);
  if (!match?.[1] || !match[2]) return null;

  const salt = bufferFromBase64Url(match[1]);
  const hash = bufferFromBase64Url(match[2]);
  if (
    !salt ||
    !hash ||
    salt.length !== SALT_BYTES ||
    hash.length !== SCRYPT_DK_LEN
  ) {
    return null;
  }
  return { salt, hash };
}

function bufferFromBase64Url(value: string): Buffer | null {
  try {
    const buffer = Buffer.from(value, "base64url");
    return buffer.length > 0 ? buffer : null;
  } catch {
    return null;
  }
}

async function dummyScryptWork() {
  await scryptAsync(
    "invalid-password",
    randomBytes(SALT_BYTES),
    SCRYPT_DK_LEN,
    SCRYPT_OPTIONS,
  );
}

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keylen, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
}
