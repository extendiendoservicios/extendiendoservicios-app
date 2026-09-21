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
            foreignKeyName: "admin_capabilities_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
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
            foreignKeyName: "profiles_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
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
            foreignKeyName: "user_roles_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
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
