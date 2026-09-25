import type { PageDocument } from "@/modules/editor/model";

export type Scenario = "new-user" | "agency";
export type AnalyticsMode = "data" | "no-data" | "zero" | "loading" | "error";
export type PrototypeEventName =
  | "session_started" | "signup_completed" | "goal_selected" | "template_selected" | "slug_chosen"
  | "block_added" | "block_edited" | "preview_opened" | "publish_clicked" | "publish_succeeded"
  | "publish_failed" | "error_shown" | "workspace_switched" | "profile_list_viewed"
  | "profile_creation_started" | "profile_duplicated" | "report_link_created" | "report_viewed"
  | "analytics_viewed" | "public_link_copied";

export interface PrototypeEvent { name: PrototypeEventName; at: string; detail?: string; }
export interface DebugFlags { forceSaveError: boolean; slowSave: boolean; forcePublishError: boolean; analyticsMode: AnalyticsMode; }
export interface ReportLink { token: string; profileId: string; workspaceName: string; period: string; expiresAt: string; status: "active" | "revoked" | "expired"; createdAt: string; }

export interface ProtoState {
  version: 1;
  scenario: Scenario;
  sessionStartedAt: string;
  profiles: PageDocument[];
  reports: ReportLink[];
  events: PrototypeEvent[];
  debug: DebugFlags;
  user?: { name: string; email: string };
}
