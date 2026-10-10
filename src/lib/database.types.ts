// Hand-written types mirroring supabase/migrations/*.sql.
// If you have the Supabase CLI, regenerate with:
//   npx supabase gen types typescript --project-id <id> > src/lib/database.types.ts

export type SubscriptionStatus = "free" | "basic" | "pro";
export type BillingInterval = "monthly" | "yearly";
export type BusinessType = "salon" | "general";
export type DocumentType = "invoice" | "estimate";
export type DocumentStatus = "draft" | "sent" | "partial" | "paid";
export type PayType = "commission" | "hourly" | "salary";
export type PayoutStatus = "active" | "voided";
export type AppLockRole = "owner" | "staff";
export type ThemePreference = "light" | "dark" | "system";
export type StatementImportStatus = "draft" | "committed" | "discarded" | "expired" | "failed";
export type StatementLineKind = "purchase" | "payment" | "refund" | "fee" | "interest" | "other";
export type RateCadence = "weekly" | "monthly";
export type AdminActionType =
  | "tier_override"
  | "subscription_cancel"
  | "subscription_refund"
  | "resend_confirmation"
  | "password_reset"
  | "note";

// Minimal shape for the jsonb args create_register_transaction takes -
// this file has no other jsonb-typed RPC param to mirror, so this is
// hand-written rather than generated.
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

