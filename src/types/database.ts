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
        Relationships: []
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
          scheduled_for: string
          sent_at: string | null
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
          scheduled_for?: string
          sent_at?: string | null
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
          scheduled_for?: string
          sent_at?: string | null
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
          event_type: string
          status: string
          sanitized_error: string | null
          metadata: Json
          created_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          review_request_id: string
          provider: string
          provider_message_id?: string | null
          event_type: string
          status: string
          sanitized_error?: string | null
          metadata?: Json
          created_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          review_request_id?: string
          provider?: string
          provider_message_id?: string | null
          event_type?: string
          status?: string
          sanitized_error?: string | null
          metadata?: Json
          created_at?: string
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
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}
