import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Content-addressed storage for revision bodies. Keys are sha256 hex, so writes
 * are idempotent and history is immutable. Filesystem and memory now; S3 and
 * R2 implement the same two methods.
 */
export interface BlobStore {
  put(hash: string, body: string): Promise<void>;
  get(hash: string): Promise<string | undefined>;
}

export class MemoryBlobStore implements BlobStore {
  readonly #items = new Map<string, string>();
  async put(hash: string, body: string) {
    this.#items.set(hash, body);
  }
  async get(hash: string) {
    return this.#items.get(hash);
  }
}

export class FsBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  #path(hash: string) {
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error(`Not a sha256 hash: ${hash}`);
    return join(this.root, hash.slice(0, 2), hash);
  }

  async put(hash: string, body: string) {
    const path = this.#path(hash);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body, { flag: "w" });
  }

  async get(hash: string) {
    try {
      return await readFile(this.#path(hash), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw err;
    }
  }
}
