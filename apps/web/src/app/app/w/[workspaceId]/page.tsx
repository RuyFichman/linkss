import { UpgradeLink } from "@/modules/billing/components/upgrade-link";
import type { Metadata } from "next";
import Link from "next/link";
import { APP_COPY, ONBOARDING_COPY, TEAM_COPY, WORKSPACE_ANALYTICS_COPY } from "@/content/pt-BR";
import { publicAddressLabel, publicPageUrl } from "@/lib/app-url";
import { limitUsage } from "@/modules/entitlements";
import { authorizeWorkspacePage } from "@/modules/identity/page-guard";
import { can } from "@/modules/identity/permissions";
import { getSupabase } from "@/modules/identity/session";
import { ArchiveControl } from "@/modules/profiles/components/archive-controls";
import { ProfileAvatar } from "@/modules/profiles/components/profile-avatar";
import { onboardingChecklist } from "@/modules/profiles/onboarding";
import { hasActiveFilters, pageListHref, pageListPageCount, parsePageListParams, type PageListParams } from "@/modules/profiles/page-list";
import { fetchPageList } from "@/modules/profiles/page-list-server";
import { getProfileRepository } from "@/modules/profiles/server";
import { Badge, EmptyState, Notice } from "@/ui";

export const metadata: Metadata = { title: "Páginas" };

const STATUS_TONE = { draft: "neutral", published: "success", archived: "warning" } as const;
const FILTERS = [null, "draft", "published", "archived"] as const;

