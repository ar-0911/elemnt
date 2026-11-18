import type { BlobStore } from "../lib/blobs.js";
import { sha256 } from "../lib/crypto.js";
import { HttpError } from "../services/errors.js";

/**
 * A site's files as an immutable, content-addressed tree: a JSON manifest blob
 * mapping each path to the hash of its content blob. Saving a file makes a new
 * tree, so every draft, preview and release is a snapshot that can be served,
 * diffed or rolled back to without copying anything.
 */

export interface TreeEntry {
  hash: string;
  /** Text files are stored as is; images, fonts and other binaries as base64. */
  encoding: "utf8" | "base64";
  size: number;
}

export interface Tree {
  files: Record<string, TreeEntry>;
}

export const MAX_FILES = 400;
export const MAX_FILE_BYTES = 3_000_000;

/** Folders a site may have. Only the public ones are served as files. */
export const SITE_DIRS = ["layouts", "partials", "pages", "styles", "scripts", "assets", "data"] as const;
export const PUBLIC_DIRS = ["styles", "scripts", "assets"] as const;

const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/;

/** A clean, relative file path in one of the site folders (or site.json). */
export function normalizeFilePath(path: string): string {
  const clean = path.trim().replace(/^\/+/, "");
  const parts = clean.split("/");
  const ok =
    clean === "site.json" ||
    (parts.length >= 2 && parts.length <= 8 && (SITE_DIRS as readonly string[]).includes(parts[0]!) && parts.every((p) => SEGMENT.test(p) && p !== "." && p !== ".."));
  if (!ok) throw new HttpError(400, `"${path}" isn't a valid site file. Use site.json or a path under ${SITE_DIRS.join("/, ")}/, e.g. layouts/docs.liquid.`);
  return clean;
}

const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|glb|gltf|bin|mp4|webm|mp3|wav|hdr|ktx2|pdf)$/i;
export const isBinaryPath = (path: string) => BINARY.test(path);

export const EMPTY_TREE: Tree = { files: {} };

export async function saveTree(blobs: BlobStore, tree: Tree): Promise<string> {
  const sorted: Tree = { files: Object.fromEntries(Object.entries(tree.files).sort(([a], [b]) => a.localeCompare(b))) };
  const body = JSON.stringify(sorted);
  const hash = sha256(body);
  await blobs.put(hash, body);
  return hash;
}

const treeCache = new Map<string, Tree>();

export async function loadTree(blobs: BlobStore, hash: string): Promise<Tree> {
  const hit = treeCache.get(hash);
  if (hit) return hit;
  const body = await blobs.get(hash);
  if (body === undefined) throw new Error(`Site tree ${hash} is missing from blob storage.`);
  const tree = JSON.parse(body) as Tree;
  if (treeCache.size > 200) treeCache.clear();
  treeCache.set(hash, tree);
  return tree;
}

/** Stores one file's content; returns its tree entry. */
export async function putFile(blobs: BlobStore, path: string, content: string, encoding?: "utf8" | "base64"): Promise<TreeEntry> {
  const enc = encoding ?? (isBinaryPath(path) ? "base64" : "utf8");
  if (enc === "base64" && !/^[A-Za-z0-9+/=\s]*$/.test(content)) throw new HttpError(400, `${path} should be base64 (it's a binary file).`);
  const size = enc === "base64" ? Math.floor((content.replace(/\s/g, "").length * 3) / 4) : Buffer.byteLength(content);
  if (size > MAX_FILE_BYTES) throw new HttpError(400, `${path} is ${Math.round(size / 1000)} KB; a site file can be at most ${MAX_FILE_BYTES / 1_000_000} MB.`);
  const body = enc === "base64" ? content.replace(/\s/g, "") : content;
  // Different namespaces for text and base64 so the same bytes never collide.
  const hash = sha256(`${enc}:${body}`);
  await blobs.put(hash, body);
  return { hash, encoding: enc, size };
}

export async function readFileText(blobs: BlobStore, tree: Tree, path: string): Promise<string | undefined> {
  const entry = tree.files[path];
  if (!entry) return undefined;
  const body = await blobs.get(entry.hash);
  if (body === undefined) throw new Error(`Site file ${path} (${entry.hash}) is missing from blob storage.`);
  return body;
}

export async function readFileBytes(blobs: BlobStore, tree: Tree, path: string): Promise<Uint8Array | undefined> {
  const entry = tree.files[path];
  if (!entry) return undefined;
  const body = await readFileText(blobs, tree, path);
  if (body === undefined) return undefined;
  return entry.encoding === "base64" ? new Uint8Array(Buffer.from(body, "base64")) : new TextEncoder().encode(body);
}

/** Writes several files (null deletes) and returns the new tree. */
export async function writeFiles(blobs: BlobStore, base: Tree, changes: { path: string; content: string | null; encoding?: "utf8" | "base64" }[]): Promise<Tree> {
  const files = { ...base.files };
  for (const change of changes) {
    const path = normalizeFilePath(change.path);
    if (change.content === null) delete files[path];
    else files[path] = await putFile(blobs, path, change.content, change.encoding);
  }
  if (Object.keys(files).length > MAX_FILES) throw new HttpError(400, `A site can have at most ${MAX_FILES} files.`);
  return { files };
}

const TYPES: Record<string, string> = {
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  html: "text/html; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  bin: "application/octet-stream",
  hdr: "application/octet-stream",
  ktx2: "image/ktx2",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  pdf: "application/pdf",
};

export function contentType(path: string): string {
  return TYPES[path.split(".").pop()!.toLowerCase()] ?? "application/octet-stream";
}
