import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { singlePartEtag, type StateTarget } from "./storage.js";

/**
 * Test double: a bucket in memory that answers the five commands the kitchen sends, with the
 * conditional writes R2 honours (`If-Match`, `If-None-Match: *`) and MD5 ETags like R2's.
 */
export class FakeBucket {
  objects = new Map<string, { body: Buffer; etag: string }>();
  puts: Array<Record<string, unknown>> = [];
  /** Keys whose next PUT fails, to exercise failures after the commit. */
  failPut = new Set<string>();

  private error(name: string, status: number): Error {
    return Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
  }

  put(key: string, body: string | Buffer): string {
    const bytes = Buffer.from(body);
    const etag = singlePartEtag(bytes);
    this.objects.set(key, { body: bytes, etag });
    return etag;
  }

  target(): StateTarget {
    return { client: { send: this.send } as StateTarget["client"], bucket: "b", key: "news.db", backupPrefix: "backups/" };
  }

  send = async (command: unknown): Promise<unknown> => {
    await Promise.resolve();
    if (command instanceof GetObjectCommand) {
      const object = this.objects.get(command.input.Key!);
      if (!object) throw this.error("NoSuchKey", 404);
      return { ETag: object.etag, Body: { transformToByteArray: () => Promise.resolve(new Uint8Array(object.body)) } };
    }
    if (command instanceof HeadObjectCommand) {
      const object = this.objects.get(command.input.Key!);
      if (!object) throw this.error("NotFound", 404);
      return { ETag: object.etag };
    }
    if (command instanceof PutObjectCommand) {
      const input = command.input as unknown as Record<string, unknown> & { Key: string; Body: Buffer };
      this.puts.push(input);
      if (this.failPut.delete(input.Key)) throw this.error("InternalError", 500);
      const current = this.objects.get(input.Key);
      if (input.IfNoneMatch === "*" && current) throw this.error("PreconditionFailed", 412);
      if (typeof input.IfMatch === "string" && current?.etag !== input.IfMatch) throw this.error("PreconditionFailed", 412);
      return { ETag: this.put(input.Key, input.Body) };
    }
    if (command instanceof ListObjectsV2Command) {
      const prefix = command.input.Prefix ?? "";
      const keys = [...this.objects.keys()].filter((key) => key.startsWith(prefix)).sort();
      // Two keys a page, so pagination is exercised.
      const start = command.input.ContinuationToken ? Number(command.input.ContinuationToken) : 0;
      const page = keys.slice(start, start + 2);
      const more = start + 2 < keys.length;
      return {
        Contents: page.map((Key) => ({ Key })),
        IsTruncated: more,
        NextContinuationToken: more ? String(start + 2) : undefined,
      };
    }
    if (command instanceof DeleteObjectCommand) {
      this.objects.delete(command.input.Key!);
      return {};
    }
    throw new Error("comando inesperado");
  };
}