const ICON = { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, focusable: false } as const;
const SearchIcon = <svg {...ICON} className="page-search-icon"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg>;
const SortIcon = <svg {...ICON} width="16" height="16"><path d="M5 3v10M2.5 10.5 5 13l2.5-2.5M11 13V3M8.5 5.5 11 3l2.5 2.5" /></svg>;
const ExternalIcon = <svg {...ICON} width="12" height="12"><path d="M9 3h4v4M13 3 7.5 8.5M12 9.5V13H3V4h3.5" /></svg>;

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
  // First steps, until the first publication. Derived from the counts this screen already has.
  const onboarding = onboardingChecklist({ total: list.total, published: list.counts.published, archived: list.counts.archived, canEdit: mayCreate });
  const firstPage = !filtered ? list.items[0] : undefined;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-2">
          <h1 className="text-3xl font-bold">{copy.listTitle}</h1>
          <div className="page-usage" data-reached={usage.reached ? "" : undefined}>
            <span className="page-usage-text">{copy.usage(usage.used, usage.limit)}</span>
            <span className="page-usage-bar" aria-hidden="true"><span style={{ width: `${usage.limit > 0 ? Math.min(100, (usage.used / usage.limit) * 100) : 100}%` }} /></span>
            {list.counts.archived > 0 ? <span className="text-sm text-app-muted">{copy.usageNote}</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          {list.total > 0 ? <Link className="ui-button ui-button-secondary" href={`/app/w/${workspaceId}/resultados`}>{WORKSPACE_ANALYTICS_COPY.openFromList}</Link> : null}
          {mayCreate && !usage.reached ? <Link className="ui-button ui-button-primary" href={`/app/w/${workspaceId}/paginas/nova`}>+ {copy.create}</Link> : null}
        </div>
      </header>

      {onboarding ? (
        <section className="surface-card grid gap-4 p-5 sm:p-6" aria-labelledby="primeiros-passos">
          <div className="grid gap-1">
            <h2 id="primeiros-passos" className="text-xl font-bold">{ONBOARDING_COPY.title}</h2>
            <p className="m-0 text-sm text-app-muted">{ONBOARDING_COPY.lead}</p>
          </div>
          <ol className="m-0 grid list-none gap-3 p-0">
            {onboarding.steps.map((item, index) => (
              <li key={item.step} className="grid gap-2 rounded-2xl border border-app-border p-4" aria-current={item.current ? "step" : undefined}>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-bold">{index + 1}. {ONBOARDING_COPY.steps[item.step].title}</h3>
                  <Badge tone={item.done ? "success" : item.current ? "accent" : "neutral"}>{item.done ? ONBOARDING_COPY.done : item.current ? ONBOARDING_COPY.current : ONBOARDING_COPY.next}</Badge>
                </div>
                <p className="m-0 text-sm">{ONBOARDING_COPY.steps[item.step].body}</p>
                {item.current && item.step === "create" && !usage.reached ? <div><Link className="ui-button ui-button-primary" href={`/app/w/${workspaceId}/paginas/nova`}>{ONBOARDING_COPY.actions.create}</Link></div> : null}
                {item.current && item.step === "publish" && firstPage ? <div><Link className="ui-button ui-button-primary" href={`/app/w/${workspaceId}/paginas/${firstPage.id}`}>{ONBOARDING_COPY.actions.publish}</Link></div> : null}
              </li>
            ))}
          </ol>
          <p className="m-0"><Link className="inline-flex min-h-11 items-center text-sm font-bold text-app-accent underline" href="/ajuda">{ONBOARDING_COPY.actions.help}</Link></p>
        </section>
      ) : null}

      {mayCreate && usage.reached ? <><Notice tone="warning">{copy.limitReached(usage.limit)}</Notice><UpgradeLink workspaceId={workspaceId} role={access.role} reason="max_profiles" /></> : null}
      {!mayCreate ? <p className="m-0 text-app-muted">{copy.createForbidden}</p> : null}

      {list.total === 0 ? (
        <EmptyState title={copy.emptyTitle} description={copy.emptyDescription} action={mayCreate && !usage.reached ? <Link className="ui-button ui-button-primary" href={`/app/w/${workspaceId}/paginas/nova`}>{copy.create}</Link> : undefined} />
      ) : (
        <>
          {list.searchable ? (
            <section className="page-toolbar" aria-label={copy.search.label}>
              <form action={`/app/w/${workspaceId}`} method="get" role="search" className="page-search">
                <label htmlFor="page-search" className="sr-only">{copy.search.label}</label>
                {SearchIcon}
                <input id="page-search" name="q" type="search" className="page-search-input" defaultValue={listParams.search} placeholder={copy.search.placeholder} maxLength={80} autoComplete="off" enterKeyHint="search" />
                {listParams.status ? <input type="hidden" name="situacao" value={single(query.situacao) ?? ""} /> : null}
                {listParams.order === "name" ? <input type="hidden" name="ordem" value="nome" /> : null}
                <button type="submit" className="ui-button ui-button-primary page-search-submit">{copy.search.submit}</button>
              </form>
              <nav aria-label={copy.filter.label} className="page-filters">
                {FILTERS.map((status) => {
                  const current = listParams.status === status;
                  const total = status === null ? list.total : list.counts[status];
                  return (
                    <Link key={status ?? "all"} href={here({ status, page: 1 })} aria-current={current ? "true" : undefined} className="page-filter">
                      {copy.filter[status ?? "all"]} <span className="page-filter-count">{total}</span>
                    </Link>
                  );
                })}
              </nav>
              <Link href={here({ order: listParams.order === "name" ? "recent" : "name", page: 1 })} className="page-order">
                {SortIcon}{copy.order.label}: {copy.order[listParams.order]}
              </Link>
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
            <ul className="surface-card page-rows">
              {list.items.map((profile) => {
                const pagePath = `/app/w/${workspaceId}/paginas/${profile.id}`;
                return (
                  <li key={profile.id} className="page-row">
                    <div className="page-row-identity">
                      <ProfileAvatar title={profile.title} avatarPath={profile.avatarPath} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                          <h2 className="m-0 min-w-0 truncate text-base font-bold leading-tight sm:text-lg">{profile.title}</h2>
                          <Badge dot tone={STATUS_TONE[profile.status]}>{copy.status[profile.status]}</Badge>
                          {profile.hasUnpublishedChanges ? <Badge tone="warning">{copy.unpublishedChanges}</Badge> : null}
                        </div>
                        <p className="page-row-meta">
                          {/* Only a published page has something to open; the others show the address they keep. */}
                          {profile.status === "published"
                            ? <a className="page-row-address" href={publicPageUrl(profile.slug)} target="_blank" rel="noopener noreferrer"><span className="truncate">{publicAddressLabel(profile.slug)}</span><span className="sr-only"> {copy.opensInNewTab}</span>{ExternalIcon}</a>
                            : <span className="truncate">{publicAddressLabel(profile.slug)}</span>}
                        </p>
                      </div>
                    </div>
                    <div className="page-row-actions">
                      <Link className="ui-button ui-button-primary" href={pagePath} aria-label={`${copy.settings}: ${profile.title}`}>{copy.settings}</Link>
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
