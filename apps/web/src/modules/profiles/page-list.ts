import type { Database } from "@/lib/database.types";
import { normalizeSlug } from "./slug";

type ProfileStatus = Database["public"]["Enums"]["profile_status"];

/** Mirrors the bounds of public.list_workspace_profiles (ADR 0012). */
export const PAGE_LIST_SIZE = 20;
export const PAGE_LIST_SEARCH_MAX_LENGTH = 80;
const PAGE_LIST_MAX_PAGE = 500;

export type PageListOrder = "recent" | "name";

/** Words used in the URL, so a shared link reads naturally in pt-BR. */
const STATUS_BY_PARAM: Readonly<Record<string, ProfileStatus | undefined>> = { rascunho: "draft", publicada: "published", arquivada: "archived" };
const PARAM_BY_STATUS: Record<ProfileStatus, string> = { draft: "rascunho", published: "publicada", archived: "arquivada" };

export interface PageListParams {
  /** What the person typed, cleaned up. Matched against the page name. */
  search: string;
  /** The same text in address form ("Café Ipê" -> "cafe-ipe"), matched against the address. */
  slugSearch: string;
  status: ProfileStatus | null;
  order: PageListOrder;
  /** 1-based. */
  page: number;
}

type Query = Readonly<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  if (typeof value === "string") return value;
  return Array.isArray(value) && typeof value[0] === "string" ? value[0] : "";
}

/**
 * Reads the list state from an untrusted query string. Anything unexpected falls back to the
 * default instead of failing, so an old or hand-edited link still opens the list.
 */
export function parsePageListParams(query: Query): PageListParams {
  const cleaned = first(query.q).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  const search = [...cleaned].slice(0, PAGE_LIST_SEARCH_MAX_LENGTH).join("").trim();
  // Address form of the same text; characters an address cannot have are dropped.
  const slugSearch = normalizeSlug(search).replace(/[^a-z0-9-]/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const statusKey = first(query.situacao);
  const status = Object.hasOwn(STATUS_BY_PARAM, statusKey) ? STATUS_BY_PARAM[statusKey] ?? null : null;
  const order: PageListOrder = first(query.ordem) === "nome" ? "name" : "recent";
  const rawPage = first(query.pagina);
  const page = /^[1-9][0-9]{0,3}$/.test(rawPage) ? Math.min(Number(rawPage), PAGE_LIST_MAX_PAGE) : 1;
  return { search, slugSearch, status, order, page };
}

export function pageListOffset(params: Pick<PageListParams, "page">): number {
  return (params.page - 1) * PAGE_LIST_SIZE;
}

export function pageListPageCount(matched: number): number {
  return Math.max(1, Math.ceil(matched / PAGE_LIST_SIZE));
}

export function hasActiveFilters(params: Pick<PageListParams, "search" | "status">): boolean {
  return params.search !== "" || params.status !== null;
}

/** Link to the list with the given state; defaults are left out so the plain list has a plain URL. */
export function pageListHref(workspaceId: string, params: Partial<Pick<PageListParams, "search" | "status" | "order" | "page">> = {}): string {
  const query = new URLSearchParams();
  if (params.search) query.set("q", params.search);
  if (params.status) query.set("situacao", PARAM_BY_STATUS[params.status]);
  if (params.order === "name") query.set("ordem", "nome");
  if (params.page && params.page > 1) query.set("pagina", String(params.page));
  const text = query.toString();
  return `/app/w/${workspaceId}${text ? `?${text}` : ""}`;
}

export function statusParam(status: ProfileStatus): string {
  return PARAM_BY_STATUS[status];
}

export interface PageListItem {
  id: string;
  title: string;
  slug: string;
  status: ProfileStatus;
  avatarPath: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  hasUnpublishedChanges: boolean;
}

export interface PageListResult {
  /** Live pages in the workspace, whatever the search: what counts toward max_profiles. */
  total: number;
  counts: Record<ProfileStatus, number>;
  matched: number;
  items: PageListItem[];
  /** False when the list came from the fallback query (migration not applied yet). */
  searchable: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function count(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

/** Tolerant read of the items JSON: a malformed entry is dropped, never rendered. */
export function readPageListItems(value: unknown): PageListItem[] {
  if (!Array.isArray(value)) return [];
  const items: PageListItem[] = [];
  for (const entry of value as unknown[]) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const { id, title, slug, status, createdAt, updatedAt } = row;
    if (typeof id !== "string" || !UUID.test(id) || typeof title !== "string" || typeof slug !== "string") continue;
    if (status !== "draft" && status !== "published" && status !== "archived") continue;
    if (typeof createdAt !== "string" || typeof updatedAt !== "string") continue;
    items.push({
      id, title, slug, status, createdAt, updatedAt,
      avatarPath: typeof row.avatarPath === "string" ? row.avatarPath : null,
      publishedAt: typeof row.publishedAt === "string" ? row.publishedAt : null,
      hasUnpublishedChanges: row.hasUnpublishedChanges === true,
    });
  }
  return items;
}

export interface PageListRow {
  total_pages: unknown;
  draft_pages: unknown;
  published_pages: unknown;
  archived_pages: unknown;
  matched_pages: unknown;
  items: unknown;
}

export function readPageListRow(row: PageListRow | null | undefined): PageListResult {
  return {
    total: count(row?.total_pages),
    counts: { draft: count(row?.draft_pages), published: count(row?.published_pages), archived: count(row?.archived_pages) },
    matched: count(row?.matched_pages),
    items: readPageListItems(row?.items),
    searchable: true,
  };
}
