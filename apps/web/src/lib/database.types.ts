
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "analytics_daily": {
                  Row: {
                    "count": number,"day": string,"dimension": Database["public"]['Enums']["analytics_dimension"],"event_type": Database["public"]['Enums']["analytics_event_type"],"key": string,"profile_id": string,"workspace_id": string
                  }
                  Insert: {
                    "count": number,"day": string,"dimension": Database["public"]['Enums']["analytics_dimension"],"event_type": Database["public"]['Enums']["analytics_event_type"],"key"?: string,"profile_id": string,"workspace_id": string
                  }
                  Update: {
                    "count"?: number,"day"?: string,"dimension"?: Database["public"]['Enums']["analytics_dimension"],"event_type"?: Database["public"]['Enums']["analytics_event_type"],"key"?: string,"profile_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "analytics_daily_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "analytics_daily_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"analytics_day_status": {
                  Row: {
                    "aggregated_at": string,"day": string,"event_count": number,"finalized_at": string | null
                  }
                  Insert: {
                    "aggregated_at"?: string,"day": string,"event_count"?: number,"finalized_at"?: string | null
                  }
                  Update: {
                    "aggregated_at"?: string,"day"?: string,"event_count"?: number,"finalized_at"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"analytics_events": {
                  Row: {
                    "block_id": string | null,"country": string | null,"day": string,"device": Database["public"]['Enums']["analytics_device"] | null,"event_id": string,"event_type": Database["public"]['Enums']["analytics_event_type"],"occurred_at": string,"profile_id": string,"source": Database["public"]['Enums']["analytics_source"] | null,"utm_campaign": string | null,"utm_medium": string | null,"utm_source": string | null,"visitor_hash": string | null,"workspace_id": string
                  }
                  Insert: {
                    "block_id"?: string | null,"country"?: string | null,"day": string,"device"?: Database["public"]['Enums']["analytics_device"] | null,"event_id": string,"event_type": Database["public"]['Enums']["analytics_event_type"],"occurred_at"?: string,"profile_id": string,"source"?: Database["public"]['Enums']["analytics_source"] | null,"utm_campaign"?: string | null,"utm_medium"?: string | null,"utm_source"?: string | null,"visitor_hash"?: string | null,"workspace_id": string
                  }
                  Update: {
                    "block_id"?: string | null,"country"?: string | null,"day"?: string,"device"?: Database["public"]['Enums']["analytics_device"] | null,"event_id"?: string,"event_type"?: Database["public"]['Enums']["analytics_event_type"],"occurred_at"?: string,"profile_id"?: string,"source"?: Database["public"]['Enums']["analytics_source"] | null,"utm_campaign"?: string | null,"utm_medium"?: string | null,"utm_source"?: string | null,"visitor_hash"?: string | null,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "analytics_events_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "analytics_events_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"analytics_rate_hits": {
                  Row: {
                    "client_hash": string,"count": number,"window_start": string
                  }
                  Insert: {
                    "client_hash": string,"count": number,"window_start": string
                  }
                  Update: {
                    "client_hash"?: string,"count"?: number,"window_start"?: string
                  }
                  Relationships: [
                    
                  ]
                },"analytics_settings": {
                  Row: {
                    "collection_started_at": string,"id": boolean,"max_raw_events": number,"reporting_timezone": string
                  }
                  Insert: {
                    "collection_started_at"?: string,"id"?: boolean,"max_raw_events"?: number,"reporting_timezone"?: string
                  }
                  Update: {
                    "collection_started_at"?: string,"id"?: boolean,"max_raw_events"?: number,"reporting_timezone"?: string
                  }
                  Relationships: [
                    
                  ]
                },"audit_events": {
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
                },"billing_customers": {
                  Row: {
                    "created_at": string,"created_by": string | null,"provider": string,"provider_customer_id": string,"workspace_id": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"provider": string,"provider_customer_id": string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"provider"?: string,"provider_customer_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "billing_customers_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: true
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"billing_events": {
                  Row: {
                    "observed_at": string,"outcome": string,"provider": string,"provider_event_id": string,"reason": string,"received_at": string,"workspace_id": string | null
                  }
                  Insert: {
                    "observed_at": string,"outcome": string,"provider": string,"provider_event_id": string,"reason": string,"received_at"?: string,"workspace_id"?: string | null
                  }
                  Update: {
                    "observed_at"?: string,"outcome"?: string,"provider"?: string,"provider_event_id"?: string,"reason"?: string,"received_at"?: string,"workspace_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"billing_invoices": {
                  Row: {
                    "amount_cents": number,"created_at": string,"currency": string,"id": string,"issued_at": string,"paid_at": string | null,"provider": string,"provider_invoice_id": string,"receipt_url": string | null,"status": string,"subscription_id": string,"updated_at": string,"workspace_id": string
                  }
                  Insert: {
                    "amount_cents": number,"created_at"?: string,"currency": string,"id"?: string,"issued_at": string,"paid_at"?: string | null,"provider": string,"provider_invoice_id": string,"receipt_url"?: string | null,"status": string,"subscription_id": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "amount_cents"?: number,"created_at"?: string,"currency"?: string,"id"?: string,"issued_at"?: string,"paid_at"?: string | null,"provider"?: string,"provider_invoice_id"?: string,"receipt_url"?: string | null,"status"?: string,"subscription_id"?: string,"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "billing_invoices_subscription_id_fkey"
      columns: ["subscription_id"]
isOneToOne: false
      referencedRelation: "billing_subscriptions"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "billing_invoices_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"billing_subscriptions": {
                  Row: {
                    "amount_cents": number,"billing_interval": Database["public"]['Enums']["billing_interval"],"cancel_at_period_end": boolean,"created_at": string,"currency": string,"current_period_end": string | null,"ended_at": string | null,"grace_expired_at": string | null,"grace_until": string | null,"granted_plan_id": string | null,"held_plan_id": string | null,"held_until": string | null,"id": string,"observed_at": string,"plan_id": string,"provider": string,"provider_customer_id": string,"provider_subscription_id": string,"status": Database["public"]['Enums']["billing_subscription_status"],"updated_at": string,"workspace_id": string
                  }
                  Insert: {
                    "amount_cents": number,"billing_interval": Database["public"]['Enums']["billing_interval"],"cancel_at_period_end"?: boolean,"created_at"?: string,"currency": string,"current_period_end"?: string | null,"ended_at"?: string | null,"grace_expired_at"?: string | null,"grace_until"?: string | null,"granted_plan_id"?: string | null,"held_plan_id"?: string | null,"held_until"?: string | null,"id"?: string,"observed_at": string,"plan_id": string,"provider": string,"provider_customer_id": string,"provider_subscription_id": string,"status": Database["public"]['Enums']["billing_subscription_status"],"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "amount_cents"?: number,"billing_interval"?: Database["public"]['Enums']["billing_interval"],"cancel_at_period_end"?: boolean,"created_at"?: string,"currency"?: string,"current_period_end"?: string | null,"ended_at"?: string | null,"grace_expired_at"?: string | null,"grace_until"?: string | null,"granted_plan_id"?: string | null,"held_plan_id"?: string | null,"held_until"?: string | null,"id"?: string,"observed_at"?: string,"plan_id"?: string,"provider"?: string,"provider_customer_id"?: string,"provider_subscription_id"?: string,"status"?: Database["public"]['Enums']["billing_subscription_status"],"updated_at"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "billing_subscriptions_granted_plan_id_fkey"
      columns: ["granted_plan_id"]
isOneToOne: false
      referencedRelation: "plans"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "billing_subscriptions_held_plan_id_fkey"
      columns: ["held_plan_id"]
isOneToOne: false
      referencedRelation: "plans"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "billing_subscriptions_plan_id_fkey"
      columns: ["plan_id"]
isOneToOne: false
      referencedRelation: "plans"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "billing_subscriptions_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"form_leads": {
                  Row: {
                    "block_id": string,"consent_given": boolean,"consent_required": boolean,"consent_text": string,"consent_version": string,"consented_at": string | null,"created_at": string,"dedupe_key": string,"email": string | null,"id": string,"message": string | null,"name": string | null,"phone": string | null,"profile_id": string,"publication_version": number,"purge_after": string,"workspace_id": string
                  }
                  Insert: {
                    "block_id": string,"consent_given": boolean,"consent_required": boolean,"consent_text": string,"consent_version": string,"consented_at"?: string | null,"created_at"?: string,"dedupe_key": string,"email"?: string | null,"id"?: string,"message"?: string | null,"name"?: string | null,"phone"?: string | null,"profile_id": string,"publication_version": number,"purge_after": string,"workspace_id": string
                  }
                  Update: {
                    "block_id"?: string,"consent_given"?: boolean,"consent_required"?: boolean,"consent_text"?: string,"consent_version"?: string,"consented_at"?: string | null,"created_at"?: string,"dedupe_key"?: string,"email"?: string | null,"id"?: string,"message"?: string | null,"name"?: string | null,"phone"?: string | null,"profile_id"?: string,"publication_version"?: number,"purge_after"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "form_leads_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "form_leads_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"form_submission_hits": {
                  Row: {
                    "client_hash": string,"created_at": string,"id": number,"profile_id": string
                  }
                  Insert: {
                    "client_hash": string,"created_at"?: string,"id"?: never,"profile_id": string
                  }
                  Update: {
                    "client_hash"?: string,"created_at"?: string,"id"?: never,"profile_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "form_submission_hits_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"media_asset_shares": {
                  Row: {
                    "created_at": string,"media_id": string,"profile_id": string,"workspace_id": string
                  }
                  Insert: {
                    "created_at"?: string,"media_id": string,"profile_id": string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"media_id"?: string,"profile_id"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "media_asset_shares_media_id_fkey"
      columns: ["media_id"]
isOneToOne: false
      referencedRelation: "media_assets"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "media_asset_shares_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "media_asset_shares_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"media_assets": {
                  Row: {
                    "activated_at": string | null,"bytes": number,"content_type": string,"created_at": string,"created_by": string | null,"height": number,"id": string,"kind": Database["public"]['Enums']["media_kind"],"profile_id": string,"status": Database["public"]['Enums']["media_status"],"variants": NonNullable<Json>,"width": number,"workspace_id": string
                  }
                  Insert: {
                    "activated_at"?: string | null,"bytes": number,"content_type"?: string,"created_at"?: string,"created_by"?: string | null,"height": number,"id": string,"kind": Database["public"]['Enums']["media_kind"],"profile_id": string,"status"?: Database["public"]['Enums']["media_status"],"variants": NonNullable<Json>,"width": number,"workspace_id": string
                  }
                  Update: {
                    "activated_at"?: string | null,"bytes"?: number,"content_type"?: string,"created_at"?: string,"created_by"?: string | null,"height"?: number,"id"?: string,"kind"?: Database["public"]['Enums']["media_kind"],"profile_id"?: string,"status"?: Database["public"]['Enums']["media_status"],"variants"?: NonNullable<Json>,"width"?: number,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "media_assets_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "media_assets_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
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
                },"plan_prices": {
                  Row: {
                    "amount_cents": number,"billing_interval": Database["public"]['Enums']["billing_interval"],"created_at": string,"currency": string,"plan_id": string
                  }
                  Insert: {
                    "amount_cents": number,"billing_interval": Database["public"]['Enums']["billing_interval"],"created_at"?: string,"currency": string,"plan_id": string
                  }
                  Update: {
                    "amount_cents"?: number,"billing_interval"?: Database["public"]['Enums']["billing_interval"],"created_at"?: string,"currency"?: string,"plan_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "plan_prices_plan_id_fkey"
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
                    "avatar_path": string | null,"bio": string,"blocks": NonNullable<Json>,"created_at": string,"created_by": string | null,"deleted_at": string | null,"draft_revision": number,"duplicated_from": string | null,"id": string,"live_publication_id": string | null,"published_at": string | null,"purge_after": string | null,"slug": string,"social_links": NonNullable<Json>,"status": Database["public"]['Enums']["profile_status"],"theme": Json | null,"title": string,"updated_at": string,"workspace_id": string
                  }
                  Insert: {
                    "avatar_path"?: string | null,"bio"?: string,"blocks"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"draft_revision"?: number,"duplicated_from"?: string | null,"id"?: string,"live_publication_id"?: string | null,"published_at"?: string | null,"purge_after"?: string | null,"slug": string,"social_links"?: NonNullable<Json>,"status"?: Database["public"]['Enums']["profile_status"],"theme"?: Json | null,"title": string,"updated_at"?: string,"workspace_id": string
                  }
                  Update: {
                    "avatar_path"?: string | null,"bio"?: string,"blocks"?: NonNullable<Json>,"created_at"?: string,"created_by"?: string | null,"deleted_at"?: string | null,"draft_revision"?: number,"duplicated_from"?: string | null,"id"?: string,"live_publication_id"?: string | null,"published_at"?: string | null,"purge_after"?: string | null,"slug"?: string,"social_links"?: NonNullable<Json>,"status"?: Database["public"]['Enums']["profile_status"],"theme"?: Json | null,"title"?: string,"updated_at"?: string,"workspace_id"?: string
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
                },"report_links": {
                  Row: {
                    "created_at": string,"created_by": string | null,"expires_at": string,"id": string,"label": string | null,"period_days": number,"profile_id": string,"revoked_at": string | null,"revoked_by": string | null,"token_hash": string,"workspace_id": string
                  }
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"expires_at": string,"id"?: string,"label"?: string | null,"period_days": number,"profile_id": string,"revoked_at"?: string | null,"revoked_by"?: string | null,"token_hash": string,"workspace_id": string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"expires_at"?: string,"id"?: string,"label"?: string | null,"period_days"?: number,"profile_id"?: string,"revoked_at"?: string | null,"revoked_by"?: string | null,"token_hash"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "report_links_profile_id_fkey"
      columns: ["profile_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "report_links_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
                  ]
                },"report_lookup_failures": {
                  Row: {
                    "client_hash": string,"created_at": string,"id": number
                  }
                  Insert: {
                    "client_hash": string,"created_at"?: string,"id"?: never
                  }
                  Update: {
                    "client_hash"?: string,"created_at"?: string,"id"?: never
                  }
                  Relationships: [
                    
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
                },"workspace_invitations": {
                  Row: {
                    "accepted_at": string | null,"accepted_by": string | null,"created_at": string,"email": string,"expires_at": string,"id": string,"invited_by": string | null,"revoked_at": string | null,"revoked_by": string | null,"role": Database["public"]['Enums']["workspace_role"],"token_hash": string,"workspace_id": string
                  }
                  Insert: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"created_at"?: string,"email": string,"expires_at": string,"id"?: string,"invited_by"?: string | null,"revoked_at"?: string | null,"revoked_by"?: string | null,"role": Database["public"]['Enums']["workspace_role"],"token_hash": string,"workspace_id": string
                  }
                  Update: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"created_at"?: string,"email"?: string,"expires_at"?: string,"id"?: string,"invited_by"?: string | null,"revoked_at"?: string | null,"revoked_by"?: string | null,"role"?: Database["public"]['Enums']["workspace_role"],"token_hash"?: string,"workspace_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "workspace_invitations_workspace_id_fkey"
      columns: ["workspace_id"]
isOneToOne: false
      referencedRelation: "workspaces"
      referencedColumns: ["id"]
    }
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
            "accept_workspace_invitation":
{ Args: { "p_token": string }; Returns: {
              "state": string,"workspace_id": string
            }[]
                           },
"activate_media_asset":
{ Args: { "p_media_id": string,"p_signature": string }; Returns: undefined
                           },
"apply_billing_snapshot":
{ Args: { "p_payload": string,"p_signature": string }; Returns: Json
                           },
"archive_profile":
{ Args: { "p_profile_id": string }; Returns: {
              "slug": string,"was_published": boolean
            }[]
                           },
"begin_billing_change":
{ Args: { "p_kind": string,"p_plan_id"?: string,"p_workspace_id": string }; Returns: {
              "amount_cents": number,"billing_interval": Database["public"]['Enums']["billing_interval"],"plan_id": string,"provider_customer_id": string,"provider_subscription_id": string
            }[]
                           },
"begin_billing_checkout":
{ Args: { "p_interval": Database["public"]['Enums']["billing_interval"],"p_plan_id": string,"p_workspace_id": string }; Returns: undefined
                           },
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
"claim_media_cleanup":
{ Args: { "p_limit"?: number }; Returns: {
              "media_id": string,"object_names": (string)[]
            }[]
                           },
"create_agency_workspace":
{ Args: { "p_name": string }; Returns: string
                           },
"create_report_link":
{ Args: { "p_expires_in_days": number,"p_label"?: string,"p_period_days": number,"p_profile_id": string,"p_token_hash": string }; Returns: {
              "expires_at": string,"link_id": string
            }[]
                           },
"create_workspace_invitation":
{ Args: { "p_email": string,"p_role": Database["public"]['Enums']["workspace_role"],"p_token_hash": string,"p_workspace_id": string }; Returns: {
              "expires_at": string,"invitation_id": string
            }[]
                           },
"delete_form_lead":
{ Args: { "p_lead_id": string }; Returns: undefined
                           },
"duplicate_profile":
{ Args: { "p_profile_id": string,"p_slug": string,"p_title": string }; Returns: string
                           },
"ensure_personal_workspace":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"fail_media_asset":
{ Args: { "p_media_id": string }; Returns: undefined
                           },
"finish_media_cleanup":
{ Args: { "p_media_ids": (string)[] }; Returns: number
                           },
"get_profile_analytics":
{ Args: { "p_from": string,"p_profile_id": string,"p_to": string }; Returns: Json
                           },
"get_public_page":
{ Args: { "p_slug": string }; Returns: {
              "canonical_slug": string,"document": Json,"published_at": string,"show_badge": boolean,"state": string,"version": number
            }[]
                           },
"get_shared_report":
{ Args: { "p_client"?: string,"p_token": string }; Returns: Json
                           },
"get_workspace_analytics":
{ Args: { "p_from": string,"p_to": string,"p_workspace_id": string }; Returns: Json
                           },
"get_workspace_invitation":
{ Args: { "p_token": string }; Returns: {
              "expires_at": string,"inviter_name": string,"role": Database["public"]['Enums']["workspace_role"],"state": string,"workspace_id": string,"workspace_name": string
            }[]
                           },
"ingest_analytics_events":
{ Args: { "p_payload": string,"p_signature": string }; Returns: Json
                           },
"list_workspace_members":
{ Args: { "p_workspace_id": string }; Returns: {
              "display_name": string,"email": string,"is_self": boolean,"joined_at": string,"membership_id": string,"role": Database["public"]['Enums']["workspace_role"],"user_id": string
            }[]
                           },
"list_workspace_profiles":
{ Args: { "p_limit"?: number,"p_offset"?: number,"p_order"?: string,"p_search"?: string,"p_slug_search"?: string,"p_status"?: Database["public"]['Enums']["profile_status"],"p_workspace_id": string }; Returns: {
              "archived_pages": number,"draft_pages": number,"items": Json,"matched_pages": number,"published_pages": number,"total_pages": number
            }[]
                           },
"publish_profile":
{ Args: { "p_expected_revision"?: number,"p_profile_id": string }; Returns: {
              "created": boolean,"publication_id": string,"version": number
            }[]
                           },
"record_analytics_export":
{ Args: { "p_from": string,"p_profile_id": string,"p_rows": number,"p_to": string }; Returns: undefined
                           },
"record_auth_event":
{ Args: { "p_action": Database["public"]['Enums']["audit_action"],"p_metadata"?: Json }; Returns: undefined
                           },
"record_lead_export":
{ Args: { "p_count": number,"p_profile_id": string }; Returns: undefined
                           },
"record_workspace_analytics_export":
{ Args: { "p_from": string,"p_rows": number,"p_to": string,"p_workspace_id": string }; Returns: undefined
                           },
"register_billing_customer":
{ Args: { "p_customer_id": string,"p_signature": string,"p_workspace_id": string }; Returns: string
                           },
"register_media_asset":
{ Args: { "p_height": number,"p_kind": Database["public"]['Enums']["media_kind"],"p_media_id": string,"p_profile_id": string,"p_signature": string,"p_variants": Json,"p_width": number }; Returns: undefined
                           },
"remove_workspace_member":
{ Args: { "p_membership_id": string }; Returns: undefined
                           },
"restore_profile_publication":
{ Args: { "p_profile_id": string,"p_publication_id": string }; Returns: number
                           },
"revoke_report_link":
{ Args: { "p_link_id": string }; Returns: undefined
                           },
"revoke_workspace_invitation":
{ Args: { "p_invitation_id": string }; Returns: undefined
                           },
"run_analytics_maintenance":
{ Args: { "p_day"?: string }; Returns: Json
                           },
"run_billing_maintenance":
{ Args: { "p_limit"?: number,"p_now"?: string }; Returns: Json
                           },
"soft_delete_profile":
{ Args: { "p_profile_id": string }; Returns: undefined
                           },
"soft_delete_workspace":
{ Args: { "p_workspace_id": string }; Returns: undefined
                           },
"submit_form_lead":
{ Args: { "p_block_id": string,"p_client_hash"?: string,"p_consent"?: boolean,"p_fields": Json,"p_honeypot"?: string,"p_slug": string }; Returns: string
                           },
"unarchive_profile":
{ Args: { "p_profile_id": string }; Returns: undefined
                           },
"unpublish_profile":
{ Args: { "p_profile_id": string }; Returns: undefined
                           },
"workspace_storage_usage":
{ Args: { "p_workspace_id": string }; Returns: {
              "limit_bytes": number,"used_bytes": number
            }[]
                           }
          }
          Enums: {
            "analytics_device": "mobile"|"tablet"|"desktop"|"unknown","analytics_dimension": "total"|"block"|"source"|"utm"|"device"|"country","analytics_event_type": "page_view"|"link_click"|"social_click"|"embed_load"|"whatsapp_click"|"pix_copy"|"pix_pay_click"|"form_submit"|"badge_click","analytics_source": "direct"|"instagram"|"facebook"|"whatsapp"|"tiktok"|"youtube"|"x"|"linkedin"|"telegram"|"google"|"search"|"other","audit_action": "auth.sign_in"|"auth.sign_out"|"auth.password_reset_completed"|"workspace.created"|"workspace.deleted"|"membership.role_changed"|"membership.removed"|"profile.slug_changed"|"profile.deleted"|"profile.published"|"profile.unpublished"|"profile.publication_restored"|"lead.deleted"|"lead.exported"|"analytics.exported"|"profile.archived"|"profile.unarchived"|"profile.duplicated"|"invitation.created"|"invitation.revoked"|"invitation.accepted"|"report_link.created"|"report_link.revoked"|"billing.checkout_started"|"billing.change_requested"|"billing.subscription_changed"|"billing.plan_changed","billing_interval": "month"|"year","billing_subscription_status": "incomplete"|"active"|"past_due"|"ended","entitlement_key": "max_profiles"|"analytics_days"|"team_members"|"custom_domain"|"remove_badge"|"shareable_reports"|"storage_mb","media_kind": "avatar"|"image","media_status": "pending"|"ready"|"failed"|"deleting","membership_status": "invited"|"active"|"revoked","profile_status": "draft"|"published"|"archived","slug_release_reason": "changed"|"deleted","workspace_kind": "personal"|"agency","workspace_role": "owner"|"admin"|"editor","workspace_status": "active"|"suspended"
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
            "analytics_device": ["mobile", "tablet", "desktop", "unknown"],"analytics_dimension": ["total", "block", "source", "utm", "device", "country"],"analytics_event_type": ["page_view", "link_click", "social_click", "embed_load", "whatsapp_click", "pix_copy", "pix_pay_click", "form_submit", "badge_click"],"analytics_source": ["direct", "instagram", "facebook", "whatsapp", "tiktok", "youtube", "x", "linkedin", "telegram", "google", "search", "other"],"audit_action": ["auth.sign_in", "auth.sign_out", "auth.password_reset_completed", "workspace.created", "workspace.deleted", "membership.role_changed", "membership.removed", "profile.slug_changed", "profile.deleted", "profile.published", "profile.unpublished", "profile.publication_restored", "lead.deleted", "lead.exported", "analytics.exported", "profile.archived", "profile.unarchived", "profile.duplicated", "invitation.created", "invitation.revoked", "invitation.accepted", "report_link.created", "report_link.revoked", "billing.checkout_started", "billing.change_requested", "billing.subscription_changed", "billing.plan_changed"],"billing_interval": ["month", "year"],"billing_subscription_status": ["incomplete", "active", "past_due", "ended"],"entitlement_key": ["max_profiles", "analytics_days", "team_members", "custom_domain", "remove_badge", "shareable_reports", "storage_mb"],"media_kind": ["avatar", "image"],"media_status": ["pending", "ready", "failed", "deleting"],"membership_status": ["invited", "active", "revoked"],"profile_status": ["draft", "published", "archived"],"slug_release_reason": ["changed", "deleted"],"workspace_kind": ["personal", "agency"],"workspace_role": ["owner", "admin", "editor"],"workspace_status": ["active", "suspended"]
          }
        }
} as const

