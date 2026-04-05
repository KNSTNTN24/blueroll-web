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
      businesses: {
        Row: {
          id: string
          name: string
          address: string | null
          registration_number: string | null
          fhrs_id: number | null
          fsa_rating: string | null
          post_code: string | null
          created_at: string
          updated_at: string | null
        }
        Insert: {
          id?: string
          name: string
          address?: string | null
          registration_number?: string | null
          fhrs_id?: number | null
          fsa_rating?: string | null
          post_code?: string | null
          created_at?: string
          updated_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          address?: string | null
          registration_number?: string | null
          fhrs_id?: number | null
          fsa_rating?: string | null
          post_code?: string | null
          updated_at?: string | null
        }
      }
      profiles: {
        Row: {
          id: string
          email: string
          full_name: string | null
          role: string
          business_id: string
          avatar_url: string | null
          created_at: string
          updated_at: string | null
        }
        Insert: {
          id: string
          email: string
          full_name?: string | null
          role: string
          business_id: string
          avatar_url?: string | null
          created_at?: string
        }
        Update: {
          email?: string
          full_name?: string | null
          role?: string
          business_id?: string
          avatar_url?: string | null
        }
      }
      invites: {
        Row: {
          id: string
          email: string
          role: string
          business_id: string
          invited_by: string
          token: string
          expires_at: string
          used_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          email: string
          role: string
          business_id: string
          invited_by: string
          token: string
          expires_at?: string
          used_at?: string | null
        }
        Update: {
          used_at?: string | null
        }
      }
      checklist_templates: {
        Row: {
          id: string
          name: string
          description: string | null
          frequency: string
          assigned_roles: string[]
          business_id: string
          sfbb_section: string | null
          is_default: boolean
          active: boolean
          supervisor_role: string | null
          deadline_time: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          frequency: string
          assigned_roles: string[]
          business_id: string
          sfbb_section?: string | null
          is_default?: boolean
          active?: boolean
          supervisor_role?: string | null
          deadline_time?: string | null
        }
        Update: {
          name?: string
          description?: string | null
          frequency?: string
          assigned_roles?: string[]
          sfbb_section?: string | null
          is_default?: boolean
          active?: boolean
          supervisor_role?: string | null
          deadline_time?: string | null
        }
      }
      checklist_template_items: {
        Row: {
          id: string
          template_id: string
          name: string
          description: string | null
          item_type: string
          required: boolean
          sort_order: number
          sfbb_reference: string | null
          min_value: number | null
          max_value: number | null
          unit: string | null
        }
        Insert: {
          id?: string
          template_id: string
          name: string
          description?: string | null
          item_type: string
          required?: boolean
          sort_order?: number
          sfbb_reference?: string | null
          min_value?: number | null
          max_value?: number | null
          unit?: string | null
        }
        Update: {
          name?: string
          description?: string | null
          item_type?: string
          required?: boolean
          sort_order?: number
          min_value?: number | null
          max_value?: number | null
          unit?: string | null
        }
      }
      checklist_completions: {
        Row: {
          id: string
          template_id: string
          completed_by: string
          completed_at: string
          signed_off_by: string | null
          signed_off_at: string | null
          notes: string | null
          business_id: string
        }
        Insert: {
          id?: string
          template_id: string
          completed_by: string
          completed_at?: string
          signed_off_by?: string | null
          signed_off_at?: string | null
          notes?: string | null
          business_id: string
        }
        Update: {
          signed_off_by?: string | null
          signed_off_at?: string | null
          notes?: string | null
        }
      }
      checklist_responses: {
        Row: {
          id: string
          completion_id: string
          item_id: string
          value: string
          notes: string | null
          flagged: boolean
        }
        Insert: {
          id?: string
          completion_id: string
          item_id: string
          value: string
          notes?: string | null
          flagged?: boolean
        }
        Update: {
          value?: string
          notes?: string | null
          flagged?: boolean
        }
      }
      ingredients: {
        Row: {
          id: string
          name: string
          allergens: string[]
          business_id: string | null
        }
        Insert: {
          id?: string
          name: string
          allergens?: string[]
          business_id?: string | null
        }
        Update: {
          name?: string
          allergens?: string[]
        }
      }
      recipes: {
        Row: {
          id: string
          name: string
          description: string | null
          category: string
          instructions: string
          cooking_method: string | null
          cooking_temp: number | null
          cooking_time: number | null
          cooking_time_unit: string | null
          sfbb_check_method: string | null
          extra_care_flags: string[]
          reheating_instructions: string | null
          hot_holding_required: boolean
          chilling_method: string | null
          photo_url: string | null
          source_video_url: string | null
          business_id: string
          created_by: string
          active: boolean
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          description?: string | null
          category: string
          instructions?: string
          cooking_method?: string | null
          cooking_temp?: number | null
          cooking_time?: number | null
          cooking_time_unit?: string | null
          sfbb_check_method?: string | null
          extra_care_flags?: string[]
          reheating_instructions?: string | null
          hot_holding_required?: boolean
          chilling_method?: string | null
          photo_url?: string | null
          source_video_url?: string | null
          business_id: string
          created_by: string
          active?: boolean
        }
        Update: {
          name?: string
          description?: string | null
          category?: string
          instructions?: string
          cooking_method?: string | null
          cooking_temp?: number | null
          cooking_time?: number | null
          cooking_time_unit?: string | null
          sfbb_check_method?: string | null
          extra_care_flags?: string[]
          reheating_instructions?: string | null
          hot_holding_required?: boolean
          chilling_method?: string | null
          photo_url?: string | null
          source_video_url?: string | null
          active?: boolean
        }
      }
      recipe_ingredients: {
        Row: {
          id: string
          recipe_id: string
          ingredient_id: string
          quantity: string | null
          unit: string | null
          notes: string | null
        }
        Insert: {
          id?: string
          recipe_id: string
          ingredient_id: string
          quantity?: string | null
          unit?: string | null
          notes?: string | null
        }
        Update: {
          quantity?: string | null
          unit?: string | null
          notes?: string | null
        }
      }
      menu_items: {
        Row: {
          id: string
          recipe_id: string
          category: string
          active: boolean
          display_order: number
          business_id: string
        }
        Insert: {
          id?: string
          recipe_id: string
          category: string
          active?: boolean
          display_order?: number
          business_id: string
        }
        Update: {
          category?: string
          active?: boolean
          display_order?: number
        }
      }
      diary_entries: {
        Row: {
          id: string
          date: string
          business_id: string
          signed_by: string | null
          notes: string | null
          opening_done: boolean
          closing_done: boolean
          created_at: string
        }
        Insert: {
          id?: string
          date: string
          business_id: string
          signed_by?: string | null
          notes?: string | null
          opening_done?: boolean
          closing_done?: boolean
        }
        Update: {
          signed_by?: string | null
          notes?: string | null
          opening_done?: boolean
          closing_done?: boolean
        }
      }
      notifications: {
        Row: {
          id: string
          user_id: string
          type: string
          title: string
          message: string
          read: boolean
          link: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          type: string
          title: string
          message: string
          read?: boolean
          link?: string | null
        }
        Update: {
          read?: boolean
        }
      }
      suppliers: {
        Row: {
          id: string
          name: string
          contact_name: string | null
          phone: string | null
          address: string | null
          goods_supplied: string | null
          delivery_days: string[]
          business_id: string
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          contact_name?: string | null
          phone?: string | null
          address?: string | null
          goods_supplied?: string | null
          delivery_days?: string[]
          business_id: string
        }
        Update: {
          name?: string
          contact_name?: string | null
          phone?: string | null
          address?: string | null
          goods_supplied?: string | null
          delivery_days?: string[]
        }
      }
      incidents: {
        Row: {
          id: string
          type: string
          description: string
          action_taken: string | null
          follow_up: string | null
          reported_by: string
          date: string
          business_id: string
          created_at: string
          status: string
          resolved_by: string | null
          resolved_at: string | null
          resolved_notes: string | null
          updated_at: string | null
        }
        Insert: {
          id?: string
          type: string
          description: string
          action_taken?: string | null
          follow_up?: string | null
          reported_by: string
          date: string
          business_id: string
          status?: string
          resolved_by?: string | null
          resolved_at?: string | null
          resolved_notes?: string | null
        }
        Update: {
          type?: string
          description?: string
          action_taken?: string | null
          follow_up?: string | null
          status?: string
          resolved_by?: string | null
          resolved_at?: string | null
          resolved_notes?: string | null
        }
      }
      documents: {
        Row: {
          id: string
          title: string
          description: string | null
          category: string
          file_url: string
          file_name: string
          file_size: number | null
          file_type: string | null
          uploaded_by: string
          business_id: string
          access_level: string
          expires_at: string | null
          created_at: string
          updated_at: string | null
        }
        Insert: {
          id?: string
          title: string
          description?: string | null
          category: string
          file_url: string
          file_name: string
          file_size?: number | null
          file_type?: string | null
          uploaded_by: string
          business_id: string
          access_level?: string
          expires_at?: string | null
        }
        Update: {
          title?: string
          description?: string | null
          category?: string
          access_level?: string
          expires_at?: string | null
        }
      }
      document_access: {
        Row: {
          id: string
          document_id: string
          profile_id: string
          granted_by: string
          created_at: string
        }
        Insert: {
          id?: string
          document_id: string
          profile_id: string
          granted_by: string
        }
        Update: Record<string, never>
      }
      staff_checkins: {
        Row: {
          id: string
          user_id: string
          business_id: string
          checked_in_at: string
          checked_out_at: string | null
          date: string
          mood: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          business_id: string
          checked_in_at?: string
          checked_out_at?: string | null
          date?: string
          mood?: string | null
        }
        Update: {
          checked_out_at?: string | null
        }
      }
      deliveries: {
        Row: {
          id: string
          supplier_id: string | null
          received_by: string | null
          received_at: string
          product_temperature: number | null
          notes: string | null
          business_id: string
          created_at: string
        }
        Insert: {
          id?: string
          supplier_id?: string | null
          received_by?: string | null
          received_at?: string
          product_temperature?: number | null
          notes?: string | null
          business_id: string
        }
        Update: {
          supplier_id?: string | null
          product_temperature?: number | null
          notes?: string | null
        }
      }
      delivery_photos: {
        Row: {
          id: string
          delivery_id: string
          photo_url: string
          file_name: string | null
          created_at: string
        }
        Insert: {
          id?: string
          delivery_id: string
          photo_url: string
          file_name?: string | null
        }
        Update: Record<string, never>
      }
    }
    Functions: {
      setup_business: {
        Args: {
          business_name: string
          owner_name: string
          business_address?: string
          p_fhrs_id?: number
          p_fsa_rating?: string
          p_post_code?: string
        }
        Returns: void
      }
      join_with_invite: {
        Args: {
          invite_token: string
          member_name: string
        }
        Returns: void
      }
    }
  }
}

export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']
export type Insertable<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']
export type Updatable<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update']
