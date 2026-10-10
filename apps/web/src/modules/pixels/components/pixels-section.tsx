import { PIXELS_COPY } from "@/content/pt-BR";
import { UpgradeLink } from "@/modules/billing/components/upgrade-link";
import type { WorkspaceRole } from "@/modules/identity/permissions";
import { can } from "@/modules/identity/permissions";
import { Notice } from "@/ui";
import { setPixelsAction } from "../actions";
import { getPixelsService } from "../server";
import { PixelsForm } from "./pixels-form";

/**
 * Meta Pixel and Google Analytics identifiers of one page, in the page settings (ADR 0017). Every
 * member sees what is configured; owners and admins change it. The form is a convenience: the
 * command re-authorizes on the server and the database checks role, plan and format again.
 */
export async function PixelsSection({ workspaceId, profileId, role, inPlan }: { workspaceId: string; profileId: string; role: WorkspaceRole; inPlan: boolean }) {
  const copy = PIXELS_COPY;
  const frame = (children: React.ReactNode) => (
    <section className="surface-card grid grid-cols-[minmax(0,1fr)] content-start gap-4 p-5 sm:p-8" aria-labelledby="pixels-title">
      <h2 id="pixels-title" className="text-xl font-bold">{copy.title}</h2>
      <p className="m-0 text-app-muted">{copy.lead}</p>
      {children}
    </section>
  );

  let found: Awaited<ReturnType<Awaited<ReturnType<typeof getPixelsService>>["get"]>>;
  try {
    found = await (await getPixelsService()).get(profileId);
  } catch {
    return frame(<Notice tone="danger">{copy.loadError}</Notice>);
  }
  if (!found.ok) return frame(<Notice tone={found.error === "not_deployed" ? "neutral" : "danger"}>{found.error === "not_deployed" ? copy.notDeployed : copy.loadError}</Notice>);

  const { metaPixelId, gaMeasurementId } = found.value;
  const configured = metaPixelId !== null || gaMeasurementId !== null;
  const canManage = can(role, "pixels.manage");
  const current = (
    <ul className="m-0 grid list-none gap-1 p-0 font-bold">
      {metaPixelId ? <li className="break-all">{copy.current.meta(metaPixelId)}</li> : null}
      {gaMeasurementId ? <li className="break-all">{copy.current.ga(gaMeasurementId)}</li> : null}
      {configured ? null : <li className="font-normal text-app-muted">{copy.current.none}</li>}
    </ul>
  );

  if (!inPlan) {
    return frame(
      <>
        <Notice tone={configured ? "warning" : "neutral"}>{configured ? copy.suspendedByPlan : copy.notInPlan}</Notice>
        <UpgradeLink workspaceId={workspaceId} role={role} reason="tracking_pixels" />
        {/* Clearing is always allowed, so identifiers left from a previous plan can be removed. */}
        {configured ? (canManage ? <PixelsForm action={setPixelsAction.bind(null, profileId)} initial={{ meta: metaPixelId ?? "", ga: gaMeasurementId ?? "" }} /> : current) : null}
      </>,
    );
  }

  return frame(
    <>
      <p className="m-0 text-sm text-app-muted">{copy.consentNotice}</p>
      {canManage ? (
        <>
          <PixelsForm action={setPixelsAction.bind(null, profileId)} initial={{ meta: metaPixelId ?? "", ga: gaMeasurementId ?? "" }} />
          <p className="m-0 text-sm text-app-muted">{copy.responsibility}</p>
        </>
      ) : (
        <>{current}<p className="m-0 text-app-muted">{copy.viewOnly}</p></>
      )}
    </>,
  );
}
