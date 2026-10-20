import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

/**
 * Where the kitchen's single file lives between runs: an object store that speaks the S3 API and
 * honours conditional writes (Cloudflare R2 in production).
 *
 * The upload is conditional on the version that was downloaded (`If-Match`), or on the object not
 * existing yet (`If-None-Match: *`). The workflow already runs one kitchen at a time; this is what
 * stops anything outside it — a manual run against production, a re-run of an old job — from
 * overwriting a newer kitchen with an older one.
 */

export interface StateTarget {
  client: Pick<S3Client, "send">;
  bucket: string;
  /** Object key of the kitchen database. */
  key: string;
  /** Prefix for the dated daily copies. */
  backupPrefix: string;
}

export interface StateRevision {
  exists: boolean;
  etag?: string;
}

export class StateConflictError extends Error {
  constructor(key: string) {
    super(`a cozinha mudou no armazenamento durante esta execução: ${key}`);
    this.name = "StateConflictError";
  }
}

export const DEFAULT_BUCKET = "pulso-cozinha";
export const DEFAULT_KEY = "news.db";
export const BACKUP_PREFIX = "backups/";
/** The weekly audio's published files: too heavy for the kitchen file, so they sit beside it. */
export const WEEKLY_PREFIX = "weekly/";
/** Daily copies kept. A bad run is caught within days, not a month. */
export const BACKUP_KEEP_DAYS = 30;

/**
 * The target from the environment, or null when it is not configured.
 *
 * `R2_ACCOUNT_ID` builds the Cloudflare endpoint; `KITCHEN_S3_ENDPOINT` points anywhere else that
 * speaks S3 (a local MinIO, for instance). Checksums are sent only when an operation requires them:
 * the SDK's default CRC headers are not something every S3-compatible store accepts.
 */
export function stateTargetFromEnv(env: NodeJS.ProcessEnv = process.env): StateTarget | null {
  const endpoint =
    env.KITCHEN_S3_ENDPOINT ?? (env.R2_ACCOUNT_ID ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : undefined);
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey) return null;
  return {
    client: new S3Client({
      endpoint,
      region: "auto",
      credentials: { accessKeyId, secretAccessKey },
      // A local stand-in (MinIO, a test server) has no per-bucket hostnames.
      forcePathStyle: Boolean(env.KITCHEN_S3_ENDPOINT),
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      maxAttempts: 5,
    }),
    bucket: env.R2_BUCKET ?? DEFAULT_BUCKET,
    key: env.KITCHEN_KEY ?? DEFAULT_KEY,
    backupPrefix: BACKUP_PREFIX,
  };
}

