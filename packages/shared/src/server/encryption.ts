import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ENCRYPTION_VERSION = "v1";
const ALGORITHM = "aes-256-gcm";

function deriveKey(secret: string) {
  return createHash("sha256").update(secret).digest();
}

function getKey(secret: string) {
  const normalized = secret.trim();

  if (!normalized) {
    throw new Error("APP_ENCRYPTION_KEY is missing.");
  }

  if (/^[a-f0-9]{64}$/i.test(normalized)) {
    return Buffer.from(normalized, "hex");
  }

  return deriveKey(normalized);
}

export function encryptSecret(value: string, secret: string) {
  if (!value) {
    return "";
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    ENCRYPTION_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export function decryptSecret(payload: string | null | undefined, secret: string) {
  if (!payload) {
    return "";
  }

  const [version, ivEncoded, tagEncoded, dataEncoded] = payload.split(":");

  if (version !== ENCRYPTION_VERSION || !ivEncoded || !tagEncoded || !dataEncoded) {
    return payload;
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    getKey(secret),
    Buffer.from(ivEncoded, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataEncoded, "base64url")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

export function maskSecret(value: string | null | undefined) {
  const raw = String(value || "");

  if (!raw) {
    return "";
  }

  if (raw.length <= 8) {
    return `${raw.slice(0, 2)}***`;
  }

  return `${raw.slice(0, 4)}***${raw.slice(-4)}`;
}
