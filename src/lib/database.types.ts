// ATENÇÃO: Este arquivo foi escrito manualmente como aproximação do schema.
// Após aplicar a migration 002_whatsapp_bot.sql no Supabase, REGENERE com:
//   npm run gen:types
// Isso substituirá o conteúdo por tipos gerados automaticamente do banco real,
// garantindo que divergências de schema virem erros de compilação.

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
      profiles: {
        Row: {
          id: string
          full_name: string | null
          company_name: string | null
          created_at: string
          updated_at: string | null
        }
        Insert: {
          id: string
          full_name?: string | null
          company_name?: string | null
          created_at?: string
          updated_at?: string | null
        }
        Update: {
          id?: string
          full_name?: string | null
          company_name?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }

      cars: {
        Row: {
          id: string
          user_id: string
          brand: string
          model: string
          version: string | null
          year: number
          price: number
          mileage: number
          transmission: string | null
          fuel: string | null
          color: string | null
          vehicle_type: string
          status: 'available' | 'reserved' | 'sold'
          sold_price: number | null
          sold_at: string | null
          sold_by: string | null
          description: string | null
          created_at: string
          updated_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          brand: string
          model: string
          version?: string | null
          year: number
          price: number
          mileage?: number
          transmission?: string | null
          fuel?: string | null
          color?: string | null
          vehicle_type?: string
          status?: 'available' | 'reserved' | 'sold'
          sold_price?: number | null
          sold_at?: string | null
          sold_by?: string | null
          description?: string | null
          created_at?: string
          updated_at?: string | null
        }
        Update: {
          brand?: string
          model?: string
          version?: string | null
          year?: number
          price?: number
          mileage?: number
          transmission?: string | null
          fuel?: string | null
          color?: string | null
          vehicle_type?: string
          status?: 'available' | 'reserved' | 'sold'
          sold_price?: number | null
          sold_at?: string | null
          sold_by?: string | null
          description?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }

      car_images: {
        Row: {
          id: string
          car_id: string
          user_id: string
          image_url: string
          file_path: string | null
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          car_id: string
          user_id: string
          image_url: string
          file_path?: string | null
          sort_order?: number
          created_at?: string
        }
        Update: {
          image_url?: string
          file_path?: string | null
          sort_order?: number
        }
        Relationships: []
      }

      leads: {
        Row: {
          id: string
          user_id: string
          name: string
          phone: string | null
          email: string | null
          status: string
          notes: string | null
          car_id: string | null
          created_at: string
          updated_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          name: string
          phone?: string | null
          email?: string | null
          status?: string
          notes?: string | null
          car_id?: string | null
          created_at?: string
          updated_at?: string | null
        }
        Update: {
          name?: string
          phone?: string | null
          email?: string | null
          status?: string
          notes?: string | null
          car_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }

      appointments: {
        Row: {
          id: string
          user_id: string
          customer_name: string
          customer_phone: string | null
          customer_email: string | null
          appointment_date: string
          appointment_time: string
          status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
          notes: string | null
          car_id: string | null
          created_at: string
          updated_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          customer_name: string
          customer_phone?: string | null
          customer_email?: string | null
          appointment_date: string
          appointment_time: string
          status?: 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
          notes?: string | null
          car_id?: string | null
          created_at?: string
          updated_at?: string | null
        }
        Update: {
          customer_name?: string
          customer_phone?: string | null
          customer_email?: string | null
          appointment_date?: string
          appointment_time?: string
          status?: 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show'
          notes?: string | null
          car_id?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }

      company_settings: {
        Row: {
          id: string
          user_id: string
          company_name: string | null
          address: string | null
          phone_number: string | null
          whatsapp_number: string | null
          working_days: string | null
          business_hours_start: string | null
          business_hours_end: string | null
          appointment_duration: number | null
          appointment_interval: number | null
          whatsapp_phone_number_id: string | null
          booking_mode: 'auto' | 'confirm'
          bot_custom_instructions: string | null
          business_hours: Json | null
          max_appointments_per_slot: number
          created_at: string
          updated_at: string | null
        }
        Insert: {
          id?: string
          user_id: string
          company_name?: string | null
          address?: string | null
          phone_number?: string | null
          whatsapp_number?: string | null
          working_days?: string | null
          business_hours_start?: string | null
          business_hours_end?: string | null
          appointment_duration?: number | null
          appointment_interval?: number | null
          whatsapp_phone_number_id?: string | null
          booking_mode?: 'auto' | 'confirm'
          bot_custom_instructions?: string | null
          business_hours?: Json | null
          max_appointments_per_slot?: number
          created_at?: string
          updated_at?: string | null
        }
        Update: {
          company_name?: string | null
          address?: string | null
          phone_number?: string | null
          whatsapp_number?: string | null
          working_days?: string | null
          business_hours_start?: string | null
          business_hours_end?: string | null
          appointment_duration?: number | null
          appointment_interval?: number | null
          whatsapp_phone_number_id?: string | null
          booking_mode?: 'auto' | 'confirm'
          bot_custom_instructions?: string | null
          business_hours?: Json | null
          max_appointments_per_slot?: number
          updated_at?: string | null
        }
        Relationships: []
      }

      schedule_exceptions: {
        Row: {
          id: string
          user_id: string
          date: string
          closed: boolean
          start_time: string | null
          end_time: string | null
          note: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          date: string
          closed?: boolean
          start_time?: string | null
          end_time?: string | null
          note?: string | null
          created_at?: string
        }
        Update: {
          closed?: boolean
          start_time?: string | null
          end_time?: string | null
          note?: string | null
        }
        Relationships: []
      }

      bot_faqs: {
        Row: {
          id: string
          user_id: string
          question: string
          answer: string
          enabled: boolean
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          question: string
          answer: string
          enabled?: boolean
          created_at?: string
        }
        Update: {
          question?: string
          answer?: string
          enabled?: boolean
        }
        Relationships: []
      }

      conversations: {
        Row: {
          id: string
          user_id: string
          customer_phone: string
          customer_name: string | null
          status: 'bot' | 'human' | 'closed' | 'pending'
          last_message_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          customer_phone: string
          customer_name?: string | null
          status?: 'bot' | 'human' | 'closed' | 'pending'
          last_message_at?: string | null
          created_at?: string
        }
        Update: {
          customer_name?: string | null
          status?: 'bot' | 'human' | 'closed' | 'pending'
          last_message_at?: string | null
        }
        Relationships: []
      }

      messages: {
        Row: {
          id: string
          conversation_id: string
          role: 'customer' | 'bot' | 'agent'
          content: string
          wa_message_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          conversation_id: string
          role: 'customer' | 'bot' | 'agent'
          content: string
          wa_message_id?: string | null
          created_at?: string
        }
        Update: {
          content?: string
        }
        Relationships: []
      }
    }

    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// Aliases convenientes
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']

export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']

export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update']