function statusOf(error: unknown): number | undefined {
  return (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata?.httpStatusCode;
}

/** The object is absent. A missing bucket is a misconfiguration, not an empty kitchen. */
function isMissing(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  if (name === "NoSuchBucket") return false;
  return name === "NoSuchKey" || name === "NotFound" || statusOf(error) === 404;
}

function isPreconditionFailed(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === "PreconditionFailed" || statusOf(error) === 412;
}

async function bodyBytes(body: unknown): Promise<Buffer> {
  const stream = body as { transformToByteArray?: () => Promise<Uint8Array> } | undefined;
  if (!stream?.transformToByteArray) throw new Error("objeto sem corpo");
  return Buffer.from(await stream.transformToByteArray());
}

/** Downloads the kitchen to `localPath`. A missing object is an empty kitchen, not an error. */
export async function downloadState(target: StateTarget, localPath: string): Promise<StateRevision> {
  mkdirSync(path.dirname(localPath), { recursive: true });
  try {
    const got = await target.client.send(new GetObjectCommand({ Bucket: target.bucket, Key: target.key }));
    writeFileSync(localPath, await bodyBytes(got.Body));
    return { exists: true, ...(got.ETag ? { etag: got.ETag } : {}) };
  } catch (error) {
    if (isMissing(error)) return { exists: false };
    throw error;
  }
}

/** The current version without downloading it, for a deliberate replace. */
export async function headState(target: StateTarget): Promise<StateRevision> {
  try {
    const head = await target.client.send(new HeadObjectCommand({ Bucket: target.bucket, Key: target.key }));
    return { exists: true, ...(head.ETag ? { etag: head.ETag } : {}) };
  } catch (error) {
    if (isMissing(error)) return { exists: false };
    throw error;
  }
}

/** The ETag R2 and S3 give a single-part upload: the MD5 of the body, quoted. */
export function singlePartEtag(body: Buffer): string {
  return `"${createHash("md5").update(body).digest("hex")}"`;
}

/**
 * Uploads the kitchen only if the stored version is still the one `revision` describes.
 *
 * The client retries a PUT whose response was lost; if the first attempt had landed, the retry's
 * precondition fails against our own write. A 412 is therefore checked against what is stored:
 * if it is byte for byte the file being uploaded, the upload succeeded.
 */
export async function uploadState(target: StateTarget, localPath: string, revision: StateRevision): Promise<string> {
  if (revision.exists && !revision.etag) throw new Error(`versão da cozinha desconhecida: ${target.key}`);
  const body = readFileSync(localPath);
  try {
    const put = await target.client.send(
      new PutObjectCommand({
        Bucket: target.bucket,
        Key: target.key,
        Body: body,
        ContentType: "application/vnd.sqlite3",
        ...(revision.exists ? { IfMatch: revision.etag } : { IfNoneMatch: "*" }),
      })
    );
    return put.ETag ?? "";
  } catch (error) {
    if (!isPreconditionFailed(error)) throw error;
    const stored = await headState(target);
    const mine = singlePartEtag(body);
    if (stored.etag === mine) return mine;
    throw new StateConflictError(target.key);
  }
}

function backupKey(target: StateTarget, day: string): string {
  return `${target.backupPrefix}news-${day}.db`;
}

/** Keeps a dated copy of the kitchen just uploaded. The same day overwrites its own copy. */
export async function backupState(target: StateTarget, localPath: string, now = new Date()): Promise<string> {
  const key = backupKey(target, now.toISOString().slice(0, 10));
  await target.client.send(
    new PutObjectCommand({ Bucket: target.bucket, Key: key, Body: readFileSync(localPath), ContentType: "application/vnd.sqlite3" })
  );
  return key;
}

async function listKeys(target: StateTarget, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const page = await target.client.send(
      new ListObjectsV2Command({ Bucket: target.bucket, Prefix: prefix, ContinuationToken: token })
    );
    for (const object of page.Contents ?? []) if (object.Key) keys.push(object.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

/** Deletes the dated copies older than `keepDays`. Returns the keys it removed. */
export async function pruneBackups(target: StateTarget, now = new Date(), keepDays = BACKUP_KEEP_DAYS): Promise<string[]> {
  const cutoff = new Date(now.getTime() - keepDays * 86_400_000).toISOString().slice(0, 10);
  const stale = (await listKeys(target, target.backupPrefix)).filter((key) => {
    const day = /news-(\d{4}-\d{2}-\d{2})\.db$/.exec(key)?.[1];
    return day !== undefined && day < cutoff;
  });
  for (const key of stale) {
    await target.client.send(new DeleteObjectCommand({ Bucket: target.bucket, Key: key }));
  }
  return stale;
}

/** Downloads every object under `prefix` into `dir`, keeping the relative layout. */
export async function downloadPrefix(target: StateTarget, prefix: string, dir: string): Promise<number> {
  const root = path.resolve(dir);
  let written = 0;
  for (const key of await listKeys(target, prefix)) {
    const relative = key.slice(prefix.length);
    if (!relative || relative.endsWith("/")) continue;
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) continue;
    mkdirSync(path.dirname(file), { recursive: true });
    const got = await target.client.send(new GetObjectCommand({ Bucket: target.bucket, Key: key }));
    writeFileSync(file, await bodyBytes(got.Body));
    written += 1;
  }
  return written;
}

/** Uploads every file under `dir` to `prefix`, for the one-time import of the weekly audio. */
export async function uploadDir(target: StateTarget, dir: string, prefix: string, relative = ""): Promise<number> {
  let count = 0;
  for (const name of readdirSync(relative ? path.join(dir, relative) : dir)) {
    const rel = relative ? `${relative}/${name}` : name;
    if (statSync(path.join(dir, rel)).isDirectory()) {
      count += await uploadDir(target, dir, prefix, rel);
      continue;
    }
    await target.client.send(new PutObjectCommand({ Bucket: target.bucket, Key: `${prefix}${rel}`, Body: readFileSync(path.join(dir, rel)) }));
    count += 1;
  }
  return count;
}

/** One object's bytes, or null when it does not exist. */
export async function readObject(target: StateTarget, key: string): Promise<Buffer | null> {
  try {
    const got = await target.client.send(new GetObjectCommand({ Bucket: target.bucket, Key: key }));
    return await bodyBytes(got.Body);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

export async function writeObject(target: StateTarget, key: string, body: Buffer, contentType?: string): Promise<void> {
  await target.client.send(
    new PutObjectCommand({ Bucket: target.bucket, Key: key, Body: body, ...(contentType ? { ContentType: contentType } : {}) })
  );
}
