import { randomUUID } from "crypto";
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl as awsGetSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  recordStorageUpload,
  recordStorageDelete,
  type StorageLogContext,
} from "@/server/services/storage-usage";

type StorageEnv = {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKey?: string;
  secretKey?: string;
  forcePathStyle: boolean;
  publicUrl?: string;
};

function getEnv(): StorageEnv {
  return {
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? "ap-southeast-2",
    bucket: process.env.S3_BUCKET ?? "scootering",
    accessKey: process.env.S3_ACCESS_KEY,
    secretKey: process.env.S3_SECRET_KEY,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    publicUrl: process.env.S3_PUBLIC_URL,
  };
}

let client: S3Client | null = null;

function getClient(): S3Client | null {
  if (client) return client;
  const env = getEnv();
  if (!env.accessKey || !env.secretKey) return null;
  client = new S3Client({
    region: env.region,
    endpoint: env.endpoint,
    forcePathStyle: env.forcePathStyle,
    credentials: {
      accessKeyId: env.accessKey,
      secretAccessKey: env.secretKey,
    },
  });
  return client;
}

export type UploadArgs = {
  /** logical folder within bucket, e.g. "vehicles", "inspections/pre" */
  folder: string;
  filename?: string;
  contentType: string;
  body: Buffer | Uint8Array;
  /** Optional attribution for the Platform > Storage cost tab. */
  log?: StorageLogContext;
};

export type UploadResult = {
  key: string;
  url: string;
};

/**
 * Upload a file to S3/MinIO. Falls back to writing under /public/uploads
 * when S3 credentials are not configured (local dev without docker).
 *
 * In production the fallback is refused: a misconfigured deployment would
 * otherwise write to an ephemeral/read-only filesystem and hand back a
 * relative URL that fails `z.string().url()` downstream. Fail loud at the
 * upload boundary instead of producing a broken record.
 */
export async function uploadFile(args: UploadArgs): Promise<UploadResult> {
  const ext = args.filename?.split(".").pop() ?? guessExt(args.contentType);
  const name = `${randomUUID()}${ext ? "." + ext : ""}`;
  const key = `${args.folder.replace(/^\/|\/$/g, "")}/${name}`;

  const size = args.body instanceof Buffer ? args.body.length : args.body.byteLength;

  const s3 = getClient();
  if (!s3) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Object storage is not configured. Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY (and S3_PUBLIC_URL) on the host.",
      );
    }
    const result = await uploadFileLocal(key, args);
    await recordStorageUpload({
      key: result.key,
      sizeBytes: size,
      contentType: args.contentType,
      ctx: args.log,
    });
    return result;
  }

  const env = getEnv();
  await s3.send(
    new PutObjectCommand({
      Bucket: env.bucket,
      Key: key,
      Body: args.body,
      ContentType: args.contentType,
    }),
  );

  await recordStorageUpload({
    key,
    sizeBytes: size,
    contentType: args.contentType,
    ctx: args.log,
  });

  const base = env.publicUrl ?? `${env.endpoint?.replace(/\/$/, "")}/${env.bucket}`;
  return { key, url: `${base}/${key}` };
}

async function uploadFileLocal(key: string, args: UploadArgs): Promise<UploadResult> {
  const { mkdir, writeFile } = await import("fs/promises");
  const path = await import("path");
  const abs = path.join(process.cwd(), "public", "uploads", key);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, args.body);
  return { key, url: `/uploads/${key}` };
}

/**
 * Download an object's bytes. Used server-side for follow-up processing of
 * already-uploaded images (e.g. OCR of a licence after the client has
 * uploaded it to S3).
 */
export async function downloadFile(key: string): Promise<Buffer> {
  const s3 = getClient();
  if (!s3) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Object storage is not configured. Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY on the host.",
      );
    }
    const { readFile } = await import("fs/promises");
    const path = await import("path");
    return readFile(path.join(process.cwd(), "public", "uploads", key));
  }
  const res = await s3.send(
    new GetObjectCommand({ Bucket: getEnv().bucket, Key: key }),
  );
  const body = res.Body;
  if (!body) throw new Error(`No body for S3 object ${key}`);
  // `body` is a ReadableStream in the v3 SDK; collect chunks into a Buffer.
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function deleteFile(
  key: string,
  opts: { log?: StorageLogContext } = {},
): Promise<void> {
  const s3 = getClient();
  if (!s3) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Object storage is not configured. Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY on the host.",
      );
    }
    const { unlink } = await import("fs/promises");
    const path = await import("path");
    await unlink(path.join(process.cwd(), "public", "uploads", key)).catch(() => undefined);
    await recordStorageDelete({ key, ctx: opts.log });
    return;
  }
  await s3.send(new DeleteObjectCommand({ Bucket: getEnv().bucket, Key: key }));
  await recordStorageDelete({ key, ctx: opts.log });
}

/**
 * Generate a signed URL for private object access. Returns a direct URL when
 * running with the public-bucket dev setup (no signing needed).
 */
export async function getSignedUrl(key: string, expiresInSec = 900): Promise<string> {
  const s3 = getClient();
  const env = getEnv();
  if (!s3) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "Object storage is not configured. Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY on the host.",
      );
    }
    return `/uploads/${key}`;
  }
  const cmd = new GetObjectCommand({ Bucket: env.bucket, Key: key });
  return awsGetSignedUrl(s3, cmd, { expiresIn: expiresInSec });
}

function guessExt(contentType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "application/pdf": "pdf",
  };
  return map[contentType] ?? contentType.split("/")[1] ?? "bin";
}
