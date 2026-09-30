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
      get_my_role: { Args: never; Returns: string };
      get_my_school_id: { Args: never; Returns: string };
      is_school_admin: { Args: never; Returns: boolean };
      is_super_admin: { Args: never; Returns: boolean };
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
      seed_default_staff_types: {
        Args: { _school_id: string };
        Returns: undefined;
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
