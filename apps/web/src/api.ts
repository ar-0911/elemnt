import type { Diagnostic } from "@elemnt/core";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
  get diagnostics(): Diagnostic[] {
    return (this.details.diagnostics as Diagnostic[] | undefined) ?? [];
  }
}

async function request<T>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    ...init,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const { error, ...details } = data as { error?: string };
    throw new ApiError(res.status, error ?? `Request failed (${res.status})`, details);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  del: <T = void>(path: string, init?: RequestInit) => request<T>("DELETE", path, undefined, init),
};

export interface Me {
  userId: string;
  email: string;
  role: "owner" | "admin" | "editor" | "viewer" | undefined;
  linkedin: { connected: boolean; name?: string };
}

export interface Space {
  id: string;
  slug: string;
  name: string;
  visibility: "private" | "workspace" | "public";
}

export interface TreePage {
  id: string;
  path: string;
  title: string;
  summary: string | null;
  published: boolean;
  hasDraft: boolean;
}

export interface OpenedPage {
  page: { id: string; path: string; title: string; publishedRevisionId: string | null; draftRevisionId: string | null; lockedBy: string | null };
  space: { slug: string; name: string; visibility: Space["visibility"] };
  headRevisionId: string | null;
  url: string;
  source: string;
}

export interface SaveResult {
  pageId: string;
  revisionId: string;
  published: boolean;
}

export interface Revision {
  id: string;
  parentRevisionId: string | null;
  title: string | null;
  authorEmail: string | null;
  authorName: string | null;
  message: string | null;
  createdAt: string;
}

export interface Comment {
  id: string;
  parentId: string | null;
  anchor: { exact: string } | null;
  body: string;
  authorEmail: string | null;
  authorName: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export interface SearchHit {
  pageId: string;
  title: string;
  path: string;
  spaceSlug: string;
  spaceName: string;
  snippetHtml: string;
}
