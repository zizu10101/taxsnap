// Hand-written types mirroring supabase/migrations/*.sql.
// If you have the Supabase CLI, regenerate with:
//   npx supabase gen types typescript --project-id <id> > src/lib/database.types.ts

export type SubscriptionStatus = "free" | "basic" | "pro";
export type InvoiceStatus = "draft" | "sent" | "paid";

export interface ReceiptItem {
  name: string;
  amount: number;
}

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unit_price: number;
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
          created_at: string;
        };
        Insert: {
          id: string;
          email: string;
          stripe_customer_id?: string | null;
          subscription_status?: SubscriptionStatus;
          business_type?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          stripe_customer_id?: string | null;
          subscription_status?: SubscriptionStatus;
          business_type?: string;
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
          items?: ReceiptItem[] | null;
          created_at?: string;
        };
        Relationships: [];
      };
      invoices: {
        Row: {
          id: string;
          user_id: string;
          client_name: string;
          client_email: string | null;
          line_items: InvoiceLineItem[];
          total_amount: number;
          status: InvoiceStatus;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          client_name: string;
          client_email?: string | null;
          line_items?: InvoiceLineItem[];
          total_amount?: number;
          status?: InvoiceStatus;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          client_name?: string;
          client_email?: string | null;
          line_items?: InvoiceLineItem[];
          total_amount?: number;
          status?: InvoiceStatus;
          created_at?: string;
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
export type Invoice = Database["public"]["Tables"]["invoices"]["Row"];
