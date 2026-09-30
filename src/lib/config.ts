import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import pg from "pg";

const { Pool } = pg;
let pool: pg.Pool | null = null;

export function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is not set. Run loadEnvFile() before getPool().",
      );
    }
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool;
}

function encryptionKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is required for secure Meesho configuration");
  }
  return createHash("sha256").update(secret).digest();
}

export function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decrypt(value: string | null | undefined) {
  if (!value) return "";
  const [version, ivValue, tagValue, ciphertextValue] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !ciphertextValue) {
    throw new Error("Stored Meesho configuration has an unsupported format");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivValue, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export type MeeshoAuthConfig = {
  apiAuth: string;
  anonymousXo: string;
};

export async function getMeeshoAuthConfig(): Promise<MeeshoAuthConfig> {
  const result = await getPool().query(
    "select api_auth_ciphertext, anonymous_xo_ciphertext from meesho_runtime_config where id = 1 limit 1",
  );
  const row = result.rows[0] as
    | { api_auth_ciphertext: string | null; anonymous_xo_ciphertext: string | null }
    | undefined;
  const apiAuth =
    (row && decrypt(row.api_auth_ciphertext)) ||
    process.env.MEESHO_API_AUTH?.trim() ||
    "";
  const anonymousXo =
    (row && decrypt(row.anonymous_xo_ciphertext)) ||
    process.env.MEESHO_ANONYMOUS_XO?.trim() ||
    "";
  if (!apiAuth) {
    throw new Error("Meesho API auth is not configured.");
  }
  return { apiAuth, anonymousXo };
}