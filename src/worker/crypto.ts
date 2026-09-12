const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function base64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function randomToken(size = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(size)));
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return base64Url(new Uint8Array(digest));
}

async function importEncryptionKey(base64Key: string): Promise<CryptoKey> {
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = base64ToBytes(base64Key);
  } catch {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY 必须是 Base64");
  }
  if (raw.byteLength !== 32) throw new Error("CREDENTIAL_ENCRYPTION_KEY 必须解码为 32 字节");
  return crypto.subtle.importKey("raw", raw.buffer, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptCredential(
  credential: unknown,
  base64Key: string,
  aad: string,
): Promise<{ encryptedPayload: string; nonce: string }> {
  const key = await importEncryptionKey(base64Key);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: encoder.encode(aad) },
    key,
    encoder.encode(JSON.stringify(credential)),
  );
  return {
    encryptedPayload: bytesToBase64(new Uint8Array(encrypted)),
    nonce: bytesToBase64(nonce),
  };
}

export async function decryptCredential<T>(
  encryptedPayload: string,
  nonce: string,
  base64Key: string,
  aad: string,
): Promise<T> {
  const key = await importEncryptionKey(base64Key);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(nonce), additionalData: encoder.encode(aad) },
    key,
    base64ToBytes(encryptedPayload),
  );
  return JSON.parse(decoder.decode(decrypted)) as T;
}