export interface ReceiptItem {
  name: string;
  amount: number;
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          subscription_status: SubscriptionStatus;
          billing_interval: BillingInterval | null;
          current_period_end: string | null;
          cancel_at_period_end: boolean;
          pending_tier: "basic" | "pro" | null;
          pending_billing_interval: BillingInterval | null;
          pending_change_effective_at: string | null;
          business_type: BusinessType;
          logo_url: string | null;
          business_name: string | null;
          business_address: string | null;
          business_phone: string | null;
          business_email: string | null;
          business_profile_skipped: boolean;
          onboarding_completed: boolean;
          needs_business_type_prompt: boolean;
          theme_preference: ThemePreference;
          hidden_nav_keys: string[];
          created_at: string;
        };
        Insert: {
          id: string;
          email: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          subscription_status?: SubscriptionStatus;
          billing_interval?: BillingInterval | null;
          current_period_end?: string | null;
          cancel_at_period_end?: boolean;
          pending_tier?: "basic" | "pro" | null;
          pending_billing_interval?: BillingInterval | null;
          pending_change_effective_at?: string | null;
          business_type?: BusinessType;
          logo_url?: string | null;
          business_name?: string | null;
          business_address?: string | null;
          business_phone?: string | null;
          business_email?: string | null;
          business_profile_skipped?: boolean;
          onboarding_completed?: boolean;
          needs_business_type_prompt?: boolean;
          theme_preference?: ThemePreference;
          hidden_nav_keys?: string[];
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          subscription_status?: SubscriptionStatus;
          billing_interval?: BillingInterval | null;
          current_period_end?: string | null;
          cancel_at_period_end?: boolean;
          pending_tier?: "basic" | "pro" | null;
          pending_billing_interval?: BillingInterval | null;
          pending_change_effective_at?: string | null;
          business_type?: BusinessType;
          logo_url?: string | null;
          business_name?: string | null;
          business_address?: string | null;
          business_phone?: string | null;
          business_email?: string | null;
          business_profile_skipped?: boolean;
          onboarding_completed?: boolean;
          needs_business_type_prompt?: boolean;
          theme_preference?: ThemePreference;
          hidden_nav_keys?: string[];
          created_at?: string;
        };
        Relationships: [];
      };
      receipts: {
        Row: {
          id: string;
          user_id: string;
          image_url: string | null;
          merchant_name: string;
          transaction_date: string;
          total_amount: number;
          tax_amount: number;
          tax_category: string;
          job_name: string | null;
          job_id: string | null;
          source_template_id: string | null;
          paid_with_account_id: string | null;
          items: ReceiptItem[] | null;
          // 0053 (card statement import). Optional in the type until that migration
          // is applied everywhere - rows read before then simply lack them.
          from_statement?: boolean;
          no_receipt?: boolean;
          receipt_attached_at?: string | null;
          created_at: string;
          // 0056: SHA-256 of the original scanned file (64 hex), the only thing kept of it.
          file_sha256?: string | null;
          // 0057 (tax codes): the code a card-statement expense was saved with. Null = no code (every
          // scanned or typed receipt, and a statement line that needs one). Optional until applied.
          tax_rate?: number | null;
          itc_pct?: number | null;
          deductible_pct?: number | null;
          tax_source?: TaxSourceName | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          image_url?: string | null;
          merchant_name: string;
          transaction_date: string;
          total_amount: number;
          tax_amount?: number;
          tax_category: string;
          job_name?: string | null;
          job_id?: string | null;
          source_template_id?: string | null;
          paid_with_account_id?: string | null;
          items?: ReceiptItem[] | null;
          from_statement?: boolean;
          no_receipt?: boolean;
          receipt_attached_at?: string | null;
          created_at?: string;
          file_sha256?: string | null;
          // 0057 (tax codes): the code a card-statement expense was saved with. Null = no code (every
          // scanned or typed receipt, and a statement line that needs one). Optional until applied.
          tax_rate?: number | null;
          itc_pct?: number | null;
          deductible_pct?: number | null;
          tax_source?: TaxSourceName | null;
        };
        Update: {
          id?: string;
          user_id?: string;
          image_url?: string | null;
          merchant_name?: string;
          transaction_date?: string;
          total_amount?: number;
          tax_amount?: number;
          tax_category?: string;
          job_name?: string | null;
          job_id?: string | null;
          source_template_id?: string | null;
          paid_with_account_id?: string | null;
          items?: ReceiptItem[] | null;
          from_statement?: boolean;
          no_receipt?: boolean;
          receipt_attached_at?: string | null;
          created_at?: string;
          file_sha256?: string | null;
          // 0057 (tax codes): the code a card-statement expense was saved with. Null = no code (every
          // scanned or typed receipt, and a statement line that needs one). Optional until applied.
          tax_rate?: number | null;
          itc_pct?: number | null;
          deductible_pct?: number | null;
          tax_source?: TaxSourceName | null;
        };
        Relationships: [
          {
            foreignKeyName: "receipts_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "receipts_source_template_id_fkey";
            columns: ["source_template_id"];
            isOneToOne: false;
            referencedRelation: "expense_templates";
            referencedColumns: ["id"];
          },
        ];
      };
      clients: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          email: string | null;
          address: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          email?: string | null;
          address?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          email?: string | null;
          address?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      documents: {
        Row: {
          id: string;
          user_id: string;
          client_id: string | null;
          job_id: string | null;
          place_of_work: string | null;
          // Migration 0062. notes = client-facing; internal_notes = OWNER-ONLY, never in client output.
          notes: string | null;
          internal_notes: string | null;
          type: DocumentType;
          status: DocumentStatus;
          issue_date: string;
          due_date: string | null;
          subtotal: number;
          hst_amount: number;
          total_amount: number;
          converted_from_id: string | null;
          excluded_from_hst: boolean;
          document_number: number;
          is_progress_draw: boolean;
          draw_number: number | null;
          draw_description: string | null;
          draw_percent_complete: number | null;
          sign_token: string | null;
          signed_at: string | null;
          signer_name: string | null;
          signer_ip: string | null;
          view_token: string | null;
          invoice_email_sent_at: string | null;
          created_past_plan_limit: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          client_id?: string | null;
          job_id?: string | null;
          place_of_work?: string | null;
          notes?: string | null;
          internal_notes?: string | null;
          type: DocumentType;
          status?: DocumentStatus;
          issue_date?: string;
          due_date?: string | null;
          subtotal?: number;
          hst_amount?: number;
          total_amount?: number;
          converted_from_id?: string | null;
          excluded_from_hst?: boolean;
          document_number: number;
          is_progress_draw?: boolean;
          draw_number?: number | null;
          draw_description?: string | null;
          draw_percent_complete?: number | null;
          sign_token?: string | null;
          signed_at?: string | null;
          signer_name?: string | null;
          signer_ip?: string | null;
          view_token?: string | null;
          invoice_email_sent_at?: string | null;
          created_past_plan_limit?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          client_id?: string | null;
          job_id?: string | null;
          place_of_work?: string | null;
          notes?: string | null;
          internal_notes?: string | null;
          type?: DocumentType;
          status?: DocumentStatus;
          issue_date?: string;
          due_date?: string | null;
          subtotal?: number;
          hst_amount?: number;
          total_amount?: number;
          converted_from_id?: string | null;
          excluded_from_hst?: boolean;
          document_number?: number;
          is_progress_draw?: boolean;
          draw_number?: number | null;
          draw_description?: string | null;
          draw_percent_complete?: number | null;
          sign_token?: string | null;
          signed_at?: string | null;
          signer_name?: string | null;
          signer_ip?: string | null;
          view_token?: string | null;
          invoice_email_sent_at?: string | null;
          created_past_plan_limit?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "documents_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "documents_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      document_items: {
        Row: {
          id: string;
          document_id: string;
          // Migration 0061. A null name is a pre-0061 line: its description IS the name (lineName).
          name: string | null;
          description: string;
          unit: string | null;
          quantity: number;
          unit_price: number;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          document_id: string;
          name?: string | null;
          description: string;
          unit?: string | null;
          quantity?: number;
          unit_price?: number;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          document_id?: string;
          name?: string | null;
          description?: string;
          unit?: string | null;
          quantity?: number;
          unit_price?: number;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_items_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      payments: {
        Row: {
          id: string;
          document_id: string;
          amount: number;
          paid_date: string;
          method: string | null;
          note: string | null;
          bank_account_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          document_id: string;
          amount: number;
          paid_date?: string;
          method?: string | null;
          note?: string | null;
          bank_account_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          document_id?: string;
          amount?: number;
          paid_date?: string;
          method?: string | null;
          note?: string | null;
          bank_account_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payments_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "payments_bank_account_id_fkey";
            columns: ["bank_account_id"];
            isOneToOne: false;
            referencedRelation: "bank_accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      bank_accounts: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          is_active: boolean;
          account_type: "bank" | "card";
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          is_active?: boolean;
          account_type?: "bank" | "card";
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          is_active?: boolean;
          account_type?: "bank" | "card";
          created_at?: string;
        };
        Relationships: [];
      };
      expense_categories: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          is_active: boolean;
          // 0055: marks the one category statement import files interest and fees
          // under ('bank_charges'), whatever the owner has renamed it. Optional in
          // the type until that migration is applied everywhere.
          system_key?: "bank_charges" | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          is_active?: boolean;
          system_key?: "bank_charges" | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          is_active?: boolean;
          system_key?: "bank_charges" | null;
          created_at?: string;
        };
        Relationships: [];
      };
      jobs: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          location: string | null;
          client_id: string | null;
          contract_value: number | null;
          contract_number: number | null;
          retainage_rate: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          location?: string | null;
          client_id?: string | null;
          contract_value?: number | null;
          contract_number?: number | null;
          retainage_rate?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          location?: string | null;
          client_id?: string | null;
          contract_value?: number | null;
          contract_number?: number | null;
          retainage_rate?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
      contract_changes: {
        Row: {
          id: string;
          job_id: string;
          amount: number;
          reason: string;
          changed_at: string;
          created_at: string;
          billed_document_id: string | null;
        };
        Insert: {
          id?: string;
          job_id: string;
          amount: number;
          reason: string;
          changed_at?: string;
          created_at?: string;
          billed_document_id?: string | null;
        };
        Update: {
          id?: string;
          job_id?: string;
          amount?: number;
          reason?: string;
          changed_at?: string;
          created_at?: string;
          billed_document_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "contract_changes_billed_document_id_fkey";
            columns: ["billed_document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      contract_change_items: {
        Row: {
          id: string;
          contract_change_id: string;
          description: string;
          quantity: number;
          unit_price: number;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          contract_change_id: string;
          description: string;
          quantity?: number;
          unit_price?: number;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          contract_change_id?: string;
          description?: string;
          quantity?: number;
          unit_price?: number;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contract_change_items_contract_change_id_fkey";
            columns: ["contract_change_id"];
            isOneToOne: false;
            referencedRelation: "contract_changes";
            referencedColumns: ["id"];
          },
        ];
      };
      line_items: {
        Row: {
          id: string;
          user_id: string;
          // Migration 0061 (name, unit). A null name is an old item: its description IS the name.
          name: string | null;
          description: string;
          unit: string | null;
          unit_price: number;
          // Migration 0059. Reads must treat a missing/invalid value as 1 (savedItemQuantity).
          quantity: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name?: string | null;
          description: string;
          unit?: string | null;
          unit_price?: number;
          quantity?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string | null;
          description?: string;
          unit?: string | null;
          unit_price?: number;
          quantity?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      expense_templates: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          description: string;
          default_amount: number;
          default_tax_amount: number;
          default_tax_category: string;
          default_paid_with_account_id: string | null;
          job_id: string | null;
          recurrence_hint: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          description: string;
          default_amount?: number;
          default_tax_amount?: number;
          default_tax_category?: string;
          default_paid_with_account_id?: string | null;
          job_id?: string | null;
          recurrence_hint?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          description?: string;
          default_amount?: number;
          default_tax_amount?: number;
          default_tax_category?: string;
          default_paid_with_account_id?: string | null;
          job_id?: string | null;
          recurrence_hint?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "expense_templates_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      employees: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          default_hourly_rate: number;
          default_billable_rate: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          default_hourly_rate?: number;
          default_billable_rate?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          default_hourly_rate?: number;
          default_billable_rate?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      hour_entries: {
        Row: {
          id: string;
          user_id: string;
          employee_id: string;
          job_id: string;
          work_date: string;
          hours: number;
          rate: number;
          labor_cost: number;
          billable_rate: number;
          labor_revenue: number;
          // Set when this entry was generated from a clock-in/out session
          // (0043_employee_login.sql). Hours/date on such a row are derived
          // from the session's timestamps - edit the session, not the entry.
          time_session_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          employee_id: string;
          job_id: string;
          work_date?: string;
          hours: number;
          rate: number;
          billable_rate?: number;
          time_session_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          employee_id?: string;
          job_id?: string;
          work_date?: string;
          hours?: number;
          rate?: number;
          billable_rate?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "hour_entries_time_session_id_fkey";
            columns: ["time_session_id"];
            isOneToOne: true;
            referencedRelation: "time_sessions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hour_entries_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hour_entries_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      renters: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          rental_rate: number;
          rate_cadence: RateCadence;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          rental_rate?: number;
          rate_cadence?: RateCadence;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          rental_rate?: number;
          rate_cadence?: RateCadence;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      rent_payments: {
        Row: {
          id: string;
          user_id: string;
          renter_id: string;
          paid_date: string;
          amount: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          renter_id: string;
          paid_date?: string;
          amount: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          renter_id?: string;
          paid_date?: string;
          amount?: number;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "rent_payments_renter_id_fkey";
            columns: ["renter_id"];
            isOneToOne: false;
            referencedRelation: "renters";
            referencedColumns: ["id"];
          },
        ];
      };
      services: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          default_price: number;
          color: string;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          default_price?: number;
          color: string;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          default_price?: number;
          color?: string;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      stylists: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          is_active: boolean;
          pay_type: PayType;
          commission_rate: number;
          // Never selectable via a normal request (column-level REVOKE in
          // 0013_stylist_pin.sql) - present here only to mirror the actual
          // DB schema, per this file's own header comment. Every real
          // select call site uses STYLIST_PUBLIC_COLUMNS instead of "*",
          // which omits this and reads has_pin instead.
          pin_hash: string | null;
          has_pin: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          is_active?: boolean;
          pay_type?: PayType;
          commission_rate?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          is_active?: boolean;
          pay_type?: PayType;
          commission_rate?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      // Founder /admin audit log (0041_admin_actions.sql) - service-role
      // access only, RLS on with no policies. 'note' rows carry the note
      // body in `reason`.
      admin_actions: {
        Row: {
          id: string;
          account_id: string;
          account_email: string;
          admin_id: string;
          action_type: AdminActionType;
          old_value: string | null;
          new_value: string | null;
          reason: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          account_id: string;
          account_email: string;
          admin_id: string;
          action_type: AdminActionType;
          old_value?: string | null;
          new_value?: string | null;
          reason: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          account_id?: string;
          account_email?: string;
          admin_id?: string;
          action_type?: AdminActionType;
          old_value?: string | null;
          new_value?: string | null;
          reason?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      commission_entries: {
        Row: {
          id: string;
          user_id: string;
          stylist_id: string;
          service_id: string | null;
          service_name: string;
          customer_name: string | null;
          price_charged: number;
          commission_rate_applied: number;
          commission_owed: number;
          payout_id: string | null;
          // Null for every entry logged before 0036_register_transactions.sql
          // (never backfilled) and for a legacy standalone single-service
          // sale - set only when the entry was rung up as part of a
          // multi-item Register cart checkout.
          transaction_id: string | null;
          is_deleted: boolean;
          deleted_at: string | null;
          // Set together, only on the FIRST edit (see
          // 0018_commission_entry_edits.sql / PATCH /api/commission-entries/[id])
          // - a second edit must not overwrite these with the state right
          // before it, so they always read as "what was first entered."
          edited_at: string | null;
          original_service_id: string | null;
          original_service_name: string | null;
          original_price: number | null;
          original_stylist_id: string | null;
          original_stylist_name: string | null;
          // Reference/reporting only (0024_commission_payment_tax.sql) -
          // never wired into sales/documents/payments or lib/hst.ts, same
          // boundary as commission_owed/labor_cost.
          payment_method: string | null;
          tax_applied: boolean;
          tax_amount: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          stylist_id: string;
          service_id?: string | null;
          service_name: string;
          customer_name?: string | null;
          price_charged: number;
          commission_rate_applied: number;
          payout_id?: string | null;
          transaction_id?: string | null;
          is_deleted?: boolean;
          deleted_at?: string | null;
          edited_at?: string | null;
          original_service_id?: string | null;
          original_service_name?: string | null;
          original_price?: number | null;
          original_stylist_id?: string | null;
          original_stylist_name?: string | null;
          payment_method?: string | null;
          tax_applied?: boolean;
          tax_amount?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          stylist_id?: string;
          service_id?: string | null;
          service_name?: string;
          customer_name?: string | null;
          price_charged?: number;
          commission_rate_applied?: number;
          payout_id?: string | null;
          transaction_id?: string | null;
          is_deleted?: boolean;
          deleted_at?: string | null;
          edited_at?: string | null;
          original_service_id?: string | null;
          original_service_name?: string | null;
          original_price?: number | null;
          original_stylist_id?: string | null;
          original_stylist_name?: string | null;
          payment_method?: string | null;
          tax_applied?: boolean;
          tax_amount?: number | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "commission_entries_stylist_id_fkey";
            columns: ["stylist_id"];
            isOneToOne: false;
            referencedRelation: "stylists";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "commission_entries_service_id_fkey";
            columns: ["service_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "commission_entries_original_stylist_id_fkey";
            columns: ["original_stylist_id"];
            isOneToOne: false;
            referencedRelation: "stylists";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "commission_entries_payout_id_fkey";
            columns: ["payout_id"];
            isOneToOne: false;
            referencedRelation: "payouts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "commission_entries_original_service_id_fkey";
            columns: ["original_service_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "commission_entries_transaction_id_fkey";
            columns: ["transaction_id"];
            isOneToOne: false;
            referencedRelation: "register_transactions";
            referencedColumns: ["id"];
          },
        ];
      };
      products: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          default_price: number;
          is_active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          name: string;
          default_price?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          name?: string;
          default_price?: number;
          is_active?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      register_transactions: {
        Row: {
          id: string;
          user_id: string;
          customer_name: string | null;
          payment_method: string | null;
          tax_applied: boolean;
          subtotal: number;
          tax_amount: number;
          total_amount: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          customer_name?: string | null;
          payment_method?: string | null;
          tax_applied?: boolean;
          subtotal?: number;
          tax_amount?: number;
          total_amount?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          customer_name?: string | null;
          payment_method?: string | null;
          tax_applied?: boolean;
          subtotal?: number;
          tax_amount?: number;
          total_amount?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      register_transaction_products: {
        Row: {
          id: string;
          transaction_id: string;
          product_id: string | null;
          product_name: string;
          price_charged: number;
          tax_amount: number | null;
          is_deleted: boolean;
          deleted_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          transaction_id: string;
          product_id?: string | null;
          product_name: string;
          price_charged: number;
          tax_amount?: number | null;
          is_deleted?: boolean;
          deleted_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          transaction_id?: string;
          product_id?: string | null;
          product_name?: string;
          price_charged?: number;
          tax_amount?: number | null;
          is_deleted?: boolean;
          deleted_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "register_transaction_products_transaction_id_fkey";
            columns: ["transaction_id"];
            isOneToOne: false;
            referencedRelation: "register_transactions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "register_transaction_products_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      payouts: {
        Row: {
          id: string;
          stylist_id: string;
          paid_at: string;
          total_amount: number;
          range_start: string;
          range_end: string;
          confirmed_by_stylist: boolean;
          confirmed_at: string | null;
          status: PayoutStatus;
          voided_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          stylist_id: string;
          paid_at?: string;
          total_amount: number;
          range_start: string;
          range_end: string;
          confirmed_by_stylist?: boolean;
          confirmed_at?: string | null;
          status?: PayoutStatus;
          voided_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          stylist_id?: string;
          paid_at?: string;
          total_amount?: number;
          range_start?: string;
          range_end?: string;
          confirmed_by_stylist?: boolean;
          confirmed_at?: string | null;
          status?: PayoutStatus;
          voided_at?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "payouts_stylist_id_fkey";
            columns: ["stylist_id"];
            isOneToOne: false;
            referencedRelation: "stylists";
            referencedColumns: ["id"];
          },
        ];
      };
      adjustments: {
        Row: {
          id: string;
          stylist_id: string;
          amount: number;
          reason: string;
          related_payout_id: string | null;
          applied_payout_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          stylist_id: string;
          amount: number;
          reason: string;
          related_payout_id?: string | null;
          applied_payout_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          stylist_id?: string;
          amount?: number;
          reason?: string;
          related_payout_id?: string | null;
          applied_payout_id?: string | null;
          created_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "adjustments_stylist_id_fkey";
            columns: ["stylist_id"];
            isOneToOne: false;
            referencedRelation: "stylists";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "adjustments_related_payout_id_fkey";
            columns: ["related_payout_id"];
            isOneToOne: false;
            referencedRelation: "payouts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "adjustments_applied_payout_id_fkey";
            columns: ["applied_payout_id"];
            isOneToOne: false;
            referencedRelation: "payouts";
            referencedColumns: ["id"];
          },
        ];
      };
      sales: {
        Row: {
          id: string;
          user_id: string;
          period_label: string;
          gross_sales: number;
          cash_deposits: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          period_label: string;
          gross_sales?: number;
          cash_deposits?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          period_label?: string;
          gross_sales?: number;
          cash_deposits?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      app_settings: {
        Row: {
          user_id: string;
          // Never selectable via a normal request (column-level REVOKE in
          // 0017_app_lock.sql) - present here only to mirror the actual DB
          // schema, per this file's own header comment. Every real select
          // call site uses APP_SETTINGS_PUBLIC_COLUMNS instead of "*",
          // which omits these and reads has_owner_pin/has_staff_pin instead.
          owner_pin_hash: string | null;
          staff_pin_hash: string | null;
          has_owner_pin: boolean;
          has_staff_pin: boolean;
          // Shared per-business employee clock-in link token (0043).
          employee_login_token: string | null;
          created_at: string;
        };
        Insert: {
          user_id: string;
          employee_login_token?: string | null;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          employee_login_token?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      // pin_hash is deliberately absent from Row: it's never selectable by
      // authenticated/anon (0043_employee_login.sql) so nothing typed here
      // should ever pretend otherwise.
      employee_pins: {
        Row: {
          employee_id: string;
          user_id: string;
          pin_failed_attempts: number;
          pin_locked_until: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      employee_sessions: {
        Row: {
          id: string;
          token_hash: string;
          user_id: string;
          employee_id: string;
          created_at: string;
          last_seen_at: string;
          expires_at: string;
        };
        Insert: {
          id?: string;
          token_hash: string;
          user_id: string;
          employee_id: string;
          created_at?: string;
          last_seen_at?: string;
          expires_at: string;
        };
        Update: {
          last_seen_at?: string;
          expires_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "employee_sessions_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      employee_login_failures: {
        Row: { id: number; ip: string; created_at: string };
        Insert: { ip: string; created_at?: string };
        Update: never;
        Relationships: [];
      };
      client_portal_logins: {
        // pin_hash is never selectable; rows are written only through the
        // create/reset/regenerate/remove_client_portal_* functions.
        Row: {
          client_id: string;
          user_id: string;
          link_token: string;
          pin_failed_attempts: number;
          pin_locked_until: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "client_portal_logins_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: true;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
      };
      client_sessions: {
        Row: {
          id: string;
          token_hash: string;
          user_id: string;
          client_id: string;
          created_at: string;
          last_seen_at: string;
          expires_at: string;
        };
        Insert: {
          id?: string;
          token_hash: string;
          user_id: string;
          client_id: string;
          created_at?: string;
          last_seen_at?: string;
          expires_at: string;
        };
        Update: {
          last_seen_at?: string;
          expires_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "client_sessions_client_id_fkey";
            columns: ["client_id"];
            isOneToOne: false;
            referencedRelation: "clients";
            referencedColumns: ["id"];
          },
        ];
      };
      client_login_failures: {
        Row: { id: number; ip: string; created_at: string };
        Insert: { ip: string; created_at?: string };
        Update: never;
        Relationships: [];
      };
      accountant_logins: {
        // pin_hash is never selectable; rows are written only through the
        // create/reset/regenerate/remove_accountant_* functions.
        Row: {
          user_id: string;
          link_token: string;
          pin_failed_attempts: number;
          pin_locked_until: string | null;
          last_login_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      accountant_sessions: {
        Row: {
          id: string;
          token_hash: string;
          user_id: string;
          created_at: string;
          expires_at: string;
        };
        Insert: {
          id?: string;
          token_hash: string;
          user_id: string;
          created_at?: string;
          expires_at: string;
        };
        Update: never;
        Relationships: [];
      };
      accountant_login_failures: {
        Row: { id: number; ip: string; created_at: string };
        Insert: { ip: string; created_at?: string };
        Update: never;
        Relationships: [];
      };
      time_sessions: {
        Row: {
          id: string;
          user_id: string;
          employee_id: string;
          job_id: string;
          clock_in_at: string;
          clock_out_at: string | null;
          rate: number;
          billable_rate: number;
          closed_by: "employee" | "owner" | null;
          owner_edited_at: string | null;
          original_clock_in_at: string | null;
          original_clock_out_at: string | null;
          created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [
          {
            foreignKeyName: "time_sessions_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "time_sessions_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      statement_imports: {
        Row: {
          id: string;
          user_id: string;
          account_id: string;
          status: StatementImportStatus;
          file_sha256: string;
          page_count: number;
          issuer: string | null;
          period_start: string | null;
          period_end: string | null;
          opening_balance: number | null;
          closing_balance: number | null;
          statement_total: number | null;
          statement_total_kind: "purchases" | "new_balance" | null;
          reconcile_diff: number | null;
          reconcile_acknowledged: boolean;
          line_count: number | null;
          input_tokens: number;
          output_tokens: number;
          created_at: string;
          updated_at: string;
          committed_at: string | null;
        };
        // Created and changed through the service-role functions below (0052),
        // never by an owner. The one direct write is touching updated_at when
        // the user edits a line, so a draft in use isn't purged as stale.
        Insert: never;
        // Service role only. Besides touching updated_at, the app moves a SAVED import between
        // 'committed' and 'discarded' (Delete statement, Re-import and its rollback); every other
        // change goes through the statement functions.
        Update: { updated_at?: string; status?: StatementImportStatus };
        Relationships: [];
      };
      statement_chunks: {
        Row: {
          id: string;
          import_id: string;
          user_id: string;
          chunk_no: number;
          page_from: number;
          page_to: number;
          status: "pending" | "done" | "failed";
          attempts: number;
          error_code: string | null;
          input_tokens: number;
          output_tokens: number;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      statement_lines: {
        Row: {
          id: string;
          import_id: string;
          chunk_id: string;
          user_id: string;
          account_id: string;
          page: number;
          line_no: number;
          txn_date: string;
          description: string;
          amount: number;
          kind: StatementLineKind;
          currency: string;
          original_amount: number | null;
          original_currency: string | null;
          line_fingerprint: string | null;
          duplicate_of_line_id: string | null;
          duplicate_override: boolean;
          suggested_category: string | null;
          category: string | null;
          category_confirmed: boolean;
          paid_with_account_id: string | null;
          tax_amount: number;
          resolution: "matched" | "new_expense" | "skipped" | null;
          matched_receipt_id: string | null;
          created_receipt_id: string | null;
          committed: boolean;
          // 0057 (tax codes): the owner's pick for the line, and the resolved code once saved.
          tax_rate?: number | null;
          itc_pct?: number | null;
          deductible_pct?: number | null;
          tax_source?: TaxSourceName | null;
          // 0058: set when the line was freed by deleting its expense / matched receipt, and what
          // it was before ('new_expense' | 'matched'). Null on every line freed before 0058.
          released_at?: string | null;
          released_from?: "new_expense" | "matched" | null;
        };
        Insert: never;
        // Service-role only (the owner has SELECT, nothing else): the review
        // routes write the user's per-line decisions through the admin client.
        Update: Partial<
          Omit<
            Database["public"]["Tables"]["statement_lines"]["Row"],
            "id" | "import_id" | "chunk_id" | "user_id" | "account_id"
          >
        >;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      start_statement_import: {
        Args: {
          p_user_id: string;
          p_account_id: string;
          p_file_sha256: string;
          p_page_count: number;
          p_chunks: Json;
          p_monthly_cap: number | null;
        };
        Returns: string;
      };
      save_chunk_result: {
        Args: {
          p_user_id: string;
          p_import_id: string;
          p_chunk_no: number;
          p_lines: Json;
          p_header: Json;
          p_input_tokens: number;
          p_output_tokens: number;
        };
        Returns: number;
      };
      fail_chunk: {
        Args: {
          p_user_id: string;
          p_import_id: string;
          p_chunk_no: number;
          p_error_code: string;
          p_input_tokens: number;
          p_output_tokens: number;
        };
        Returns: undefined;
      };
      finalize_statement_lines: {
        Args: { p_user_id: string; p_import_id: string };
        Returns: number;
      };
      commit_statement_import: {
        Args: {
          p_user_id: string;
          p_import_id: string;
          p_reconcile_diff: number | null;
          p_reconcile_acknowledged: boolean;
        };
        Returns: Json;
      };
      discard_statement_import: {
        Args: { p_user_id: string; p_import_id: string };
        Returns: undefined;
      };
      purge_stale_statement_drafts: {
        Args: { p_days?: number };
        Returns: number;
      };
      rename_expense_category: {
        Args: { p_id: string; p_new_name: string };
        Returns: Database["public"]["Tables"]["expense_categories"]["Row"];
      };
      create_payout: {
        Args: {
          p_stylist_id: string;
          p_range_start: string;
          p_range_end: string;
        };
        Returns: Database["public"]["Tables"]["payouts"]["Row"];
      };
      create_adjustment: {
        Args: {
          p_stylist_id: string;
          p_related_payout_id: string;
          p_amount: number;
          p_reason: string;
        };
        Returns: Database["public"]["Tables"]["adjustments"]["Row"];
      };
      confirm_payout: {
        Args: {
          p_payout_id: string;
        };
        Returns: Database["public"]["Tables"]["payouts"]["Row"];
      };
      void_payout: {
        Args: {
          p_payout_id: string;
        };
        Returns: Database["public"]["Tables"]["payouts"]["Row"];
      };
      set_stylist_pin: {
        Args: {
          p_stylist_id: string;
          p_pin: string;
        };
        Returns: undefined;
      };
      verify_stylist_pin: {
        Args: {
          p_stylist_id: string;
          p_pin: string;
        };
        Returns: boolean;
      };
      set_owner_pin: {
        Args: {
          p_pin: string;
        };
        Returns: undefined;
      };
      set_staff_pin: {
        Args: {
          p_pin: string;
        };
        Returns: undefined;
      };
      verify_app_pin: {
        Args: {
          p_pin: string;
        };
        Returns: string | null;
      };
      create_employee_pin: {
        Args: { p_employee_id: string; p_pin: string };
        Returns: undefined;
      };
      reset_employee_pin: {
        Args: { p_employee_id: string; p_pin: string };
        Returns: undefined;
      };
      remove_employee_pin: {
        Args: { p_employee_id: string };
        Returns: undefined;
      };
      verify_employee_pin: {
        Args: { p_user_id: string; p_employee_id: string; p_pin: string };
        Returns: boolean;
      };
      create_client_portal_login: {
        Args: { p_client_id: string; p_pin: string; p_link_token: string };
        Returns: undefined;
      };
      reset_client_portal_pin: {
        Args: { p_client_id: string; p_pin: string };
        Returns: undefined;
      };
      regenerate_client_portal_link: {
        Args: { p_client_id: string; p_link_token: string };
        Returns: undefined;
      };
      remove_client_portal_login: {
        Args: { p_client_id: string };
        Returns: undefined;
      };
      verify_client_pin: {
        Args: { p_user_id: string; p_client_id: string; p_pin: string };
        Returns: boolean;
      };
      create_accountant_login: {
        Args: { p_pin: string; p_link_token: string };
        Returns: undefined;
      };
      reset_accountant_pin: {
        Args: { p_pin: string };
        Returns: undefined;
      };
      regenerate_accountant_link: {
        Args: { p_link_token: string };
        Returns: undefined;
      };
      remove_accountant_login: {
        Args: Record<PropertyKey, never>;
        Returns: undefined;
      };
      verify_accountant_pin: {
        Args: { p_user_id: string; p_pin: string };
        Returns: boolean;
      };
      employee_clock_in: {
        Args: { p_user_id: string; p_employee_id: string; p_job_id: string };
        Returns: Database["public"]["Tables"]["time_sessions"]["Row"];
      };
      employee_clock_out: {
        Args: { p_user_id: string; p_employee_id: string };
        Returns: Database["public"]["Tables"]["time_sessions"]["Row"];
      };
      owner_close_time_session: {
        Args: { p_id: string; p_clock_out_at: string };
        Returns: Database["public"]["Tables"]["time_sessions"]["Row"];
      };
      owner_edit_time_session: {
        Args: { p_id: string; p_clock_in_at: string; p_clock_out_at: string | null };
        Returns: Database["public"]["Tables"]["time_sessions"]["Row"];
      };
      owner_delete_time_session: {
        Args: { p_id: string };
        Returns: undefined;
      };
      create_register_transaction: {
        Args: {
          p_customer_name: string | null;
          p_payment_method: string | null;
          p_tax_applied: boolean;
          p_services: Json;
          p_products: Json;
        };
        Returns: Database["public"]["Tables"]["register_transactions"]["Row"];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type TaxSourceName = "line" | "rule" | "foreign_currency" | "category" | "kind";

export type Receipt = Database["public"]["Tables"]["receipts"]["Row"];
export type Client = Database["public"]["Tables"]["clients"]["Row"];
export type ClientUpdate = Database["public"]["Tables"]["clients"]["Update"];
export type InvoiceDocument = Database["public"]["Tables"]["documents"]["Row"];
export type DocumentUpdate = Database["public"]["Tables"]["documents"]["Update"];
export type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];
export type DocumentItem = Database["public"]["Tables"]["document_items"]["Row"];
export type SalesPeriod = Database["public"]["Tables"]["sales"]["Row"];
export type Payment = Database["public"]["Tables"]["payments"]["Row"];
export type Job = Database["public"]["Tables"]["jobs"]["Row"];
export type BankAccount = Database["public"]["Tables"]["bank_accounts"]["Row"];
export type ExpenseCategory = Database["public"]["Tables"]["expense_categories"]["Row"];
export type StatementImport = Database["public"]["Tables"]["statement_imports"]["Row"];
export type StatementChunk = Database["public"]["Tables"]["statement_chunks"]["Row"];
export type StatementLine = Database["public"]["Tables"]["statement_lines"]["Row"];
export type JobUpdate = Database["public"]["Tables"]["jobs"]["Update"];
export type ContractChange = Database["public"]["Tables"]["contract_changes"]["Row"];
export type LineItem = Database["public"]["Tables"]["line_items"]["Row"];
export type LineItemUpdate = Database["public"]["Tables"]["line_items"]["Update"];
export type ExpenseTemplate = Database["public"]["Tables"]["expense_templates"]["Row"];
export type Employee = Database["public"]["Tables"]["employees"]["Row"];
export type EmployeeUpdate = Database["public"]["Tables"]["employees"]["Update"];
export type TimeSession = Database["public"]["Tables"]["time_sessions"]["Row"];
export type EmployeePinStatus = Database["public"]["Tables"]["employee_pins"]["Row"];
export type HourEntry = Database["public"]["Tables"]["hour_entries"]["Row"];
export type HourEntryUpdate = Database["public"]["Tables"]["hour_entries"]["Update"];
export type Renter = Database["public"]["Tables"]["renters"]["Row"];
export type RenterUpdate = Database["public"]["Tables"]["renters"]["Update"];
export type RentPayment = Database["public"]["Tables"]["rent_payments"]["Row"];
export type RentPaymentUpdate = Database["public"]["Tables"]["rent_payments"]["Update"];
export type Service = Database["public"]["Tables"]["services"]["Row"];
export type ServiceUpdate = Database["public"]["Tables"]["services"]["Update"];
export type Stylist = Database["public"]["Tables"]["stylists"]["Row"];
export type StylistUpdate = Database["public"]["Tables"]["stylists"]["Update"];
// What every real select actually returns (STYLIST_PUBLIC_COLUMNS omits
// pin_hash) - use this, not Stylist, for anything that reaches the client.
export type StylistPublic = Omit<Stylist, "pin_hash">;
export type CommissionEntry = Database["public"]["Tables"]["commission_entries"]["Row"];
export type CommissionEntryUpdate =
  Database["public"]["Tables"]["commission_entries"]["Update"];
export type Product = Database["public"]["Tables"]["products"]["Row"];
export type ProductUpdate = Database["public"]["Tables"]["products"]["Update"];
export type RegisterTransaction = Database["public"]["Tables"]["register_transactions"]["Row"];
export type RegisterTransactionProduct =
  Database["public"]["Tables"]["register_transaction_products"]["Row"];
export type Payout = Database["public"]["Tables"]["payouts"]["Row"];
export type Adjustment = Database["public"]["Tables"]["adjustments"]["Row"];
export type AppSettings = Database["public"]["Tables"]["app_settings"]["Row"];
// What every real select actually returns (APP_SETTINGS_PUBLIC_COLUMNS omits
// owner_pin_hash/staff_pin_hash) - use this, not AppSettings, for anything
// that reaches the client.
export type AppSettingsPublic = Omit<AppSettings, "owner_pin_hash" | "staff_pin_hash">;

export interface CommissionEntryWithRelations extends CommissionEntry {
  stylist: StylistPublic;
  service: Service | null;
  payout: Pick<
    Payout,
    | "id"
    | "confirmed_by_stylist"
    | "confirmed_at"
    | "paid_at"
    | "status"
    | "total_amount"
    | "range_start"
    | "range_end"
  > | null;
}

// The Register cart's own checkout record, with its service (via the
// linked commission_entries rows) and product line items nested - used by
// GET /api/register-transactions for the "Today's entries" staff-mode
// list and anywhere else a transaction needs to show what was actually
// rung up in it.
export interface RegisterTransactionWithItems extends RegisterTransaction {
  entries: CommissionEntryWithRelations[];
  products: RegisterTransactionProduct[];
}

export interface RentPaymentWithRenter extends RentPayment {
  renter: Pick<Renter, "id" | "name">;
}

export interface DocumentWithClient extends InvoiceDocument {
  client: Client | null;
  job: Job | null;
  payments: Payment[];
}

export interface DocumentWithRelations extends DocumentWithClient {
  items: DocumentItem[];
}

export interface ExpenseTemplateWithJob extends ExpenseTemplate {
  job: { name: string } | null;
}

// The slice of a clocked session the Hours page needs to show its times and
// let the owner correct them. Absent on manually logged entries.
export type HourEntrySession = Pick<
  TimeSession,
  | "id"
  | "clock_in_at"
  | "clock_out_at"
  | "closed_by"
  | "owner_edited_at"
  | "original_clock_in_at"
  | "original_clock_out_at"
>;

export interface HourEntryWithRelations extends HourEntry {
  employee: Employee;
  job: Job;
  session?: HourEntrySession | null;
}
