import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";

import { authEnv } from "../env";

/**
 * AES-256-GCM encryption helper for per-agent API keys.
 *
 * The encryption key is sourced from `AGENTSCOPE_SECRETS_KEY` (64 hex chars
 * = 32 bytes) when set, and otherwise derived from `AUTH_SECRET` via
 * scrypt. Each value is encrypted with a fresh 12-byte IV and stored as a
 * single string:
 *
 *   base64(iv) ":" base64(authTag) ":" base64(ciphertext)
 *
 * The key never leaves the process. The format is deliberately simple (no
 * envelope, no version byte) because the ciphertext is bound to the
 * deployment's key — rotating either `AGENTSCOPE_SECRETS_KEY` or
 * `AUTH_SECRET` invalidates all stored secrets, which is the desired
 * behavior.
 */

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const KEY_BYTES = 32;
const SCRYPT_SALT = "agentscope:agent-api-key:v1";

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  // AGENTSCOPE_SECRETS_KEY (64 hex chars = 32 bytes) lets operators rotate
  // the encryption key independently of AUTH_SECRET. When unset, we derive
  // a stable key from AUTH_SECRET via scrypt, which means rotating
  // AUTH_SECRET invalidates all stored API keys.
  const env = authEnv();
  const override = env.AGENTSCOPE_SECRETS_KEY;
  if (override) {
    // authEnv() already enforces 64 hex chars, which always decodes to 32
    // bytes. The key cache is process-local.
    cachedKey = Buffer.from(override, "hex");
    return cachedKey;
  }
  const secret = env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SECRET is required to encrypt or decrypt agent API keys (or set AGENTSCOPE_SECRETS_KEY).",
    );
  }
  cachedKey = scryptSync(secret, SCRYPT_SALT, KEY_BYTES);
  return cachedKey;
}

/** Encrypt a plaintext secret. Returns null when the input is null/empty. */
export function encryptSecret(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined) return null;
  const trimmed = plaintext.trim();
  if (trimmed === "") return null;

  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(trimmed, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    iv.toString("base64"),
    authTag.toString("base64"),
    ciphertext.toString("base64"),
  ].join(":");
}

/** Decrypt a secret produced by {@link encryptSecret}. */
export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("Encrypted secret payload is malformed.");
  }
  const [ivPart, tagPart, ctPart] = parts;
  if (!ivPart || !tagPart || !ctPart) {
    throw new Error("Encrypted secret payload is malformed.");
  }

  const key = getKey();
  const iv = Buffer.from(ivPart, "base64");
  const authTag = Buffer.from(tagPart, "base64");
  const ciphertext = Buffer.from(ctPart, "base64");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}

/** True when the value looks like an encrypted payload (not a plaintext key). */
export function isEncryptedSecret(value: string | null | undefined): boolean {
  if (!value) return false;
  const parts = value.split(":");
  return parts.length === 3 && parts.every((p) => /^[A-Za-z0-9+/=]+$/.test(p));
}
