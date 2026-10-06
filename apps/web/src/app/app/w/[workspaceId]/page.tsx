import type { Metadata } from "next";
import Link from "next/link";
import { APP_COPY, TEAM_COPY } from "@/content/pt-BR";
import { publicAddressLabel } from "@/lib/app-url";
import { limitUsage } from "@/modules/entitlements";
import { authorizeWorkspacePage } from "@/modules/identity/page-guard";
import { can } from "@/modules/identity/permissions";
import { getSupabase } from "@/modules/identity/session";
import { ArchiveControl } from "@/modules/profiles/components/archive-controls";
import { ProfileAvatar } from "@/modules/profiles/components/profile-avatar";
import { hasActiveFilters, pageListHref, pageListPageCount, parsePageListParams, type PageListParams } from "@/modules/profiles/page-list";
import { fetchPageList } from "@/modules/profiles/page-list-server";
import { getProfileRepository } from "@/modules/profiles/server";
import { Badge, EmptyState, Notice } from "@/ui";

export const metadata: Metadata = { title: "Páginas" };

const STATUS_TONE = { draft: "neutral", published: "success", archived: "warning" } as const;
const FILTERS = [null, "draft", "published", "archived"] as const;

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Page list of a workspace: search, status filter and pagination live in the URL, so they survive a
 * reload and the back button and work without JavaScript. Two queries per render whatever the
 * number of pages (the list and the plan's entitlements).
 */
export default async function WorkspaceHomePage({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const access = await authorizeWorkspacePage(workspaceId, "profile.view");
  if (!access) return null;

  const listParams = parsePageListParams(query);
  const [list, entitlements] = await Promise.all([fetchPageList(await getSupabase(), workspaceId, listParams), (await getProfileRepository()).entitlements(workspaceId)]);
  const usage = limitUsage(entitlements, "max_profiles", list.total);
  const mayCreate = can(access.role, "profile.create");
  const mayArchive = can(access.role, "profile.archive") && list.searchable;
  const mayDuplicate = can(access.role, "profile.duplicate") && list.searchable && !usage.reached;
  const filtered = list.searchable && hasActiveFilters(listParams);
  const pageCount = pageListPageCount(list.matched);
  const copy = APP_COPY.pages;
  const notice = single(query.criada) ? APP_COPY.profileForm.created
    : single(query.excluida) ? APP_COPY.deletePage.deleted
    : single(query.convite) === "aceito" ? TEAM_COPY.accept.accepted
    : null;
  const here = (overrides: Partial<PageListParams>) => pageListHref(workspaceId, { ...listParams, ...overrides });

  return (
    <div className="grid gap-6">
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{copy.listTitle}</h1>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-app-muted">
            <Badge tone={usage.reached ? "warning" : "accent"}>{copy.usage(usage.used, usage.limit)}</Badge>
            {list.counts.archived > 0 ? <span>{copy.usageNote}</span> : null}
          </p>
        </div>
        {mayCreate && !usage.reached ? <Link className="ui-button ui-button-primary" href={`/app/w/${workspaceId}/paginas/nova`}>+ {copy.create}</Link> : null}
      </header>

      {mayCreate && usage.reached ? <Notice tone="warning">{copy.limitReached(usage.limit)}</Notice> : null}
      {!mayCreate ? <p className="m-0 text-app-muted">{copy.createForbidden}</p> : null}

      {list.total === 0 ? (
        <EmptyState title={copy.emptyTitle} description={copy.emptyDescription} action={mayCreate && !usage.reached ? <Link className="ui-button ui-button-primary" href={`/app/w/${workspaceId}/paginas/nova`}>{copy.create}</Link> : undefined} />
      ) : (
        <>
          {list.searchable ? (
            <section className="grid gap-3" aria-label={copy.search.label}>
              <form action={`/app/w/${workspaceId}`} method="get" role="search" className="flex flex-wrap items-end gap-3">
                <div className="ui-field min-w-0 flex-1 basis-56">
                  <label htmlFor="page-search">{copy.search.label}</label>
                  <input id="page-search" name="q" type="search" className="ui-input" defaultValue={listParams.search} placeholder={copy.search.placeholder} maxLength={80} autoComplete="off" enterKeyHint="search" />
                </div>
                {listParams.status ? <input type="hidden" name="situacao" value={single(query.situacao) ?? ""} /> : null}
                {listParams.order === "name" ? <input type="hidden" name="ordem" value="nome" /> : null}
                <button type="submit" className="ui-button ui-button-secondary">{copy.search.submit}</button>
              </form>
              <nav aria-label={copy.filter.label} className="flex flex-wrap items-center gap-2">
                {FILTERS.map((status) => {
                  const current = listParams.status === status;
                  const total = status === null ? list.total : list.counts[status];
                  return (
                    <Link key={status ?? "all"} href={here({ status, page: 1 })} aria-current={current ? "true" : undefined} className="inline-flex min-h-11 items-center gap-1 rounded-full border border-app-border px-4 text-sm font-bold aria-[current=true]:border-app-accent aria-[current=true]:bg-app-accent/10 aria-[current=true]:underline">
                      {copy.filter[status ?? "all"]} <span className="font-normal text-app-muted">({total})</span>
                    </Link>
                  );
                })}
                <Link href={here({ order: listParams.order === "name" ? "recent" : "name", page: 1 })} className="ml-auto inline-flex min-h-11 items-center text-sm font-bold text-app-accent underline">
                  {copy.order.label}: {copy.order[listParams.order]}
                </Link>
              </nav>
              {filtered ? (
                <p className="m-0 flex flex-wrap items-center gap-x-3 text-sm text-app-muted" role="status">
                  <span>{copy.search.found(list.matched)}</span>
                  <Link className="inline-flex min-h-11 items-center font-bold text-app-accent underline" href={pageListHref(workspaceId, { order: listParams.order })}>{copy.search.clearAll}</Link>
                </p>
              ) : null}
            </section>
          ) : <Notice>{copy.search.unavailable}</Notice>}

          {list.items.length === 0 ? (
            <EmptyState
              title={copy.search.emptyTitle}
              description={listParams.search ? copy.search.emptyForTerm(listParams.search) : copy.search.emptyForStatus}
              action={listParams.search
                ? <Link className="ui-button ui-button-secondary" href={here({ search: "", page: 1 })}>{copy.search.clear}</Link>
                : <Link className="ui-button ui-button-secondary" href={pageListHref(workspaceId, { order: listParams.order })}>{copy.search.clearAll}</Link>}
            />
          ) : (
            <ul className="m-0 grid list-none gap-3 p-0">
              {list.items.map((profile) => {
                const pagePath = `/app/w/${workspaceId}/paginas/${profile.id}`;
                return (
                  <li key={profile.id} className="surface-card grid gap-4 p-4 sm:p-5">
                    <div className="flex min-w-0 items-center gap-4">
                      <ProfileAvatar title={profile.title} avatarPath={profile.avatarPath} />
                      <div className="min-w-0 flex-1">
                        <h2 className="truncate text-lg font-bold">{profile.title}</h2>
                        <p className="m-0 truncate text-sm text-app-muted">{publicAddressLabel(profile.slug)}</p>
                        <p className="m-0 mt-2 flex flex-wrap gap-2">
                          <Badge tone={STATUS_TONE[profile.status]}>{copy.status[profile.status]}</Badge>
                          {profile.hasUnpublishedChanges ? <Badge tone="warning">{copy.unpublishedChanges}</Badge> : null}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link className="ui-button ui-button-secondary" href={pagePath} aria-label={`${copy.settings}: ${profile.title}`}>{copy.settings}</Link>
                      <Link className="ui-button ui-button-secondary" href={`${pagePath}/resultados`} aria-label={`${copy.results}: ${profile.title}`}>{copy.results}</Link>
                      {mayDuplicate ? <Link className="ui-button ui-button-secondary" href={`${pagePath}/duplicar`} aria-label={APP_COPY.duplicate.openFor(profile.title)}>{APP_COPY.duplicate.open}</Link> : null}
                      {mayArchive ? <ArchiveControl page={profile} /> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {pageCount > 1 ? (
            <nav aria-label={copy.pagination.label} className="flex flex-wrap items-center justify-between gap-3">
              {listParams.page > 1 ? <Link className="ui-button ui-button-secondary" href={here({ page: listParams.page - 1 })} rel="prev">← {copy.pagination.previous}</Link> : <span />}
              <span className="text-sm text-app-muted">{copy.pagination.position(Math.min(listParams.page, pageCount), pageCount)}</span>
              {listParams.page < pageCount ? <Link className="ui-button ui-button-secondary" href={here({ page: listParams.page + 1 })} rel="next">{copy.pagination.next} →</Link> : <span />}
            </nav>
          ) : null}
        </>
      )}
      <p className="m-0 text-sm text-app-muted">{copy.publishHint}</p>
    </div>
  );
}
