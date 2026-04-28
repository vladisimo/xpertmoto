import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALG = "aes-256-gcm";

function getKey(): Buffer {
  const raw = process.env.SECRET_ENC_KEY ?? process.env.ETOLL_ENC_KEY;
  if (!raw) {
    throw new Error(
      "SECRET_ENC_KEY (or legacy ETOLL_ENC_KEY) not set. Generate one with: openssl rand -base64 32",
    );
  }
  // Must be a 32-byte key supplied as base64. The earlier scrypt fallback
  // with a hardcoded salt was removed: any compromise of the password would
  // yield the key on every deployment using the same password, defeating
  // most of the point of salting. If you want a password-derived key, run
  // scrypt yourself with a per-deployment salt and pass the base64 result.
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error(
      "SECRET_ENC_KEY must be a 32-byte key encoded as base64 (got " +
        buf.length +
        " bytes). Generate one with: openssl rand -base64 32",
    );
  }
  return buf;
}

export type EncryptedSecret = { enc: string; iv: string; tag: string };

export function encryptSecret(plaintext: string): EncryptedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    enc: enc.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(s: EncryptedSecret): string {
  const decipher = createDecipheriv(ALG, getKey(), Buffer.from(s.iv, "base64"));
  decipher.setAuthTag(Buffer.from(s.tag, "base64"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(s.enc, "base64")),
    decipher.final(),
  ]);
  return plain.toString("utf8");
}
