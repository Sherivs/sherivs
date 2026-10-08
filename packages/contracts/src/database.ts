export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      academic_programs: {
        Row: {
          age_range: string | null;
          created_at: string | null;
          description: string | null;
          duration: string | null;
          features: Json | null;
          id: string;
          is_published: boolean | null;
          name: string;
          order_index: number | null;
          school_id: string;
          subjects: Json | null;
        };
        Insert: {
          age_range?: string | null;
          created_at?: string | null;
          description?: string | null;
          duration?: string | null;
          features?: Json | null;
          id?: string;
          is_published?: boolean | null;
          name: string;
          order_index?: number | null;
          school_id: string;
          subjects?: Json | null;
        };
        Update: {
          age_range?: string | null;
          created_at?: string | null;
          description?: string | null;
          duration?: string | null;
          features?: Json | null;
          id?: string;
          is_published?: boolean | null;
          name?: string;
          order_index?: number | null;
          school_id?: string;
          subjects?: Json | null;
        };
        Relationships: [
          {
            foreignKeyName: "academic_programs_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      admission_applications: {
        Row: {
          academic_achievements: string | null;
          academic_year_applying: string;
          ai_recommendation: string | null;
          ai_review_result: Json | null;
          ai_reviewed_at: string | null;
          allergies_detail: string | null;
          application_number: string;
          applying_for_class: string;
          created_at: string;
          decision_notes: string | null;
          disabilities_or_special_needs: string | null;
          discipline_explanation: string | null;
          documents_uploaded: Json;
          emergency_contact_name: string | null;
          emergency_contact_phone: string | null;
          emergency_contact_relationship: string | null;
          guardian_name: string | null;
          guardian_phone: string | null;
          guardian_relationship: string | null;
          has_allergies: boolean | null;
          has_special_needs: boolean | null;
          id: string;
          interview_date: string | null;
          interview_notes: string | null;
          interview_responses: Json;
          medical_conditions: string | null;
          parent_one_address: string | null;
          parent_one_email: string;
          parent_one_name: string;
          parent_one_occupation: string | null;
          parent_one_phone: string;
          parent_one_relationship: string;
          parent_two_address: string | null;
          parent_two_email: string | null;
          parent_two_name: string | null;
          parent_two_occupation: string | null;
          parent_two_phone: string | null;
          parent_two_relationship: string | null;
          previous_class_completed: string | null;
          previous_school_address: string | null;
          previous_school_name: string | null;
          reason_for_leaving: string | null;
          school_id: string;
          status: string;
          student_address: string | null;
          student_blood_group: string | null;
          student_date_of_birth: string;
          student_first_name: string;
          student_gender: string | null;
          student_genotype: string | null;
          student_last_name: string;
          student_nationality: string | null;
          student_religion: string | null;
          submitted_at: string;
          updated_at: string;
          was_disciplined: boolean | null;
          year_completed: string | null;
        };
        Insert: {
          academic_achievements?: string | null;
          academic_year_applying: string;
          ai_recommendation?: string | null;
          ai_review_result?: Json | null;
          ai_reviewed_at?: string | null;
          allergies_detail?: string | null;
          application_number: string;
          applying_for_class: string;
          created_at?: string;
          decision_notes?: string | null;
          disabilities_or_special_needs?: string | null;
          discipline_explanation?: string | null;
          documents_uploaded?: Json;
          emergency_contact_name?: string | null;
          emergency_contact_phone?: string | null;
          emergency_contact_relationship?: string | null;
          guardian_name?: string | null;
          guardian_phone?: string | null;
          guardian_relationship?: string | null;
          has_allergies?: boolean | null;
          has_special_needs?: boolean | null;
          id?: string;
          interview_date?: string | null;
          interview_notes?: string | null;
          interview_responses?: Json;
          medical_conditions?: string | null;
          parent_one_address?: string | null;
          parent_one_email: string;
          parent_one_name: string;
          parent_one_occupation?: string | null;
          parent_one_phone: string;
          parent_one_relationship: string;
          parent_two_address?: string | null;
          parent_two_email?: string | null;
          parent_two_name?: string | null;
          parent_two_occupation?: string | null;
          parent_two_phone?: string | null;
          parent_two_relationship?: string | null;
          previous_class_completed?: string | null;
          previous_school_address?: string | null;
          previous_school_name?: string | null;
          reason_for_leaving?: string | null;
          school_id: string;
          status?: string;
          student_address?: string | null;
          student_blood_group?: string | null;
          student_date_of_birth: string;
          student_first_name: string;
          student_gender?: string | null;
          student_genotype?: string | null;
          student_last_name: string;
          student_nationality?: string | null;
          student_religion?: string | null;
          submitted_at?: string;
          updated_at?: string;
          was_disciplined?: boolean | null;
          year_completed?: string | null;
        };
        Update: {
          academic_achievements?: string | null;
          academic_year_applying?: string;
          ai_recommendation?: string | null;
          ai_review_result?: Json | null;
          ai_reviewed_at?: string | null;
          allergies_detail?: string | null;
          application_number?: string;
          applying_for_class?: string;
          created_at?: string;
          decision_notes?: string | null;
          disabilities_or_special_needs?: string | null;
          discipline_explanation?: string | null;
          documents_uploaded?: Json;
          emergency_contact_name?: string | null;
          emergency_contact_phone?: string | null;
          emergency_contact_relationship?: string | null;
          guardian_name?: string | null;
          guardian_phone?: string | null;
          guardian_relationship?: string | null;
          has_allergies?: boolean | null;
          has_special_needs?: boolean | null;
          id?: string;
          interview_date?: string | null;
          interview_notes?: string | null;
          interview_responses?: Json;
          medical_conditions?: string | null;
          parent_one_address?: string | null;
          parent_one_email?: string;
          parent_one_name?: string;
          parent_one_occupation?: string | null;
          parent_one_phone?: string;
          parent_one_relationship?: string;
          parent_two_address?: string | null;
          parent_two_email?: string | null;
          parent_two_name?: string | null;
          parent_two_occupation?: string | null;
          parent_two_phone?: string | null;
          parent_two_relationship?: string | null;
          previous_class_completed?: string | null;
          previous_school_address?: string | null;
          previous_school_name?: string | null;
          reason_for_leaving?: string | null;
          school_id?: string;
          status?: string;
          student_address?: string | null;
          student_blood_group?: string | null;
          student_date_of_birth?: string;
          student_first_name?: string;
          student_gender?: string | null;
          student_genotype?: string | null;
          student_last_name?: string;
          student_nationality?: string | null;
          student_religion?: string | null;
          submitted_at?: string;
          updated_at?: string;
          was_disciplined?: boolean | null;
          year_completed?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "admission_applications_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_conversations: {
        Row: {
          created_at: string | null;
          id: string;
          last_message_at: string | null;
          message_count: number | null;
          messages: Json | null;
          portal: string;
          school_id: string;
          title: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          last_message_at?: string | null;
          message_count?: number | null;
          messages?: Json | null;
          portal: string;
          school_id: string;
          title?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          last_message_at?: string | null;
          message_count?: number | null;
          messages?: Json | null;
          portal?: string;
          school_id?: string;
          title?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_conversations_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_conversations_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_interaction_log: {
        Row: {
          created_at: string | null;
          id: string;
          latency_ms: number | null;
          model_used: string | null;
          portal: string;
          prompt_text: string | null;
          response_text: string | null;
          school_id: string;
          success: boolean | null;
          tokens_in: number | null;
          tokens_out: number | null;
          user_id: string | null;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          latency_ms?: number | null;
          model_used?: string | null;
          portal: string;
          prompt_text?: string | null;
          response_text?: string | null;
          school_id: string;
          success?: boolean | null;
          tokens_in?: number | null;
          tokens_out?: number | null;
          user_id?: string | null;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          latency_ms?: number | null;
          model_used?: string | null;
          portal?: string;
          prompt_text?: string | null;
          response_text?: string | null;
          school_id?: string;
          success?: boolean | null;
          tokens_in?: number | null;
          tokens_out?: number | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "ai_interaction_log_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_interaction_log_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      attendance: {
        Row: {
          class_id: string | null;
          created_at: string | null;
          date: string;
          id: string;
          marked_by: string | null;
          note: string | null;
          school_id: string;
          status: string;
          student_id: string;
        };
        Insert: {
          class_id?: string | null;
          created_at?: string | null;
          date: string;
          id?: string;
          marked_by?: string | null;
          note?: string | null;
          school_id: string;
          status: string;
          student_id: string;
        };
        Update: {
          class_id?: string | null;
          created_at?: string | null;
          date?: string;
          id?: string;
          marked_by?: string | null;
          note?: string | null;
          school_id?: string;
          status?: string;
          student_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "attendance_class_id_fkey";
            columns: ["class_id"];
            isOneToOne: false;
            referencedRelation: "classes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attendance_marked_by_fkey";
            columns: ["marked_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attendance_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attendance_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
        ];
      };
      attendance_logs: {
        Row: {
          created_at: string | null;
          face_match_score: number | null;
          face_matched: boolean | null;
          fraud_detected: boolean | null;
          fraud_flags: Json | null;
          gps_latitude: number | null;
          gps_longitude: number | null;
          id: string;
          inside_geofence: boolean | null;
          qr_token: string | null;
          school_id: string;
          teacher_id: string;
          timestamp: string | null;
          type: string;
          verified: boolean | null;
        };
        Insert: {
          created_at?: string | null;
          face_match_score?: number | null;
          face_matched?: boolean | null;
          fraud_detected?: boolean | null;
          fraud_flags?: Json | null;
          gps_latitude?: number | null;
          gps_longitude?: number | null;
          id?: string;
          inside_geofence?: boolean | null;
          qr_token?: string | null;
          school_id: string;
          teacher_id: string;
          timestamp?: string | null;
          type: string;
          verified?: boolean | null;
        };
        Update: {
          created_at?: string | null;
          face_match_score?: number | null;
          face_matched?: boolean | null;
          fraud_detected?: boolean | null;
          fraud_flags?: Json | null;
          gps_latitude?: number | null;
          gps_longitude?: number | null;
          id?: string;
          inside_geofence?: boolean | null;
          qr_token?: string | null;
          school_id?: string;
          teacher_id?: string;
          timestamp?: string | null;
          type?: string;
          verified?: boolean | null;
        };
        Relationships: [
          {
            foreignKeyName: "attendance_logs_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attendance_logs_teacher_id_fkey";
            columns: ["teacher_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      attendance_verification_log: {
        Row: {
          accuracy_meters: number | null;
          created_at: string | null;
          device_id: string | null;
          face_verified: boolean | null;
          failure_reason: string | null;
          id: string;
          ip_address: string | null;
          latitude: number | null;
          longitude: number | null;
          qr_token_used: string | null;
          result: string | null;
          school_id: string;
          user_id: string | null;
          verification_time: string | null;
          verification_type: string | null;
          within_geofence: boolean | null;
        };
        Insert: {
          accuracy_meters?: number | null;
          created_at?: string | null;
          device_id?: string | null;
          face_verified?: boolean | null;
          failure_reason?: string | null;
          id?: string;
          ip_address?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          qr_token_used?: string | null;
          result?: string | null;
          school_id: string;
          user_id?: string | null;
          verification_time?: string | null;
          verification_type?: string | null;
          within_geofence?: boolean | null;
        };
        Update: {
          accuracy_meters?: number | null;
          created_at?: string | null;
          device_id?: string | null;
          face_verified?: boolean | null;
          failure_reason?: string | null;
          id?: string;
          ip_address?: string | null;
          latitude?: number | null;
          longitude?: number | null;
          qr_token_used?: string | null;
          result?: string | null;
          school_id?: string;
          user_id?: string | null;
          verification_time?: string | null;
          verification_type?: string | null;
          within_geofence?: boolean | null;
        };
        Relationships: [
          {
            foreignKeyName: "attendance_verification_log_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "attendance_verification_log_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_logs: {
        Row: {
          action: string;
          created_at: string | null;
          id: string;
          ip_address: string | null;
          new_value: Json | null;
          old_value: Json | null;
          record_id: string | null;
          school_id: string | null;
          table_name: string | null;
          user_id: string | null;
        };
        Insert: {
          action: string;
          created_at?: string | null;
          id?: string;
          ip_address?: string | null;
          new_value?: Json | null;
          old_value?: Json | null;
          record_id?: string | null;
          school_id?: string | null;
          table_name?: string | null;
          user_id?: string | null;
        };
        Update: {
          action?: string;
          created_at?: string | null;
          id?: string;
          ip_address?: string | null;
          new_value?: Json | null;
          old_value?: Json | null;
          record_id?: string | null;
          school_id?: string | null;
          table_name?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "audit_logs_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "audit_logs_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      blog_posts: {
        Row: {
          author_id: string | null;
          category: string | null;
          content: string;
          cover_image_url: string | null;
          created_at: string | null;
          excerpt: string | null;
          id: string;
          is_published: boolean | null;
          published_at: string | null;
          school_id: string;
          slug: string;
          title: string;
          updated_at: string | null;
          view_count: number | null;
        };
        Insert: {
          author_id?: string | null;
          category?: string | null;
          content: string;
          cover_image_url?: string | null;
          created_at?: string | null;
          excerpt?: string | null;
          id?: string;
          is_published?: boolean | null;
          published_at?: string | null;
          school_id: string;
          slug: string;
          title: string;
          updated_at?: string | null;
          view_count?: number | null;
        };
        Update: {
          author_id?: string | null;
          category?: string | null;
          content?: string;
          cover_image_url?: string | null;
          created_at?: string | null;
          excerpt?: string | null;
          id?: string;
          is_published?: boolean | null;
          published_at?: string | null;
          school_id?: string;
          slug?: string;
          title?: string;
          updated_at?: string | null;
          view_count?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "blog_posts_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "blog_posts_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      cg_api_key: {
        Row: {
          api_key_ref: string;
          created_at: string;
          created_by: string;
          expires_at: string | null;
          fingerprint: string;
          key_hash: string;
          key_preview: string;
          note: string | null;
          revoke_reason: string | null;
          revoked_at: string | null;
          revoked_by: string | null;
          scopes: string[];
          status: string;
          tenant_id: string;
          type: string;
        };
        Insert: {
          api_key_ref: string;
          created_at?: string;
          created_by: string;
          expires_at?: string | null;
          fingerprint: string;
          key_hash: string;
          key_preview: string;
          note?: string | null;
          revoke_reason?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          scopes: string[];
          status: string;
          tenant_id: string;
          type: string;
        };
        Update: {
          api_key_ref?: string;
          created_at?: string;
          created_by?: string;
          expires_at?: string | null;
          fingerprint?: string;
          key_hash?: string;
          key_preview?: string;
          note?: string | null;
          revoke_reason?: string | null;
          revoked_at?: string | null;
          revoked_by?: string | null;
          scopes?: string[];
          status?: string;
          tenant_id?: string;
          type?: string;
        };
        Relationships: [];
      };
      cg_conformance_assessment: {
        Row: {
          assessment_id: string;
          created_at: string;
          decision: string;
          declared_contract_id: string;
          declared_version: string;
          observed_contract_id: string;
          observed_version: string;
          reason: string;
          verification_id: string;
        };
        Insert: {
          assessment_id: string;
          created_at?: string;
          decision: string;
          declared_contract_id: string;
          declared_version: string;
          observed_contract_id: string;
          observed_version: string;
          reason: string;
          verification_id: string;
        };
        Update: {
          assessment_id?: string;
          created_at?: string;
          decision?: string;
          declared_contract_id?: string;
          declared_version?: string;
          observed_contract_id?: string;
          observed_version?: string;
          reason?: string;
          verification_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cg_conformance_assessment_verification_id_fkey";
            columns: ["verification_id"];
            isOneToOne: false;
            referencedRelation: "cg_verification_result";
            referencedColumns: ["verification_id"];
          },
        ];
      };
      cg_delivery_evidence: {
        Row: {
          adapter: string;
          ai_generated: boolean;
          channel: string;
          created_at: string;
          id: string;
          notification_ref: string | null;
          outcome: string;
          outcome_code: string;
          provider_message_id: string | null;
          reason: string;
          recipient_redacted: string;
          tenant_id: string;
          trigger_source: string;
          triggered_by: string;
        };
        Insert: {
          adapter: string;
          ai_generated?: boolean;
          channel: string;
          created_at?: string;
          id: string;
          notification_ref?: string | null;
          outcome: string;
          outcome_code: string;
          provider_message_id?: string | null;
          reason: string;
          recipient_redacted: string;
          tenant_id: string;
          trigger_source: string;
          triggered_by: string;
        };
        Update: {
          adapter?: string;
          ai_generated?: boolean;
          channel?: string;
          created_at?: string;
          id?: string;
          notification_ref?: string | null;
          outcome?: string;
          outcome_code?: string;
          provider_message_id?: string | null;
          reason?: string;
          recipient_redacted?: string;
          tenant_id?: string;
          trigger_source?: string;
          triggered_by?: string;
        };
        Relationships: [];
      };
      cg_domain_runtime: {
        Row: {
          created_at: string;
          id: string;
          manifest: Json;
          name: string;
          status: string;
          updated_at: string;
          version: string;
        };
        Insert: {
          created_at?: string;
          id: string;
          manifest?: Json;
          name: string;
          status?: string;
          updated_at?: string;
          version: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          manifest?: Json;
          name?: string;
          status?: string;
          updated_at?: string;
          version?: string;
        };
        Relationships: [];
      };
      cg_entity: {
        Row: {
          attributes: Json;
          causation_id: string | null;
          classification: string;
          confidence: number | null;
          correlation_id: string | null;
          created_at: string;
          created_by: string | null;
          declared_origin: string | null;
          entity_type: string;
          id: string;
          object_type: string | null;
          observed_at: string | null;
          parent_event_id: string | null;
          policy_context: Json | null;
          provenance: Json | null;
          recorded_at: string;
          schema_version: string | null;
          source_ref: string | null;
          source_type: string | null;
          state: string | null;
          status: string | null;
          superseded_by: string | null;
          supersedes: string | null;
          tenant_id: string | null;
          trace_id: string | null;
          updated_at: string;
          updated_by: string | null;
          valid_from: string | null;
          valid_time_known: boolean | null;
          valid_to: string | null;
        };
        Insert: {
          attributes?: Json;
          causation_id?: string | null;
          classification?: string;
          confidence?: number | null;
          correlation_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          declared_origin?: string | null;
          entity_type: string;
          id?: string;
          object_type?: string | null;
          observed_at?: string | null;
          parent_event_id?: string | null;
          policy_context?: Json | null;
          provenance?: Json | null;
          recorded_at?: string;
          schema_version?: string | null;
          source_ref?: string | null;
          source_type?: string | null;
          state?: string | null;
          status?: string | null;
          superseded_by?: string | null;
          supersedes?: string | null;
          tenant_id?: string | null;
          trace_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          valid_from?: string | null;
          valid_time_known?: boolean | null;
          valid_to?: string | null;
        };
        Update: {
          attributes?: Json;
          causation_id?: string | null;
          classification?: string;
          confidence?: number | null;
          correlation_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          declared_origin?: string | null;
          entity_type?: string;
          id?: string;
          object_type?: string | null;
          observed_at?: string | null;
          parent_event_id?: string | null;
          policy_context?: Json | null;
          provenance?: Json | null;
          recorded_at?: string;
          schema_version?: string | null;
          source_ref?: string | null;
          source_type?: string | null;
          state?: string | null;
          status?: string | null;
          superseded_by?: string | null;
          supersedes?: string | null;
          tenant_id?: string | null;
          trace_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          valid_from?: string | null;
          valid_time_known?: boolean | null;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "cg_entity_superseded_by_fkey";
            columns: ["superseded_by"];
            isOneToOne: false;
            referencedRelation: "cg_entity";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cg_entity_supersedes_fkey";
            columns: ["supersedes"];
            isOneToOne: false;
            referencedRelation: "cg_entity";
            referencedColumns: ["id"];
          },
        ];
      };
      cg_event: {
        Row: {
          actor_identity: string | null;
          aggregate_id: string;
          aggregate_type: string;
          attempts: number;
          causation_id: string | null;
          correlation_id: string | null;
          created_at: string;
          created_by: string | null;
          declared_origin: string | null;
          event_type: string;
          id: string;
          idempotency_key: string | null;
          last_error: string | null;
          object_type: string | null;
          occurred_at: string;
          parent_event_id: string | null;
          payload: Json;
          payload_version: number;
          policy_context: Json | null;
          provenance: Json | null;
          recorded_at: string;
          schema_version: string | null;
          state: string;
          status: string | null;
          supersedes: string | null;
          tenant_id: string | null;
          trace_id: string | null;
          updated_at: string;
          updated_by: string | null;
          valid_from: string | null;
          valid_time_known: boolean | null;
          valid_until: string | null;
        };
        Insert: {
          actor_identity?: string | null;
          aggregate_id: string;
          aggregate_type: string;
          attempts?: number;
          causation_id?: string | null;
          correlation_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          declared_origin?: string | null;
          event_type: string;
          id?: string;
          idempotency_key?: string | null;
          last_error?: string | null;
          object_type?: string | null;
          occurred_at?: string;
          parent_event_id?: string | null;
          payload?: Json;
          payload_version?: number;
          policy_context?: Json | null;
          provenance?: Json | null;
          recorded_at?: string;
          schema_version?: string | null;
          state?: string;
          status?: string | null;
          supersedes?: string | null;
          tenant_id?: string | null;
          trace_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          valid_from?: string | null;
          valid_time_known?: boolean | null;
          valid_until?: string | null;
        };
        Update: {
          actor_identity?: string | null;
          aggregate_id?: string;
          aggregate_type?: string;
          attempts?: number;
          causation_id?: string | null;
          correlation_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          declared_origin?: string | null;
          event_type?: string;
          id?: string;
          idempotency_key?: string | null;
          last_error?: string | null;
          object_type?: string | null;
          occurred_at?: string;
          parent_event_id?: string | null;
          payload?: Json;
          payload_version?: number;
          policy_context?: Json | null;
          provenance?: Json | null;
          recorded_at?: string;
          schema_version?: string | null;
          state?: string;
          status?: string | null;
          supersedes?: string | null;
          tenant_id?: string | null;
          trace_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          valid_from?: string | null;
          valid_time_known?: boolean | null;
          valid_until?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "cg_event_supersedes_fkey";
            columns: ["supersedes"];
            isOneToOne: false;
            referencedRelation: "cg_event";
            referencedColumns: ["id"];
          },
        ];
      };
      cg_event_route_cursor: {
        Row: {
          delivered_count: number;
          last_event_ref: string | null;
          subscription_id: string;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          delivered_count?: number;
          last_event_ref?: string | null;
          subscription_id: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          delivered_count?: number;
          last_event_ref?: string | null;
          subscription_id?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cg_event_route_cursor_subscription_fk";
            columns: ["subscription_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "cg_event_route_subscription";
            referencedColumns: ["id", "tenant_id"];
          },
        ];
      };
      cg_event_route_outcome: {
        Row: {
          backpressure: Json | null;
          delivery: Json | null;
          denial_reason: string | null;
          detail: string;
          event_ref: string;
          id: string;
          kind: string;
          recorded_at: string;
          subscriber_id: string;
          subscription_id: string;
          tenant_id: string | null;
        };
        Insert: {
          backpressure?: Json | null;
          delivery?: Json | null;
          denial_reason?: string | null;
          detail?: string;
          event_ref: string;
          id: string;
          kind: string;
          recorded_at?: string;
          subscriber_id: string;
          subscription_id: string;
          tenant_id?: string | null;
        };
        Update: {
          backpressure?: Json | null;
          delivery?: Json | null;
          denial_reason?: string | null;
          detail?: string;
          event_ref?: string;
          id?: string;
          kind?: string;
          recorded_at?: string;
          subscriber_id?: string;
          subscription_id?: string;
          tenant_id?: string | null;
        };
        Relationships: [];
      };
      cg_event_route_queue: {
        Row: {
          delivered_at: string | null;
          delivery: Json;
          delivery_decision: string;
          enqueued_at: string;
          event_digest: string;
          event_ref: string;
          state: string;
          subscription_id: string;
          tenant_id: string;
        };
        Insert: {
          delivered_at?: string | null;
          delivery: Json;
          delivery_decision: string;
          enqueued_at?: string;
          event_digest: string;
          event_ref: string;
          state?: string;
          subscription_id: string;
          tenant_id: string;
        };
        Update: {
          delivered_at?: string | null;
          delivery?: Json;
          delivery_decision?: string;
          enqueued_at?: string;
          event_digest?: string;
          event_ref?: string;
          state?: string;
          subscription_id?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cg_event_route_queue_subscription_fk";
            columns: ["subscription_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "cg_event_route_subscription";
            referencedColumns: ["id", "tenant_id"];
          },
        ];
      };
      cg_event_route_subscription: {
        Row: {
          declared_at: string;
          dedup: string;
          event_types: Json;
          id: string;
          max_sensitivity: string;
          max_undelivered: number;
          ordering: string;
          status: string;
          subscriber_id: string;
          tenant_id: string;
          visibility_scopes: Json;
        };
        Insert: {
          declared_at?: string;
          dedup: string;
          event_types?: Json;
          id: string;
          max_sensitivity: string;
          max_undelivered: number;
          ordering: string;
          status?: string;
          subscriber_id: string;
          tenant_id: string;
          visibility_scopes?: Json;
        };
        Update: {
          declared_at?: string;
          dedup?: string;
          event_types?: Json;
          id?: string;
          max_sensitivity?: string;
          max_undelivered?: number;
          ordering?: string;
          status?: string;
          subscriber_id?: string;
          tenant_id?: string;
          visibility_scopes?: Json;
        };
        Relationships: [];
      };
      cg_event_security: {
        Row: {
          digest: string;
          emission_authority: string;
          event_ref: string;
          evidence_class: string;
          id: string;
          issuance_at: string;
          issuance_at_ms: number;
          issuance_issuer: string;
          issuance_sequence: number;
          issuer_id: string;
          previous_digest: string | null;
          recorded_at: string;
          redactable_fields: Json;
          sensitivity: string;
          source: string;
          subject_refs: Json;
          tenant_id: string;
          visibility: string;
        };
        Insert: {
          digest: string;
          emission_authority: string;
          event_ref: string;
          evidence_class: string;
          id: string;
          issuance_at: string;
          issuance_at_ms: number;
          issuance_issuer: string;
          issuance_sequence: number;
          issuer_id: string;
          previous_digest?: string | null;
          recorded_at?: string;
          redactable_fields?: Json;
          sensitivity: string;
          source: string;
          subject_refs?: Json;
          tenant_id: string;
          visibility: string;
        };
        Update: {
          digest?: string;
          emission_authority?: string;
          event_ref?: string;
          evidence_class?: string;
          id?: string;
          issuance_at?: string;
          issuance_at_ms?: number;
          issuance_issuer?: string;
          issuance_sequence?: number;
          issuer_id?: string;
          previous_digest?: string | null;
          recorded_at?: string;
          redactable_fields?: Json;
          sensitivity?: string;
          source?: string;
          subject_refs?: Json;
          tenant_id?: string;
          visibility?: string;
        };
        Relationships: [];
      };
      cg_event_security_denial: {
        Row: {
          detail: string;
          event_ref: string;
          id: string;
          reason: string;
          recorded_at: string;
          subscriber_id: string | null;
          tenant_id: string | null;
        };
        Insert: {
          detail?: string;
          event_ref: string;
          id: string;
          reason: string;
          recorded_at?: string;
          subscriber_id?: string | null;
          tenant_id?: string | null;
        };
        Update: {
          detail?: string;
          event_ref?: string;
          id?: string;
          reason?: string;
          recorded_at?: string;
          subscriber_id?: string | null;
          tenant_id?: string | null;
        };
        Relationships: [];
      };
      cg_event_security_redaction: {
        Row: {
          detail: string;
          event_ref: string;
          id: string;
          reason: string;
          recorded_at: string;
          subscriber_id: string;
          tenant_id: string;
          withheld_fields: Json;
          withheld_subject_refs: Json;
        };
        Insert: {
          detail?: string;
          event_ref: string;
          id: string;
          reason: string;
          recorded_at?: string;
          subscriber_id: string;
          tenant_id: string;
          withheld_fields?: Json;
          withheld_subject_refs?: Json;
        };
        Update: {
          detail?: string;
          event_ref?: string;
          id?: string;
          reason?: string;
          recorded_at?: string;
          subscriber_id?: string;
          tenant_id?: string;
          withheld_fields?: Json;
          withheld_subject_refs?: Json;
        };
        Relationships: [];
      };
      cg_evidence_lifecycle_act: {
        Row: {
          act: Json;
          act_evidence_id: string | null;
          act_kind: string;
          actor_id: string;
          id: string;
          recorded_at: string;
          target_evidence_id: string;
          tenant_id: string;
        };
        Insert: {
          act: Json;
          act_evidence_id?: string | null;
          act_kind: string;
          actor_id: string;
          id: string;
          recorded_at?: string;
          target_evidence_id: string;
          tenant_id: string;
        };
        Update: {
          act?: Json;
          act_evidence_id?: string | null;
          act_kind?: string;
          actor_id?: string;
          id?: string;
          recorded_at?: string;
          target_evidence_id?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cg_evidence_lifecycle_act_target_fk";
            columns: ["target_evidence_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "cg_evidence_record";
            referencedColumns: ["id", "tenant_id"];
          },
        ];
      };
      cg_evidence_record: {
        Row: {
          canonical_truth_eligible: boolean;
          captured_at: string;
          captured_by: string;
          causation_id: string | null;
          claim: Json;
          confidence: number | null;
          confidence_basis: string | null;
          correlation_id: string;
          created_by: string;
          declared_origin: string | null;
          evidence_class: string;
          evidence_type: string;
          id: string;
          lineage: Json;
          object_type: string;
          observed_at: string | null;
          parent_event_id: string | null;
          policy_context: Json;
          prior_class: string | null;
          promotion: Json | null;
          provenance: Json;
          recorded_at: string;
          retention_policy_id: string;
          revocation: Json | null;
          revokes: string | null;
          schema_version: string;
          source_ref: string | null;
          status: string;
          sufficiency: Json | null;
          supersedes: string | null;
          tenant_id: string;
          trace_id: string;
          updated_by: string;
          valid_from: string | null;
          valid_until: string | null;
        };
        Insert: {
          canonical_truth_eligible?: boolean;
          captured_at: string;
          captured_by: string;
          causation_id?: string | null;
          claim: Json;
          confidence?: number | null;
          confidence_basis?: string | null;
          correlation_id: string;
          created_by: string;
          declared_origin?: string | null;
          evidence_class: string;
          evidence_type: string;
          id: string;
          lineage?: Json;
          object_type: string;
          observed_at?: string | null;
          parent_event_id?: string | null;
          policy_context: Json;
          prior_class?: string | null;
          promotion?: Json | null;
          provenance: Json;
          recorded_at: string;
          retention_policy_id: string;
          revocation?: Json | null;
          revokes?: string | null;
          schema_version: string;
          source_ref?: string | null;
          status: string;
          sufficiency?: Json | null;
          supersedes?: string | null;
          tenant_id: string;
          trace_id: string;
          updated_by: string;
          valid_from?: string | null;
          valid_until?: string | null;
        };
        Update: {
          canonical_truth_eligible?: boolean;
          captured_at?: string;
          captured_by?: string;
          causation_id?: string | null;
          claim?: Json;
          confidence?: number | null;
          confidence_basis?: string | null;
          correlation_id?: string;
          created_by?: string;
          declared_origin?: string | null;
          evidence_class?: string;
          evidence_type?: string;
          id?: string;
          lineage?: Json;
          object_type?: string;
          observed_at?: string | null;
          parent_event_id?: string | null;
          policy_context?: Json;
          prior_class?: string | null;
          promotion?: Json | null;
          provenance?: Json;
          recorded_at?: string;
          retention_policy_id?: string;
          revocation?: Json | null;
          revokes?: string | null;
          schema_version?: string;
          source_ref?: string | null;
          status?: string;
          sufficiency?: Json | null;
          supersedes?: string | null;
          tenant_id?: string;
          trace_id?: string;
          updated_by?: string;
          valid_from?: string | null;
          valid_until?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "cg_evidence_record_revokes_fk";
            columns: ["revokes", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "cg_evidence_record";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "cg_evidence_record_supersedes_fk";
            columns: ["supersedes", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "cg_evidence_record";
            referencedColumns: ["id", "tenant_id"];
          },
        ];
      };
      cg_execution_history: {
        Row: {
          execution_id: string;
          external_effect: string;
          id: string;
          reason: string | null;
          recorded_at: string;
          status: string;
        };
        Insert: {
          execution_id: string;
          external_effect: string;
          id?: string;
          reason?: string | null;
          recorded_at?: string;
          status: string;
        };
        Update: {
          execution_id?: string;
          external_effect?: string;
          id?: string;
          reason?: string | null;
          recorded_at?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cg_execution_history_execution_id_fkey";
            columns: ["execution_id"];
            isOneToOne: false;
            referencedRelation: "cg_execution_record";
            referencedColumns: ["id"];
          },
        ];
      };
      cg_execution_record: {
        Row: {
          action: string;
          actor_id: string;
          attempt_id: string;
          created_at: string;
          external_effect: string;
          id: string;
          idempotency_key: string;
          mission_id: string;
          mission_version: string;
          reality_ref: string;
          reason: string | null;
          requested_at: string;
          started_at: string;
          status: string;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          action: string;
          actor_id: string;
          attempt_id: string;
          created_at?: string;
          external_effect: string;
          id: string;
          idempotency_key: string;
          mission_id: string;
          mission_version: string;
          reality_ref: string;
          reason?: string | null;
          requested_at: string;
          started_at: string;
          status: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          action?: string;
          actor_id?: string;
          attempt_id?: string;
          created_at?: string;
          external_effect?: string;
          id?: string;
          idempotency_key?: string;
          mission_id?: string;
          mission_version?: string;
          reality_ref?: string;
          reason?: string | null;
          requested_at?: string;
          started_at?: string;
          status?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cg_execution_record_tenant_id_mission_id_mission_version_fkey";
            columns: ["tenant_id", "mission_id", "mission_version"];
            isOneToOne: false;
            referencedRelation: "cg_mission_intent";
            referencedColumns: ["tenant_id", "mission_id", "version"];
          },
        ];
      };
      cg_file_object: {
        Row: {
          content_ref: string;
          content_type: string;
          created_at: string;
          deleted_at: string | null;
          filename: string;
          grant_refs: Json;
          id: string;
          owner_ref: string;
          purpose: string;
          size_bytes: number;
          tenant_id: string;
          updated_at: string;
          visibility: string;
        };
        Insert: {
          content_ref: string;
          content_type: string;
          created_at?: string;
          deleted_at?: string | null;
          filename: string;
          grant_refs?: Json;
          id: string;
          owner_ref: string;
          purpose: string;
          size_bytes: number;
          tenant_id: string;
          updated_at?: string;
          visibility: string;
        };
        Update: {
          content_ref?: string;
          content_type?: string;
          created_at?: string;
          deleted_at?: string | null;
          filename?: string;
          grant_refs?: Json;
          id?: string;
          owner_ref?: string;
          purpose?: string;
          size_bytes?: number;
          tenant_id?: string;
          updated_at?: string;
          visibility?: string;
        };
        Relationships: [];
      };
      cg_foundation_evidence: {
        Row: {
          actor_id: string;
          created_at: string;
          evidence_id: string;
          integrity: string;
          lifecycle: string;
          lineage: string[];
          observed_at: string;
          producer: string;
          provenance: string;
          recorded_at: string;
          tenant_id: string;
        };
        Insert: {
          actor_id: string;
          created_at?: string;
          evidence_id: string;
          integrity: string;
          lifecycle: string;
          lineage?: string[];
          observed_at: string;
          producer: string;
          provenance: string;
          recorded_at: string;
          tenant_id: string;
        };
        Update: {
          actor_id?: string;
          created_at?: string;
          evidence_id?: string;
          integrity?: string;
          lifecycle?: string;
          lineage?: string[];
          observed_at?: string;
          producer?: string;
          provenance?: string;
          recorded_at?: string;
          tenant_id?: string;
        };
        Relationships: [];
      };
      cg_hermes_observation: {
        Row: {
          correlation_id: string | null;
          created_at: string;
          created_by: string;
          declared_origin: string;
          event_ref: string | null;
          generated_by_ai: boolean;
          id: string;
          kind: string;
          observed_at: string;
          recorded_at: string;
          source: string;
          statement: Json;
          subject_ref: string;
          tenant_id: string;
          trace_id: string | null;
          updated_at: string;
          verified: boolean;
        };
        Insert: {
          correlation_id?: string | null;
          created_at?: string;
          created_by: string;
          declared_origin: string;
          event_ref?: string | null;
          generated_by_ai?: boolean;
          id: string;
          kind: string;
          observed_at: string;
          recorded_at?: string;
          source: string;
          statement?: Json;
          subject_ref: string;
          tenant_id: string;
          trace_id?: string | null;
          updated_at?: string;
          verified?: boolean;
        };
        Update: {
          correlation_id?: string | null;
          created_at?: string;
          created_by?: string;
          declared_origin?: string;
          event_ref?: string | null;
          generated_by_ai?: boolean;
          id?: string;
          kind?: string;
          observed_at?: string;
          recorded_at?: string;
          source?: string;
          statement?: Json;
          subject_ref?: string;
          tenant_id?: string;
          trace_id?: string | null;
          updated_at?: string;
          verified?: boolean;
        };
        Relationships: [];
      };
      cg_idempotency_record: {
        Row: {
          actor_id: string;
          created_at: string;
          expires_at: string;
          external_effect: string;
          id: string;
          idempotency_key: string;
          intent: string;
          payload_digest: string;
          reason: string | null;
          response_ref: string;
          scope: string;
          status: string;
          tenant_id: string;
        };
        Insert: {
          actor_id: string;
          created_at?: string;
          expires_at: string;
          external_effect: string;
          id?: string;
          idempotency_key: string;
          intent: string;
          payload_digest: string;
          reason?: string | null;
          response_ref: string;
          scope: string;
          status: string;
          tenant_id: string;
        };
        Update: {
          actor_id?: string;
          created_at?: string;
          expires_at?: string;
          external_effect?: string;
          id?: string;
          idempotency_key?: string;
          intent?: string;
          payload_digest?: string;
          reason?: string | null;
          response_ref?: string;
          scope?: string;
          status?: string;
          tenant_id?: string;
        };
        Relationships: [];
      };
      cg_identity: {
        Row: {
          created_at: string;
          display_name: string;
          entity_id: string | null;
          external_subject: string | null;
          id: string;
          kind: string;
          state: string;
          tenant_id: string | null;
          updated_at: string;
          verified: boolean;
        };
        Insert: {
          created_at?: string;
          display_name: string;
          entity_id?: string | null;
          external_subject?: string | null;
          id?: string;
          kind: string;
          state?: string;
          tenant_id?: string | null;
          updated_at?: string;
          verified?: boolean;
        };
        Update: {
          created_at?: string;
          display_name?: string;
          entity_id?: string | null;
          external_subject?: string | null;
          id?: string;
          kind?: string;
          state?: string;
          tenant_id?: string | null;
          updated_at?: string;
          verified?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "cg_identity_entity_id_fkey";
            columns: ["entity_id"];
            isOneToOne: false;
            referencedRelation: "cg_entity";
            referencedColumns: ["id"];
          },
        ];
      };
      cg_knowledge_downgrade: {
        Row: {
          downgraded_at: string;
          downgraded_by: string;
          evidence_ref: string;
          from_tier: string;
          id: string;
          reason: string;
          source_id: string;
          tenant_id: string;
          to_tier: string;
        };
        Insert: {
          downgraded_at: string;
          downgraded_by: string;
          evidence_ref: string;
          from_tier: string;
          id: string;
          reason: string;
          source_id: string;
          tenant_id: string;
          to_tier: string;
        };
        Update: {
          downgraded_at?: string;
          downgraded_by?: string;
          evidence_ref?: string;
          from_tier?: string;
          id?: string;
          reason?: string;
          source_id?: string;
          tenant_id?: string;
          to_tier?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cg_knowledge_downgrade_source_fk";
            columns: ["source_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "cg_knowledge_source";
            referencedColumns: ["id", "tenant_id"];
          },
        ];
      };
      cg_knowledge_freshness_contract: {
        Row: {
          fresh_until: string;
          record_id: string;
          registered_at: string;
          revalidate_after_seconds: number | null;
          revalidation: string;
          source_id: string;
          tenant_id: string;
          tier_at_registration: string;
        };
        Insert: {
          fresh_until: string;
          record_id: string;
          registered_at: string;
          revalidate_after_seconds?: number | null;
          revalidation: string;
          source_id: string;
          tenant_id: string;
          tier_at_registration: string;
        };
        Update: {
          fresh_until?: string;
          record_id?: string;
          registered_at?: string;
          revalidate_after_seconds?: number | null;
          revalidation?: string;
          source_id?: string;
          tenant_id?: string;
          tier_at_registration?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cg_knowledge_freshness_contract_source_fk";
            columns: ["source_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "cg_knowledge_source";
            referencedColumns: ["id", "tenant_id"];
          },
        ];
      };
      cg_knowledge_invalidation: {
        Row: {
          evidence_ref: string;
          id: string;
          invalidated_at: string;
          invalidated_by: string;
          reason: string;
          record_id: string;
          tenant_id: string;
        };
        Insert: {
          evidence_ref: string;
          id: string;
          invalidated_at: string;
          invalidated_by: string;
          reason: string;
          record_id: string;
          tenant_id: string;
        };
        Update: {
          evidence_ref?: string;
          id?: string;
          invalidated_at?: string;
          invalidated_by?: string;
          reason?: string;
          record_id?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cg_knowledge_invalidation_contract_fk";
            columns: ["record_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "cg_knowledge_freshness_contract";
            referencedColumns: ["record_id", "tenant_id"];
          },
        ];
      };
      cg_knowledge_source: {
        Row: {
          declared_at: string;
          declared_by: string;
          description: string;
          evidence_ref: string | null;
          id: string;
          tenant_id: string;
          tier: string;
        };
        Insert: {
          declared_at: string;
          declared_by: string;
          description: string;
          evidence_ref?: string | null;
          id: string;
          tenant_id: string;
          tier: string;
        };
        Update: {
          declared_at?: string;
          declared_by?: string;
          description?: string;
          evidence_ref?: string | null;
          id?: string;
          tenant_id?: string;
          tier?: string;
        };
        Relationships: [];
      };
      cg_memory_access_log: {
        Row: {
          denial_reason: string | null;
          exclusions: Json;
          id: string;
          identity_ref: string | null;
          outcome: string;
          purpose: string;
          recorded_at: string;
          returned_record_ids: Json;
          scope_id: string | null;
          tenant_id: string | null;
        };
        Insert: {
          denial_reason?: string | null;
          exclusions?: Json;
          id: string;
          identity_ref?: string | null;
          outcome: string;
          purpose?: string;
          recorded_at?: string;
          returned_record_ids?: Json;
          scope_id?: string | null;
          tenant_id?: string | null;
        };
        Update: {
          denial_reason?: string | null;
          exclusions?: Json;
          id?: string;
          identity_ref?: string | null;
          outcome?: string;
          purpose?: string;
          recorded_at?: string;
          returned_record_ids?: Json;
          scope_id?: string | null;
          tenant_id?: string | null;
        };
        Relationships: [];
      };
      cg_memory_record: {
        Row: {
          causation_id: string | null;
          content: string;
          correlation_id: string | null;
          created_by: string;
          declared_origin: string | null;
          domain: string;
          freshness_at: string;
          id: string;
          memory_class: string;
          mission_ref: string | null;
          object_type: string | null;
          parent_event_id: string | null;
          policy_context: Json | null;
          provenance: Json | null;
          recorded_at: string;
          required_permission: string | null;
          schema_version: string | null;
          scope_id: string;
          sensitivity: string;
          status: string | null;
          supersedes: string | null;
          tenant_id: string;
          trace_id: string | null;
          updated_by: string | null;
          valid_from: string | null;
          valid_time_known: boolean;
          valid_until: string | null;
        };
        Insert: {
          causation_id?: string | null;
          content: string;
          correlation_id?: string | null;
          created_by: string;
          declared_origin?: string | null;
          domain: string;
          freshness_at: string;
          id: string;
          memory_class: string;
          mission_ref?: string | null;
          object_type?: string | null;
          parent_event_id?: string | null;
          policy_context?: Json | null;
          provenance?: Json | null;
          recorded_at?: string;
          required_permission?: string | null;
          schema_version?: string | null;
          scope_id: string;
          sensitivity: string;
          status?: string | null;
          supersedes?: string | null;
          tenant_id: string;
          trace_id?: string | null;
          updated_by?: string | null;
          valid_from?: string | null;
          valid_time_known?: boolean;
          valid_until?: string | null;
        };
        Update: {
          causation_id?: string | null;
          content?: string;
          correlation_id?: string | null;
          created_by?: string;
          declared_origin?: string | null;
          domain?: string;
          freshness_at?: string;
          id?: string;
          memory_class?: string;
          mission_ref?: string | null;
          object_type?: string | null;
          parent_event_id?: string | null;
          policy_context?: Json | null;
          provenance?: Json | null;
          recorded_at?: string;
          required_permission?: string | null;
          schema_version?: string | null;
          scope_id?: string;
          sensitivity?: string;
          status?: string | null;
          supersedes?: string | null;
          tenant_id?: string;
          trace_id?: string | null;
          updated_by?: string | null;
          valid_from?: string | null;
          valid_time_known?: boolean;
          valid_until?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "cg_memory_record_scope_fk";
            columns: ["scope_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "cg_memory_scope";
            referencedColumns: ["id", "tenant_id"];
          },
          {
            foreignKeyName: "cg_memory_record_supersedes_fk";
            columns: ["supersedes", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "cg_memory_record";
            referencedColumns: ["id", "tenant_id"];
          },
        ];
      };
      cg_memory_scope: {
        Row: {
          actor_scope: Json;
          declared_at: string;
          declared_by: string;
          domains: Json;
          id: string;
          max_sensitivity: string;
          mission_ref: string | null;
          tenant_id: string;
        };
        Insert: {
          actor_scope?: Json;
          declared_at?: string;
          declared_by: string;
          domains?: Json;
          id: string;
          max_sensitivity: string;
          mission_ref?: string | null;
          tenant_id: string;
        };
        Update: {
          actor_scope?: Json;
          declared_at?: string;
          declared_by?: string;
          domains?: Json;
          id?: string;
          max_sensitivity?: string;
          mission_ref?: string | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      cg_mission_intent: {
        Row: {
          authority_ref: string;
          authorized_actions: string[];
          context_ref: string;
          created_at: string;
          expires_at: string | null;
          id: string;
          lifecycle: string;
          mission_id: string;
          non_scope: string[];
          owner_ref: string;
          purpose: string;
          tenant_id: string;
          updated_at: string;
          version: string;
        };
        Insert: {
          authority_ref: string;
          authorized_actions?: string[];
          context_ref: string;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          lifecycle: string;
          mission_id: string;
          non_scope?: string[];
          owner_ref: string;
          purpose: string;
          tenant_id: string;
          updated_at?: string;
          version: string;
        };
        Update: {
          authority_ref?: string;
          authorized_actions?: string[];
          context_ref?: string;
          created_at?: string;
          expires_at?: string | null;
          id?: string;
          lifecycle?: string;
          mission_id?: string;
          non_scope?: string[];
          owner_ref?: string;
          purpose?: string;
          tenant_id?: string;
          updated_at?: string;
          version?: string;
        };
        Relationships: [];
      };
      cg_mission_lease: {
        Row: {
          acquired_at: string;
          attempt: number;
          completed_at: string | null;
          execution_id: string;
          expires_at: string;
          heartbeat_at: string;
          lease_id: string;
          mission_id: string;
          outcome: string | null;
          retry_not_before: string | null;
          state: string;
          tenant_id: string;
          updated_at: string;
          worker_id: string;
        };
        Insert: {
          acquired_at: string;
          attempt: number;
          completed_at?: string | null;
          execution_id: string;
          expires_at: string;
          heartbeat_at: string;
          lease_id: string;
          mission_id: string;
          outcome?: string | null;
          retry_not_before?: string | null;
          state: string;
          tenant_id: string;
          updated_at?: string;
          worker_id: string;
        };
        Update: {
          acquired_at?: string;
          attempt?: number;
          completed_at?: string | null;
          execution_id?: string;
          expires_at?: string;
          heartbeat_at?: string;
          lease_id?: string;
          mission_id?: string;
          outcome?: string | null;
          retry_not_before?: string | null;
          state?: string;
          tenant_id?: string;
          updated_at?: string;
          worker_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cg_mission_lease_execution_fk";
            columns: ["execution_id", "tenant_id", "mission_id"];
            isOneToOne: false;
            referencedRelation: "cg_execution_record";
            referencedColumns: ["id", "tenant_id", "mission_id"];
          },
        ];
      };
      cg_observation: {
        Row: {
          causation_id: string | null;
          confidence: number | null;
          correlation_id: string | null;
          created_at: string;
          created_by: string | null;
          declared_origin: string | null;
          evidence_entity_ids: string[];
          id: string;
          kind: string;
          object_type: string | null;
          observed_at: string | null;
          observer_identity: string | null;
          parent_event_id: string | null;
          policy_context: Json | null;
          provenance: Json | null;
          recorded_at: string;
          schema_version: string | null;
          source_ref: string | null;
          source_type: string | null;
          statement: Json;
          status: string | null;
          subject_entity_id: string;
          superseded_by: string | null;
          supersedes: string | null;
          tenant_id: string | null;
          trace_id: string | null;
          updated_at: string;
          updated_by: string | null;
          valid_from: string | null;
          valid_time_known: boolean | null;
          valid_until: string | null;
        };
        Insert: {
          causation_id?: string | null;
          confidence?: number | null;
          correlation_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          declared_origin?: string | null;
          evidence_entity_ids?: string[];
          id?: string;
          kind: string;
          object_type?: string | null;
          observed_at?: string | null;
          observer_identity?: string | null;
          parent_event_id?: string | null;
          policy_context?: Json | null;
          provenance?: Json | null;
          recorded_at?: string;
          schema_version?: string | null;
          source_ref?: string | null;
          source_type?: string | null;
          statement?: Json;
          status?: string | null;
          subject_entity_id: string;
          superseded_by?: string | null;
          supersedes?: string | null;
          tenant_id?: string | null;
          trace_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          valid_from?: string | null;
          valid_time_known?: boolean | null;
          valid_until?: string | null;
        };
        Update: {
          causation_id?: string | null;
          confidence?: number | null;
          correlation_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          declared_origin?: string | null;
          evidence_entity_ids?: string[];
          id?: string;
          kind?: string;
          object_type?: string | null;
          observed_at?: string | null;
          observer_identity?: string | null;
          parent_event_id?: string | null;
          policy_context?: Json | null;
          provenance?: Json | null;
          recorded_at?: string;
          schema_version?: string | null;
          source_ref?: string | null;
          source_type?: string | null;
          statement?: Json;
          status?: string | null;
          subject_entity_id?: string;
          superseded_by?: string | null;
          supersedes?: string | null;
          tenant_id?: string | null;
          trace_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          valid_from?: string | null;
          valid_time_known?: boolean | null;
          valid_until?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "cg_observation_subject_entity_id_fkey";
            columns: ["subject_entity_id"];
            isOneToOne: false;
            referencedRelation: "cg_entity";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cg_observation_superseded_by_fkey";
            columns: ["superseded_by"];
            isOneToOne: false;
            referencedRelation: "cg_observation";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cg_observation_supersedes_fkey";
            columns: ["supersedes"];
            isOneToOne: false;
            referencedRelation: "cg_observation";
            referencedColumns: ["id"];
          },
        ];
      };
      cg_org_communication_sender: {
        Row: {
          channel: string;
          created_at: string;
          credential_ref: string;
          from_number: string;
          org_ref: string;
          provenance: Json;
          provider: string;
          sender_ref: string;
          status: string;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          channel: string;
          created_at?: string;
          credential_ref: string;
          from_number: string;
          org_ref: string;
          provenance: Json;
          provider: string;
          sender_ref: string;
          status: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          channel?: string;
          created_at?: string;
          credential_ref?: string;
          from_number?: string;
          org_ref?: string;
          provenance?: Json;
          provider?: string;
          sender_ref?: string;
          status?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      cg_org_membership: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          org_unit_id: string;
          principal_ref: string;
          role_ref: string;
          state: string;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id: string;
          org_unit_id: string;
          principal_ref: string;
          role_ref: string;
          state?: string;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          org_unit_id?: string;
          principal_ref?: string;
          role_ref?: string;
          state?: string;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cg_org_membership_org_unit_id_fkey";
            columns: ["org_unit_id"];
            isOneToOne: false;
            referencedRelation: "cg_org_unit";
            referencedColumns: ["id"];
          },
        ];
      };
      cg_org_profile: {
        Row: {
          created_at: string;
          id: string;
          payload: Json;
          profile_key: string;
          runtime_ref: string;
          tenant_ref: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          payload?: Json;
          profile_key: string;
          runtime_ref: string;
          tenant_ref: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          payload?: Json;
          profile_key?: string;
          runtime_ref?: string;
          tenant_ref?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      cg_org_unit: {
        Row: {
          created_at: string;
          created_by: string;
          id: string;
          kind: string;
          lifecycle_state: string;
          parent_org_unit_id: string | null;
          profile: Json;
          tenant_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by: string;
          id: string;
          kind: string;
          lifecycle_state?: string;
          parent_org_unit_id?: string | null;
          profile?: Json;
          tenant_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string;
          id?: string;
          kind?: string;
          lifecycle_state?: string;
          parent_org_unit_id?: string | null;
          profile?: Json;
          tenant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cg_org_unit_parent_org_unit_id_fkey";
            columns: ["parent_org_unit_id"];
            isOneToOne: false;
            referencedRelation: "cg_org_unit";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cg_org_unit_parent_same_tenant_fk";
            columns: ["parent_org_unit_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "cg_org_unit";
            referencedColumns: ["id", "tenant_id"];
          },
        ];
      };
      cg_reasoning_provenance_snapshot: {
        Row: {
          actor_ref: string;
          agent_ref: string | null;
          causation_id: string | null;
          context_content_digest: string | null;
          context_trace_id: string | null;
          correlation_id: string | null;
          created_by: string;
          declared_origin: string | null;
          estimated_cost_usd: number | null;
          evidence_class: string;
          generated_by_ai: boolean;
          id: string;
          mission_ref: string | null;
          model_id: string;
          model_provider_class: string | null;
          object_type: string | null;
          origin_tenant_id: string;
          output_digest: string;
          parent_event_id: string | null;
          policy_context: Json | null;
          provenance: Json | null;
          provenance_source: string;
          provenance_source_ref: string | null;
          purpose: string;
          recorded_at: string;
          recorded_by: string | null;
          routed_via_registry: boolean;
          routing_rationale: Json;
          schema_version: string;
          snapshot_id: string;
          status: string | null;
          tenant_id: string;
          tokens_in: number;
          tokens_out: number;
          trace_id: string | null;
          updated_by: string | null;
          verified: boolean;
        };
        Insert: {
          actor_ref: string;
          agent_ref?: string | null;
          causation_id?: string | null;
          context_content_digest?: string | null;
          context_trace_id?: string | null;
          correlation_id?: string | null;
          created_by: string;
          declared_origin?: string | null;
          estimated_cost_usd?: number | null;
          evidence_class: string;
          generated_by_ai: boolean;
          id: string;
          mission_ref?: string | null;
          model_id: string;
          model_provider_class?: string | null;
          object_type?: string | null;
          origin_tenant_id: string;
          output_digest: string;
          parent_event_id?: string | null;
          policy_context?: Json | null;
          provenance?: Json | null;
          provenance_source: string;
          provenance_source_ref?: string | null;
          purpose: string;
          recorded_at: string;
          recorded_by?: string | null;
          routed_via_registry: boolean;
          routing_rationale?: Json;
          schema_version: string;
          snapshot_id: string;
          status?: string | null;
          tenant_id: string;
          tokens_in: number;
          tokens_out: number;
          trace_id?: string | null;
          updated_by?: string | null;
          verified: boolean;
        };
        Update: {
          actor_ref?: string;
          agent_ref?: string | null;
          causation_id?: string | null;
          context_content_digest?: string | null;
          context_trace_id?: string | null;
          correlation_id?: string | null;
          created_by?: string;
          declared_origin?: string | null;
          estimated_cost_usd?: number | null;
          evidence_class?: string;
          generated_by_ai?: boolean;
          id?: string;
          mission_ref?: string | null;
          model_id?: string;
          model_provider_class?: string | null;
          object_type?: string | null;
          origin_tenant_id?: string;
          output_digest?: string;
          parent_event_id?: string | null;
          policy_context?: Json | null;
          provenance?: Json | null;
          provenance_source?: string;
          provenance_source_ref?: string | null;
          purpose?: string;
          recorded_at?: string;
          recorded_by?: string | null;
          routed_via_registry?: boolean;
          routing_rationale?: Json;
          schema_version?: string;
          snapshot_id?: string;
          status?: string | null;
          tenant_id?: string;
          tokens_in?: number;
          tokens_out?: number;
          trace_id?: string | null;
          updated_by?: string | null;
          verified?: boolean;
        };
        Relationships: [];
      };
      cg_reconciliation_input: {
        Row: {
          attribute: string;
          confidence: number | null;
          evidence_class: string;
          kind: string;
          observation_id: string;
          observed_at: string | null;
          recorded_at: string;
          reliability: string;
          subject_entity_id: string;
          supersedes: string | null;
          tenant_id: string;
          valid_from: string | null;
          valid_time_known: boolean;
          valid_until: string | null;
          verdict_row_id: string;
        };
        Insert: {
          attribute: string;
          confidence?: number | null;
          evidence_class: string;
          kind: string;
          observation_id: string;
          observed_at?: string | null;
          recorded_at: string;
          reliability: string;
          subject_entity_id: string;
          supersedes?: string | null;
          tenant_id: string;
          valid_from?: string | null;
          valid_time_known?: boolean;
          valid_until?: string | null;
          verdict_row_id: string;
        };
        Update: {
          attribute?: string;
          confidence?: number | null;
          evidence_class?: string;
          kind?: string;
          observation_id?: string;
          observed_at?: string | null;
          recorded_at?: string;
          reliability?: string;
          subject_entity_id?: string;
          supersedes?: string | null;
          tenant_id?: string;
          valid_from?: string | null;
          valid_time_known?: boolean;
          valid_until?: string | null;
          verdict_row_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cg_reconciliation_input_verdict_fk";
            columns: ["verdict_row_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "cg_reconciliation_verdict";
            referencedColumns: ["id", "tenant_id"];
          },
        ];
      };
      cg_reconciliation_verdict: {
        Row: {
          applied_rules: Json;
          attribute: string;
          causation_id: string | null;
          correlation_id: string | null;
          created_by: string;
          declared_origin: string | null;
          duplicates: Json;
          id: string;
          inputs: Json;
          object_type: string | null;
          outcome: string;
          parent_event_id: string | null;
          policy_context: Json | null;
          provenance: Json | null;
          recorded_at: string;
          residual_uncertainty: Json;
          resolution_trace: Json;
          rule_applied: string | null;
          schema_version: string | null;
          status: string | null;
          subject_entity_id: string;
          superseded: Json;
          tenant_id: string;
          trace_id: string | null;
          updated_by: string | null;
          valid_from: string | null;
          valid_time_known: boolean;
          valid_until: string | null;
          value: Json | null;
          verdict_id: string;
          verdict_provenance: Json;
          winner_id: string | null;
        };
        Insert: {
          applied_rules?: Json;
          attribute: string;
          causation_id?: string | null;
          correlation_id?: string | null;
          created_by: string;
          declared_origin?: string | null;
          duplicates?: Json;
          id: string;
          inputs?: Json;
          object_type?: string | null;
          outcome: string;
          parent_event_id?: string | null;
          policy_context?: Json | null;
          provenance?: Json | null;
          recorded_at: string;
          residual_uncertainty: Json;
          resolution_trace?: Json;
          rule_applied?: string | null;
          schema_version?: string | null;
          status?: string | null;
          subject_entity_id: string;
          superseded?: Json;
          tenant_id: string;
          trace_id?: string | null;
          updated_by?: string | null;
          valid_from?: string | null;
          valid_time_known?: boolean;
          valid_until?: string | null;
          value?: Json | null;
          verdict_id: string;
          verdict_provenance: Json;
          winner_id?: string | null;
        };
        Update: {
          applied_rules?: Json;
          attribute?: string;
          causation_id?: string | null;
          correlation_id?: string | null;
          created_by?: string;
          declared_origin?: string | null;
          duplicates?: Json;
          id?: string;
          inputs?: Json;
          object_type?: string | null;
          outcome?: string;
          parent_event_id?: string | null;
          policy_context?: Json | null;
          provenance?: Json | null;
          recorded_at?: string;
          residual_uncertainty?: Json;
          resolution_trace?: Json;
          rule_applied?: string | null;
          schema_version?: string | null;
          status?: string | null;
          subject_entity_id?: string;
          superseded?: Json;
          tenant_id?: string;
          trace_id?: string | null;
          updated_by?: string | null;
          valid_from?: string | null;
          valid_time_known?: boolean;
          valid_until?: string | null;
          value?: Json | null;
          verdict_id?: string;
          verdict_provenance?: Json;
          winner_id?: string | null;
        };
        Relationships: [];
      };
      cg_relationship: {
        Row: {
          attributes: Json;
          causation_id: string | null;
          confidence: number | null;
          correlation_id: string | null;
          created_at: string;
          created_by: string | null;
          declared_origin: string | null;
          id: string;
          object_type: string | null;
          observed_at: string | null;
          parent_event_id: string | null;
          policy_context: Json | null;
          provenance: Json | null;
          recorded_at: string;
          relation_type: string;
          schema_version: string | null;
          source_entity_id: string;
          source_ref: string | null;
          status: string | null;
          target_entity_id: string;
          tenant_id: string | null;
          trace_id: string | null;
          updated_at: string;
          updated_by: string | null;
          valid_from: string | null;
          valid_to: string | null;
        };
        Insert: {
          attributes?: Json;
          causation_id?: string | null;
          confidence?: number | null;
          correlation_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          declared_origin?: string | null;
          id?: string;
          object_type?: string | null;
          observed_at?: string | null;
          parent_event_id?: string | null;
          policy_context?: Json | null;
          provenance?: Json | null;
          recorded_at?: string;
          relation_type: string;
          schema_version?: string | null;
          source_entity_id: string;
          source_ref?: string | null;
          status?: string | null;
          target_entity_id: string;
          tenant_id?: string | null;
          trace_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          valid_from?: string | null;
          valid_to?: string | null;
        };
        Update: {
          attributes?: Json;
          causation_id?: string | null;
          confidence?: number | null;
          correlation_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          declared_origin?: string | null;
          id?: string;
          object_type?: string | null;
          observed_at?: string | null;
          parent_event_id?: string | null;
          policy_context?: Json | null;
          provenance?: Json | null;
          recorded_at?: string;
          relation_type?: string;
          schema_version?: string | null;
          source_entity_id?: string;
          source_ref?: string | null;
          status?: string | null;
          target_entity_id?: string;
          tenant_id?: string | null;
          trace_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
          valid_from?: string | null;
          valid_to?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "cg_relationship_source_entity_id_fkey";
            columns: ["source_entity_id"];
            isOneToOne: false;
            referencedRelation: "cg_entity";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cg_relationship_target_entity_id_fkey";
            columns: ["target_entity_id"];
            isOneToOne: false;
            referencedRelation: "cg_entity";
            referencedColumns: ["id"];
          },
        ];
      };
      cg_role_assignment: {
        Row: {
          created_at: string;
          ended_on: string | null;
          id: string;
          identity_ref: string;
          role_id: string;
          started_on: string;
          status: string;
          tenant_ref: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          ended_on?: string | null;
          id?: string;
          identity_ref: string;
          role_id: string;
          started_on?: string;
          status?: string;
          tenant_ref: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          ended_on?: string | null;
          id?: string;
          identity_ref?: string;
          role_id?: string;
          started_on?: string;
          status?: string;
          tenant_ref?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      cg_role_grant: {
        Row: {
          capability: string;
          granted_by: string;
          granted_on: string;
          id: string;
          revoked_on: string | null;
          role_id: string;
          tenant_ref: string;
        };
        Insert: {
          capability: string;
          granted_by: string;
          granted_on?: string;
          id?: string;
          revoked_on?: string | null;
          role_id: string;
          tenant_ref: string;
        };
        Update: {
          capability?: string;
          granted_by?: string;
          granted_on?: string;
          id?: string;
          revoked_on?: string | null;
          role_id?: string;
          tenant_ref?: string;
        };
        Relationships: [];
      };
      cg_tenant: {
        Row: {
          created_at: string;
          environment: string;
          id: string;
          name: string;
          parent_tenant_id: string | null;
          region: string | null;
          slug: string;
          status: string;
          tenant_type: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          environment?: string;
          id?: string;
          name: string;
          parent_tenant_id?: string | null;
          region?: string | null;
          slug: string;
          status?: string;
          tenant_type: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          environment?: string;
          id?: string;
          name?: string;
          parent_tenant_id?: string | null;
          region?: string | null;
          slug?: string;
          status?: string;
          tenant_type?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cg_tenant_parent_tenant_id_fkey";
            columns: ["parent_tenant_id"];
            isOneToOne: false;
            referencedRelation: "cg_tenant";
            referencedColumns: ["id"];
          },
        ];
      };
      cg_tool_runtime_invocation: {
        Row: {
          at: string;
          at_ms: number;
          delegation_ref: string | null;
          evidence_ref: string | null;
          lease_handle_refs: Json;
          lease_invalidated: boolean;
          outcome: string;
          reason_code: string | null;
          reason_detail: string | null;
          record_id: string;
          redacted_params: Json;
          required_capability_ids: Json;
          result_summary: string | null;
          tenant_id: string;
          tool_id: string;
          worker_id: string | null;
          worker_identity_ref: string | null;
        };
        Insert: {
          at: string;
          at_ms: number;
          delegation_ref?: string | null;
          evidence_ref?: string | null;
          lease_handle_refs?: Json;
          lease_invalidated?: boolean;
          outcome: string;
          reason_code?: string | null;
          reason_detail?: string | null;
          record_id: string;
          redacted_params: Json;
          required_capability_ids?: Json;
          result_summary?: string | null;
          tenant_id: string;
          tool_id: string;
          worker_id?: string | null;
          worker_identity_ref?: string | null;
        };
        Update: {
          at?: string;
          at_ms?: number;
          delegation_ref?: string | null;
          evidence_ref?: string | null;
          lease_handle_refs?: Json;
          lease_invalidated?: boolean;
          outcome?: string;
          reason_code?: string | null;
          reason_detail?: string | null;
          record_id?: string;
          redacted_params?: Json;
          required_capability_ids?: Json;
          result_summary?: string | null;
          tenant_id?: string;
          tool_id?: string;
          worker_id?: string | null;
          worker_identity_ref?: string | null;
        };
        Relationships: [];
      };
      cg_tool_runtime_tool: {
        Row: {
          budget_guard: Json | null;
          contract: string;
          credential_requirements: Json;
          id: string;
          rate_guard: Json | null;
          registered_at: string;
          registered_at_ms: number;
          required_capability_ids: Json;
          risk_class: string;
          sensitive_param_keys: Json;
          tenant_id: string;
          tool_id: string;
        };
        Insert: {
          budget_guard?: Json | null;
          contract: string;
          credential_requirements?: Json;
          id: string;
          rate_guard?: Json | null;
          registered_at: string;
          registered_at_ms: number;
          required_capability_ids?: Json;
          risk_class: string;
          sensitive_param_keys?: Json;
          tenant_id: string;
          tool_id: string;
        };
        Update: {
          budget_guard?: Json | null;
          contract?: string;
          credential_requirements?: Json;
          id?: string;
          rate_guard?: Json | null;
          registered_at?: string;
          registered_at_ms?: number;
          required_capability_ids?: Json;
          risk_class?: string;
          sensitive_param_keys?: Json;
          tenant_id?: string;
          tool_id?: string;
        };
        Relationships: [];
      };
      cg_usage_attribution_bucket: {
        Row: {
          bucket_key: string;
          dimension: string;
          rollup_row_id: string;
          tenant_id: string;
          totals: Json;
        };
        Insert: {
          bucket_key: string;
          dimension: string;
          rollup_row_id: string;
          tenant_id: string;
          totals: Json;
        };
        Update: {
          bucket_key?: string;
          dimension?: string;
          rollup_row_id?: string;
          tenant_id?: string;
          totals?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "cg_usage_attribution_bucket_rollup_fk";
            columns: ["rollup_row_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "cg_usage_attribution_rollup";
            referencedColumns: ["id", "tenant_id"];
          },
        ];
      };
      cg_usage_attribution_rollup: {
        Row: {
          grand_total: Json;
          id: string;
          integrity_conserves: boolean;
          integrity_defects: Json;
          integrity_ok: boolean;
          integrity_problems: Json;
          period_from: string | null;
          period_to: string | null;
          recorded_at: string;
          recorded_from: string | null;
          recorded_to: string | null;
          tenant_id: string;
        };
        Insert: {
          grand_total: Json;
          id: string;
          integrity_conserves: boolean;
          integrity_defects?: Json;
          integrity_ok: boolean;
          integrity_problems?: Json;
          period_from?: string | null;
          period_to?: string | null;
          recorded_at: string;
          recorded_from?: string | null;
          recorded_to?: string | null;
          tenant_id: string;
        };
        Update: {
          grand_total?: Json;
          id?: string;
          integrity_conserves?: boolean;
          integrity_defects?: Json;
          integrity_ok?: boolean;
          integrity_problems?: Json;
          period_from?: string | null;
          period_to?: string | null;
          recorded_at?: string;
          recorded_from?: string | null;
          recorded_to?: string | null;
          tenant_id?: string;
        };
        Relationships: [];
      };
      cg_verification_result: {
        Row: {
          created_at: string;
          decision: string;
          evidence_ids: string[];
          execution_id: string;
          reason: string;
          verification_id: string;
        };
        Insert: {
          created_at?: string;
          decision: string;
          evidence_ids?: string[];
          execution_id: string;
          reason: string;
          verification_id: string;
        };
        Update: {
          created_at?: string;
          decision?: string;
          evidence_ids?: string[];
          execution_id?: string;
          reason?: string;
          verification_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cg_verification_result_execution_id_fkey";
            columns: ["execution_id"];
            isOneToOne: false;
            referencedRelation: "cg_execution_record";
            referencedColumns: ["id"];
          },
        ];
      };
      cg_worker_capability: {
        Row: {
          capability_id: string;
          definition_id: string;
          description: string;
          tenant_id: string;
        };
        Insert: {
          capability_id: string;
          definition_id: string;
          description: string;
          tenant_id: string;
        };
        Update: {
          capability_id?: string;
          definition_id?: string;
          description?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cg_worker_capability_definition_fk";
            columns: ["definition_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "cg_worker_definition";
            referencedColumns: ["id", "tenant_id"];
          },
        ];
      };
      cg_worker_definition: {
        Row: {
          causation_id: string | null;
          classification: string;
          correlation_id: string | null;
          created_at: string;
          created_by: string;
          declared_origin: string | null;
          delegation_history_refs: Json;
          id: string;
          identity_id: string;
          lifecycle_state: string;
          max_risk_class: string;
          object_type: string | null;
          parent_event_id: string | null;
          policy_context: Json | null;
          provenance: Json | null;
          resource_scopes: Json;
          schema_version: string | null;
          status: string | null;
          tenant_id: string;
          trace_id: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          causation_id?: string | null;
          classification: string;
          correlation_id?: string | null;
          created_at?: string;
          created_by: string;
          declared_origin?: string | null;
          delegation_history_refs?: Json;
          id: string;
          identity_id: string;
          lifecycle_state?: string;
          max_risk_class: string;
          object_type?: string | null;
          parent_event_id?: string | null;
          policy_context?: Json | null;
          provenance?: Json | null;
          resource_scopes?: Json;
          schema_version?: string | null;
          status?: string | null;
          tenant_id: string;
          trace_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          causation_id?: string | null;
          classification?: string;
          correlation_id?: string | null;
          created_at?: string;
          created_by?: string;
          declared_origin?: string | null;
          delegation_history_refs?: Json;
          id?: string;
          identity_id?: string;
          lifecycle_state?: string;
          max_risk_class?: string;
          object_type?: string | null;
          parent_event_id?: string | null;
          policy_context?: Json | null;
          provenance?: Json | null;
          resource_scopes?: Json;
          schema_version?: string | null;
          status?: string | null;
          tenant_id?: string;
          trace_id?: string | null;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "cg_worker_definition_identity_id_fkey";
            columns: ["identity_id"];
            isOneToOne: false;
            referencedRelation: "cg_identity";
            referencedColumns: ["id"];
          },
        ];
      };
      cg_worker_delegation: {
        Row: {
          definition_id: string;
          delegated_capabilities: Json;
          delegation_ref: string;
          id: string;
          max_granted_risk_class: string;
          recorded_at: string;
          recorded_by: string;
          tenant_id: string;
        };
        Insert: {
          definition_id: string;
          delegated_capabilities?: Json;
          delegation_ref: string;
          id: string;
          max_granted_risk_class: string;
          recorded_at?: string;
          recorded_by: string;
          tenant_id: string;
        };
        Update: {
          definition_id?: string;
          delegated_capabilities?: Json;
          delegation_ref?: string;
          id?: string;
          max_granted_risk_class?: string;
          recorded_at?: string;
          recorded_by?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cg_worker_delegation_definition_fk";
            columns: ["definition_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "cg_worker_definition";
            referencedColumns: ["id", "tenant_id"];
          },
        ];
      };
      cg_worker_delegation_grant: {
        Row: {
          definition_id: string;
          delegated_capabilities: Json;
          delegation_ref: string;
          granted_at: string;
          granted_by: string;
          id: string;
          max_granted_risk_class: string;
          revoked_at: string | null;
          revoked_by: string | null;
          revoked_reason: string | null;
          state: string;
          tenant_id: string;
        };
        Insert: {
          definition_id: string;
          delegated_capabilities?: Json;
          delegation_ref: string;
          granted_at?: string;
          granted_by: string;
          id: string;
          max_granted_risk_class: string;
          revoked_at?: string | null;
          revoked_by?: string | null;
          revoked_reason?: string | null;
          state: string;
          tenant_id: string;
        };
        Update: {
          definition_id?: string;
          delegated_capabilities?: Json;
          delegation_ref?: string;
          granted_at?: string;
          granted_by?: string;
          id?: string;
          max_granted_risk_class?: string;
          revoked_at?: string | null;
          revoked_by?: string | null;
          revoked_reason?: string | null;
          state?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cg_worker_delegation_grant_definition_fk";
            columns: ["definition_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "cg_worker_definition";
            referencedColumns: ["id", "tenant_id"];
          },
        ];
      };
      cg_worker_quarantine: {
        Row: {
          definition_id: string;
          failure_count: number;
          failure_threshold: number;
          id: string;
          quarantined_at: string;
          quarantined_by: string;
          reason: string;
          released_at: string | null;
          released_by: string | null;
          state: string;
          tenant_id: string;
        };
        Insert: {
          definition_id: string;
          failure_count: number;
          failure_threshold: number;
          id: string;
          quarantined_at?: string;
          quarantined_by: string;
          reason: string;
          released_at?: string | null;
          released_by?: string | null;
          state: string;
          tenant_id: string;
        };
        Update: {
          definition_id?: string;
          failure_count?: number;
          failure_threshold?: number;
          id?: string;
          quarantined_at?: string;
          quarantined_by?: string;
          reason?: string;
          released_at?: string | null;
          released_by?: string | null;
          state?: string;
          tenant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cg_worker_quarantine_definition_fk";
            columns: ["definition_id", "tenant_id"];
            isOneToOne: false;
            referencedRelation: "cg_worker_definition";
            referencedColumns: ["id", "tenant_id"];
          },
        ];
      };
      cg_workforce_kind: {
        Row: {
          aliases: string[];
          authority_group: string;
          created_at: string;
          description: string;
          employment_class: string;
          family: string;
          is_leadership: boolean;
          is_teaching: boolean;
          kind_code: string;
          runtime_ref: string;
          status: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          aliases?: string[];
          authority_group: string;
          created_at?: string;
          description?: string;
          employment_class: string;
          family: string;
          is_leadership?: boolean;
          is_teaching?: boolean;
          kind_code: string;
          runtime_ref: string;
          status?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          aliases?: string[];
          authority_group?: string;
          created_at?: string;
          description?: string;
          employment_class?: string;
          family?: string;
          is_leadership?: boolean;
          is_teaching?: boolean;
          kind_code?: string;
          runtime_ref?: string;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cg_workforce_kind_runtime_ref_fkey";
            columns: ["runtime_ref"];
            isOneToOne: false;
            referencedRelation: "cg_domain_runtime";
            referencedColumns: ["id"];
          },
        ];
      };
      cg_workforce_position: {
        Row: {
          attributes: Json;
          created_at: string;
          employment_type: string;
          ended_on: string | null;
          id: string;
          identity_ref: string;
          is_primary: boolean;
          kind_code: string;
          runtime_ref: string;
          started_on: string;
          status: string;
          tenant_ref: string;
          updated_at: string;
        };
        Insert: {
          attributes?: Json;
          created_at?: string;
          employment_type?: string;
          ended_on?: string | null;
          id?: string;
          identity_ref: string;
          is_primary?: boolean;
          kind_code: string;
          runtime_ref: string;
          started_on: string;
          status?: string;
          tenant_ref: string;
          updated_at?: string;
        };
        Update: {
          attributes?: Json;
          created_at?: string;
          employment_type?: string;
          ended_on?: string | null;
          id?: string;
          identity_ref?: string;
          is_primary?: boolean;
          kind_code?: string;
          runtime_ref?: string;
          started_on?: string;
          status?: string;
          tenant_ref?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cg_workforce_position_runtime_ref_kind_code_fkey";
            columns: ["runtime_ref", "kind_code"];
            isOneToOne: false;
            referencedRelation: "cg_workforce_kind";
            referencedColumns: ["runtime_ref", "kind_code"];
          },
        ];
      };
      cg_workspace: {
        Row: {
          archive_reason: string | null;
          code: string;
          config_version: number;
          created_at: string;
          created_by: string;
          default_page_id: string | null;
          id: string;
          is_discoverable: boolean;
          lifecycle_state: string;
          locale: string | null;
          module_ids: string[];
          name: string;
          parent_workspace_id: string | null;
          region: string | null;
          suspension_reason: string | null;
          tenant_id: string;
          timezone: string | null;
          type: string;
          updated_at: string;
        };
        Insert: {
          archive_reason?: string | null;
          code: string;
          config_version?: number;
          created_at?: string;
          created_by: string;
          default_page_id?: string | null;
          id: string;
          is_discoverable?: boolean;
          lifecycle_state?: string;
          locale?: string | null;
          module_ids?: string[];
          name: string;
          parent_workspace_id?: string | null;
          region?: string | null;
          suspension_reason?: string | null;
          tenant_id: string;
          timezone?: string | null;
          type: string;
          updated_at?: string;
        };
        Update: {
          archive_reason?: string | null;
          code?: string;
          config_version?: number;
          created_at?: string;
          created_by?: string;
          default_page_id?: string | null;
          id?: string;
          is_discoverable?: boolean;
          lifecycle_state?: string;
          locale?: string | null;
          module_ids?: string[];
          name?: string;
          parent_workspace_id?: string | null;
          region?: string | null;
          suspension_reason?: string | null;
          tenant_id?: string;
          timezone?: string | null;
          type?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cg_workspace_parent_workspace_id_fkey";
            columns: ["parent_workspace_id"];
            isOneToOne: false;
            referencedRelation: "cg_workspace";
            referencedColumns: ["id"];
          },
        ];
      };
      cg_workspace_member: {
        Row: {
          actor_id: string;
          created_at: string;
          id: string;
          invited_by: string | null;
          member_role: string;
          state: string;
          tenant_id: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          actor_id: string;
          created_at?: string;
          id: string;
          invited_by?: string | null;
          member_role: string;
          state?: string;
          tenant_id: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          actor_id?: string;
          created_at?: string;
          id?: string;
          invited_by?: string | null;
          member_role?: string;
          state?: string;
          tenant_id?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "cg_workspace_member_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "cg_workspace";
            referencedColumns: ["id"];
          },
        ];
      };
      classes: {
        Row: {
          academic_year: string | null;
          capacity: number | null;
          created_at: string | null;
          grade_level: string | null;
          id: string;
          name: string;
          room: string | null;
          school_id: string;
          teacher_id: string | null;
        };
        Insert: {
          academic_year?: string | null;
          capacity?: number | null;
          created_at?: string | null;
          grade_level?: string | null;
          id?: string;
          name: string;
          room?: string | null;
          school_id: string;
          teacher_id?: string | null;
        };
        Update: {
          academic_year?: string | null;
          capacity?: number | null;
          created_at?: string | null;
          grade_level?: string | null;
          id?: string;
          name?: string;
          room?: string | null;
          school_id?: string;
          teacher_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "classes_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "classes_teacher_id_fkey";
            columns: ["teacher_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      clinic_visits: {
        Row: {
          attending_nurse: string | null;
          blood_pressure: string | null;
          complaint: string | null;
          created_at: string;
          diagnosis: string | null;
          follow_up_date: string | null;
          id: string;
          medication_given: string | null;
          notes: string | null;
          outcome: string | null;
          parent_notified: boolean;
          parent_notified_at: string | null;
          school_id: string;
          student_id: string | null;
          temperature: number | null;
          treatment: string | null;
          updated_at: string;
          visit_date: string;
          visit_time: string;
        };
        Insert: {
          attending_nurse?: string | null;
          blood_pressure?: string | null;
          complaint?: string | null;
          created_at?: string;
          diagnosis?: string | null;
          follow_up_date?: string | null;
          id?: string;
          medication_given?: string | null;
          notes?: string | null;
          outcome?: string | null;
          parent_notified?: boolean;
          parent_notified_at?: string | null;
          school_id: string;
          student_id?: string | null;
          temperature?: number | null;
          treatment?: string | null;
          updated_at?: string;
          visit_date?: string;
          visit_time?: string;
        };
        Update: {
          attending_nurse?: string | null;
          blood_pressure?: string | null;
          complaint?: string | null;
          created_at?: string;
          diagnosis?: string | null;
          follow_up_date?: string | null;
          id?: string;
          medication_given?: string | null;
          notes?: string | null;
          outcome?: string | null;
          parent_notified?: boolean;
          parent_notified_at?: string | null;
          school_id?: string;
          student_id?: string | null;
          temperature?: number | null;
          treatment?: string | null;
          updated_at?: string;
          visit_date?: string;
          visit_time?: string;
        };
        Relationships: [
          {
            foreignKeyName: "clinic_visits_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "clinic_visits_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
        ];
      };
      digital_twin_calls: {
        Row: {
          call_duration_seconds: number | null;
          call_outcome: string | null;
          call_recording_url: string | null;
          call_status: string;
          call_summary: string | null;
          call_transcript: string | null;
          call_type: string | null;
          created_at: string;
          ended_at: string | null;
          id: string;
          recipient_name: string | null;
          recipient_phone: string | null;
          recipient_role: string | null;
          scheduled_at: string | null;
          school_id: string;
          started_at: string | null;
          student_id: string | null;
          trigger_event: string | null;
          twilio_call_sid: string | null;
          twin_config_id: string | null;
        };
        Insert: {
          call_duration_seconds?: number | null;
          call_outcome?: string | null;
          call_recording_url?: string | null;
          call_status?: string;
          call_summary?: string | null;
          call_transcript?: string | null;
          call_type?: string | null;
          created_at?: string;
          ended_at?: string | null;
          id?: string;
          recipient_name?: string | null;
          recipient_phone?: string | null;
          recipient_role?: string | null;
          scheduled_at?: string | null;
          school_id: string;
          started_at?: string | null;
          student_id?: string | null;
          trigger_event?: string | null;
          twilio_call_sid?: string | null;
          twin_config_id?: string | null;
        };
        Update: {
          call_duration_seconds?: number | null;
          call_outcome?: string | null;
          call_recording_url?: string | null;
          call_status?: string;
          call_summary?: string | null;
          call_transcript?: string | null;
          call_type?: string | null;
          created_at?: string;
          ended_at?: string | null;
          id?: string;
          recipient_name?: string | null;
          recipient_phone?: string | null;
          recipient_role?: string | null;
          scheduled_at?: string | null;
          school_id?: string;
          started_at?: string | null;
          student_id?: string | null;
          trigger_event?: string | null;
          twilio_call_sid?: string | null;
          twin_config_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "digital_twin_calls_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "digital_twin_calls_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "digital_twin_calls_twin_config_id_fkey";
            columns: ["twin_config_id"];
            isOneToOne: false;
            referencedRelation: "digital_twin_config";
            referencedColumns: ["id"];
          },
        ];
      };
      digital_twin_config: {
        Row: {
          created_at: string;
          id: string;
          is_active: boolean;
          school_id: string;
          school_knowledge: Json;
          trigger_rules: Json;
          twin_name: string;
          twin_personality: string;
          twin_voice: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          school_id: string;
          school_knowledge?: Json;
          trigger_rules?: Json;
          twin_name?: string;
          twin_personality?: string;
          twin_voice?: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          school_id?: string;
          school_knowledge?: Json;
          trigger_rules?: Json;
          twin_name?: string;
          twin_personality?: string;
          twin_voice?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "digital_twin_config_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: true;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      discipline_records: {
        Row: {
          action_taken: string | null;
          created_at: string;
          description: string;
          follow_up_date: string | null;
          follow_up_required: boolean;
          id: string;
          incident_date: string;
          incident_type: string;
          notes: string | null;
          parent_notified: boolean;
          parent_notified_at: string | null;
          recorded_by: string | null;
          resolved: boolean;
          school_id: string;
          severity: string;
          student_id: string | null;
          updated_at: string;
        };
        Insert: {
          action_taken?: string | null;
          created_at?: string;
          description: string;
          follow_up_date?: string | null;
          follow_up_required?: boolean;
          id?: string;
          incident_date?: string;
          incident_type: string;
          notes?: string | null;
          parent_notified?: boolean;
          parent_notified_at?: string | null;
          recorded_by?: string | null;
          resolved?: boolean;
          school_id: string;
          severity?: string;
          student_id?: string | null;
          updated_at?: string;
        };
        Update: {
          action_taken?: string | null;
          created_at?: string;
          description?: string;
          follow_up_date?: string | null;
          follow_up_required?: boolean;
          id?: string;
          incident_date?: string;
          incident_type?: string;
          notes?: string | null;
          parent_notified?: boolean;
          parent_notified_at?: string | null;
          recorded_by?: string | null;
          resolved?: boolean;
          school_id?: string;
          severity?: string;
          student_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "discipline_records_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "discipline_records_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "discipline_records_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
        ];
      };
      events: {
        Row: {
          cover_image_url: string | null;
          created_at: string | null;
          created_by: string | null;
          description: string | null;
          end_date: string | null;
          end_time: string | null;
          event_date: string;
          event_time: string | null;
          event_type: string | null;
          id: string;
          is_published: boolean | null;
          location: string | null;
          school_id: string;
          target_audience: string | null;
          title: string;
        };
        Insert: {
          cover_image_url?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          description?: string | null;
          end_date?: string | null;
          end_time?: string | null;
          event_date: string;
          event_time?: string | null;
          event_type?: string | null;
          id?: string;
          is_published?: boolean | null;
          location?: string | null;
          school_id: string;
          target_audience?: string | null;
          title: string;
        };
        Update: {
          cover_image_url?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          description?: string | null;
          end_date?: string | null;
          end_time?: string | null;
          event_date?: string;
          event_time?: string | null;
          event_type?: string | null;
          id?: string;
          is_published?: boolean | null;
          location?: string | null;
          school_id?: string;
          target_audience?: string | null;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "events_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "events_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      faqs: {
        Row: {
          answer: string;
          category: string | null;
          created_at: string | null;
          id: string;
          is_published: boolean | null;
          order_index: number | null;
          question: string;
          school_id: string;
        };
        Insert: {
          answer: string;
          category?: string | null;
          created_at?: string | null;
          id?: string;
          is_published?: boolean | null;
          order_index?: number | null;
          question: string;
          school_id: string;
        };
        Update: {
          answer?: string;
          category?: string | null;
          created_at?: string | null;
          id?: string;
          is_published?: boolean | null;
          order_index?: number | null;
          question?: string;
          school_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "faqs_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      fees: {
        Row: {
          academic_year: string | null;
          amount: number;
          created_at: string | null;
          due_date: string | null;
          fee_type: string;
          id: string;
          paid_amount: number | null;
          paid_at: string | null;
          paystack_access_code: string | null;
          paystack_reference: string | null;
          school_id: string;
          status: string | null;
          student_id: string;
          term: string | null;
        };
        Insert: {
          academic_year?: string | null;
          amount: number;
          created_at?: string | null;
          due_date?: string | null;
          fee_type: string;
          id?: string;
          paid_amount?: number | null;
          paid_at?: string | null;
          paystack_access_code?: string | null;
          paystack_reference?: string | null;
          school_id: string;
          status?: string | null;
          student_id: string;
          term?: string | null;
        };
        Update: {
          academic_year?: string | null;
          amount?: number;
          created_at?: string | null;
          due_date?: string | null;
          fee_type?: string;
          id?: string;
          paid_amount?: number | null;
          paid_at?: string | null;
          paystack_access_code?: string | null;
          paystack_reference?: string | null;
          school_id?: string;
          status?: string | null;
          student_id?: string;
          term?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "fees_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fees_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
        ];
      };
      fraud_attempts: {
        Row: {
          attempted_by: string | null;
          captured_face_url: string | null;
          created_at: string | null;
          face_similarity: number | null;
          fraud_flags: Json | null;
          fraud_score: number | null;
          fraud_type: string | null;
          gps_latitude: number | null;
          gps_longitude: number | null;
          id: string;
          school_id: string;
          status: string | null;
        };
        Insert: {
          attempted_by?: string | null;
          captured_face_url?: string | null;
          created_at?: string | null;
          face_similarity?: number | null;
          fraud_flags?: Json | null;
          fraud_score?: number | null;
          fraud_type?: string | null;
          gps_latitude?: number | null;
          gps_longitude?: number | null;
          id?: string;
          school_id: string;
          status?: string | null;
        };
        Update: {
          attempted_by?: string | null;
          captured_face_url?: string | null;
          created_at?: string | null;
          face_similarity?: number | null;
          fraud_flags?: Json | null;
          fraud_score?: number | null;
          fraud_type?: string | null;
          gps_latitude?: number | null;
          gps_longitude?: number | null;
          id?: string;
          school_id?: string;
          status?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "fraud_attempts_attempted_by_fkey";
            columns: ["attempted_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "fraud_attempts_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      grades: {
        Row: {
          academic_year: string;
          ca_score: number | null;
          class_id: string | null;
          created_at: string | null;
          exam_score: number | null;
          grade: string | null;
          grade_remark: string | null;
          id: string;
          is_published: boolean | null;
          school_id: string;
          student_id: string;
          subject: string;
          teacher_id: string | null;
          term: string;
          total_score: number | null;
        };
        Insert: {
          academic_year: string;
          ca_score?: number | null;
          class_id?: string | null;
          created_at?: string | null;
          exam_score?: number | null;
          grade?: string | null;
          grade_remark?: string | null;
          id?: string;
          is_published?: boolean | null;
          school_id: string;
          student_id: string;
          subject: string;
          teacher_id?: string | null;
          term: string;
          total_score?: number | null;
        };
        Update: {
          academic_year?: string;
          ca_score?: number | null;
          class_id?: string | null;
          created_at?: string | null;
          exam_score?: number | null;
          grade?: string | null;
          grade_remark?: string | null;
          id?: string;
          is_published?: boolean | null;
          school_id?: string;
          student_id?: string;
          subject?: string;
          teacher_id?: string | null;
          term?: string;
          total_score?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "grades_class_id_fkey";
            columns: ["class_id"];
            isOneToOne: false;
            referencedRelation: "classes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "grades_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "grades_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "grades_teacher_id_fkey";
            columns: ["teacher_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      hostel_allocations: {
        Row: {
          allocated_at: string;
          bed_number: number | null;
          created_at: string;
          id: string;
          is_active: boolean;
          room_id: string | null;
          school_id: string;
          session: string | null;
          student_id: string | null;
          term: string | null;
          updated_at: string;
        };
        Insert: {
          allocated_at?: string;
          bed_number?: number | null;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          room_id?: string | null;
          school_id: string;
          session?: string | null;
          student_id?: string | null;
          term?: string | null;
          updated_at?: string;
        };
        Update: {
          allocated_at?: string;
          bed_number?: number | null;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          room_id?: string | null;
          school_id?: string;
          session?: string | null;
          student_id?: string | null;
          term?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "hostel_allocations_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "hostel_rooms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hostel_allocations_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hostel_allocations_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
        ];
      };
      hostel_attendance: {
        Row: {
          created_at: string;
          date: string;
          id: string;
          morning_check: string | null;
          night_check: string | null;
          notes: string | null;
          recorded_by: string | null;
          room_id: string | null;
          school_id: string;
          student_id: string | null;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          date?: string;
          id?: string;
          morning_check?: string | null;
          night_check?: string | null;
          notes?: string | null;
          recorded_by?: string | null;
          room_id?: string | null;
          school_id: string;
          student_id?: string | null;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          date?: string;
          id?: string;
          morning_check?: string | null;
          night_check?: string | null;
          notes?: string | null;
          recorded_by?: string | null;
          room_id?: string | null;
          school_id?: string;
          student_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "hostel_attendance_recorded_by_fkey";
            columns: ["recorded_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hostel_attendance_room_id_fkey";
            columns: ["room_id"];
            isOneToOne: false;
            referencedRelation: "hostel_rooms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hostel_attendance_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "hostel_attendance_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
        ];
      };
      hostel_rooms: {
        Row: {
          block: string | null;
          capacity: number;
          created_at: string;
          floor: string | null;
          gender: string | null;
          id: string;
          is_active: boolean;
          room_name: string;
          school_id: string;
          updated_at: string;
        };
        Insert: {
          block?: string | null;
          capacity?: number;
          created_at?: string;
          floor?: string | null;
          gender?: string | null;
          id?: string;
          is_active?: boolean;
          room_name: string;
          school_id: string;
          updated_at?: string;
        };
        Update: {
          block?: string | null;
          capacity?: number;
          created_at?: string;
          floor?: string | null;
          gender?: string | null;
          id?: string;
          is_active?: boolean;
          room_name?: string;
          school_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "hostel_rooms_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      lesson_plans: {
        Row: {
          activities: Json | null;
          admin_viewed: boolean | null;
          assessment_methods: Json | null;
          class_id: string | null;
          created_at: string | null;
          date_planned: string | null;
          description: string | null;
          duration_minutes: number | null;
          file_urls: Json | null;
          homework_assignment: string | null;
          id: string;
          learning_objectives: Json | null;
          materials_needed: Json | null;
          review_notes: string | null;
          school_id: string;
          status: string | null;
          subject: string | null;
          teacher_id: string;
          title: string;
          topic: string | null;
          updated_at: string | null;
        };
        Insert: {
          activities?: Json | null;
          admin_viewed?: boolean | null;
          assessment_methods?: Json | null;
          class_id?: string | null;
          created_at?: string | null;
          date_planned?: string | null;
          description?: string | null;
          duration_minutes?: number | null;
          file_urls?: Json | null;
          homework_assignment?: string | null;
          id?: string;
          learning_objectives?: Json | null;
          materials_needed?: Json | null;
          review_notes?: string | null;
          school_id: string;
          status?: string | null;
          subject?: string | null;
          teacher_id: string;
          title: string;
          topic?: string | null;
          updated_at?: string | null;
        };
        Update: {
          activities?: Json | null;
          admin_viewed?: boolean | null;
          assessment_methods?: Json | null;
          class_id?: string | null;
          created_at?: string | null;
          date_planned?: string | null;
          description?: string | null;
          duration_minutes?: number | null;
          file_urls?: Json | null;
          homework_assignment?: string | null;
          id?: string;
          learning_objectives?: Json | null;
          materials_needed?: Json | null;
          review_notes?: string | null;
          school_id?: string;
          status?: string | null;
          subject?: string | null;
          teacher_id?: string;
          title?: string;
          topic?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "lesson_plans_class_id_fkey";
            columns: ["class_id"];
            isOneToOne: false;
            referencedRelation: "classes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lesson_plans_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "lesson_plans_teacher_id_fkey";
            columns: ["teacher_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      library_books: {
        Row: {
          author: string | null;
          category: string | null;
          copies_available: number;
          copies_total: number;
          created_at: string;
          id: string;
          is_active: boolean;
          isbn: string | null;
          school_id: string;
          shelf_location: string | null;
          title: string;
          updated_at: string;
        };
        Insert: {
          author?: string | null;
          category?: string | null;
          copies_available?: number;
          copies_total?: number;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          isbn?: string | null;
          school_id: string;
          shelf_location?: string | null;
          title: string;
          updated_at?: string;
        };
        Update: {
          author?: string | null;
          category?: string | null;
          copies_available?: number;
          copies_total?: number;
          created_at?: string;
          id?: string;
          is_active?: boolean;
          isbn?: string | null;
          school_id?: string;
          shelf_location?: string | null;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "library_books_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      library_borrowings: {
        Row: {
          book_id: string | null;
          borrowed_date: string;
          created_at: string;
          due_date: string | null;
          fine_amount: number;
          id: string;
          notes: string | null;
          returned_date: string | null;
          school_id: string;
          status: string;
          student_id: string | null;
          updated_at: string;
        };
        Insert: {
          book_id?: string | null;
          borrowed_date?: string;
          created_at?: string;
          due_date?: string | null;
          fine_amount?: number;
          id?: string;
          notes?: string | null;
          returned_date?: string | null;
          school_id: string;
          status?: string;
          student_id?: string | null;
          updated_at?: string;
        };
        Update: {
          book_id?: string | null;
          borrowed_date?: string;
          created_at?: string;
          due_date?: string | null;
          fine_amount?: number;
          id?: string;
          notes?: string | null;
          returned_date?: string | null;
          school_id?: string;
          status?: string;
          student_id?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "library_borrowings_book_id_fkey";
            columns: ["book_id"];
            isOneToOne: false;
            referencedRelation: "library_books";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "library_borrowings_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "library_borrowings_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          attachment_name: string | null;
          attachment_size: number | null;
          attachment_url: string | null;
          body: string;
          created_at: string | null;
          id: string;
          is_read: boolean | null;
          parent_id: string | null;
          recipient_id: string;
          school_id: string;
          sender_id: string | null;
          subject: string | null;
          thread_id: string;
        };
        Insert: {
          attachment_name?: string | null;
          attachment_size?: number | null;
          attachment_url?: string | null;
          body: string;
          created_at?: string | null;
          id?: string;
          is_read?: boolean | null;
          parent_id?: string | null;
          recipient_id: string;
          school_id: string;
          sender_id?: string | null;
          subject?: string | null;
          thread_id?: string;
        };
        Update: {
          attachment_name?: string | null;
          attachment_size?: number | null;
          attachment_url?: string | null;
          body?: string;
          created_at?: string | null;
          id?: string;
          is_read?: boolean | null;
          parent_id?: string | null;
          recipient_id?: string;
          school_id?: string;
          sender_id?: string | null;
          subject?: string | null;
          thread_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_recipient_id_fkey";
            columns: ["recipient_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_sender_id_fkey";
            columns: ["sender_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      news: {
        Row: {
          author_id: string | null;
          category: string | null;
          content: string;
          cover_image_url: string | null;
          created_at: string | null;
          excerpt: string | null;
          id: string;
          is_pinned: boolean | null;
          is_published: boolean | null;
          published_at: string | null;
          school_id: string;
          target_audience: string | null;
          title: string;
          updated_at: string | null;
          view_count: number | null;
        };
        Insert: {
          author_id?: string | null;
          category?: string | null;
          content: string;
          cover_image_url?: string | null;
          created_at?: string | null;
          excerpt?: string | null;
          id?: string;
          is_pinned?: boolean | null;
          is_published?: boolean | null;
          published_at?: string | null;
          school_id: string;
          target_audience?: string | null;
          title: string;
          updated_at?: string | null;
          view_count?: number | null;
        };
        Update: {
          author_id?: string | null;
          category?: string | null;
          content?: string;
          cover_image_url?: string | null;
          created_at?: string | null;
          excerpt?: string | null;
          id?: string;
          is_pinned?: boolean | null;
          is_published?: boolean | null;
          published_at?: string | null;
          school_id?: string;
          target_audience?: string | null;
          title?: string;
          updated_at?: string | null;
          view_count?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "news_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "news_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      news_reads: {
        Row: {
          id: string;
          news_id: string;
          read_at: string | null;
          school_id: string;
          user_id: string;
        };
        Insert: {
          id?: string;
          news_id: string;
          read_at?: string | null;
          school_id: string;
          user_id: string;
        };
        Update: {
          id?: string;
          news_id?: string;
          read_at?: string | null;
          school_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "news_reads_news_id_fkey";
            columns: ["news_id"];
            isOneToOne: false;
            referencedRelation: "news";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "news_reads_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "news_reads_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      notification_preferences: {
        Row: {
          created_at: string;
          digest_frequency: string;
          email_announcements: boolean;
          email_attendance: boolean;
          email_fees: boolean;
          email_grades: boolean;
          email_messages: boolean;
          inapp_announcements: boolean;
          inapp_attendance: boolean;
          inapp_fees: boolean;
          inapp_grades: boolean;
          inapp_messages: boolean;
          quiet_hours_end: string | null;
          quiet_hours_start: string | null;
          school_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          digest_frequency?: string;
          email_announcements?: boolean;
          email_attendance?: boolean;
          email_fees?: boolean;
          email_grades?: boolean;
          email_messages?: boolean;
          inapp_announcements?: boolean;
          inapp_attendance?: boolean;
          inapp_fees?: boolean;
          inapp_grades?: boolean;
          inapp_messages?: boolean;
          quiet_hours_end?: string | null;
          quiet_hours_start?: string | null;
          school_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          digest_frequency?: string;
          email_announcements?: boolean;
          email_attendance?: boolean;
          email_fees?: boolean;
          email_grades?: boolean;
          email_messages?: boolean;
          inapp_announcements?: boolean;
          inapp_attendance?: boolean;
          inapp_fees?: boolean;
          inapp_grades?: boolean;
          inapp_messages?: boolean;
          quiet_hours_end?: string | null;
          quiet_hours_start?: string | null;
          school_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notification_preferences_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          action_url: string | null;
          created_at: string | null;
          id: string;
          is_read: boolean | null;
          message: string;
          school_id: string;
          title: string | null;
          type: string | null;
          user_id: string;
        };
        Insert: {
          action_url?: string | null;
          created_at?: string | null;
          id?: string;
          is_read?: boolean | null;
          message: string;
          school_id: string;
          title?: string | null;
          type?: string | null;
          user_id: string;
        };
        Update: {
          action_url?: string | null;
          created_at?: string | null;
          id?: string;
          is_read?: boolean | null;
          message?: string;
          school_id?: string;
          title?: string | null;
          type?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      organization_memberships: {
        Row: {
          created_at: string;
          id: string;
          is_active: boolean;
          is_primary: boolean;
          role: string;
          school_id: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          is_primary?: boolean;
          role: string;
          school_id: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_active?: boolean;
          is_primary?: boolean;
          role?: string;
          school_id?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organization_memberships_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      parent_student_map: {
        Row: {
          created_at: string | null;
          id: string;
          is_primary_contact: boolean | null;
          parent_id: string;
          relationship: string | null;
          school_id: string;
          student_id: string;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          is_primary_contact?: boolean | null;
          parent_id: string;
          relationship?: string | null;
          school_id: string;
          student_id: string;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          is_primary_contact?: boolean | null;
          parent_id?: string;
          relationship?: string | null;
          school_id?: string;
          student_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "parent_student_map_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "parent_student_map_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "parent_student_map_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_complaints: {
        Row: {
          attachments: Json;
          complaint_type: string;
          created_at: string;
          description: string;
          id: string;
          priority: string | null;
          resolved_at: string | null;
          responded_at: string | null;
          responded_by: string | null;
          school_id: string;
          status: string | null;
          subject: string;
          submitted_by: string;
          super_admin_response: string | null;
          updated_at: string;
        };
        Insert: {
          attachments?: Json;
          complaint_type: string;
          created_at?: string;
          description: string;
          id?: string;
          priority?: string | null;
          resolved_at?: string | null;
          responded_at?: string | null;
          responded_by?: string | null;
          school_id: string;
          status?: string | null;
          subject: string;
          submitted_by: string;
          super_admin_response?: string | null;
          updated_at?: string;
        };
        Update: {
          attachments?: Json;
          complaint_type?: string;
          created_at?: string;
          description?: string;
          id?: string;
          priority?: string | null;
          resolved_at?: string | null;
          responded_at?: string | null;
          responded_by?: string | null;
          school_id?: string;
          status?: string | null;
          subject?: string;
          submitted_by?: string;
          super_admin_response?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "platform_complaints_responded_by_fkey";
            columns: ["responded_by"];
            isOneToOne: false;
            referencedRelation: "super_admins";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "platform_complaints_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "platform_complaints_submitted_by_fkey";
            columns: ["submitted_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      platform_config: {
        Row: {
          id: string;
          key: string;
          updated_at: string | null;
          updated_by: string | null;
          value: Json;
        };
        Insert: {
          id?: string;
          key: string;
          updated_at?: string | null;
          updated_by?: string | null;
          value: Json;
        };
        Update: {
          id?: string;
          key?: string;
          updated_at?: string | null;
          updated_by?: string | null;
          value?: Json;
        };
        Relationships: [];
      };
      qr_tokens: {
        Row: {
          created_at: string | null;
          created_by: string | null;
          expires_at: string;
          id: string;
          payload: Json | null;
          school_id: string;
          token: string;
          type: string | null;
          used: boolean | null;
        };
        Insert: {
          created_at?: string | null;
          created_by?: string | null;
          expires_at: string;
          id?: string;
          payload?: Json | null;
          school_id: string;
          token: string;
          type?: string | null;
          used?: boolean | null;
        };
        Update: {
          created_at?: string | null;
          created_by?: string | null;
          expires_at?: string;
          id?: string;
          payload?: Json | null;
          school_id?: string;
          token?: string;
          type?: string | null;
          used?: boolean | null;
        };
        Relationships: [
          {
            foreignKeyName: "qr_tokens_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      school_ad_campaigns: {
        Row: {
          admission_inquiries: number | null;
          budget_naira: number;
          campaign_duration_days: number;
          campaign_name: string;
          campaign_objective: string | null;
          campaign_type: string;
          clicks: number | null;
          created_at: string;
          created_by: string | null;
          id: string;
          impressions: number | null;
          leads_generated: number | null;
          reach: number | null;
          rejection_reason: string | null;
          school_id: string;
          start_date: string | null;
          status: string | null;
          target_age_group: string | null;
          target_location: string | null;
          target_platform: string;
          target_radius_km: number | null;
          updated_at: string;
          vibeora_notes: string | null;
        };
        Insert: {
          admission_inquiries?: number | null;
          budget_naira: number;
          campaign_duration_days: number;
          campaign_name: string;
          campaign_objective?: string | null;
          campaign_type: string;
          clicks?: number | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          impressions?: number | null;
          leads_generated?: number | null;
          reach?: number | null;
          rejection_reason?: string | null;
          school_id: string;
          start_date?: string | null;
          status?: string | null;
          target_age_group?: string | null;
          target_location?: string | null;
          target_platform: string;
          target_radius_km?: number | null;
          updated_at?: string;
          vibeora_notes?: string | null;
        };
        Update: {
          admission_inquiries?: number | null;
          budget_naira?: number;
          campaign_duration_days?: number;
          campaign_name?: string;
          campaign_objective?: string | null;
          campaign_type?: string;
          clicks?: number | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          impressions?: number | null;
          leads_generated?: number | null;
          reach?: number | null;
          rejection_reason?: string | null;
          school_id?: string;
          start_date?: string | null;
          status?: string | null;
          target_age_group?: string | null;
          target_location?: string | null;
          target_platform?: string;
          target_radius_km?: number | null;
          updated_at?: string;
          vibeora_notes?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "school_ad_campaigns_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "school_ad_campaigns_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      school_api_keys: {
        Row: {
          active_payment_provider: string | null;
          africas_talking_key_encrypted: string | null;
          africas_talking_username: string | null;
          created_at: string | null;
          flutterwave_public_key: string | null;
          flutterwave_secret_key_encrypted: string | null;
          id: string;
          paystack_public_key: string | null;
          paystack_secret_key_encrypted: string | null;
          school_id: string;
          stripe_publishable_key: string | null;
          stripe_secret_key_encrypted: string | null;
          updated_at: string | null;
          whatsapp_phone_id: string | null;
          whatsapp_token_encrypted: string | null;
        };
        Insert: {
          active_payment_provider?: string | null;
          africas_talking_key_encrypted?: string | null;
          africas_talking_username?: string | null;
          created_at?: string | null;
          flutterwave_public_key?: string | null;
          flutterwave_secret_key_encrypted?: string | null;
          id?: string;
          paystack_public_key?: string | null;
          paystack_secret_key_encrypted?: string | null;
          school_id: string;
          stripe_publishable_key?: string | null;
          stripe_secret_key_encrypted?: string | null;
          updated_at?: string | null;
          whatsapp_phone_id?: string | null;
          whatsapp_token_encrypted?: string | null;
        };
        Update: {
          active_payment_provider?: string | null;
          africas_talking_key_encrypted?: string | null;
          africas_talking_username?: string | null;
          created_at?: string | null;
          flutterwave_public_key?: string | null;
          flutterwave_secret_key_encrypted?: string | null;
          id?: string;
          paystack_public_key?: string | null;
          paystack_secret_key_encrypted?: string | null;
          school_id?: string;
          stripe_publishable_key?: string | null;
          stripe_secret_key_encrypted?: string | null;
          updated_at?: string | null;
          whatsapp_phone_id?: string | null;
          whatsapp_token_encrypted?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "school_api_keys_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: true;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      school_calendar: {
        Row: {
          all_day: boolean | null;
          color: string | null;
          created_at: string | null;
          created_by: string | null;
          description: string | null;
          end_date: string | null;
          end_time: string | null;
          event_type: string | null;
          id: string;
          location: string | null;
          school_id: string;
          start_date: string;
          start_time: string | null;
          target_audience: string | null;
          title: string;
        };
        Insert: {
          all_day?: boolean | null;
          color?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          description?: string | null;
          end_date?: string | null;
          end_time?: string | null;
          event_type?: string | null;
          id?: string;
          location?: string | null;
          school_id: string;
          start_date: string;
          start_time?: string | null;
          target_audience?: string | null;
          title: string;
        };
        Update: {
          all_day?: boolean | null;
          color?: string | null;
          created_at?: string | null;
          created_by?: string | null;
          description?: string | null;
          end_date?: string | null;
          end_time?: string | null;
          event_type?: string | null;
          id?: string;
          location?: string | null;
          school_id?: string;
          start_date?: string;
          start_time?: string | null;
          target_audience?: string | null;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "school_calendar_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "school_calendar_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      school_expense_budgets: {
        Row: {
          academic_year: string;
          category: string;
          created_at: string;
          id: string;
          monthly_budget: number;
          school_id: string;
          updated_at: string;
        };
        Insert: {
          academic_year: string;
          category: string;
          created_at?: string;
          id?: string;
          monthly_budget: number;
          school_id: string;
          updated_at?: string;
        };
        Update: {
          academic_year?: string;
          category?: string;
          created_at?: string;
          id?: string;
          monthly_budget?: number;
          school_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "school_expense_budgets_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      school_expenses: {
        Row: {
          amount: number;
          approved_by: string | null;
          created_at: string;
          created_by: string | null;
          currency: string | null;
          description: string | null;
          expense_category: string;
          expense_date: string;
          expense_title: string;
          id: string;
          is_recurring: boolean | null;
          payment_method: string | null;
          receipt_url: string | null;
          recurring_frequency: string | null;
          school_id: string;
          tags: string[] | null;
          updated_at: string;
          vendor_name: string | null;
        };
        Insert: {
          amount: number;
          approved_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string | null;
          description?: string | null;
          expense_category: string;
          expense_date: string;
          expense_title: string;
          id?: string;
          is_recurring?: boolean | null;
          payment_method?: string | null;
          receipt_url?: string | null;
          recurring_frequency?: string | null;
          school_id: string;
          tags?: string[] | null;
          updated_at?: string;
          vendor_name?: string | null;
        };
        Update: {
          amount?: number;
          approved_by?: string | null;
          created_at?: string;
          created_by?: string | null;
          currency?: string | null;
          description?: string | null;
          expense_category?: string;
          expense_date?: string;
          expense_title?: string;
          id?: string;
          is_recurring?: boolean | null;
          payment_method?: string | null;
          receipt_url?: string | null;
          recurring_frequency?: string | null;
          school_id?: string;
          tags?: string[] | null;
          updated_at?: string;
          vendor_name?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "school_expenses_approved_by_fkey";
            columns: ["approved_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "school_expenses_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "school_expenses_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      school_facilities: {
        Row: {
          created_at: string | null;
          description: string | null;
          icon: string | null;
          id: string;
          image_url: string | null;
          is_published: boolean | null;
          name: string;
          order_index: number | null;
          school_id: string;
        };
        Insert: {
          created_at?: string | null;
          description?: string | null;
          icon?: string | null;
          id?: string;
          image_url?: string | null;
          is_published?: boolean | null;
          name: string;
          order_index?: number | null;
          school_id: string;
        };
        Update: {
          created_at?: string | null;
          description?: string | null;
          icon?: string | null;
          id?: string;
          image_url?: string | null;
          is_published?: boolean | null;
          name?: string;
          order_index?: number | null;
          school_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "school_facilities_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      school_gallery: {
        Row: {
          caption: string | null;
          created_at: string | null;
          id: string;
          image_url: string;
          is_published: boolean | null;
          order_index: number | null;
          school_id: string;
          title: string | null;
          updated_at: string | null;
        };
        Insert: {
          caption?: string | null;
          created_at?: string | null;
          id?: string;
          image_url: string;
          is_published?: boolean | null;
          order_index?: number | null;
          school_id: string;
          title?: string | null;
          updated_at?: string | null;
        };
        Update: {
          caption?: string | null;
          created_at?: string | null;
          id?: string;
          image_url?: string;
          is_published?: boolean | null;
          order_index?: number | null;
          school_id?: string;
          title?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "school_gallery_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      school_geofence: {
        Row: {
          campus_name: string | null;
          created_at: string | null;
          id: string;
          is_active: boolean | null;
          latitude: number;
          longitude: number;
          radius_meters: number | null;
          school_id: string;
        };
        Insert: {
          campus_name?: string | null;
          created_at?: string | null;
          id?: string;
          is_active?: boolean | null;
          latitude: number;
          longitude: number;
          radius_meters?: number | null;
          school_id: string;
        };
        Update: {
          campus_name?: string | null;
          created_at?: string | null;
          id?: string;
          is_active?: boolean | null;
          latitude?: number;
          longitude?: number;
          radius_meters?: number | null;
          school_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "school_geofence_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      school_meals: {
        Row: {
          allergy_accommodation_detail: string | null;
          breakfast_enabled: boolean | null;
          breakfast_menu_description: string | null;
          breakfast_time: string | null;
          created_at: string;
          dietitian_on_staff: boolean | null;
          has_allergy_accommodation: boolean | null;
          has_halal_option: boolean | null;
          has_vegetarian_option: boolean | null;
          hygiene_certification: string | null;
          id: string;
          last_inspection_date: string | null;
          lunch_enabled: boolean | null;
          lunch_menu_description: string | null;
          lunch_time: string | null;
          meal_fee_currency: string | null;
          meal_provider: string | null;
          meal_provider_type: string | null;
          meal_rating_by_students: string | null;
          meal_service_enabled: boolean | null;
          monthly_meal_fee: number | null;
          school_id: string;
          snack_enabled: boolean | null;
          snack_time: string | null;
          updated_at: string;
        };
        Insert: {
          allergy_accommodation_detail?: string | null;
          breakfast_enabled?: boolean | null;
          breakfast_menu_description?: string | null;
          breakfast_time?: string | null;
          created_at?: string;
          dietitian_on_staff?: boolean | null;
          has_allergy_accommodation?: boolean | null;
          has_halal_option?: boolean | null;
          has_vegetarian_option?: boolean | null;
          hygiene_certification?: string | null;
          id?: string;
          last_inspection_date?: string | null;
          lunch_enabled?: boolean | null;
          lunch_menu_description?: string | null;
          lunch_time?: string | null;
          meal_fee_currency?: string | null;
          meal_provider?: string | null;
          meal_provider_type?: string | null;
          meal_rating_by_students?: string | null;
          meal_service_enabled?: boolean | null;
          monthly_meal_fee?: number | null;
          school_id: string;
          snack_enabled?: boolean | null;
          snack_time?: string | null;
          updated_at?: string;
        };
        Update: {
          allergy_accommodation_detail?: string | null;
          breakfast_enabled?: boolean | null;
          breakfast_menu_description?: string | null;
          breakfast_time?: string | null;
          created_at?: string;
          dietitian_on_staff?: boolean | null;
          has_allergy_accommodation?: boolean | null;
          has_halal_option?: boolean | null;
          has_vegetarian_option?: boolean | null;
          hygiene_certification?: string | null;
          id?: string;
          last_inspection_date?: string | null;
          lunch_enabled?: boolean | null;
          lunch_menu_description?: string | null;
          lunch_time?: string | null;
          meal_fee_currency?: string | null;
          meal_provider?: string | null;
          meal_provider_type?: string | null;
          meal_rating_by_students?: string | null;
          meal_service_enabled?: boolean | null;
          monthly_meal_fee?: number | null;
          school_id?: string;
          snack_enabled?: boolean | null;
          snack_time?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "school_meals_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: true;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      school_sports: {
        Row: {
          achievements: string | null;
          age_groups: string | null;
          coach_name: string | null;
          coach_qualification: string | null;
          created_at: string;
          facilities_description: string | null;
          gender_category: string | null;
          id: string;
          is_active: boolean | null;
          order_index: number | null;
          school_id: string;
          sport_category: string | null;
          sport_name: string;
          training_days: string | null;
          training_time: string | null;
          updated_at: string;
        };
        Insert: {
          achievements?: string | null;
          age_groups?: string | null;
          coach_name?: string | null;
          coach_qualification?: string | null;
          created_at?: string;
          facilities_description?: string | null;
          gender_category?: string | null;
          id?: string;
          is_active?: boolean | null;
          order_index?: number | null;
          school_id: string;
          sport_category?: string | null;
          sport_name: string;
          training_days?: string | null;
          training_time?: string | null;
          updated_at?: string;
        };
        Update: {
          achievements?: string | null;
          age_groups?: string | null;
          coach_name?: string | null;
          coach_qualification?: string | null;
          created_at?: string;
          facilities_description?: string | null;
          gender_category?: string | null;
          id?: string;
          is_active?: boolean | null;
          order_index?: number | null;
          school_id?: string;
          sport_category?: string | null;
          sport_name?: string;
          training_days?: string | null;
          training_time?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "school_sports_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      school_staff: {
        Row: {
          avatar_url: string | null;
          bio: string | null;
          created_at: string | null;
          full_name: string;
          id: string;
          is_published: boolean | null;
          order_index: number | null;
          qualification: string | null;
          role: string | null;
          school_id: string;
          subject_specialty: string | null;
          updated_at: string | null;
          years_experience: number | null;
        };
        Insert: {
          avatar_url?: string | null;
          bio?: string | null;
          created_at?: string | null;
          full_name: string;
          id?: string;
          is_published?: boolean | null;
          order_index?: number | null;
          qualification?: string | null;
          role?: string | null;
          school_id: string;
          subject_specialty?: string | null;
          updated_at?: string | null;
          years_experience?: number | null;
        };
        Update: {
          avatar_url?: string | null;
          bio?: string | null;
          created_at?: string | null;
          full_name?: string;
          id?: string;
          is_published?: boolean | null;
          order_index?: number | null;
          qualification?: string | null;
          role?: string | null;
          school_id?: string;
          subject_specialty?: string | null;
          updated_at?: string | null;
          years_experience?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "school_staff_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      school_staff_types: {
        Row: {
          created_at: string;
          id: string;
          is_enabled: boolean | null;
          notes: string | null;
          order_index: number | null;
          school_id: string;
          staff_count: number | null;
          staff_type: string;
          staff_type_category: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          is_enabled?: boolean | null;
          notes?: string | null;
          order_index?: number | null;
          school_id: string;
          staff_count?: number | null;
          staff_type: string;
          staff_type_category: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          is_enabled?: boolean | null;
          notes?: string | null;
          order_index?: number | null;
          school_id?: string;
          staff_count?: number | null;
          staff_type?: string;
          staff_type_category?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "school_staff_types_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      school_transport: {
        Row: {
          afternoon_departure_time: string | null;
          annual_transport_fee: number | null;
          buses_air_conditioned: boolean | null;
          coverage_areas: string | null;
          created_at: string;
          driver_background_checked: boolean | null;
          fleet_size: number | null;
          id: string;
          live_tracking_enabled: boolean | null;
          monthly_transport_fee: number | null;
          morning_arrival_time: string | null;
          morning_pickup_start: string | null;
          parent_tracking_app: string | null;
          provider_type: string | null;
          safety_features: string | null;
          school_id: string;
          tracking_provider: string | null;
          transport_enabled: boolean | null;
          transport_provider: string | null;
          updated_at: string;
        };
        Insert: {
          afternoon_departure_time?: string | null;
          annual_transport_fee?: number | null;
          buses_air_conditioned?: boolean | null;
          coverage_areas?: string | null;
          created_at?: string;
          driver_background_checked?: boolean | null;
          fleet_size?: number | null;
          id?: string;
          live_tracking_enabled?: boolean | null;
          monthly_transport_fee?: number | null;
          morning_arrival_time?: string | null;
          morning_pickup_start?: string | null;
          parent_tracking_app?: string | null;
          provider_type?: string | null;
          safety_features?: string | null;
          school_id: string;
          tracking_provider?: string | null;
          transport_enabled?: boolean | null;
          transport_provider?: string | null;
          updated_at?: string;
        };
        Update: {
          afternoon_departure_time?: string | null;
          annual_transport_fee?: number | null;
          buses_air_conditioned?: boolean | null;
          coverage_areas?: string | null;
          created_at?: string;
          driver_background_checked?: boolean | null;
          fleet_size?: number | null;
          id?: string;
          live_tracking_enabled?: boolean | null;
          monthly_transport_fee?: number | null;
          morning_arrival_time?: string | null;
          morning_pickup_start?: string | null;
          parent_tracking_app?: string | null;
          provider_type?: string | null;
          safety_features?: string | null;
          school_id?: string;
          tracking_provider?: string | null;
          transport_enabled?: boolean | null;
          transport_provider?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "school_transport_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: true;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      schools: {
        Row: {
          about: string | null;
          active_features: Json | null;
          address: string | null;
          admission_deadline: string | null;
          admission_requirements: string | null;
          admission_timeline: Json | null;
          created_at: string | null;
          domain: string | null;
          email: string | null;
          facebook_url: string | null;
          founded_year: number | null;
          geofence: Json | null;
          geofence_latitude: number | null;
          geofence_longitude: number | null;
          geofence_radius_meters: number | null;
          google_maps_embed_url: string | null;
          hero_cta_text: string | null;
          hero_headline: string | null;
          hero_subheadline: string | null;
          id: string;
          instagram_url: string | null;
          is_active: boolean | null;
          logo_url: string | null;
          max_students: number | null;
          max_teachers: number | null;
          monthly_fee: number | null;
          motto: string | null;
          name: string;
          office_hours: string | null;
          onboarding_completed: boolean | null;
          paystack_public_key: string | null;
          paystack_secret_key: string | null;
          phone: string | null;
          primary_color: string | null;
          privacy_policy: string | null;
          school_days: Json | null;
          school_mission: string | null;
          school_rules: string | null;
          school_vision: string | null;
          secondary_color: string | null;
          section_about_enabled: boolean | null;
          section_admissions_enabled: boolean | null;
          section_blog_enabled: boolean | null;
          section_contact_enabled: boolean | null;
          section_facilities_enabled: boolean | null;
          section_faculty_enabled: boolean | null;
          section_faqs_enabled: boolean | null;
          section_hero_enabled: boolean | null;
          section_news_enabled: boolean | null;
          section_privacy_enabled: boolean | null;
          section_programs_enabled: boolean | null;
          section_rules_enabled: boolean | null;
          section_testimonials_enabled: boolean | null;
          section_why_us_enabled: boolean | null;
          show_map_on_website: boolean | null;
          slug: string;
          social_facebook_url: string | null;
          social_instagram_url: string | null;
          social_linkedin_url: string | null;
          social_media_enabled: boolean;
          social_tiktok_url: string | null;
          social_twitter_url: string | null;
          social_youtube_url: string | null;
          subscription_expires_at: string | null;
          subscription_status: string | null;
          subscription_tier: string | null;
          terms_conditions: string | null;
          twitter_url: string | null;
          updated_at: string | null;
          website_url: string | null;
        };
        Insert: {
          about?: string | null;
          active_features?: Json | null;
          address?: string | null;
          admission_deadline?: string | null;
          admission_requirements?: string | null;
          admission_timeline?: Json | null;
          created_at?: string | null;
          domain?: string | null;
          email?: string | null;
          facebook_url?: string | null;
          founded_year?: number | null;
          geofence?: Json | null;
          geofence_latitude?: number | null;
          geofence_longitude?: number | null;
          geofence_radius_meters?: number | null;
          google_maps_embed_url?: string | null;
          hero_cta_text?: string | null;
          hero_headline?: string | null;
          hero_subheadline?: string | null;
          id?: string;
          instagram_url?: string | null;
          is_active?: boolean | null;
          logo_url?: string | null;
          max_students?: number | null;
          max_teachers?: number | null;
          monthly_fee?: number | null;
          motto?: string | null;
          name: string;
          office_hours?: string | null;
          onboarding_completed?: boolean | null;
          paystack_public_key?: string | null;
          paystack_secret_key?: string | null;
          phone?: string | null;
          primary_color?: string | null;
          privacy_policy?: string | null;
          school_days?: Json | null;
          school_mission?: string | null;
          school_rules?: string | null;
          school_vision?: string | null;
          secondary_color?: string | null;
          section_about_enabled?: boolean | null;
          section_admissions_enabled?: boolean | null;
          section_blog_enabled?: boolean | null;
          section_contact_enabled?: boolean | null;
          section_facilities_enabled?: boolean | null;
          section_faculty_enabled?: boolean | null;
          section_faqs_enabled?: boolean | null;
          section_hero_enabled?: boolean | null;
          section_news_enabled?: boolean | null;
          section_privacy_enabled?: boolean | null;
          section_programs_enabled?: boolean | null;
          section_rules_enabled?: boolean | null;
          section_testimonials_enabled?: boolean | null;
          section_why_us_enabled?: boolean | null;
          show_map_on_website?: boolean | null;
          slug: string;
          social_facebook_url?: string | null;
          social_instagram_url?: string | null;
          social_linkedin_url?: string | null;
          social_media_enabled?: boolean;
          social_tiktok_url?: string | null;
          social_twitter_url?: string | null;
          social_youtube_url?: string | null;
          subscription_expires_at?: string | null;
          subscription_status?: string | null;
          subscription_tier?: string | null;
          terms_conditions?: string | null;
          twitter_url?: string | null;
          updated_at?: string | null;
          website_url?: string | null;
        };
        Update: {
          about?: string | null;
          active_features?: Json | null;
          address?: string | null;
          admission_deadline?: string | null;
          admission_requirements?: string | null;
          admission_timeline?: Json | null;
          created_at?: string | null;
          domain?: string | null;
          email?: string | null;
          facebook_url?: string | null;
          founded_year?: number | null;
          geofence?: Json | null;
          geofence_latitude?: number | null;
          geofence_longitude?: number | null;
          geofence_radius_meters?: number | null;
          google_maps_embed_url?: string | null;
          hero_cta_text?: string | null;
          hero_headline?: string | null;
          hero_subheadline?: string | null;
          id?: string;
          instagram_url?: string | null;
          is_active?: boolean | null;
          logo_url?: string | null;
          max_students?: number | null;
          max_teachers?: number | null;
          monthly_fee?: number | null;
          motto?: string | null;
          name?: string;
          office_hours?: string | null;
          onboarding_completed?: boolean | null;
          paystack_public_key?: string | null;
          paystack_secret_key?: string | null;
          phone?: string | null;
          primary_color?: string | null;
          privacy_policy?: string | null;
          school_days?: Json | null;
          school_mission?: string | null;
          school_rules?: string | null;
          school_vision?: string | null;
          secondary_color?: string | null;
          section_about_enabled?: boolean | null;
          section_admissions_enabled?: boolean | null;
          section_blog_enabled?: boolean | null;
          section_contact_enabled?: boolean | null;
          section_facilities_enabled?: boolean | null;
          section_faculty_enabled?: boolean | null;
          section_faqs_enabled?: boolean | null;
          section_hero_enabled?: boolean | null;
          section_news_enabled?: boolean | null;
          section_privacy_enabled?: boolean | null;
          section_programs_enabled?: boolean | null;
          section_rules_enabled?: boolean | null;
          section_testimonials_enabled?: boolean | null;
          section_why_us_enabled?: boolean | null;
          show_map_on_website?: boolean | null;
          slug?: string;
          social_facebook_url?: string | null;
          social_instagram_url?: string | null;
          social_linkedin_url?: string | null;
          social_media_enabled?: boolean;
          social_tiktok_url?: string | null;
          social_twitter_url?: string | null;
          social_youtube_url?: string | null;
          subscription_expires_at?: string | null;
          subscription_status?: string | null;
          subscription_tier?: string | null;
          terms_conditions?: string | null;
          twitter_url?: string | null;
          updated_at?: string | null;
          website_url?: string | null;
        };
        Relationships: [];
      };
      staff_leave: {
        Row: {
          approved_at: string | null;
          approved_by: string | null;
          created_at: string | null;
          days_requested: number | null;
          end_date: string;
          id: string;
          leave_type: string;
          notes: string | null;
          reason: string | null;
          school_id: string;
          start_date: string;
          status: string | null;
          user_id: string | null;
        };
        Insert: {
          approved_at?: string | null;
          approved_by?: string | null;
          created_at?: string | null;
          days_requested?: number | null;
          end_date: string;
          id?: string;
          leave_type: string;
          notes?: string | null;
          reason?: string | null;
          school_id: string;
          start_date: string;
          status?: string | null;
          user_id?: string | null;
        };
        Update: {
          approved_at?: string | null;
          approved_by?: string | null;
          created_at?: string | null;
          days_requested?: number | null;
          end_date?: string;
          id?: string;
          leave_type?: string;
          notes?: string | null;
          reason?: string | null;
          school_id?: string;
          start_date?: string;
          status?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "staff_leave_approved_by_fkey";
            columns: ["approved_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "staff_leave_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "staff_leave_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      staff_payroll: {
        Row: {
          approved_by: string | null;
          basic_salary: number;
          created_at: string | null;
          gross_salary: number | null;
          housing_allowance: number | null;
          id: string;
          loan_deduction: number | null;
          month: number;
          net_salary: number | null;
          other_allowances: number | null;
          other_deductions: number | null;
          payment_date: string | null;
          pension_deduction: number | null;
          school_id: string;
          status: string | null;
          tax_deduction: number | null;
          transport_allowance: number | null;
          user_id: string | null;
          year: number;
        };
        Insert: {
          approved_by?: string | null;
          basic_salary?: number;
          created_at?: string | null;
          gross_salary?: number | null;
          housing_allowance?: number | null;
          id?: string;
          loan_deduction?: number | null;
          month: number;
          net_salary?: number | null;
          other_allowances?: number | null;
          other_deductions?: number | null;
          payment_date?: string | null;
          pension_deduction?: number | null;
          school_id: string;
          status?: string | null;
          tax_deduction?: number | null;
          transport_allowance?: number | null;
          user_id?: string | null;
          year: number;
        };
        Update: {
          approved_by?: string | null;
          basic_salary?: number;
          created_at?: string | null;
          gross_salary?: number | null;
          housing_allowance?: number | null;
          id?: string;
          loan_deduction?: number | null;
          month?: number;
          net_salary?: number | null;
          other_allowances?: number | null;
          other_deductions?: number | null;
          payment_date?: string | null;
          pension_deduction?: number | null;
          school_id?: string;
          status?: string | null;
          tax_deduction?: number | null;
          transport_allowance?: number | null;
          user_id?: string | null;
          year?: number;
        };
        Relationships: [
          {
            foreignKeyName: "staff_payroll_approved_by_fkey";
            columns: ["approved_by"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "staff_payroll_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "staff_payroll_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      student_platform_fee_ledger: {
        Row: {
          academic_year: string;
          amount: number;
          collected_at: string | null;
          created_at: string;
          fee_type: string;
          id: string;
          payment_reference: string | null;
          school_id: string;
          status: string;
          student_id: string | null;
          term: string;
          updated_at: string;
        };
        Insert: {
          academic_year: string;
          amount?: number;
          collected_at?: string | null;
          created_at?: string;
          fee_type?: string;
          id?: string;
          payment_reference?: string | null;
          school_id: string;
          status?: string;
          student_id?: string | null;
          term: string;
          updated_at?: string;
        };
        Update: {
          academic_year?: string;
          amount?: number;
          collected_at?: string | null;
          created_at?: string;
          fee_type?: string;
          id?: string;
          payment_reference?: string | null;
          school_id?: string;
          status?: string;
          student_id?: string | null;
          term?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "student_platform_fee_ledger_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "student_platform_fee_ledger_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
        ];
      };
      students: {
        Row: {
          admission_number: string | null;
          blood_group: string | null;
          class_id: string | null;
          created_at: string | null;
          date_of_birth: string | null;
          disability_notes: string | null;
          enrollment_date: string | null;
          gender: string | null;
          genotype: string | null;
          home_address: string | null;
          id: string;
          is_active: boolean | null;
          lga: string | null;
          medical_conditions: string | null;
          nationality: string | null;
          parent_email: string | null;
          parent_id: string | null;
          parent_name: string | null;
          parent_phone: string | null;
          previous_school: string | null;
          religion: string | null;
          school_id: string;
          state_of_origin: string | null;
          user_id: string | null;
        };
        Insert: {
          admission_number?: string | null;
          blood_group?: string | null;
          class_id?: string | null;
          created_at?: string | null;
          date_of_birth?: string | null;
          disability_notes?: string | null;
          enrollment_date?: string | null;
          gender?: string | null;
          genotype?: string | null;
          home_address?: string | null;
          id?: string;
          is_active?: boolean | null;
          lga?: string | null;
          medical_conditions?: string | null;
          nationality?: string | null;
          parent_email?: string | null;
          parent_id?: string | null;
          parent_name?: string | null;
          parent_phone?: string | null;
          previous_school?: string | null;
          religion?: string | null;
          school_id: string;
          state_of_origin?: string | null;
          user_id?: string | null;
        };
        Update: {
          admission_number?: string | null;
          blood_group?: string | null;
          class_id?: string | null;
          created_at?: string | null;
          date_of_birth?: string | null;
          disability_notes?: string | null;
          enrollment_date?: string | null;
          gender?: string | null;
          genotype?: string | null;
          home_address?: string | null;
          id?: string;
          is_active?: boolean | null;
          lga?: string | null;
          medical_conditions?: string | null;
          nationality?: string | null;
          parent_email?: string | null;
          parent_id?: string | null;
          parent_name?: string | null;
          parent_phone?: string | null;
          previous_school?: string | null;
          religion?: string | null;
          school_id?: string;
          state_of_origin?: string | null;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "students_class_id_fkey";
            columns: ["class_id"];
            isOneToOne: false;
            referencedRelation: "classes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "students_parent_id_fkey";
            columns: ["parent_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "students_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "students_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      study_sessions: {
        Row: {
          created_at: string | null;
          duration_minutes: number | null;
          id: string;
          school_id: string;
          session_date: string | null;
          student_id: string | null;
          subject: string | null;
        };
        Insert: {
          created_at?: string | null;
          duration_minutes?: number | null;
          id?: string;
          school_id: string;
          session_date?: string | null;
          student_id?: string | null;
          subject?: string | null;
        };
        Update: {
          created_at?: string | null;
          duration_minutes?: number | null;
          id?: string;
          school_id?: string;
          session_date?: string | null;
          student_id?: string | null;
          subject?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "study_sessions_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "study_sessions_student_id_fkey";
            columns: ["student_id"];
            isOneToOne: false;
            referencedRelation: "students";
            referencedColumns: ["id"];
          },
        ];
      };
      subscriptions: {
        Row: {
          amount_paid: number | null;
          created_at: string | null;
          expires_at: string | null;
          id: string;
          paystack_reference: string | null;
          plan: string;
          school_id: string;
          started_at: string | null;
          status: string | null;
        };
        Insert: {
          amount_paid?: number | null;
          created_at?: string | null;
          expires_at?: string | null;
          id?: string;
          paystack_reference?: string | null;
          plan: string;
          school_id: string;
          started_at?: string | null;
          status?: string | null;
        };
        Update: {
          amount_paid?: number | null;
          created_at?: string | null;
          expires_at?: string | null;
          id?: string;
          paystack_reference?: string | null;
          plan?: string;
          school_id?: string;
          started_at?: string | null;
          status?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "subscriptions_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      super_admin_logs: {
        Row: {
          action: string;
          admin_id: string | null;
          created_at: string | null;
          details: Json | null;
          id: string;
          target_school_id: string | null;
        };
        Insert: {
          action: string;
          admin_id?: string | null;
          created_at?: string | null;
          details?: Json | null;
          id?: string;
          target_school_id?: string | null;
        };
        Update: {
          action?: string;
          admin_id?: string | null;
          created_at?: string | null;
          details?: Json | null;
          id?: string;
          target_school_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "super_admin_logs_admin_id_fkey";
            columns: ["admin_id"];
            isOneToOne: false;
            referencedRelation: "super_admins";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "super_admin_logs_target_school_id_fkey";
            columns: ["target_school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      super_admins: {
        Row: {
          created_at: string | null;
          email: string;
          full_name: string;
          id: string;
          is_active: boolean | null;
          role: string | null;
        };
        Insert: {
          created_at?: string | null;
          email: string;
          full_name: string;
          id: string;
          is_active?: boolean | null;
          role?: string | null;
        };
        Update: {
          created_at?: string | null;
          email?: string;
          full_name?: string;
          id?: string;
          is_active?: boolean | null;
          role?: string | null;
        };
        Relationships: [];
      };
      teacher_biometrics: {
        Row: {
          created_at: string | null;
          device_id: string | null;
          device_model: string | null;
          enrolled_at: string | null;
          enrollment_attempts: number | null;
          enrollment_status: string | null;
          face_template_hash: string | null;
          id: string;
          last_verified_at: string | null;
          school_id: string;
          user_id: string;
        };
        Insert: {
          created_at?: string | null;
          device_id?: string | null;
          device_model?: string | null;
          enrolled_at?: string | null;
          enrollment_attempts?: number | null;
          enrollment_status?: string | null;
          face_template_hash?: string | null;
          id?: string;
          last_verified_at?: string | null;
          school_id: string;
          user_id: string;
        };
        Update: {
          created_at?: string | null;
          device_id?: string | null;
          device_model?: string | null;
          enrolled_at?: string | null;
          enrollment_attempts?: number | null;
          enrollment_status?: string | null;
          face_template_hash?: string | null;
          id?: string;
          last_verified_at?: string | null;
          school_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "teacher_biometrics_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "teacher_biometrics_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      teacher_performance_profiles: {
        Row: {
          absent_count_30d: number | null;
          attendance_rate: number | null;
          avg_lesson_plan_quality: number | null;
          burnout_risk_level: string | null;
          burnout_risk_score: number | null;
          calculated_at: string | null;
          curriculum_coverage: number | null;
          id: string;
          late_count_30d: number | null;
          lesson_plans_uploaded: number | null;
          overall_teacher_health_score: number | null;
          promotion_readiness_score: number | null;
          punctuality_score: number | null;
          resignation_probability: number | null;
          school_id: string;
          student_avg_improvement: number | null;
          teacher_id: string;
        };
        Insert: {
          absent_count_30d?: number | null;
          attendance_rate?: number | null;
          avg_lesson_plan_quality?: number | null;
          burnout_risk_level?: string | null;
          burnout_risk_score?: number | null;
          calculated_at?: string | null;
          curriculum_coverage?: number | null;
          id?: string;
          late_count_30d?: number | null;
          lesson_plans_uploaded?: number | null;
          overall_teacher_health_score?: number | null;
          promotion_readiness_score?: number | null;
          punctuality_score?: number | null;
          resignation_probability?: number | null;
          school_id: string;
          student_avg_improvement?: number | null;
          teacher_id: string;
        };
        Update: {
          absent_count_30d?: number | null;
          attendance_rate?: number | null;
          avg_lesson_plan_quality?: number | null;
          burnout_risk_level?: string | null;
          burnout_risk_score?: number | null;
          calculated_at?: string | null;
          curriculum_coverage?: number | null;
          id?: string;
          late_count_30d?: number | null;
          lesson_plans_uploaded?: number | null;
          overall_teacher_health_score?: number | null;
          promotion_readiness_score?: number | null;
          punctuality_score?: number | null;
          resignation_probability?: number | null;
          school_id?: string;
          student_avg_improvement?: number | null;
          teacher_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "teacher_performance_profiles_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "teacher_performance_profiles_teacher_id_fkey";
            columns: ["teacher_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
        ];
      };
      testimonials: {
        Row: {
          avatar_url: string | null;
          content: string;
          created_at: string | null;
          id: string;
          is_published: boolean | null;
          name: string;
          order_index: number | null;
          rating: number | null;
          role: string;
          school_id: string;
        };
        Insert: {
          avatar_url?: string | null;
          content: string;
          created_at?: string | null;
          id?: string;
          is_published?: boolean | null;
          name: string;
          order_index?: number | null;
          rating?: number | null;
          role: string;
          school_id: string;
        };
        Update: {
          avatar_url?: string | null;
          content?: string;
          created_at?: string | null;
          id?: string;
          is_published?: boolean | null;
          name?: string;
          order_index?: number | null;
          rating?: number | null;
          role?: string;
          school_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "testimonials_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      timetable_slots: {
        Row: {
          break_label: string | null;
          created_at: string | null;
          day_of_week: string;
          end_time: string;
          id: string;
          is_break: boolean | null;
          period_number: number;
          room: string | null;
          school_id: string;
          start_time: string;
          subject: string;
          teacher_id: string | null;
          timetable_id: string;
        };
        Insert: {
          break_label?: string | null;
          created_at?: string | null;
          day_of_week: string;
          end_time: string;
          id?: string;
          is_break?: boolean | null;
          period_number: number;
          room?: string | null;
          school_id: string;
          start_time: string;
          subject: string;
          teacher_id?: string | null;
          timetable_id: string;
        };
        Update: {
          break_label?: string | null;
          created_at?: string | null;
          day_of_week?: string;
          end_time?: string;
          id?: string;
          is_break?: boolean | null;
          period_number?: number;
          room?: string | null;
          school_id?: string;
          start_time?: string;
          subject?: string;
          teacher_id?: string | null;
          timetable_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "timetable_slots_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "timetable_slots_teacher_id_fkey";
            columns: ["teacher_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "timetable_slots_timetable_id_fkey";
            columns: ["timetable_id"];
            isOneToOne: false;
            referencedRelation: "timetables";
            referencedColumns: ["id"];
          },
        ];
      };
      timetables: {
        Row: {
          academic_year: string;
          class_id: string;
          created_at: string | null;
          generated_by: string | null;
          id: string;
          is_active: boolean | null;
          published: boolean | null;
          school_id: string;
          term: string;
        };
        Insert: {
          academic_year: string;
          class_id: string;
          created_at?: string | null;
          generated_by?: string | null;
          id?: string;
          is_active?: boolean | null;
          published?: boolean | null;
          school_id: string;
          term: string;
        };
        Update: {
          academic_year?: string;
          class_id?: string;
          created_at?: string | null;
          generated_by?: string | null;
          id?: string;
          is_active?: boolean | null;
          published?: boolean | null;
          school_id?: string;
          term?: string;
        };
        Relationships: [
          {
            foreignKeyName: "timetables_class_id_fkey";
            columns: ["class_id"];
            isOneToOne: false;
            referencedRelation: "classes";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "timetables_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      transport_buses: {
        Row: {
          assigned_students: Json;
          bus_number: string;
          bus_type: string | null;
          capacity: number | null;
          created_at: string;
          current_latitude: number | null;
          current_longitude: number | null;
          current_status: string | null;
          driver_id: string | null;
          id: string;
          is_active: boolean | null;
          last_location_update: string | null;
          registration_plate: string | null;
          route_name: string | null;
          school_id: string;
          updated_at: string;
        };
        Insert: {
          assigned_students?: Json;
          bus_number: string;
          bus_type?: string | null;
          capacity?: number | null;
          created_at?: string;
          current_latitude?: number | null;
          current_longitude?: number | null;
          current_status?: string | null;
          driver_id?: string | null;
          id?: string;
          is_active?: boolean | null;
          last_location_update?: string | null;
          registration_plate?: string | null;
          route_name?: string | null;
          school_id: string;
          updated_at?: string;
        };
        Update: {
          assigned_students?: Json;
          bus_number?: string;
          bus_type?: string | null;
          capacity?: number | null;
          created_at?: string;
          current_latitude?: number | null;
          current_longitude?: number | null;
          current_status?: string | null;
          driver_id?: string | null;
          id?: string;
          is_active?: boolean | null;
          last_location_update?: string | null;
          registration_plate?: string | null;
          route_name?: string | null;
          school_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "transport_buses_driver_id_fkey";
            columns: ["driver_id"];
            isOneToOne: false;
            referencedRelation: "users";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "transport_buses_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      users: {
        Row: {
          account_name: string | null;
          account_number: string | null;
          address: string | null;
          avatar_url: string | null;
          bank_name: string | null;
          created_at: string | null;
          date_enrolled: string | null;
          date_of_birth: string | null;
          digital_twin_opt_out: boolean | null;
          email: string | null;
          emergency_contact: string | null;
          emergency_contact_name: string | null;
          employment_type: string | null;
          face_attempt_count: number;
          face_biometric: Json | null;
          face_lock_reason: string | null;
          face_locked_at: string | null;
          face_registered_at: string | null;
          face_skip_count: number | null;
          full_name: string;
          gender: string | null;
          id: string;
          is_active: boolean | null;
          is_face_locked: boolean;
          last_login_at: string | null;
          next_of_kin_name: string | null;
          next_of_kin_phone: string | null;
          nin: string | null;
          phone: string | null;
          push_token: string | null;
          push_token_updated_at: string | null;
          qualification: string | null;
          role: string;
          salary: number | null;
          school_id: string;
          subject_specialty: string | null;
          updated_at: string | null;
          years_experience: number | null;
        };
        Insert: {
          account_name?: string | null;
          account_number?: string | null;
          address?: string | null;
          avatar_url?: string | null;
          bank_name?: string | null;
          created_at?: string | null;
          date_enrolled?: string | null;
          date_of_birth?: string | null;
          digital_twin_opt_out?: boolean | null;
          email?: string | null;
          emergency_contact?: string | null;
          emergency_contact_name?: string | null;
          employment_type?: string | null;
          face_attempt_count?: number;
          face_biometric?: Json | null;
          face_lock_reason?: string | null;
          face_locked_at?: string | null;
          face_registered_at?: string | null;
          face_skip_count?: number | null;
          full_name: string;
          gender?: string | null;
          id: string;
          is_active?: boolean | null;
          is_face_locked?: boolean;
          last_login_at?: string | null;
          next_of_kin_name?: string | null;
          next_of_kin_phone?: string | null;
          nin?: string | null;
          phone?: string | null;
          push_token?: string | null;
          push_token_updated_at?: string | null;
          qualification?: string | null;
          role: string;
          salary?: number | null;
          school_id: string;
          subject_specialty?: string | null;
          updated_at?: string | null;
          years_experience?: number | null;
        };
        Update: {
          account_name?: string | null;
          account_number?: string | null;
          address?: string | null;
          avatar_url?: string | null;
          bank_name?: string | null;
          created_at?: string | null;
          date_enrolled?: string | null;
          date_of_birth?: string | null;
          digital_twin_opt_out?: boolean | null;
          email?: string | null;
          emergency_contact?: string | null;
          emergency_contact_name?: string | null;
          employment_type?: string | null;
          face_attempt_count?: number;
          face_biometric?: Json | null;
          face_lock_reason?: string | null;
          face_locked_at?: string | null;
          face_registered_at?: string | null;
          face_skip_count?: number | null;
          full_name?: string;
          gender?: string | null;
          id?: string;
          is_active?: boolean | null;
          is_face_locked?: boolean;
          last_login_at?: string | null;
          next_of_kin_name?: string | null;
          next_of_kin_phone?: string | null;
          nin?: string | null;
          phone?: string | null;
          push_token?: string | null;
          push_token_updated_at?: string | null;
          qualification?: string | null;
          role?: string;
          salary?: number | null;
          school_id?: string;
          subject_specialty?: string | null;
          updated_at?: string | null;
          years_experience?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "users_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      webhook_logs: {
        Row: {
          created_at: string | null;
          error_message: string | null;
          event_type: string | null;
          id: string;
          payload: Json | null;
          processed_at: string | null;
          processing_status: string | null;
          provider: string | null;
          school_id: string | null;
        };
        Insert: {
          created_at?: string | null;
          error_message?: string | null;
          event_type?: string | null;
          id?: string;
          payload?: Json | null;
          processed_at?: string | null;
          processing_status?: string | null;
          provider?: string | null;
          school_id?: string | null;
        };
        Update: {
          created_at?: string | null;
          error_message?: string | null;
          event_type?: string | null;
          id?: string;
          payload?: Json | null;
          processed_at?: string | null;
          processing_status?: string | null;
          provider?: string | null;
          school_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "webhook_logs_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
      why_us_items: {
        Row: {
          created_at: string | null;
          description: string | null;
          icon: string | null;
          id: string;
          is_published: boolean | null;
          order_index: number | null;
          school_id: string;
          title: string;
        };
        Insert: {
          created_at?: string | null;
          description?: string | null;
          icon?: string | null;
          id?: string;
          is_published?: boolean | null;
          order_index?: number | null;
          school_id: string;
          title: string;
        };
        Update: {
          created_at?: string | null;
          description?: string | null;
          icon?: string | null;
          id?: string;
          is_published?: boolean | null;
          order_index?: number | null;
          school_id?: string;
          title?: string;
        };
        Relationships: [
          {
            foreignKeyName: "why_us_items_school_id_fkey";
            columns: ["school_id"];
            isOneToOne: false;
            referencedRelation: "schools";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      assign_role: {
        Args: {
          p_ended_on?: string;
          p_identity: string;
          p_role_id: string;
          p_started_on?: string;
          p_tenant: string;
        };
        Returns: string;
      };
      assign_workforce_position: {
        Args: {
          p_employment_type?: string;
          p_identity: string;
          p_kind_code: string;
          p_primary?: boolean;
          p_runtime?: string;
          p_started_on?: string;
          p_tenant: string;
        };
        Returns: string;
      };
      cg_prune_expired_idempotency_records: {
        Args: { p_batch_limit?: number; p_before: string };
        Returns: number;
      };
      create_organization_with_founder: {
        Args: {
          p_full_name: string;
          p_org_name: string;
          p_org_slug: string;
          p_runtime?: string;
        };
        Returns: string;
      };
      end_role_assignment: {
        Args: { p_assignment_id: string };
        Returns: boolean;
      };
      end_workforce_position: {
        Args: { p_ended_on?: string; p_position_id: string };
        Returns: boolean;
      };
      get_my_memberships: {
        Args: never;
        Returns: {
          is_primary: boolean;
          role: string;
          school_id: string;
        }[];
      };
      get_my_primary_workforce_position: {
        Args: never;
        Returns: {
          authority_group: string;
          employment_type: string;
          ended_on: string;
          family: string;
          id: string;
          identity_ref: string;
          is_primary: boolean;
          kind_code: string;
          kind_title: string;
          started_on: string;
          status: string;
        }[];
      };
      get_my_role: { Args: never; Returns: string };
      get_my_school_id: { Args: never; Returns: string };
      get_my_tenant_id: { Args: never; Returns: string };
      get_org_profile: {
        Args: { p_profile_key: string; p_runtime: string; p_tenant: string };
        Returns: {
          id: string;
          payload: Json;
          updated_at: string;
        }[];
      };
      grant_role_capability: {
        Args: { p_capability: string; p_role_id: string; p_tenant: string };
        Returns: string;
      };
      holds_tenant_role: {
        Args: { p_role_ref: string; p_tenant: string };
        Returns: boolean;
      };
      is_school_admin: { Args: never; Returns: boolean };
      is_super_admin: { Args: never; Returns: boolean };
      is_tenant_admin: { Args: { p_tenant: string }; Returns: boolean };
      list_role_assignments: {
        Args: { p_tenant: string };
        Returns: {
          ended_on: string;
          id: string;
          identity_ref: string;
          role_id: string;
          started_on: string;
          status: string;
        }[];
      };
      list_role_grants: {
        Args: { p_tenant: string };
        Returns: {
          capability: string;
          granted_by: string;
          granted_on: string;
          id: string;
          revoked_on: string;
          role_id: string;
        }[];
      };
      list_workforce_positions: {
        Args: { p_tenant: string };
        Returns: {
          authority_group: string;
          employment_type: string;
          ended_on: string;
          family: string;
          id: string;
          identity_ref: string;
          is_primary: boolean;
          kind_code: string;
          kind_title: string;
          started_on: string;
          status: string;
        }[];
      };
      public_school_stats: {
        Args: { _slug: string };
        Returns: {
          founded_year: number;
          program_count: number;
          student_count: number;
          teacher_count: number;
        }[];
      };
      public_teachers: {
        Args: { _slug: string };
        Returns: {
          avatar_url: string;
          full_name: string;
          id: string;
          subject_specialty: string;
        }[];
      };
      revoke_role_capability: { Args: { p_grant_id: string }; Returns: boolean };
      seed_default_staff_types: {
        Args: { _school_id: string };
        Returns: undefined;
      };
      upsert_org_profile: {
        Args: {
          p_payload: Json;
          p_profile_key: string;
          p_runtime: string;
          p_tenant: string;
        };
        Returns: string;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
