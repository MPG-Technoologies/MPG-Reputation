export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string
          name: string
          slug: string
          country: string
          timezone: string
          status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          slug: string
          country?: string
          timezone?: string
          status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          slug?: string
          country?: string
          timezone?: string
          status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      organization_users: {
        Row: {
          id: string
          organization_id: string
          user_id: string
          role: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          user_id: string
          role?: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER'
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          user_id?: string
          role?: 'OWNER' | 'ADMIN' | 'OPERATOR' | 'VIEWER'
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_users_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          }
        ]
      }
      locations: {
        Row: {
          id: string
          organization_id: string
          name: string
          address: string | null
          country: string
          timezone: string
          status: 'ACTIVE' | 'INACTIVE'
            review_reply_to_email: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          address?: string | null
          country?: string
          timezone?: string
          status?: 'ACTIVE' | 'INACTIVE'
            review_reply_to_email?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          name?: string
          address?: string | null
          country?: string
          timezone?: string
          status?: 'ACTIVE' | 'INACTIVE'
            review_reply_to_email?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          id: string
          organization_id: string
          location_id: string
          first_name: string
          last_name: string | null
          email: string | null
          phone: string | null
          permission_email: 'allowed' | 'unknown' | 'denied'
          permission_sms: 'allowed' | 'unknown' | 'denied'
          permission_source: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          location_id: string
          first_name: string
          last_name?: string | null
          email?: string | null
          phone?: string | null
          permission_email?: 'allowed' | 'unknown' | 'denied'
          permission_sms?: 'allowed' | 'unknown' | 'denied'
          permission_source?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          location_id?: string
          first_name?: string
          last_name?: string | null
          email?: string | null
          phone?: string | null
          permission_email?: 'allowed' | 'unknown' | 'denied'
          permission_sms?: 'allowed' | 'unknown' | 'denied'
          permission_source?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      completion_api_credentials: {
        Row: {
          id: string
          organization_id: string
          name: string
          secret_hash: string
          status: 'ACTIVE' | 'REVOKED'
          rate_limit_per_minute: number
          last_used_at: string | null
          revoked_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name?: string
          secret_hash: string
          status?: 'ACTIVE' | 'REVOKED'
          rate_limit_per_minute?: number
          last_used_at?: string | null
          revoked_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          name?: string
          secret_hash?: string
          status?: 'ACTIVE' | 'REVOKED'
          rate_limit_per_minute?: number
          last_used_at?: string | null
          revoked_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      completion_ingestion_requests: {
        Row: {
          id: string
          organization_id: string
          credential_id: string
          nonce: string
          request_timestamp: string
          request_body_hash: string
          source_event_id: string | null
          location_id: string | null
          completion_event_id: string | null
          status:
            | 'CLAIMED'
            | 'ACCEPTED'
            | 'DUPLICATE'
            | 'REJECTED'
            | 'FAILED'
          http_status: number | null
          error_code: string | null
          processed_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          credential_id: string
          nonce: string
          request_timestamp: string
          request_body_hash: string
          source_event_id?: string | null
          location_id?: string | null
          completion_event_id?: string | null
          status?:
            | 'CLAIMED'
            | 'ACCEPTED'
            | 'DUPLICATE'
            | 'REJECTED'
            | 'FAILED'
          http_status?: number | null
          error_code?: string | null
          processed_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          credential_id?: string
          nonce?: string
          request_timestamp?: string
          request_body_hash?: string
          source_event_id?: string | null
          location_id?: string | null
          completion_event_id?: string | null
          status?:
            | 'CLAIMED'
            | 'ACCEPTED'
            | 'DUPLICATE'
            | 'REJECTED'
            | 'FAILED'
          http_status?: number | null
          error_code?: string | null
          processed_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      customer_completion_events: {
        Row: {
          id: string
          organization_id: string
          location_id: string
          customer_id: string
          source: string
          source_event_id: string
          source_customer_id: string | null
          source_transaction_id: string | null
          completed_at: string
          country: string
          contact: Json
          permission: Json
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          location_id: string
          customer_id: string
          source: string
          source_event_id: string
          source_customer_id?: string | null
          source_transaction_id?: string | null
          completed_at?: string
          country?: string
          contact?: Json
          permission?: Json
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          location_id?: string
          customer_id?: string
          source?: string
          source_event_id?: string
          source_customer_id?: string | null
          source_transaction_id?: string | null
          completed_at?: string
          country?: string
          contact?: Json
          permission?: Json
          created_at?: string
        }
        Relationships: []
      }
      review_destinations: {
        Row: {
          id: string
          organization_id: string
          location_id: string
          provider: 'google'
          url: string
          canonical_url: string
          status: 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'INACTIVE'
          confirmed_by: string | null
          confirmed_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          location_id: string
          provider?: 'google'
          url: string
          canonical_url: string
          status?: 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'INACTIVE'
          confirmed_by?: string | null
          confirmed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          location_id?: string
          provider?: 'google'
          url?: string
          canonical_url?: string
          status?: 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'INACTIVE'
          confirmed_by?: string | null
          confirmed_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      review_requests: {
        Row: {
          id: string
          organization_id: string
          location_id: string
          customer_id: string
          completion_event_id: string
          destination_id: string | null
          channel: 'email' | 'sms'
          status: 'SCHEDULED' | 'SENDING' | 'SENT' | 'DELIVERED' | 'CLICKED' | 'FAILED' | 'CANCELLED' | 'SUPPRESSED'
          token: string
          token_hash: string
            unsubscribe_token: string | null
            unsubscribe_token_hash: string | null
          scheduled_for: string
          sent_at: string | null
          delivered_at: string | null
          reminded_at?: string | null
          clicked_at: string | null
          cancelled_at: string | null
          failed_at: string | null
          error_message: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          location_id: string
          customer_id: string
          completion_event_id: string
          destination_id?: string | null
          channel?: 'email' | 'sms'
          status?: 'SCHEDULED' | 'SENDING' | 'SENT' | 'DELIVERED' | 'CLICKED' | 'FAILED' | 'CANCELLED' | 'SUPPRESSED'
          token: string
          token_hash: string
            unsubscribe_token?: string | null
            unsubscribe_token_hash?: string | null
          scheduled_for?: string
          sent_at?: string | null
          delivered_at?: string | null
          reminded_at?: string | null
          clicked_at?: string | null
          cancelled_at?: string | null
          failed_at?: string | null
          error_message?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          location_id?: string
          customer_id?: string
          completion_event_id?: string
          destination_id?: string | null
          channel?: 'email' | 'sms'
          status?: 'SCHEDULED' | 'SENDING' | 'SENT' | 'DELIVERED' | 'CLICKED' | 'FAILED' | 'CANCELLED' | 'SUPPRESSED'
          token?: string
          token_hash?: string
            unsubscribe_token?: string | null
            unsubscribe_token_hash?: string | null
          scheduled_for?: string
          sent_at?: string | null
          delivered_at?: string | null
          reminded_at?: string | null
          clicked_at?: string | null
          cancelled_at?: string | null
          failed_at?: string | null
          error_message?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      review_request_events: {
        Row: {
          id: string
          organization_id: string
          review_request_id: string
          event_type: string
          idempotency_key: string | null
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          review_request_id: string
          event_type: string
          idempotency_key?: string | null
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          review_request_id?: string
          event_type?: string
          idempotency_key?: string | null
          metadata?: Json
          created_at?: string
        }
        Relationships: []
      }
      message_events: {
        Row: {
          id: string
          organization_id: string
          review_request_id: string
          provider: string
          provider_message_id: string | null
          provider_event_id: string | null
          event_type: string
          status: string
          sanitized_error: string | null
          metadata: Json
          created_at: string
          event_occurred_at: string | null
          processed_at: string | null
        }
        Insert: {
          id?: string
          organization_id: string
          review_request_id: string
          provider: string
          provider_message_id?: string | null
          provider_event_id?: string | null
          event_type: string
          status: string
          sanitized_error?: string | null
          metadata?: Json
          created_at?: string
          event_occurred_at?: string | null
          processed_at?: string | null
        }
        Update: {
          id?: string
          organization_id?: string
          review_request_id?: string
          provider?: string
          provider_message_id?: string | null
          provider_event_id?: string | null
          event_type?: string
          status?: string
          sanitized_error?: string | null
          metadata?: Json
          created_at?: string
          event_occurred_at?: string | null
          processed_at?: string | null
        }
        Relationships: []
      }
      suppressions: {
        Row: {
          id: string
          organization_id: string
          channel: string
          contact_hash: string
          reason: string
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          channel?: string
          contact_hash: string
          reason?: string
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          channel?: string
          contact_hash?: string
          reason?: string
          created_at?: string
        }
        Relationships: []
      }
      organization_usage: {
        Row: {
          id: string
          organization_id: string
          period: string
          metric: string
          value: number
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          period: string
          metric: string
          value?: number
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          period?: string
          metric?: string
          value?: number
          updated_at?: string
        }
        Relationships: []
      }
      domain_event_outbox: {
        Row: {
          id: string
          organization_id: string
          event_type: string
          aggregate_type: string
          aggregate_id: string
          payload: Json
          status: 'PENDING' | 'DISPATCHED' | 'FAILED'
          attempt_count: number
          last_error: string | null
          created_at: string
          dispatched_at: string | null
        }
        Insert: {
          id?: string
          organization_id: string
          event_type: string
          aggregate_type: string
          aggregate_id: string
          payload: Json
          status?: 'PENDING' | 'DISPATCHED' | 'FAILED'
          attempt_count?: number
          last_error?: string | null
          created_at?: string
          dispatched_at?: string | null
        }
        Update: {
          id?: string
          organization_id?: string
          event_type?: string
          aggregate_type?: string
          aggregate_id?: string
          payload?: Json
          status?: 'PENDING' | 'DISPATCHED' | 'FAILED'
          attempt_count?: number
          last_error?: string | null
          created_at?: string
          dispatched_at?: string | null
        }
        Relationships: []
      }
      audit_events: {
        Row: {
          id: string
          organization_id: string
          actor_type: string
          actor_id: string | null
          event_type: string
          entity_type: string
          entity_id: string
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          actor_type: string
          actor_id?: string | null
          event_type: string
          entity_type: string
          entity_id: string
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          actor_type?: string
          actor_id?: string | null
          event_type?: string
          entity_type?: string
          entity_id?: string
          metadata?: Json
          created_at?: string
        }
        Relationships: []
      }
      organization_entitlements: {
        Row: {
          organization_id: string
          status: 'NOT_STARTED' | 'ACTIVE' | 'EXHAUSTED' | 'EXPIRED' | 'ENDED' | 'SUSPENDED'
          allocated_requests: number
          consumed_requests: number
          duration_days: number
          started_at: string | null
          expires_at: string | null
          status_reason: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          organization_id: string
          status?: 'NOT_STARTED' | 'ACTIVE' | 'EXHAUSTED' | 'EXPIRED' | 'ENDED' | 'SUSPENDED'
          allocated_requests?: number
          consumed_requests?: number
          duration_days?: number
          started_at?: string | null
          expires_at?: string | null
          status_reason?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          organization_id?: string
          status?: 'NOT_STARTED' | 'ACTIVE' | 'EXHAUSTED' | 'EXPIRED' | 'ENDED' | 'SUSPENDED'
          allocated_requests?: number
          consumed_requests?: number
          duration_days?: number
          started_at?: string | null
          expires_at?: string | null
          status_reason?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_entitlements_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          }
        ]
      }
      usage_ledger: {
        Row: {
          id: string
          organization_id: string
          event_type:
            | 'initial_request_created'
            | 'reminder_created'
            | 'provider_send_attempt'
            | 'provider_send_success'
            | 'provider_send_failure'
            | 'tracked_click'
            | 'completion_received'
          channel: 'email' | 'sms'
          units: number
          entity_type:
            | 'review_request'
            | 'message_event'
            | 'customer_completion_event'
            | 'tracked_link'
          entity_id: string
          idempotency_key: string
          source_event_id: string | null
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          event_type:
            | 'initial_request_created'
            | 'reminder_created'
            | 'provider_send_attempt'
            | 'provider_send_success'
            | 'provider_send_failure'
            | 'tracked_click'
            | 'completion_received'
          channel?: 'email' | 'sms'
          units?: number
          entity_type:
            | 'review_request'
            | 'message_event'
            | 'customer_completion_event'
            | 'tracked_link'
          entity_id: string
          idempotency_key: string
          source_event_id?: string | null
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          event_type?:
            | 'initial_request_created'
            | 'reminder_created'
            | 'provider_send_attempt'
            | 'provider_send_success'
            | 'provider_send_failure'
            | 'tracked_click'
            | 'completion_received'
          channel?: 'email' | 'sms'
          units?: number
          entity_type?:
            | 'review_request'
            | 'message_event'
            | 'customer_completion_event'
            | 'tracked_link'
          entity_id?: string
          idempotency_key?: string
          source_event_id?: string | null
          metadata?: Json
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_ledger_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          }
        ]
      }
      cost_ledger: {
        Row: {
          id: string
          organization_id: string
          usage_ledger_id: string | null
          cost_category:
            | 'email_provider'
            | 'workflow_execution'
            | 'database_storage'
            | 'hosting_allocation'
            | 'support_allocation'
            | 'other'
          cost_status: 'MEASURED' | 'CONFIGURED_ESTIMATE' | 'UNKNOWN'
          currency: string
          amount_micro_usd: number
          description: string | null
          recorded_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          usage_ledger_id?: string | null
          cost_category:
            | 'email_provider'
            | 'workflow_execution'
            | 'database_storage'
            | 'hosting_allocation'
            | 'support_allocation'
            | 'other'
          cost_status: 'MEASURED' | 'CONFIGURED_ESTIMATE' | 'UNKNOWN'
          currency?: string
          amount_micro_usd?: number
          description?: string | null
          recorded_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          usage_ledger_id?: string | null
          cost_category?:
            | 'email_provider'
            | 'workflow_execution'
            | 'database_storage'
            | 'hosting_allocation'
            | 'support_allocation'
            | 'other'
          cost_status?: 'MEASURED' | 'CONFIGURED_ESTIMATE' | 'UNKNOWN'
          currency?: string
          amount_micro_usd?: number
          description?: string | null
          recorded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_ledger_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_ledger_usage_ledger_id_fkey"
            columns: ["usage_ledger_id"]
            isOneToOne: false
            referencedRelation: "usage_ledger"
            referencedColumns: ["id"]
          }
        ]
      }
      organization_billing_accounts: {
        Row: {
          id: string
          organization_id: string
          provider: 'stripe'
          provider_customer_id: string
          environment: 'TEST' | 'LIVE'
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          provider: 'stripe'
          provider_customer_id: string
          environment?: 'TEST' | 'LIVE'
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          provider?: 'stripe'
          provider_customer_id?: string
          environment?: 'TEST' | 'LIVE'
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_billing_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          }
        ]
      }
      organization_subscriptions: {
        Row: {
          id: string
          organization_id: string
          billing_account_id: string
          provider: 'stripe'
          environment: 'TEST' | 'LIVE'
          provider_subscription_id: string
          provider_price_id: string | null
          provider_status: string
          normalized_status: 'PENDING' | 'ACTIVE' | 'GRACE' | 'SUSPENDED' | 'ENDED'
          current_period_start: string | null
          current_period_end: string | null
          cancel_at_period_end: boolean
          canceled_at: string | null
          provider_state_updated_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          billing_account_id: string
          provider: 'stripe'
          environment?: 'TEST' | 'LIVE'
          provider_subscription_id: string
          provider_price_id?: string | null
          provider_status: string
          normalized_status: 'PENDING' | 'ACTIVE' | 'GRACE' | 'SUSPENDED' | 'ENDED'
          current_period_start?: string | null
          current_period_end?: string | null
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          provider_state_updated_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          billing_account_id?: string
          provider?: 'stripe'
          environment?: 'TEST' | 'LIVE'
          provider_subscription_id?: string
          provider_price_id?: string | null
          provider_status?: string
          normalized_status?: 'PENDING' | 'ACTIVE' | 'GRACE' | 'SUSPENDED' | 'ENDED'
          current_period_start?: string | null
          current_period_end?: string | null
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          provider_state_updated_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_subscriptions_account_org_provider_env_fkey"
            columns: ["billing_account_id", "organization_id", "provider", "environment"]
            isOneToOne: false
            referencedRelation: "organization_billing_accounts"
            referencedColumns: ["id", "organization_id", "provider", "environment"]
          }
        ]
      }
      billing_webhook_events: {
        Row: {
          id: string
          provider: 'stripe'
          environment: 'TEST' | 'LIVE'
          provider_event_id: string
          event_type: string
          processing_status: 'RECEIVED' | 'PROCESSING' | 'PROCESSED' | 'IGNORED' | 'FAILED'
          payload_hash: string
          organization_id: string | null
          provider_created_at: string | null
          received_at: string
          processed_at: string | null
          error_code: string | null
          created_at: string
        }
        Insert: {
          id?: string
          provider: 'stripe'
          environment?: 'TEST' | 'LIVE'
          provider_event_id: string
          event_type: string
          processing_status?: 'RECEIVED' | 'PROCESSING' | 'PROCESSED' | 'IGNORED' | 'FAILED'
          payload_hash: string
          organization_id?: string | null
          provider_created_at?: string | null
          received_at?: string
          processed_at?: string | null
          error_code?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          provider?: 'stripe'
          environment?: 'TEST' | 'LIVE'
          provider_event_id?: string
          event_type?: string
          processing_status?: 'RECEIVED' | 'PROCESSING' | 'PROCESSED' | 'IGNORED' | 'FAILED'
          payload_hash?: string
          organization_id?: string | null
          provider_created_at?: string | null
          received_at?: string
          processed_at?: string | null
          error_code?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_webhook_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          }
        ]
      }
    }
    Views: Record<string, never>
    Functions: {
      create_org_with_owner_and_location: {
        Args: {
          p_org_name: string
          p_slug: string
          p_loc_name: string
          p_address?: string | null
          p_country?: string
          p_timezone?: string
        }
        Returns: Json
      }
      increment_organization_usage: {
        Args: {
          p_org_id: string
          p_period: string
          p_metric: string
          p_amount?: number
        }
        Returns: number
      }
      user_org_ids: {
        Args: Record<string, never>
        Returns: string[]
      }
      user_has_role: {
        Args: {
          org_id: string
          allowed_roles: string[]
        }
        Returns: boolean
      }
      user_role: {
        Args: {
          org_id: string
        }
        Returns: string
      }
      claim_completion_ingestion: {
        Args: {
          p_org_id: string
          p_credential_id: string
          p_nonce: string
          p_request_timestamp: string
          p_request_body_hash: string
        }
        Returns: Json
      }
      submit_completion_system_atomic: {
        Args: {
          p_org_id: string
          p_loc_id: string
          p_first_name: string
          p_last_name?: string | null
          p_email?: string | null
          p_phone?: string | null
          p_permission_email?: string
          p_permission_sms?: string
          p_permission_source?: string
          p_source?: string
          p_source_event_id?: string | null
          p_source_customer_id?: string | null
          p_source_transaction_id?: string | null
          p_completed_at?: string
          p_country?: string
        }
        Returns: Json
      }
      submit_quick_complete_atomic: {
        Args: {
          p_org_id: string
          p_loc_id: string
          p_first_name: string
          p_last_name?: string | null
          p_email?: string | null
          p_phone?: string | null
          p_permission_email?: string
          p_permission_sms?: string
          p_permission_source?: string
          p_source?: string
          p_source_event_id?: string | null
          p_source_customer_id?: string | null
          p_source_transaction_id?: string | null
          p_country?: string
        }
        Returns: {
          customer_id: string
          completion_event_id: string
          outbox_id: string
          source_event_id: string
        }
      }
      provision_organization_trial: {
        Args: {
          p_org_id: string
          p_allocated_requests?: number
          p_duration_days?: number
        }
        Returns: Json
      }
      activate_organization_trial: {
        Args: {
          p_org_id: string
        }
        Returns: Json
      }
      consume_trial_entitlement: {
        Args: {
          p_org_id: string
          p_review_request_id: string
          p_idempotency_key: string
          p_source_event_id?: string | null
        }
        Returns: Json
      }
      record_usage_event: {
        Args: {
          p_org_id: string
          p_event_type: string
          p_channel?: string
          p_units?: number
          p_entity_type: string
          p_entity_id: string
          p_idempotency_key: string
          p_source_event_id?: string | null
          p_metadata?: Json
        }
        Returns: Json
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
