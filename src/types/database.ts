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
      support_access_grants: {
        Row: {
          id: string
          organization_id: string
          user_id: string
          support_role: 'MPG_ADMIN'
          created_at: string
          expires_at: string
          revoked_at: string | null
        }
        Insert: {
          id?: string
          organization_id: string
          user_id: string
          support_role: 'MPG_ADMIN'
          created_at?: string
          expires_at: string
          revoked_at?: string | null
        }
        Update: {
          id?: string
          organization_id?: string
          user_id?: string
          support_role?: 'MPG_ADMIN'
          created_at?: string
          expires_at?: string
          revoked_at?: string | null
        }
        Relationships: [{
          foreignKeyName: 'support_access_grants_membership_fkey'
          columns: ['organization_id', 'user_id']
          isOneToOne: true
          referencedRelation: 'organization_users'
          referencedColumns: ['organization_id', 'user_id']
        }]
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
      customer_erasure_records: {
        Row: {
          id: string
          organization_id: string
          customer_id: string
          erased_at: string
          actor_type: string
          actor_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          customer_id: string
          erased_at?: string
          actor_type?: string
          actor_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          customer_id?: string
          erased_at?: string
          actor_type?: string
          actor_id?: string | null
          created_at?: string
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
      review_request_recipient_evidence: {
        Row: {
          id: string
          organization_id: string
          review_request_id: string
          channel: 'email' | 'sms'
          suppression_contact_hash: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          review_request_id: string
          channel?: 'email' | 'sms'
          suppression_contact_hash?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          review_request_id?: string
          channel?: 'email' | 'sms'
          suppression_contact_hash?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_rrre_review_request"
            columns: ["review_request_id", "organization_id"]
            isOneToOne: false
            referencedRelation: "review_requests"
            referencedColumns: ["id", "organization_id"]
          },
          {
            foreignKeyName: "review_request_recipient_evidence_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          }
        ]
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
      messaging_authority_evidence: {
        Row: {
          id: string
          organization_id: string
          customer_id: string
          completion_event_id: string
          channel: 'email' | 'sms'
          asserted_state: 'allowed' | 'unknown' | 'denied'
          assertion_kind: 'OPERATIONAL_PERMISSION_STATE'
          permission_source: string
          completion_source: string
          source_event_id: string
          country: string | null
          asserted_at: string | null
          observed_at: string
          basis_type: string | null
          capture_method: string | null
          evidence_reference: string | null
          policy_version: string | null
          actor_type: string
          actor_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          customer_id: string
          completion_event_id: string
          channel: 'email' | 'sms'
          asserted_state: 'allowed' | 'unknown' | 'denied'
          assertion_kind?: 'OPERATIONAL_PERMISSION_STATE'
          permission_source: string
          completion_source: string
          source_event_id: string
          country?: string | null
          asserted_at?: string | null
          observed_at?: string
          basis_type?: string | null
          capture_method?: string | null
          evidence_reference?: string | null
          policy_version?: string | null
          actor_type?: string
          actor_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          customer_id?: string
          completion_event_id?: string
          channel?: 'email' | 'sms'
          asserted_state?: 'allowed' | 'unknown' | 'denied'
          assertion_kind?: 'OPERATIONAL_PERMISSION_STATE'
          permission_source?: string
          completion_source?: string
          source_event_id?: string
          country?: string | null
          asserted_at?: string | null
          observed_at?: string
          basis_type?: string | null
          capture_method?: string | null
          evidence_reference?: string | null
          policy_version?: string | null
          actor_type?: string
          actor_id?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'fk_mae_customer'
            columns: ['customer_id', 'organization_id']
            isOneToOne: false
            referencedRelation: 'customers'
            referencedColumns: ['id', 'organization_id']
          },
          {
            foreignKeyName: 'fk_mae_completion'
            columns: ['completion_event_id', 'organization_id']
            isOneToOne: false
            referencedRelation: 'customer_completion_events'
            referencedColumns: ['id', 'organization_id']
          },
        ]
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
      stripe_test_billing_recovery_reviews: {
        Row: {
          id: string
          organization_id: string
          kind: 'CUSTOMER_SETUP' | 'CHECKOUT'
          reason: 'AGED_CUSTOMER_ATTEMPT' | 'UNLINKED_CUSTOMER' | 'CUSTOMER_MAPPING_CONFLICT' | 'AGED_CHECKOUT_ATTEMPT' | 'EXPIRED_CHECKOUT_SESSION' | 'EXPIRED_CHECKOUT_RESERVATION'
          state: 'OPEN'
          requested_by: string
          requested_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          kind: 'CUSTOMER_SETUP' | 'CHECKOUT'
          reason: 'AGED_CUSTOMER_ATTEMPT' | 'UNLINKED_CUSTOMER' | 'CUSTOMER_MAPPING_CONFLICT' | 'AGED_CHECKOUT_ATTEMPT' | 'EXPIRED_CHECKOUT_SESSION' | 'EXPIRED_CHECKOUT_RESERVATION'
          state?: 'OPEN'
          requested_by: string
          requested_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          kind?: 'CUSTOMER_SETUP' | 'CHECKOUT'
          reason?: 'AGED_CUSTOMER_ATTEMPT' | 'UNLINKED_CUSTOMER' | 'CUSTOMER_MAPPING_CONFLICT' | 'AGED_CHECKOUT_ATTEMPT' | 'EXPIRED_CHECKOUT_SESSION' | 'EXPIRED_CHECKOUT_RESERVATION'
          state?: 'OPEN'
          requested_by?: string
          requested_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_test_billing_recovery_reviews_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          }
        ]
      }
      stripe_test_billing_action_limits: {
        Row: {
          organization_id: string
          user_id: string
          period_started_at: string
          attempts: number
          last_action: 'CUSTOMER_SETUP' | 'CHECKOUT' | 'PORTAL'
          updated_at: string
        }
        Insert: {
          organization_id: string
          user_id: string
          period_started_at?: string
          attempts?: number
          last_action: 'CUSTOMER_SETUP' | 'CHECKOUT' | 'PORTAL'
          updated_at?: string
        }
        Update: {
          organization_id?: string
          user_id?: string
          period_started_at?: string
          attempts?: number
          last_action?: 'CUSTOMER_SETUP' | 'CHECKOUT' | 'PORTAL'
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_test_billing_action_limits_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          }
        ]
      }
      stripe_test_customer_provisioning: {
        Row: {
          id: string
          organization_id: string
          provider: 'stripe'
          environment: 'TEST'
          organization_name: string
          state: 'PREPARING' | 'READY'
          lease_token: string | null
          lease_expires_at: string | null
          provider_customer_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          provider?: 'stripe'
          environment?: 'TEST'
          organization_name: string
          state: 'PREPARING' | 'READY'
          lease_token?: string | null
          lease_expires_at?: string | null
          provider_customer_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          provider?: 'stripe'
          environment?: 'TEST'
          organization_name?: string
          state?: 'PREPARING' | 'READY'
          lease_token?: string | null
          lease_expires_at?: string | null
          provider_customer_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_test_customer_provisioning_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          }
        ]
      }
      stripe_test_checkout_reservations: {
        Row: {
          id: string
          organization_id: string
          billing_account_id: string
          provider: 'stripe'
          environment: 'TEST'
          provider_customer_id: string
          provider_price_id: string
          plan_id: 'monthly' | 'annual'
          return_origin: string
          status: 'PREPARING' | 'READY'
          lease_token: string | null
          lease_expires_at: string | null
          stripe_session_id: string | null
          stripe_session_url: string | null
          session_expires_at: string
          reservation_expires_at: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          billing_account_id: string
          provider?: 'stripe'
          environment?: 'TEST'
          provider_customer_id: string
          provider_price_id: string
          plan_id: 'monthly' | 'annual'
          return_origin: string
          status: 'PREPARING' | 'READY'
          lease_token?: string | null
          lease_expires_at?: string | null
          stripe_session_id?: string | null
          stripe_session_url?: string | null
          session_expires_at: string
          reservation_expires_at: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          billing_account_id?: string
          provider?: 'stripe'
          environment?: 'TEST'
          provider_customer_id?: string
          provider_price_id?: string
          plan_id?: 'monthly' | 'annual'
          return_origin?: string
          status?: 'PREPARING' | 'READY'
          lease_token?: string | null
          lease_expires_at?: string | null
          stripe_session_id?: string | null
          stripe_session_url?: string | null
          session_expires_at?: string
          reservation_expires_at?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_checkout_account_fkey"
            columns: ["billing_account_id", "organization_id", "provider", "environment"]
            isOneToOne: false
            referencedRelation: "organization_billing_accounts"
            referencedColumns: ["id", "organization_id", "provider", "environment"]
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
      billing_synthetic_subscription_exception_reviews: {
        Row: {
          id: string
          organization_id: string
          subscription_record_id: string
          webhook_event_record_id: string
          provider: 'stripe'
          environment: 'TEST'
          review_reason: 'HISTORY_INVALID_OR_AMBIGUOUS' | 'EVENT_FINGERPRINT_CONFLICT' | 'OLDER_OR_EQUAL_TIME' | 'INITIAL_SUBSCRIPTION_REQUIRES_REVIEW' | 'UNSUPPORTED_TRANSITION' | 'PAID_PERIOD_NOT_ADVANCED' | 'PAID_PERIOD_INVALID' | 'FAILED_PAYMENT_PERIOD_MISMATCH' | 'REPEATED_PAYMENT_FAILURE' | 'PAYMENT_RECOVERY_NEEDS_PROVIDER_REVIEW' | 'DISPUTE_OR_REFUND_HOLD' | 'CANCELLATION_HOLD' | 'TERMINAL_SUBSCRIPTION_HOLD' | 'END_BEFORE_PAID_PERIOD' | 'REFUND_OR_DISPUTE_REQUIRES_REVIEW'
          review_state: 'OPEN'
          source_kind: 'SYNTHETIC'
          verification_status: 'UNVERIFIED'
          access_authorized: false
          opened_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          subscription_record_id: string
          webhook_event_record_id: string
          provider?: 'stripe'
          environment?: 'TEST'
          review_reason: 'HISTORY_INVALID_OR_AMBIGUOUS' | 'EVENT_FINGERPRINT_CONFLICT' | 'OLDER_OR_EQUAL_TIME' | 'INITIAL_SUBSCRIPTION_REQUIRES_REVIEW' | 'UNSUPPORTED_TRANSITION' | 'PAID_PERIOD_NOT_ADVANCED' | 'PAID_PERIOD_INVALID' | 'FAILED_PAYMENT_PERIOD_MISMATCH' | 'REPEATED_PAYMENT_FAILURE' | 'PAYMENT_RECOVERY_NEEDS_PROVIDER_REVIEW' | 'DISPUTE_OR_REFUND_HOLD' | 'CANCELLATION_HOLD' | 'TERMINAL_SUBSCRIPTION_HOLD' | 'END_BEFORE_PAID_PERIOD' | 'REFUND_OR_DISPUTE_REQUIRES_REVIEW'
          review_state?: 'OPEN'
          source_kind?: 'SYNTHETIC'
          verification_status?: 'UNVERIFIED'
          access_authorized?: false
          opened_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          subscription_record_id?: string
          webhook_event_record_id?: string
          provider?: 'stripe'
          environment?: 'TEST'
          review_reason?: 'HISTORY_INVALID_OR_AMBIGUOUS' | 'EVENT_FINGERPRINT_CONFLICT' | 'OLDER_OR_EQUAL_TIME' | 'INITIAL_SUBSCRIPTION_REQUIRES_REVIEW' | 'UNSUPPORTED_TRANSITION' | 'PAID_PERIOD_NOT_ADVANCED' | 'PAID_PERIOD_INVALID' | 'FAILED_PAYMENT_PERIOD_MISMATCH' | 'REPEATED_PAYMENT_FAILURE' | 'PAYMENT_RECOVERY_NEEDS_PROVIDER_REVIEW' | 'DISPUTE_OR_REFUND_HOLD' | 'CANCELLATION_HOLD' | 'TERMINAL_SUBSCRIPTION_HOLD' | 'END_BEFORE_PAID_PERIOD' | 'REFUND_OR_DISPUTE_REQUIRES_REVIEW'
          review_state?: 'OPEN'
          source_kind?: 'SYNTHETIC'
          verification_status?: 'UNVERIFIED'
          access_authorized?: false
          opened_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_synthetic_subscription_exception_reviews_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_synthetic_exception_subscription_tenant_fk"
            columns: ["subscription_record_id", "organization_id", "provider", "environment"]
            isOneToOne: false
            referencedRelation: "organization_subscriptions"
            referencedColumns: ["id", "organization_id", "provider", "environment"]
          },
          {
            foreignKeyName: "billing_synthetic_subscription_exception_reviews_webhook_event_record_id_fkey"
            columns: ["webhook_event_record_id"]
            isOneToOne: false
            referencedRelation: "billing_webhook_events"
            referencedColumns: ["id"]
          }
        ]
      }
      billing_synthetic_checkout_quote_snapshots: {
        Row: {
          id: string
          organization_id: string
          billing_account_id: string
          checkout_reservation_id: string
          provider: 'stripe'
          environment: 'TEST'
          plan_id: 'monthly' | 'annual'
          provider_price_id: string
          candidate_currency: 'PHP'
          candidate_amount_minor: number
          candidate_interval: 'month' | 'year'
          interval_count: 1
          source_kind: 'SYNTHETIC'
          approval_status: 'PROPOSED'
          verification_status: 'UNVERIFIED'
          payment_authorized: false
          access_authorized: false
          captured_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          billing_account_id: string
          checkout_reservation_id: string
          provider?: 'stripe'
          environment?: 'TEST'
          plan_id: 'monthly' | 'annual'
          provider_price_id: string
          candidate_currency?: 'PHP'
          candidate_amount_minor: number
          candidate_interval: 'month' | 'year'
          interval_count?: 1
          source_kind?: 'SYNTHETIC'
          approval_status?: 'PROPOSED'
          verification_status?: 'UNVERIFIED'
          payment_authorized?: false
          access_authorized?: false
          captured_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          billing_account_id?: string
          checkout_reservation_id?: string
          provider?: 'stripe'
          environment?: 'TEST'
          plan_id?: 'monthly' | 'annual'
          provider_price_id?: string
          candidate_currency?: 'PHP'
          candidate_amount_minor?: number
          candidate_interval?: 'month' | 'year'
          interval_count?: 1
          source_kind?: 'SYNTHETIC'
          approval_status?: 'PROPOSED'
          verification_status?: 'UNVERIFIED'
          payment_authorized?: false
          access_authorized?: false
          captured_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_synthetic_checkout_quote_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mr5i4g_quote_account_tenant_fk"
            columns: ["billing_account_id", "organization_id", "provider", "environment"]
            isOneToOne: false
            referencedRelation: "organization_billing_accounts"
            referencedColumns: ["id", "organization_id", "provider", "environment"]
          },
          {
            foreignKeyName: "mr5i4g_quote_reservation_fk"
            columns: ["checkout_reservation_id"]
            isOneToOne: false
            referencedRelation: "stripe_test_checkout_reservations"
            referencedColumns: ["id"]
          }
        ]
      }
      billing_synthetic_invoice_evidence_drafts: {
        Row: {
          id: string
          organization_id: string
          billing_account_id: string
          subscription_record_id: string
          webhook_event_record_id: string
          provider: 'stripe'
          environment: 'TEST'
          provider_invoice_id: string
          provider_event_id: string
          source_payload_hash: string
          candidate_price_id: string
          candidate_currency: 'PHP'
          candidate_amount_minor: number
          candidate_interval: 'month' | 'year'
          candidate_period_start: string
          candidate_period_end: string
          source_kind: 'SYNTHETIC'
          verification_status: 'UNVERIFIED'
          financial_finality: false
          access_authorized: false
          recorded_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          billing_account_id: string
          subscription_record_id: string
          webhook_event_record_id: string
          provider?: 'stripe'
          environment?: 'TEST'
          provider_invoice_id: string
          provider_event_id: string
          source_payload_hash: string
          candidate_price_id: string
          candidate_currency?: 'PHP'
          candidate_amount_minor: number
          candidate_interval: 'month' | 'year'
          candidate_period_start: string
          candidate_period_end: string
          source_kind?: 'SYNTHETIC'
          verification_status?: 'UNVERIFIED'
          financial_finality?: false
          access_authorized?: false
          recorded_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          billing_account_id?: string
          subscription_record_id?: string
          webhook_event_record_id?: string
          provider?: 'stripe'
          environment?: 'TEST'
          provider_invoice_id?: string
          provider_event_id?: string
          source_payload_hash?: string
          candidate_price_id?: string
          candidate_currency?: 'PHP'
          candidate_amount_minor?: number
          candidate_interval?: 'month' | 'year'
          candidate_period_start?: string
          candidate_period_end?: string
          source_kind?: 'SYNTHETIC'
          verification_status?: 'UNVERIFIED'
          financial_finality?: false
          access_authorized?: false
          recorded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_synthetic_invoice_evidence_drafts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mr5i4f_account_identity_fkey"
            columns: ["billing_account_id", "organization_id", "provider", "environment"]
            isOneToOne: false
            referencedRelation: "organization_billing_accounts"
            referencedColumns: ["id", "organization_id", "provider", "environment"]
          },
          {
            foreignKeyName: "mr5i4f_subscription_identity_fkey"
            columns: ["subscription_record_id", "organization_id", "provider", "environment"]
            isOneToOne: false
            referencedRelation: "organization_subscriptions"
            referencedColumns: ["id", "organization_id", "provider", "environment"]
          },
          {
            foreignKeyName: "billing_synthetic_invoice_evidence_drafts_webhook_event_record_id_fkey"
            columns: ["webhook_event_record_id"]
            isOneToOne: false
            referencedRelation: "billing_webhook_events"
            referencedColumns: ["id"]
          }
        ]
      }
      billing_paid_entitlement_proposals: {
        Row: {
          id: string
          organization_id: string
          subscription_record_id: string
          webhook_event_record_id: string
          provider: 'stripe'
          environment: 'TEST'
          proposed_action: 'INITIAL_ACTIVATION' | 'RENEWAL' | 'PAYMENT_DUE' | 'SCHEDULE_CANCELLATION' | 'END_AT_PERIOD' | 'ESCALATE_FOR_REVIEW'
          candidate_status: 'ACTIVE' | 'PAST_DUE' | 'CANCEL_AT_PERIOD_END' | 'ENDED' | 'REVIEW_REQUIRED'
          candidate_period_end: string
          source_provider_created_at: string | null
          source_kind: 'SYNTHETIC'
          verification_status: 'UNVERIFIED'
          access_authorized: false
          recorded_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          subscription_record_id: string
          webhook_event_record_id: string
          provider?: 'stripe'
          environment?: 'TEST'
          proposed_action: 'INITIAL_ACTIVATION' | 'RENEWAL' | 'PAYMENT_DUE' | 'SCHEDULE_CANCELLATION' | 'END_AT_PERIOD' | 'ESCALATE_FOR_REVIEW'
          candidate_status: 'ACTIVE' | 'PAST_DUE' | 'CANCEL_AT_PERIOD_END' | 'ENDED' | 'REVIEW_REQUIRED'
          candidate_period_end: string
          source_provider_created_at?: string | null
          source_kind?: 'SYNTHETIC'
          verification_status?: 'UNVERIFIED'
          access_authorized?: false
          recorded_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          subscription_record_id?: string
          webhook_event_record_id?: string
          provider?: 'stripe'
          environment?: 'TEST'
          proposed_action?: 'INITIAL_ACTIVATION' | 'RENEWAL' | 'PAYMENT_DUE' | 'SCHEDULE_CANCELLATION' | 'END_AT_PERIOD' | 'ESCALATE_FOR_REVIEW'
          candidate_status?: 'ACTIVE' | 'PAST_DUE' | 'CANCEL_AT_PERIOD_END' | 'ENDED' | 'REVIEW_REQUIRED'
          candidate_period_end?: string
          source_provider_created_at?: string | null
          source_kind?: 'SYNTHETIC'
          verification_status?: 'UNVERIFIED'
          access_authorized?: false
          recorded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_paid_entitlement_proposals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_paid_entitlement_proposals_subscription_identity_fk"
            columns: ["subscription_record_id", "organization_id", "provider", "environment"]
            isOneToOne: false
            referencedRelation: "organization_subscriptions"
            referencedColumns: ["id", "organization_id", "provider", "environment"]
          },
          {
            foreignKeyName: "billing_paid_entitlement_proposals_webhook_record_fk"
            columns: ["webhook_event_record_id"]
            isOneToOne: false
            referencedRelation: "billing_webhook_events"
            referencedColumns: ["id"]
          }
        ]
      }
      stripe_subscription_reconciliation_leases: {
        Row: {
          provider_subscription_id: string
          event_id: string
          event_lease_token: string
          lease_token: string | null
          lease_expires_at: string
          updated_at: string
        }
        Insert: {
          provider_subscription_id: string
          event_id: string
          event_lease_token: string
          lease_token?: string | null
          lease_expires_at: string
          updated_at?: string
        }
        Update: {
          provider_subscription_id?: string
          event_id?: string
          event_lease_token?: string
          lease_token?: string | null
          lease_expires_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_subscription_reconciliation_leases_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "billing_webhook_events"
            referencedColumns: ["id"]
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
          provider_invoice_id: string | null
          processing_lease_token: string | null
          processing_lease_expires_at: string | null
          processing_attempt_count: number
          next_processing_attempt_at: string | null
          processing_attempts: number
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
          provider_invoice_id?: string | null
          processing_lease_token?: string | null
          processing_lease_expires_at?: string | null
          processing_attempt_count?: number
          next_processing_attempt_at?: string | null
          processing_attempts?: number
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
          provider_invoice_id?: string | null
          processing_lease_token?: string | null
          processing_lease_expires_at?: string | null
          processing_attempt_count?: number
          next_processing_attempt_at?: string | null
          processing_attempts?: number
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
      inspect_stripe_test_webhook_recovery: {
        Args: { p_limit?: number }
        Returns: Json
      }
      lease_stripe_subscription_reconciliation: {
        Args: {
          p_event_id: string
          p_event_lease_token: string
          p_subscription_id: string
        }
        Returns: Json
      }
      release_stripe_subscription_reconciliation: {
        Args: {
          p_subscription_id: string
          p_lease_token: string
        }
        Returns: Json
      }
      commit_stripe_subscription_reconciliation: {
        Args: {
          p_event_id: string
          p_event_lease_token: string
          p_subscription_lease_token: string
          p_org_id: string
          p_billing_account_id: string
          p_provider_customer_id: string
          p_environment: 'TEST' | 'LIVE'
          p_provider_subscription_id: string
          p_provider_price_id: string
          p_provider_status: string
          p_normalized_status: string
          p_current_period_start: string | null
          p_current_period_end: string | null
          p_cancel_at_period_end: boolean
          p_canceled_at: string | null
        }
        Returns: Json
      }
      lease_stripe_webhook_processing: {
        Args: { p_event_id: string }
        Returns: Json
      }
      complete_stripe_webhook_processing: {
        Args: {
          p_event_id: string
          p_lease_token: string
          p_status: 'PROCESSED' | 'IGNORED' | 'FAILED'
          p_organization_id?: string | null
          p_error_code?: string | null
        }
        Returns: Json
      }
      reconcile_stripe_subscription_projection: {
        Args: {
          p_org_id: string
          p_billing_account_id: string
          p_provider_customer_id: string
          p_environment: 'TEST' | 'LIVE'
          p_provider_subscription_id: string
          p_provider_price_id: string
          p_provider_status: string
          p_normalized_status: string
          p_current_period_start: string | null
          p_current_period_end: string | null
          p_cancel_at_period_end: boolean
          p_canceled_at: string | null
        }
        Returns: Json
      }
      claim_stripe_test_invoice_processing: {
        Args: { p_provider_event_id: string }
        Returns: Json
      }
      fail_stripe_test_invoice_processing: {
        Args: { p_provider_event_id: string; p_lease_token: string; p_error_code: string }
        Returns: Json
      }
      request_stripe_test_billing_recovery_review: {
        Args: {
          p_user_id: string
          p_organization_id: string
          p_kind: 'CUSTOMER_SETUP' | 'CHECKOUT'
        }
        Returns: Json
      }
      read_stripe_test_provider_recovery_context: {
        Args: {
          p_user_id: string
          p_organization_id: string
        }
        Returns: Json
      }
      inspect_stripe_test_billing_recovery: {
        Args: {
          p_user_id: string
          p_organization_id: string
        }
        Returns: Json
      }
      claim_stripe_test_billing_action: {
        Args: {
          p_user_id: string
          p_organization_id: string
          p_action: 'CUSTOMER_SETUP' | 'CHECKOUT' | 'PORTAL'
        }
        Returns: Json
      }
      reserve_stripe_test_customer: {
        Args: { p_user_id: string; p_organization_id: string }
        Returns: Json
      }
      finalize_stripe_test_customer: {
        Args: {
          p_user_id: string
          p_organization_id: string
          p_reservation_id: string
          p_lease_token: string
          p_provider_customer_id: string
        }
        Returns: Json
      }
      reserve_stripe_test_checkout: {
        Args: {
          p_user_id: string
          p_organization_id: string
          p_billing_account_id: string
          p_provider_customer_id: string
          p_provider_price_id: string
          p_plan_id: 'monthly' | 'annual'
          p_return_origin: string
        }
        Returns: Json
      }
      finalize_stripe_test_checkout: {
        Args: {
          p_user_id: string
          p_reservation_id: string
          p_lease_token: string
          p_session_id: string
          p_session_url: string
          p_session_expires_at: string
        }
        Returns: Json
      }
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
      execute_customer_erasure: {
        Args: {
          p_org_id: string
          p_customer_id: string
          p_actor_id: string
          p_actor_type?: string
        }
        Returns: Json
      }
      replay_customer_erasure_maintenance: {
        Args: {
          p_org_id: string
          p_customer_id: string
          p_erased_at: string
        }
        Returns: Json
      }
      replay_suppression_maintenance: {
        Args: {
          p_org_id: string
          p_channel: string
          p_contact_hash: string
          p_reason: string
          p_created_at: string
        }
        Returns: Json
      }
    }
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
