// Hand-written types mirroring supabase/migrations/*.sql.
// If you have the Supabase CLI, regenerate with:
//   npx supabase gen types typescript --project-id <id> > src/lib/database.types.ts

export type SubscriptionStatus = "free" | "basic" | "pro";
export type DocumentType = "invoice" | "estimate";
export type DocumentStatus = "draft" | "sent" | "partial" | "paid";

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
          subscription_status: SubscriptionStatus;
          business_type: string;
          logo_url: string | null;
          business_name: string | null;
          business_address: string | null;
          business_phone: string | null;
          business_email: string | null;
          business_profile_skipped: boolean;
          created_at: string;
        };
        Insert: {
          id: string;
          email: string;
          stripe_customer_id?: string | null;
          subscription_status?: SubscriptionStatus;
          business_type?: string;
          logo_url?: string | null;
          business_name?: string | null;
          business_address?: string | null;
          business_phone?: string | null;
          business_email?: string | null;
          business_profile_skipped?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          stripe_customer_id?: string | null;
          subscription_status?: SubscriptionStatus;
          business_type?: string;
          logo_url?: string | null;
          business_name?: string | null;
          business_address?: string | null;
          business_phone?: string | null;
          business_email?: string | null;
          business_profile_skipped?: boolean;
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
          items: ReceiptItem[] | null;
          created_at: string;
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
          items?: ReceiptItem[] | null;
          created_at?: string;
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
          items?: ReceiptItem[] | null;
          created_at?: string;
        };
        Relationships: [];
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
          type: DocumentType;
          status: DocumentStatus;
          issue_date: string;
          due_date: string | null;
          subtotal: number;
          hst_amount: number;
          total_amount: number;
          converted_from_id: string | null;
          excluded_from_hst: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          client_id?: string | null;
          type: DocumentType;
          status?: DocumentStatus;
          issue_date?: string;
          due_date?: string | null;
          subtotal?: number;
          hst_amount?: number;
          total_amount?: number;
          converted_from_id?: string | null;
          excluded_from_hst?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          client_id?: string | null;
          type?: DocumentType;
          status?: DocumentStatus;
          issue_date?: string;
          due_date?: string | null;
          subtotal?: number;
          hst_amount?: number;
          total_amount?: number;
          converted_from_id?: string | null;
          excluded_from_hst?: boolean;
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
        ];
      };
      document_items: {
        Row: {
          id: string;
          document_id: string;
          description: string;
          quantity: number;
          unit_price: number;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          document_id: string;
          description: string;
          quantity?: number;
          unit_price?: number;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          document_id?: string;
          description?: string;
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
          created_at: string;
        };
        Insert: {
          id?: string;
          document_id: string;
          amount: number;
          paid_date?: string;
          method?: string | null;
          note?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          document_id?: string;
          amount?: number;
          paid_date?: string;
          method?: string | null;
          note?: string | null;
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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type Receipt = Database["public"]["Tables"]["receipts"]["Row"];
export type Client = Database["public"]["Tables"]["clients"]["Row"];
export type InvoiceDocument = Database["public"]["Tables"]["documents"]["Row"];
export type DocumentUpdate = Database["public"]["Tables"]["documents"]["Update"];
export type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];
export type DocumentItem = Database["public"]["Tables"]["document_items"]["Row"];
export type SalesPeriod = Database["public"]["Tables"]["sales"]["Row"];
export type Payment = Database["public"]["Tables"]["payments"]["Row"];

export interface DocumentWithClient extends InvoiceDocument {
  client: Client | null;
  payments: Payment[];
}

export interface DocumentWithRelations extends DocumentWithClient {
  items: DocumentItem[];
}
