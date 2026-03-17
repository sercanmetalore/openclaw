// ── AES-256-GCM credential encryption ────────────────────────────────────────
// Key is generated once and stored at rest in the plugin state directory.

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const KEY_FILENAME = ".key";
const ALGORITHM = "aes-256-gcm" as const;
const KEY_BYTES = 32;
const IV_BYTES = 12;

let cachedKey: Buffer | null = null;
let cachedKeyPath = "";

/** Resolve key file path inside plugin state dir. */
function keyPath(stateDir: string): string {
  return path.join(stateDir, "plugins", "project-plan", KEY_FILENAME);
}

/**
 * Load the encryption key from disk, creating it if it does not exist.
 * The key is cached in memory for the lifetime of the process.
 */
export async function loadOrCreateKey(stateDir: string): Promise<Buffer> {
  const kp = keyPath(stateDir);
  if (cachedKey && cachedKeyPath === kp) {
    return cachedKey;
  }
  await fs.mkdir(path.dirname(kp), { recursive: true });
  try {
    const hex = (await fs.readFile(kp, "utf8")).trim();
    cachedKey = Buffer.from(hex, "hex");
    cachedKeyPath = kp;
    return cachedKey;
  } catch {
    // Key file does not exist — generate a new one.
    const key = crypto.randomBytes(KEY_BYTES);
    await fs.writeFile(kp, key.toString("hex"), { mode: 0o600 });
    cachedKey = key;
    cachedKeyPath = kp;
    return key;
  }
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Returns a compact "iv:tag:ciphertext" string (all hex).
 */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("hex"), tag.toString("hex"), encrypted.toString("hex")].join(":");
}

/**
 * Decrypt a ciphertext string produced by `encrypt`.
 * Throws on authentication failure or malformed input.
 */
export function decrypt(ciphertext: string, key: Buffer): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 3) {
    throw new Error("project-plan: invalid encrypted credential format");
  }
  const [ivHex, tagHex, encHex] = parts as [string, string, string];
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const enc = Buffer.from(encHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(enc), decipher.final()]);
  return decrypted.toString("utf8");
}
