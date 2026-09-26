
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "audit_events": {
                  Row: {
                    "action": Database["public"]['Enums']["audit_action"],"actor_user_id": string | null,"created_at": string,"id": number,"metadata": NonNullable<Json>,"target_id": string | null,"target_type": string | null,"workspace_id": string | null
                  }
                  Insert: {
                    "action": Database["public"]['Enums']["audit_action"],"actor_user_id"?: string | null,"created_at"?: string,"id"?: never,"metadata"?: NonNullable<Json>,"target_id"?: string | null,"target_type"?: string | null,"workspace_id"?: string | null
                  }
                  Update: {
                    "action"?: Database["public"]['Enums']["audit_action"],"actor_user_id"?: string | null,"created_at"?: string,"id"?: never,"metadata"?: NonNullable<Json>,"target_id"?: string | null,"target_type"?: string | null,"workspace_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"plan_entitlements": {
                  Row: {
                    "bool_value": boolean | null,"created_at": string,"int_value": number | null,"key": Database["public"]['Enums']["entitlement_key"],"plan_id": string
                  }
                  Insert: {
                    "bool_value"?: boolean | null,"created_at"?: string,"int_value"?: number | null,"key": Database["public"]['Enums']["entitlement_key"],"plan_id": string
                  }
                  Update: {
                    "bool_value"?: boolean | null,"created_at"?: string,"int_value"?: number | null,"key"?: Database["public"]['Enums']["entitlement_key"],"plan_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "plan_entitlements_plan_id_fkey"
      columns: ["plan_id"]
isOneToOne: false
      referencedRelation: "plans"
      referencedColumns: ["id"]
    }
                  ]
                },"plans": {
                  Row: {
                    "created_at": string,"id": string,"name": string
                  }
                  Insert: {
                    "created_at"?: string,"id": string,"name": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"profile_publications": {
                  Row: {
                    "created_at": string,"document": NonNullable<Json>,"id": string,"profile_id": string,"published_by": string | null,"schema_version": number,"source_revision": number,"version": number,"workspace_id": string
                  }
                  Insert: {
                    "created_at"?: string,"document": NonNullable<Json>,"id"?: string,"profile_id": string,"published_by"?: string | null,"schema_version"?: number,"source_revision": number,"version": number,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"document"?: NonNullable<Json>,"id"?: string,"profile_id"?: string,"published_by"?: string | null,"schema_version"?: number,"source_revision"?: number,"version"?: number,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "profile_publications_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "profile_publications_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "avatar_path": string | null,"bio": string,"blocks": NonNullable<Json>,"created_at": string,"created_by": string | null,"deleted_at": string | null,"draft_revision": number,"id": string,"live_publication_id": string | null,"published_at": string | null,"purge_after": string | null,"slug": string,"social_links": NonNullable<Json>,"status": Database["public"]['Enums']["profile_status"],"title": string,"updated_at": string,"workspace_id": string
                  }
                  Insert: {
                    "avatar_path"?: string | null,"bio"?: string,"blocks"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"draft_revision"?: number,"id"?: string,"live_publication_id"?: string | null,"published_at"?: string | null,"purge_after"?: string | null,"slug": string,"social_links"?: NonNullable<Json>,"status"?: Database["public"]['Enums']["profile_status"],"title": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "avatar_path"?: string | null,"bio"?: string,"blocks"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"draft_revision"?: number,"id"?: string,"live_publication_id"?: string | null,"published_at"?: string | null,"purge_after"?: string | null,"slug"?: string,"social_links"?: NonNullable<Json>,"status"?: Database["public"]['Enums']["profile_status"],"title"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "profiles_live_publication_fkey"
      columns: ["id","live_publication_id"]
isOneToOne: false
      referencedRelation: "profile_publications"
      referencedColumns: ["profile_id","id"]
    },{
      foreignKeyName: "profiles_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"reserved_slugs": {
                  Row: {
                    "created_at": string,"reason": string,"slug": string
                  }
                  Insert: {
                    "created_at"?: string,"reason": string,"slug": string
                  }
                  Update: {
                    "created_at"?: string,"reason"?: string,"slug"?: string
                  }
                  Relationships: [
                    
                  ]
                },"slug_history": {
                  Row: {
                    "hold_until": string,"id": number,"profile_id": string | null,"reason": Database["public"]['Enums']["slug_release_reason"],"released_at": string,"released_by": string | null,"slug": string,"workspace_id": string
                  }
                  Insert: {
                    "hold_until": string,"id"?: never,"profile_id"?: string | null,"reason": Database["public"]['Enums']["slug_release_reason"],"released_at"?: string,"released_by"?: string | null,"slug": string,"workspace_id": string
                  }
                  Update: {
                    "hold_until"?: string,"id"?: never,"profile_id"?: string | null,"reason"?: Database["public"]['Enums']["slug_release_reason"],"released_at"?: string,"released_by"?: string | null,"slug"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "slug_history_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"user_accounts": {
                  Row: {
                    "created_at": string,"deleted_at": string | null,"display_name": string | null,"id": string,"locale": string,"purge_after": string | null,"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"deleted_at"?: string | null,"display_name"?: string | null,"id": string,"locale"?: string,"purge_after"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"deleted_at"?: string | null,"display_name"?: string | null,"id"?: string,"locale"?: string,"purge_after"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"waitlist_signups": {
                  Row: {
                    "consent_at": string,"created_at": string,"current_tool": string | null,"email": string,"id": string,"managed_profiles": string,"name": string,"pilot_interest": boolean,"referrer": string | null,"segment": string,"utm_campaign": string | null,"utm_medium": string | null,"utm_source": string | null,"variant": string,"whatsapp": string | null,"willingness_to_pay": string
                  }
                  Insert: {
                    "consent_at": string,"created_at"?: string,"current_tool"?: string | null,"email": string,"id"?: string,"managed_profiles": string,"name": string,"pilot_interest"?: boolean,"referrer"?: string | null,"segment": string,"utm_campaign"?: string | null,"utm_medium"?: string | null,"utm_source"?: string | null,"variant": string,"whatsapp"?: string | null,"willingness_to_pay": string
                  }
                  Update: {
                    "consent_at"?: string,"created_at"?: string,"current_tool"?: string | null,"email"?: string,"id"?: string,"managed_profiles"?: string,"name"?: string,"pilot_interest"?: boolean,"referrer"?: string | null,"segment"?: string,"utm_campaign"?: string | null,"utm_medium"?: string | null,"utm_source"?: string | null,"variant"?: string,"whatsapp"?: string | null,"willingness_to_pay"?: string
                  }
                  Relationships: [
                    
                  ]
                },"workspace_memberships": {
                  Row: {
                    "accepted_at": string | null,"created_at": string,"id": string,"invited_at": string | null,"invited_by": string | null,"revoked_at": string | null,"role": Database["public"]['Enums']["workspace_role"],"status": Database["public"]['Enums']["membership_status"],"updated_at": string,"user_id": string,"workspace_id": string
                  }
                  Insert: {
                    "accepted_at"?: string | null,"created_at"?: string,"id"?: string,"invited_at"?: string | null,"invited_by"?: string | null,"revoked_at"?: string | null,"role": Database["public"]['Enums']["workspace_role"],"status"?: Database["public"]['Enums']["membership_status"],"updated_at"?: string,"user_id": string,"workspace_id": string
                  }
                  Update: {
                    "accepted_at"?: string | null,"created_at"?: string,"id"?: string,"invited_at"?: string | null,"invited_by"?: string | null,"revoked_at"?: string | null,"role"?: Database["public"]['Enums']["workspace_role"],"status"?: Database["public"]['Enums']["membership_status"],"updated_at"?: string,"user_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workspace_memberships_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"workspaces": {
                  Row: {
                    "created_at": string,"created_by": string | null,"deleted_at": string | null,"id": string,"kind": Database["public"]['Enums']["workspace_kind"],"name": string,"plan_id": string,"purge_after": string | null,"status": Database["public"]['Enums']["workspace_status"],"updated_at": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"id"?: string,"kind": Database["public"]['Enums']["workspace_kind"],"name": string,"plan_id"?: string,"purge_after"?: string | null,"status"?: Database["public"]['Enums']["workspace_status"],"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"id"?: string,"kind"?: Database["public"]['Enums']["workspace_kind"],"name"?: string,"plan_id"?: string,"purge_after"?: string | null,"status"?: Database["public"]['Enums']["workspace_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workspaces_plan_id_fkey"
      columns: ["plan_id"]
isOneToOne: false
      referencedRelation: "plans"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "change_member_role":
{ Args: { "p_membership_id": string,"p_role": Database["public"]['Enums']["workspace_role"] }; Returns: undefined
                           },
"change_profile_slug":
{ Args: { "p_profile_id": string,"p_slug": string }; Returns: string
                           },
"check_slug_availability":
{ Args: { "p_slug": string,"p_workspace_id"?: string }; Returns: {
              "normalized": string,"status": string
            }[]
                           },
"create_agency_workspace":
{ Args: { "p_name": string }; Returns: string
                           },
"ensure_personal_workspace":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"get_public_page":
{ Args: { "p_slug": string }; Returns: {
              "canonical_slug": string,"document": Json,"published_at": string,"show_badge": boolean,"state": string,"version": number
            }[]
                           },
"publish_profile":
{ Args: { "p_expected_revision"?: number,"p_profile_id": string }; Returns: {
              "created": boolean,"publication_id": string,"version": number
            }[]
                           },
"record_auth_event":
{ Args: { "p_action": Database["public"]['Enums']["audit_action"],"p_metadata"?: Json }; Returns: undefined
                           },
"remove_workspace_member":
{ Args: { "p_membership_id": string }; Returns: undefined
                           },
"restore_profile_publication":
{ Args: { "p_profile_id": string,"p_publication_id": string }; Returns: number
                           },
"soft_delete_profile":
{ Args: { "p_profile_id": string }; Returns: undefined
                           },
"soft_delete_workspace":
{ Args: { "p_workspace_id": string }; Returns: undefined
                           },
"unpublish_profile":
{ Args: { "p_profile_id": string }; Returns: undefined
                           }
          }
          Enums: {
            "audit_action": "auth.sign_in"|"auth.sign_out"|"auth.password_reset_completed"|"workspace.created"|"workspace.deleted"|"membership.role_changed"|"membership.removed"|"profile.slug_changed"|"profile.deleted"|"profile.published"|"profile.unpublished"|"profile.publication_restored","entitlement_key": "max_profiles"|"analytics_days"|"team_members"|"custom_domain"|"remove_badge"|"shareable_reports","membership_status": "invited"|"active"|"revoked","profile_status": "draft"|"published"|"archived","slug_release_reason": "changed"|"deleted","workspace_kind": "personal"|"agency","workspace_role": "owner"|"admin"|"editor","workspace_status": "active"|"suspended"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "audit_action": ["auth.sign_in", "auth.sign_out", "auth.password_reset_completed", "workspace.created", "workspace.deleted", "membership.role_changed", "membership.removed", "profile.slug_changed", "profile.deleted", "profile.published", "profile.unpublished", "profile.publication_restored"],"entitlement_key": ["max_profiles", "analytics_days", "team_members", "custom_domain", "remove_badge", "shareable_reports"],"membership_status": ["invited", "active", "revoked"],"profile_status": ["draft", "published", "archived"],"slug_release_reason": ["changed", "deleted"],"workspace_kind": ["personal", "agency"],"workspace_role": ["owner", "admin", "editor"],"workspace_status": ["active", "suspended"]
          }
        }
} as const

