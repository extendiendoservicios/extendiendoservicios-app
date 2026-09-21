export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      admin_capabilities: {
        Row: {
          capability: Database["public"]["Enums"]["admin_capability"]
          enabled: boolean
          profile_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          capability: Database["public"]["Enums"]["admin_capability"]
          enabled: boolean
          profile_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          capability?: Database["public"]["Enums"]["admin_capability"]
          enabled?: boolean
          profile_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_capabilities_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_capabilities_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "admin_capabilities_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "admin_capabilities_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      assignments: {
        Row: {
          created_at: string
          created_by: string | null
          employee_id: string
          end_time: string | null
          id: string
          notes: string | null
          removed_at: string | null
          removed_by: string | null
          removed_reason: string | null
          shift_date: string
          shift_id: string
          start_time: string | null
          status: Database["public"]["Enums"]["assignment_status"]
          updated_at: string | null
          updated_by: string | null
          window: unknown
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          employee_id: string
          end_time?: string | null
          id?: string
          notes?: string | null
          removed_at?: string | null
          removed_by?: string | null
          removed_reason?: string | null
          shift_date: string
          shift_id: string
          start_time?: string | null
          status?: Database["public"]["Enums"]["assignment_status"]
          updated_at?: string | null
          updated_by?: string | null
          window: unknown
        }
        Update: {
          created_at?: string
          created_by?: string | null
          employee_id?: string
          end_time?: string | null
          id?: string
          notes?: string | null
          removed_at?: string | null
          removed_by?: string | null
          removed_reason?: string | null
          shift_date?: string
          shift_id?: string
          start_time?: string | null
          status?: Database["public"]["Enums"]["assignment_status"]
          updated_at?: string | null
          updated_by?: string | null
          window?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employees"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "assignments_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "assignments_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "v_shifts_board"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      attendance_notices: {
        Row: {
          assignment_id: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["notice_kind"]
          minutes_late: number | null
          reason_code: Database["public"]["Enums"]["absence_reason"] | null
          reason_text: string | null
          reported_by: string | null
          source: Database["public"]["Enums"]["attendance_source"]
        }
        Insert: {
          assignment_id: string
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["notice_kind"]
          minutes_late?: number | null
          reason_code?: Database["public"]["Enums"]["absence_reason"] | null
          reason_text?: string | null
          reported_by?: string | null
          source: Database["public"]["Enums"]["attendance_source"]
        }
        Update: {
          assignment_id?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["notice_kind"]
          minutes_late?: number | null
          reason_code?: Database["public"]["Enums"]["absence_reason"] | null
          reason_text?: string | null
          reported_by?: string | null
          source?: Database["public"]["Enums"]["attendance_source"]
        }
        Relationships: [
          {
            foreignKeyName: "attendance_notices_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_notices_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "v_assignments_board"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_notices_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "v_my_day"
            referencedColumns: ["assignment_id"]
          },
          {
            foreignKeyName: "attendance_notices_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_notices_reported_by_fkey"
            columns: ["reported_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      attendance_records: {
        Row: {
          accuracy_m: number | null
          assignment_id: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["attendance_kind"]
          latitude: number | null
          longitude: number | null
          reason: string | null
          recorded_at: string
          recorded_by: string | null
          source: Database["public"]["Enums"]["attendance_source"]
        }
        Insert: {
          accuracy_m?: number | null
          assignment_id: string
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["attendance_kind"]
          latitude?: number | null
          longitude?: number | null
          reason?: string | null
          recorded_at: string
          recorded_by?: string | null
          source: Database["public"]["Enums"]["attendance_source"]
        }
        Update: {
          accuracy_m?: number | null
          assignment_id?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["attendance_kind"]
          latitude?: number | null
          longitude?: number | null
          reason?: string | null
          recorded_at?: string
          recorded_by?: string | null
          source?: Database["public"]["Enums"]["attendance_source"]
        }
        Relationships: [
          {
            foreignKeyName: "attendance_records_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "v_assignments_board"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "v_my_day"
            referencedColumns: ["assignment_id"]
          },
          {
            foreignKeyName: "attendance_records_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_records_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      checklist_template_items: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          description: string | null
          id: string
          is_required: boolean
          position: number
          template_id: string
          title: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_required?: boolean
          position: number
          template_id: string
          title: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_required?: boolean
          position?: number
          template_id?: string
          title?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checklist_template_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_template_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "checklist_template_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "checklist_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_template_items_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_template_items_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      checklist_templates: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          is_active: boolean
          name: string
          site_id: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name: string
          site_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          is_active?: boolean
          name?: string
          site_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "checklist_templates_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_templates_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "checklist_templates_site_id_client_id_fkey"
            columns: ["site_id", "client_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id", "client_id"]
          },
          {
            foreignKeyName: "checklist_templates_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_templates_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      client_contacts: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          email: string | null
          id: string
          is_primary: boolean
          name: string
          phone: string | null
          role_title: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          email?: string | null
          id?: string
          is_primary?: boolean
          name: string
          phone?: string | null
          role_title?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          email?: string | null
          id?: string
          is_primary?: boolean
          name?: string
          phone?: string | null
          role_title?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_contacts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_contacts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_contacts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_contacts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "client_contacts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_contacts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      clients: {
        Row: {
          admin_address: string | null
          created_at: string
          created_by: string | null
          cuit: string | null
          deleted_at: string | null
          id: string
          latitude: number | null
          legal_name: string
          longitude: number | null
          notes: string | null
          status: Database["public"]["Enums"]["client_status"]
          trade_name: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          admin_address?: string | null
          created_at?: string
          created_by?: string | null
          cuit?: string | null
          deleted_at?: string | null
          id?: string
          latitude?: number | null
          legal_name: string
          longitude?: number | null
          notes?: string | null
          status?: Database["public"]["Enums"]["client_status"]
          trade_name?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          admin_address?: string | null
          created_at?: string
          created_by?: string | null
          cuit?: string | null
          deleted_at?: string | null
          id?: string
          latitude?: number | null
          legal_name?: string
          longitude?: number | null
          notes?: string | null
          status?: Database["public"]["Enums"]["client_status"]
          trade_name?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "clients_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      company_settings: {
        Row: {
          id: number
          location_consent_text: string | null
          logo_path: string | null
          name: string | null
          support_phone: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id: number
          location_consent_text?: string | null
          logo_path?: string | null
          name?: string | null
          support_phone?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: number
          location_consent_text?: string | null
          logo_path?: string | null
          name?: string | null
          support_phone?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "company_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      employee_availability: {
        Row: {
          created_at: string
          created_by: string | null
          employee_id: string
          end_time: string
          id: string
          start_time: string
          updated_at: string | null
          updated_by: string | null
          weekday: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          employee_id: string
          end_time: string
          id?: string
          start_time: string
          updated_at?: string | null
          updated_by?: string | null
          weekday: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          employee_id?: string
          end_time?: string
          id?: string
          start_time?: string
          updated_at?: string | null
          updated_by?: string | null
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "employee_availability_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_availability_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "employee_availability_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "employee_availability_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employees"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "employee_availability_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_availability_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      employee_client_permissions: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          employee_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          employee_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          employee_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_client_permissions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_client_permissions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_client_permissions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_client_permissions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "employee_client_permissions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "employee_client_permissions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employees"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      employee_leaves: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          employee_id: string
          ends_on: string | null
          id: string
          reason: string | null
          starts_on: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          employee_id: string
          ends_on?: string | null
          id?: string
          reason?: string | null
          starts_on: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          employee_id?: string
          ends_on?: string | null
          id?: string
          reason?: string | null
          starts_on?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_leaves_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_leaves_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "employee_leaves_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "employee_leaves_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employees"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "employee_leaves_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_leaves_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      employees: {
        Row: {
          address: string | null
          birth_date: string | null
          created_at: string
          created_by: string | null
          cuil: string | null
          deleted_at: string | null
          dni: string
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          emergency_contact_relationship: string | null
          employee_number: number
          hire_date: string | null
          notes: string | null
          profile_id: string
          status: Database["public"]["Enums"]["employee_status"]
          terminated_at: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          address?: string | null
          birth_date?: string | null
          created_at?: string
          created_by?: string | null
          cuil?: string | null
          deleted_at?: string | null
          dni: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relationship?: string | null
          employee_number?: number
          hire_date?: string | null
          notes?: string | null
          profile_id: string
          status?: Database["public"]["Enums"]["employee_status"]
          terminated_at?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          address?: string | null
          birth_date?: string | null
          created_at?: string
          created_by?: string | null
          cuil?: string | null
          deleted_at?: string | null
          dni?: string
          emergency_contact_name?: string | null
          emergency_contact_phone?: string | null
          emergency_contact_relationship?: string | null
          employee_number?: number
          hire_date?: string | null
          notes?: string | null
          profile_id?: string
          status?: Database["public"]["Enums"]["employee_status"]
          terminated_at?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "employees_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "employees_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      holidays: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          holiday_date: string | null
          id: string
          name: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          holiday_date?: string | null
          id?: string
          name?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          holiday_date?: string | null
          id?: string
          name?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "holidays_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holidays_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "holidays_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "holidays_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_path: string | null
          contact_email: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          first_name: string
          id: string
          is_active: boolean
          last_name: string
          last_seen_changes_at: string | null
          location_consent_at: string | null
          phone: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          avatar_path?: string | null
          contact_email?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          first_name: string
          id: string
          is_active?: boolean
          last_name: string
          last_seen_changes_at?: string | null
          location_consent_at?: string | null
          phone?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          avatar_path?: string | null
          contact_email?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          first_name?: string
          id?: string
          is_active?: boolean
          last_name?: string
          last_seen_changes_at?: string | null
          location_consent_at?: string | null
          phone?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "profiles_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      rating_criteria: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          position: number
          title: string
          updated_at: string | null
          updated_by: string | null
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          position: number
          title: string
          updated_at?: string | null
          updated_by?: string | null
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          position?: number
          title?: string
          updated_at?: string | null
          updated_by?: string | null
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rating_criteria_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rating_criteria_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "rating_criteria_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rating_criteria_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      ratings: {
        Row: {
          assignment_id: string
          comment: string | null
          created_at: string
          created_by: string | null
          id: string
          score: number
          supervision_id: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          assignment_id: string
          comment?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          score: number
          supervision_id: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          assignment_id?: string
          comment?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          score?: number
          supervision_id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ratings_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "assignments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "v_assignments_board"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_assignment_id_fkey"
            columns: ["assignment_id"]
            isOneToOne: false
            referencedRelation: "v_my_day"
            referencedColumns: ["assignment_id"]
          },
          {
            foreignKeyName: "ratings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "ratings_supervision_id_fkey"
            columns: ["supervision_id"]
            isOneToOne: false
            referencedRelation: "supervisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_supervision_id_fkey"
            columns: ["supervision_id"]
            isOneToOne: false
            referencedRelation: "v_my_supervisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_supervision_id_fkey"
            columns: ["supervision_id"]
            isOneToOne: false
            referencedRelation: "v_supervisions_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ratings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      security_events: {
        Row: {
          actor_id: string | null
          created_at: string
          details: Json | null
          event_type: Database["public"]["Enums"]["security_event_type"]
          id: string
          ip: unknown
          target_id: string | null
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          event_type: Database["public"]["Enums"]["security_event_type"]
          id?: string
          ip?: unknown
          target_id?: string | null
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          event_type?: Database["public"]["Enums"]["security_event_type"]
          id?: string
          ip?: unknown
          target_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "security_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "security_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "security_events_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "security_events_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      services: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          end_time: string
          id: string
          max_hours_month: number | null
          min_hours_month: number | null
          name: string
          notes: string | null
          required_staff: number
          site_id: string
          start_time: string
          status: Database["public"]["Enums"]["service_status"]
          updated_at: string | null
          updated_by: string | null
          valid_from: string
          valid_to: string | null
          weekdays: number[]
          works_on_holidays: boolean
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          end_time: string
          id?: string
          max_hours_month?: number | null
          min_hours_month?: number | null
          name: string
          notes?: string | null
          required_staff?: number
          site_id: string
          start_time: string
          status?: Database["public"]["Enums"]["service_status"]
          updated_at?: string | null
          updated_by?: string | null
          valid_from: string
          valid_to?: string | null
          weekdays: number[]
          works_on_holidays?: boolean
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          end_time?: string
          id?: string
          max_hours_month?: number | null
          min_hours_month?: number | null
          name?: string
          notes?: string | null
          required_staff?: number
          site_id?: string
          start_time?: string
          status?: Database["public"]["Enums"]["service_status"]
          updated_at?: string | null
          updated_by?: string | null
          valid_from?: string
          valid_to?: string | null
          weekdays?: number[]
          works_on_holidays?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "services_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "services_site_id_client_id_fkey"
            columns: ["site_id", "client_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id", "client_id"]
          },
          {
            foreignKeyName: "services_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "services_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      shift_tasks: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_required: boolean
          not_done_reason: string | null
          position: number
          shift_id: string
          status: Database["public"]["Enums"]["task_status"]
          status_changed_at: string | null
          status_changed_by: string | null
          title: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_required: boolean
          not_done_reason?: string | null
          position: number
          shift_id: string
          status?: Database["public"]["Enums"]["task_status"]
          status_changed_at?: string | null
          status_changed_by?: string | null
          title: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_required?: boolean
          not_done_reason?: string | null
          position?: number
          shift_id?: string
          status?: Database["public"]["Enums"]["task_status"]
          status_changed_at?: string | null
          status_changed_by?: string | null
          title?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shift_tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "shift_tasks_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_tasks_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "v_shifts_board"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_tasks_status_changed_by_fkey"
            columns: ["status_changed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_tasks_status_changed_by_fkey"
            columns: ["status_changed_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "shift_tasks_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_tasks_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      shifts: {
        Row: {
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          checklist_template_id: string | null
          client_id: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          end_time: string
          ends_at: string | null
          generated: boolean
          id: string
          notes: string | null
          required_staff: number
          service_id: string | null
          shift_date: string
          site_id: string
          start_time: string
          starts_at: string | null
          status: Database["public"]["Enums"]["shift_status"]
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          checklist_template_id?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          end_time: string
          ends_at?: string | null
          generated?: boolean
          id?: string
          notes?: string | null
          required_staff: number
          service_id?: string | null
          shift_date: string
          site_id: string
          start_time: string
          starts_at?: string | null
          status?: Database["public"]["Enums"]["shift_status"]
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          checklist_template_id?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          end_time?: string
          ends_at?: string | null
          generated?: boolean
          id?: string
          notes?: string | null
          required_staff?: number
          service_id?: string | null
          shift_date?: string
          site_id?: string
          start_time?: string
          starts_at?: string | null
          status?: Database["public"]["Enums"]["shift_status"]
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shifts_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "shifts_checklist_template_id_fkey"
            columns: ["checklist_template_id"]
            isOneToOne: false
            referencedRelation: "checklist_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "shifts_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_site_id_client_id_fkey"
            columns: ["site_id", "client_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id", "client_id"]
          },
          {
            foreignKeyName: "shifts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      sites: {
        Row: {
          access_instructions: string | null
          address: string
          building_hours: string | null
          city: string | null
          client_id: string
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          id: string
          latitude: number | null
          longitude: number | null
          name: string
          phone_restricted: boolean
          photos_not_allowed: boolean
          restrictions_notes: string | null
          status: Database["public"]["Enums"]["site_status"]
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          access_instructions?: string | null
          address: string
          building_hours?: string | null
          city?: string | null
          client_id: string
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name: string
          phone_restricted?: boolean
          photos_not_allowed?: boolean
          restrictions_notes?: string | null
          status?: Database["public"]["Enums"]["site_status"]
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          access_instructions?: string | null
          address?: string
          building_hours?: string | null
          city?: string | null
          client_id?: string
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          name?: string
          phone_restricted?: boolean
          photos_not_allowed?: boolean
          restrictions_notes?: string | null
          status?: Database["public"]["Enums"]["site_status"]
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sites_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sites_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "sites_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sites_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      supervision_attendance: {
        Row: {
          accuracy_m: number | null
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["attendance_kind"]
          latitude: number | null
          longitude: number | null
          recorded_at: string
          supervision_id: string
        }
        Insert: {
          accuracy_m?: number | null
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["attendance_kind"]
          latitude?: number | null
          longitude?: number | null
          recorded_at: string
          supervision_id: string
        }
        Update: {
          accuracy_m?: number | null
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["attendance_kind"]
          latitude?: number | null
          longitude?: number | null
          recorded_at?: string
          supervision_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supervision_attendance_supervision_id_fkey"
            columns: ["supervision_id"]
            isOneToOne: false
            referencedRelation: "supervisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supervision_attendance_supervision_id_fkey"
            columns: ["supervision_id"]
            isOneToOne: false
            referencedRelation: "v_my_supervisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supervision_attendance_supervision_id_fkey"
            columns: ["supervision_id"]
            isOneToOne: false
            referencedRelation: "v_supervisions_admin"
            referencedColumns: ["id"]
          },
        ]
      }
      supervisions: {
        Row: {
          assigned_at: string
          assigned_by: string | null
          cancel_reason: string | null
          created_at: string
          created_by: string | null
          criteria_snapshot: Json | null
          general_notes: string | null
          id: string
          not_done_reason: string | null
          shift_id: string
          status: Database["public"]["Enums"]["supervision_status"]
          supervisor_id: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          assigned_at?: string
          assigned_by?: string | null
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          criteria_snapshot?: Json | null
          general_notes?: string | null
          id?: string
          not_done_reason?: string | null
          shift_id: string
          status?: Database["public"]["Enums"]["supervision_status"]
          supervisor_id: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          assigned_at?: string
          assigned_by?: string | null
          cancel_reason?: string | null
          created_at?: string
          created_by?: string | null
          criteria_snapshot?: Json | null
          general_notes?: string | null
          id?: string
          not_done_reason?: string | null
          shift_id?: string
          status?: Database["public"]["Enums"]["supervision_status"]
          supervisor_id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "supervisions_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supervisions_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "supervisions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supervisions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "supervisions_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supervisions_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "v_shifts_board"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supervisions_supervisor_id_fkey"
            columns: ["supervisor_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "supervisions_supervisor_id_fkey"
            columns: ["supervisor_id"]
            isOneToOne: false
            referencedRelation: "v_employees"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "supervisions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supervisions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      user_roles: {
        Row: {
          granted_at: string
          granted_by: string | null
          profile_id: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          profile_id: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          profile_id?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "user_roles_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
        ]
      }
    }
    Views: {
      v_assignments_board: {
        Row: {
          check_in_at: string | null
          check_out_at: string | null
          client_id: string | null
          client_legal_name: string | null
          created_at: string | null
          created_by: string | null
          display_status: string | null
          effective_end_time: string | null
          effective_ends_at: string | null
          effective_start_time: string | null
          effective_starts_at: string | null
          employee_avatar_path: string | null
          employee_first_name: string | null
          employee_id: string | null
          employee_last_name: string | null
          id: string | null
          minutes_early_leave: number | null
          minutes_late: number | null
          notes: string | null
          removed_at: string | null
          removed_by: string | null
          removed_reason: string | null
          shift_date: string | null
          shift_id: string | null
          shift_status: Database["public"]["Enums"]["shift_status"] | null
          site_id: string | null
          site_name: string | null
          status: Database["public"]["Enums"]["assignment_status"] | null
          updated_at: string | null
          updated_by: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "assignments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "v_employees"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "assignments_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "assignments_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "v_shifts_board"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "shifts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_site_id_client_id_fkey"
            columns: ["site_id", "client_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id", "client_id"]
          },
        ]
      }
      v_clients: {
        Row: {
          active_services_count: number | null
          admin_address: string | null
          created_at: string | null
          created_by: string | null
          cuit: string | null
          deleted_at: string | null
          id: string | null
          latitude: number | null
          legal_name: string | null
          longitude: number | null
          notes: string | null
          sites_count: number | null
          status: Database["public"]["Enums"]["client_status"] | null
          trade_name: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "clients_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clients_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      v_employees: {
        Row: {
          address: string | null
          avatar_path: string | null
          birth_date: string | null
          contact_email: string | null
          created_at: string | null
          created_by: string | null
          cuil: string | null
          deleted_at: string | null
          dni: string | null
          effective_status: string | null
          emergency_contact_name: string | null
          emergency_contact_phone: string | null
          emergency_contact_relationship: string | null
          employee_number: number | null
          first_name: string | null
          hire_date: string | null
          last_name: string | null
          notes: string | null
          phone: string | null
          profile_id: string | null
          profile_is_active: boolean | null
          roles: Database["public"]["Enums"]["app_role"][] | null
          status: Database["public"]["Enums"]["employee_status"] | null
          terminated_at: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "employees_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "employees_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      v_my_day: {
        Row: {
          access_instructions: string | null
          assignment_id: string | null
          building_hours: string | null
          changed_since_last_seen: boolean | null
          client_id: string | null
          client_legal_name: string | null
          client_trade_name: string | null
          effective_end_time: string | null
          effective_ends_at: string | null
          effective_start_time: string | null
          effective_starts_at: string | null
          is_today: boolean | null
          notes: string | null
          phone_restricted: boolean | null
          photos_not_allowed: boolean | null
          restrictions_notes: string | null
          shift_date: string | null
          shift_id: string | null
          shift_status: Database["public"]["Enums"]["shift_status"] | null
          site_address: string | null
          site_contact_name: string | null
          site_contact_phone: string | null
          site_id: string | null
          site_name: string | null
          status: Database["public"]["Enums"]["assignment_status"] | null
          tasks_done: number | null
          tasks_total: number | null
        }
        Relationships: [
          {
            foreignKeyName: "assignments_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assignments_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "v_shifts_board"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_site_id_client_id_fkey"
            columns: ["site_id", "client_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id", "client_id"]
          },
        ]
      }
      v_my_supervisions: {
        Row: {
          assigned_at: string | null
          assigned_employees: Json | null
          cancel_reason: string | null
          check_in_at: string | null
          check_out_at: string | null
          client_id: string | null
          client_legal_name: string | null
          criteria_snapshot: Json | null
          end_time: string | null
          ends_at: string | null
          general_notes: string | null
          id: string | null
          not_done_reason: string | null
          shift_date: string | null
          shift_id: string | null
          site_address: string | null
          site_id: string | null
          site_name: string | null
          start_time: string | null
          starts_at: string | null
          status: Database["public"]["Enums"]["supervision_status"] | null
        }
        Relationships: [
          {
            foreignKeyName: "shifts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_site_id_client_id_fkey"
            columns: ["site_id", "client_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id", "client_id"]
          },
          {
            foreignKeyName: "supervisions_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supervisions_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "v_shifts_board"
            referencedColumns: ["id"]
          },
        ]
      }
      v_people_basic: {
        Row: {
          avatar_path: string | null
          first_name: string | null
          last_name: string | null
          profile_id: string | null
        }
        Insert: {
          avatar_path?: string | null
          first_name?: string | null
          last_name?: string | null
          profile_id?: string | null
        }
        Update: {
          avatar_path?: string | null
          first_name?: string | null
          last_name?: string | null
          profile_id?: string | null
        }
        Relationships: []
      }
      v_public_branding: {
        Row: {
          logo_path: string | null
          name: string | null
          support_phone: string | null
        }
        Insert: {
          logo_path?: string | null
          name?: string | null
          support_phone?: string | null
        }
        Update: {
          logo_path?: string | null
          name?: string | null
          support_phone?: string | null
        }
        Relationships: []
      }
      v_search: {
        Row: {
          id: string | null
          kind: string | null
          search_text: string | null
          subtitle: string | null
          title: string | null
        }
        Relationships: []
      }
      v_shifts_board: {
        Row: {
          absent_count: number | null
          assigned_count: number | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          checklist_template_id: string | null
          client_id: string | null
          client_legal_name: string | null
          client_trade_name: string | null
          created_at: string | null
          created_by: string | null
          delayed_count: number | null
          deleted_at: string | null
          display_status: string | null
          end_time: string | null
          ends_at: string | null
          finished_count: number | null
          generated: boolean | null
          id: string | null
          notes: string | null
          present_count: number | null
          required_staff: number | null
          service_id: string | null
          shift_date: string | null
          site_city: string | null
          site_id: string | null
          site_name: string | null
          start_time: string | null
          starts_at: string | null
          status: Database["public"]["Enums"]["shift_status"] | null
          updated_at: string | null
          updated_by: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shifts_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "shifts_checklist_template_id_fkey"
            columns: ["checklist_template_id"]
            isOneToOne: false
            referencedRelation: "checklist_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "shifts_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_site_id_client_id_fkey"
            columns: ["site_id", "client_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id", "client_id"]
          },
          {
            foreignKeyName: "shifts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      v_supervisions_admin: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          cancel_reason: string | null
          check_in_at: string | null
          check_out_at: string | null
          client_id: string | null
          client_legal_name: string | null
          created_at: string | null
          general_notes: string | null
          id: string | null
          not_done_reason: string | null
          ratings_avg: number | null
          ratings_count: number | null
          shift_date: string | null
          shift_id: string | null
          site_id: string | null
          site_name: string | null
          status: Database["public"]["Enums"]["supervision_status"] | null
          supervisor_first_name: string | null
          supervisor_id: string | null
          supervisor_last_name: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shifts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "v_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_site_id_client_id_fkey"
            columns: ["site_id", "client_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id", "client_id"]
          },
          {
            foreignKeyName: "supervisions_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supervisions_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "v_people_basic"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "supervisions_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supervisions_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "v_shifts_board"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supervisions_supervisor_id_fkey"
            columns: ["supervisor_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "supervisions_supervisor_id_fkey"
            columns: ["supervisor_id"]
            isOneToOne: false
            referencedRelation: "v_employees"
            referencedColumns: ["profile_id"]
          },
        ]
      }
    }
    Functions: {
      mark_changes_seen: {
        Args: never
        Returns: {
          avatar_path: string | null
          contact_email: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          first_name: string
          id: string
          is_active: boolean
          last_name: string
          last_seen_changes_at: string | null
          location_consent_at: string | null
          phone: string | null
          updated_at: string | null
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_admin_capability: {
        Args: {
          p_capability: Database["public"]["Enums"]["admin_capability"]
          p_enabled: boolean
          p_profile_id: string
        }
        Returns: {
          capability: Database["public"]["Enums"]["admin_capability"]
          enabled: boolean
          profile_id: string
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "admin_capabilities"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_user_roles: {
        Args: {
          p_profile_id: string
          p_roles: Database["public"]["Enums"]["app_role"][]
        }
        Returns: Database["public"]["Enums"]["app_role"][]
      }
    }
    Enums: {
      absence_reason:
        | "illness"
        | "personal"
        | "procedure"
        | "transport"
        | "other"
      admin_capability:
        | "manage_users"
        | "cancel_shifts"
        | "edit_ratings"
        | "edit_checklists"
        | "manage_attendance"
        | "generate_shifts"
        | "manage_supervisions"
      app_role: "owner" | "admin" | "supervisor" | "employee"
      assignment_status:
        | "expected"
        | "delay_notified"
        | "absence_notified"
        | "present"
        | "finished"
      attendance_kind: "check_in" | "check_out"
      attendance_source: "employee_app" | "admin"
      client_status: "active" | "suspended" | "closed"
      employee_status: "active" | "terminated"
      notice_kind: "delay" | "absence"
      security_event_type:
        | "sign_in"
        | "sign_in_failed"
        | "user_created"
        | "user_deactivated"
        | "user_reactivated"
        | "password_reset_by_admin"
        | "sessions_revoked"
        | "roles_changed"
        | "capabilities_changed"
        | "email_changed"
      service_status: "active" | "paused" | "ended"
      shift_status:
        | "scheduled"
        | "assigned"
        | "in_progress"
        | "completed"
        | "cancelled"
      site_status: "active" | "inactive"
      supervision_status:
        | "assigned"
        | "in_progress"
        | "completed"
        | "not_done"
        | "cancelled"
      task_status: "pending" | "in_progress" | "done" | "not_done"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      absence_reason: [
        "illness",
        "personal",
        "procedure",
        "transport",
        "other",
      ],
      admin_capability: [
        "manage_users",
        "cancel_shifts",
        "edit_ratings",
        "edit_checklists",
        "manage_attendance",
        "generate_shifts",
        "manage_supervisions",
      ],
      app_role: ["owner", "admin", "supervisor", "employee"],
      assignment_status: [
        "expected",
        "delay_notified",
        "absence_notified",
        "present",
        "finished",
      ],
      attendance_kind: ["check_in", "check_out"],
      attendance_source: ["employee_app", "admin"],
      client_status: ["active", "suspended", "closed"],
      employee_status: ["active", "terminated"],
      notice_kind: ["delay", "absence"],
      security_event_type: [
        "sign_in",
        "sign_in_failed",
        "user_created",
        "user_deactivated",
        "user_reactivated",
        "password_reset_by_admin",
        "sessions_revoked",
        "roles_changed",
        "capabilities_changed",
        "email_changed",
      ],
      service_status: ["active", "paused", "ended"],
      shift_status: [
        "scheduled",
        "assigned",
        "in_progress",
        "completed",
        "cancelled",
      ],
      site_status: ["active", "inactive"],
      supervision_status: [
        "assigned",
        "in_progress",
        "completed",
        "not_done",
        "cancelled",
      ],
      task_status: ["pending", "in_progress", "done", "not_done"],
    },
  },
} as const
