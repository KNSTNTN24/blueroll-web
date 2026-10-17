const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

async function importEncryptionKey(base64Key: string): Promise<CryptoKey> {
  const bytes = base64ToBytes(base64Key);
  if (bytes.byteLength !== 32) throw new Error("IAP_EVENT_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  return crypto.subtle.importKey("raw", asArrayBuffer(bytes), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function encryptIapSecret(value: string, base64Key: string, now = new Date()) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await importEncryptionKey(base64Key),
    encoder.encode(value),
  ));
  const deleteAfter = new Date(now);
  deleteAfter.setUTCDate(deleteAfter.getUTCDate() + 90);
  return { ciphertext: bytesToBase64(ciphertext), iv: bytesToBase64(iv), deleteAfter: deleteAfter.toISOString() };
}

export async function decryptIapSecret(ciphertext: string, iv: string, base64Key: string): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asArrayBuffer(base64ToBytes(iv)) },
    await importEncryptionKey(base64Key),
    asArrayBuffer(base64ToBytes(ciphertext)),
  );
  return decoder.decode(plaintext);
}

export function distinctBusinessIds(...candidateSets: Array<Array<string | null | undefined>>): string[] {
  return [...new Set(candidateSets.flat().filter((value): value is string => Boolean(value)))].sort();
}

export function candidateResolution(candidates: Array<string | null | undefined>): "matched" | "unmatched" | "conflict" {
  const count = distinctBusinessIds(candidates).length;
  return count === 1 ? "matched" : count === 0 ? "unmatched" : "conflict";
}

export function safeEventLog(input: {
  provider: string;
  eventId: string;
  resolution: string;
  tokenHash?: string;
}): Record<string, string> {
  return Object.fromEntries(Object.entries(input).filter((entry): entry is [string, string] => entry[1] !== undefined));
}
