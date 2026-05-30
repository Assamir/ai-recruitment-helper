/* eslint-disable @typescript-eslint/no-redundant-type-constituents -- generated Supabase types */
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      analyses: {
        Row: {
          candidate_id: string;
          completed_at: string | null;
          created_at: string;
          custom_requirements: string | null;
          error_message: string | null;
          id: string;
          job_profile_id: string | null;
          match_summary: string | null;
          project_context: string | null;
          raw_response: string | null;
          status: string;
          user_id: string;
        };
        Insert: {
          candidate_id: string;
          completed_at?: string | null;
          created_at?: string;
          custom_requirements?: string | null;
          error_message?: string | null;
          id?: string;
          job_profile_id?: string | null;
          match_summary?: string | null;
          project_context?: string | null;
          raw_response?: string | null;
          status?: string;
          user_id: string;
        };
        Update: {
          candidate_id?: string;
          completed_at?: string | null;
          created_at?: string;
          custom_requirements?: string | null;
          error_message?: string | null;
          id?: string;
          job_profile_id?: string | null;
          match_summary?: string | null;
          project_context?: string | null;
          raw_response?: string | null;
          status?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "analyses_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "analyses_job_profile_id_fkey";
            columns: ["job_profile_id"];
            isOneToOne: false;
            referencedRelation: "job_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      analysis_questions: {
        Row: {
          analysis_id: string;
          category: string;
          created_at: string;
          id: string;
          question: string;
          rationale: string;
          sort_order: number;
          suggested_answer: string | null;
        };
        Insert: {
          analysis_id: string;
          category: string;
          created_at?: string;
          id?: string;
          question: string;
          rationale: string;
          sort_order?: number;
          suggested_answer?: string | null;
        };
        Update: {
          analysis_id?: string;
          category?: string;
          created_at?: string;
          id?: string;
          question?: string;
          rationale?: string;
          sort_order?: number;
          suggested_answer?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "analysis_questions_analysis_id_fkey";
            columns: ["analysis_id"];
            isOneToOne: false;
            referencedRelation: "analyses";
            referencedColumns: ["id"];
          },
        ];
      };
      candidates: {
        Row: {
          created_at: string;
          cv_text: string | null;
          file_name: string | null;
          first_name: string | null;
          id: string;
          last_name: string | null;
          linkedin_text: string | null;
          pii_map: Json | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          cv_text?: string | null;
          file_name?: string | null;
          first_name?: string | null;
          id?: string;
          last_name?: string | null;
          linkedin_text?: string | null;
          pii_map?: Json | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          cv_text?: string | null;
          file_name?: string | null;
          first_name?: string | null;
          id?: string;
          last_name?: string | null;
          linkedin_text?: string | null;
          pii_map?: Json | null;
          user_id?: string;
        };
        Relationships: [];
      };
      job_profiles: {
        Row: {
          created_at: string;
          description: string;
          expected_skills: Json;
          id: string;
          name: string;
          seniority_level: string | null;
        };
        Insert: {
          created_at?: string;
          description: string;
          expected_skills?: Json;
          id?: string;
          name: string;
          seniority_level?: string | null;
        };
        Update: {
          created_at?: string;
          description?: string;
          expected_skills?: Json;
          id?: string;
          name?: string;
          seniority_level?: string | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          created_at: string;
          email: string | null;
          id: string;
        };
        Insert: {
          created_at?: string;
          email?: string | null;
          id: string;
        };
        Update: {
          created_at?: string;
          email?: string | null;
          id?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
