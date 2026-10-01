/**
 * SUBSCRIPTION TIERS — LEGACY MODULE, RECONCILED (MISSION-R-73, J-044).
 *
 * STATUS: deprecated as a DECISION surface; retained as the commercial tier
 * catalog (prices, limits, feature matrix) because live consumers still
 * import it. Public API is frozen for the MISSION-R-121 universal-root
 * relocation — do not extend, do not add new consumers.
 *
 * Reconciliation facts (evidence: tests/unit/financial-reconciliation.test.ts
 * and tests/unit/subscription-tiers.test.ts):
 *
 * 1. The `schools.active_features` jsonb column is an input to NO access
 *    decision as of this mission. It never had SQL-level enforcement (no
 *    migration, function, view or policy reads it — verified against
 *    database/supabase/migrations); its only leverage was this module's
 *    signature, and the per-school override parameters below are DEAD INPUTS
 *    kept solely for signature stability. `isFeatureActive` /
 *    `hasTierFeature` return the site-wide unlock decision every caller
 *    already observed; the school-column argument cannot influence them
 *    (proven exhaustively by the coupling-kill test).
 *
 * 2. "May THIS actor use this feature?" is answered exclusively by the
 *    canonical feature-access contract surface: `getMyFeatureAccess` in
 *    the feature-access server functions over the runtime feature gate —
 *    keyed by TenantId + identity + roles, fail-closed, with explainable
 *    decisions. New code must call that surface, never this module.
 *
 * 3. "What does this tenant's plan commercially entitle?" is resolved
 *    TenantId-keyed by `payments/tier-entitlements.ts`, which translates
 *    this catalog into the phase-13 financial contract plane with declared
 *    provenance. That module also records why NO schema migration was
 *    required for this reconciliation (column is decision-dead; retirement
 *    of the still-written column is MISSION-R-121 follow-up work).
 */


export const SUBSCRIPTION_TIERS = {
  trial: {
    name: "Trial",
    price_monthly: 0,
    price_annual: 0,
    per_student_fee_monthly: 0,
    duration_days: 30,
    max_students: 50,
    max_teachers: 5,
    max_classes: 5,
    storage_gb: 1,
    portals: ["admin"] as const,
    color: "#6b7280",
    badge: "gray",
    description: "Try the platform free for 30 days",
    features: {
      admin_portal: true,
      basic_profiles: true,
      class_management: true,
      manual_attendance: true,
      view_grades: true,
      school_website: true,
      school_calendar_view: true,
      qr_attendance: false,
      face_biometrics: false,
      geofence: false,
      teacher_portal: false,
      parent_portal: false,
      student_portal: false,
      bursar_portal: false,
      hq_portal: false,
      fee_management: false,
      paystack_payments: false,
      flutterwave_payments: false,
      stripe_payments: false,
      grade_publishing: false,
      report_cards: false,
      lesson_plans: false,
      ai_timetable: false,
      teacher_performance_ai: false,
      burnout_prediction: false,
      student_at_risk: false,
      parent_engagement_score: false,
      school_health_certificate: false,
      bulk_import: false,
      email_notifications: false,
      sms_notifications: false,
      whatsapp_notifications: false,
      push_notifications: false,
      school_blog: false,
      alumni_portal: false,
      offline_attendance: false,
      api_access: false,
      white_label: false,
      custom_domain: false,
      multi_branch: false,
      dedicated_database: false,
      priority_support: false,
      remove_branding: false,
      advanced_analytics: false,
      exportable_reports: false,
      paystack_split: false,
      audit_logs: false,
      news_management: false,
      cms_management: false,
      sports_management: false,
      meal_management: false,
      transport_basic: false,
      bus_live_tracking: false,
      parent_bus_app: false,
      fleet_management: false,
      expense_tracking: false,
      expense_ai_insights: false,
      vibeora_intelligence: false,
      school_ads: false,
      support_tickets: true,
      ai_admissions_review: false,
      digital_twin: false,
    },
    platform_apis: [] as string[],
    client_apis: [] as string[],
  },

  starter: {
    name: "Starter",
    price_monthly: 15000,
    price_annual: 150000,
    per_student_fee_monthly: 200,
    duration_days: null,
    max_students: 200,
    max_teachers: 20,
    max_classes: 20,
    storage_gb: 5,
    portals: ["admin", "teacher", "parent", "student", "bursar"] as const,
    color: "#3b82f6",
    badge: "blue",
    description: "Complete school management for small schools",
    features: {
      admin_portal: true,
      basic_profiles: true,
      class_management: true,
      manual_attendance: true,
      view_grades: true,
      school_website: true,
      school_calendar_view: true,
      qr_attendance: true,
      face_biometrics: false,
      geofence: false,
      teacher_portal: true,
      parent_portal: true,
      student_portal: true,
      bursar_portal: true,
      hq_portal: false,
      fee_management: true,
      paystack_payments: true,
      flutterwave_payments: false,
      stripe_payments: false,
      grade_publishing: true,
      report_cards: true,
      lesson_plans: true,
      ai_timetable: false,
      teacher_performance_ai: false,
      burnout_prediction: false,
      student_at_risk: false,
      parent_engagement_score: false,
      school_health_certificate: false,
      bulk_import: false,
      email_notifications: true,
      sms_notifications: false,
      whatsapp_notifications: false,
      push_notifications: false,
      school_blog: false,
      alumni_portal: false,
      offline_attendance: false,
      api_access: false,
      white_label: false,
      custom_domain: false,
      multi_branch: false,
      dedicated_database: false,
      priority_support: false,
      remove_branding: false,
      advanced_analytics: false,
      exportable_reports: false,
      paystack_split: false,
      audit_logs: true,
      news_management: true,
      cms_management: true,
      sports_management: true,
      meal_management: true,
      transport_basic: true,
      bus_live_tracking: false,
      parent_bus_app: false,
      fleet_management: false,
      expense_tracking: true,
      expense_ai_insights: false,
      vibeora_intelligence: false,
      school_ads: false,
      support_tickets: true,
      ai_admissions_review: false,
      digital_twin: false,
    },
    platform_apis: ["resend_email"] as string[],
    client_apis: ["paystack"] as string[],
  },

  growth: {
    name: "Growth",
    price_monthly: 35000,
    price_annual: 350000,
    per_student_fee_monthly: 350,
    duration_days: null,
    max_students: 500,
    max_teachers: 50,
    max_classes: 50,
    storage_gb: 20,
    portals: ["admin", "teacher", "parent", "student", "bursar", "hq"] as const,
    color: "#10b981",
    badge: "emerald",
    description: "Advanced features for growing schools",
    features: {
      admin_portal: true,
      basic_profiles: true,
      class_management: true,
      manual_attendance: true,
      view_grades: true,
      school_website: true,
      school_calendar_view: true,
      qr_attendance: true,
      face_biometrics: true,
      geofence: true,
      teacher_portal: true,
      parent_portal: true,
      student_portal: true,
      bursar_portal: true,
      hq_portal: true,
      fee_management: true,
      paystack_payments: true,
      flutterwave_payments: true,
      stripe_payments: false,
      grade_publishing: true,
      report_cards: true,
      lesson_plans: true,
      ai_timetable: true,
      teacher_performance_ai: true,
      burnout_prediction: false,
      student_at_risk: true,
      parent_engagement_score: true,
      school_health_certificate: true,
      bulk_import: true,
      email_notifications: true,
      sms_notifications: true,
      whatsapp_notifications: true,
      push_notifications: false,
      school_blog: true,
      alumni_portal: false,
      offline_attendance: true,
      api_access: false,
      white_label: false,
      custom_domain: false,
      multi_branch: false,
      dedicated_database: false,
      priority_support: false,
      remove_branding: false,
      advanced_analytics: true,
      exportable_reports: true,
      paystack_split: false,
      audit_logs: true,
      news_management: true,
      cms_management: true,
      sports_management: true,
      meal_management: true,
      transport_basic: true,
      bus_live_tracking: true,
      parent_bus_app: true,
      fleet_management: false,
      expense_tracking: true,
      expense_ai_insights: false,
      vibeora_intelligence: false,
      school_ads: false,
      support_tickets: true,
      ai_admissions_review: true,
      digital_twin: false,
    },
    platform_apis: ["resend_email", "twilio_sms", "whatsapp_cloud"] as string[],
    client_apis: ["paystack", "flutterwave"] as string[],
  },

  professional: {
    name: "Professional",
    price_monthly: 75000,
    price_annual: 750000,
    per_student_fee_monthly: 500,
    duration_days: null,
    max_students: 1000,
    max_teachers: 100,
    max_classes: 100,
    storage_gb: 50,
    portals: ["admin", "teacher", "parent", "student", "bursar", "hq"] as const,
    color: "#8b5cf6",
    badge: "purple",
    description: "Enterprise intelligence for serious schools",
    features: {
      admin_portal: true,
      basic_profiles: true,
      class_management: true,
      manual_attendance: true,
      view_grades: true,
      school_website: true,
      school_calendar_view: true,
      qr_attendance: true,
      face_biometrics: true,
      geofence: true,
      teacher_portal: true,
      parent_portal: true,
      student_portal: true,
      bursar_portal: true,
      hq_portal: true,
      fee_management: true,
      paystack_payments: true,
      flutterwave_payments: true,
      stripe_payments: true,
      grade_publishing: true,
      report_cards: true,
      lesson_plans: true,
      ai_timetable: true,
      teacher_performance_ai: true,
      burnout_prediction: true,
      student_at_risk: true,
      parent_engagement_score: true,
      school_health_certificate: true,
      bulk_import: true,
      email_notifications: true,
      sms_notifications: true,
      whatsapp_notifications: true,
      push_notifications: true,
      school_blog: true,
      alumni_portal: false,
      offline_attendance: true,
      api_access: false,
      white_label: false,
      custom_domain: false,
      multi_branch: false,
      dedicated_database: false,
      priority_support: true,
      remove_branding: true,
      advanced_analytics: true,
      exportable_reports: true,
      paystack_split: false,
      audit_logs: true,
      news_management: true,
      cms_management: true,
      sports_management: true,
      meal_management: true,
      transport_basic: true,
      bus_live_tracking: true,
      parent_bus_app: true,
      fleet_management: true,
      expense_tracking: true,
      expense_ai_insights: true,
      vibeora_intelligence: true,
      school_ads: true,
      support_tickets: true,
      ai_admissions_review: true,
      digital_twin: true,
    },
    platform_apis: ["resend_email", "twilio_sms", "whatsapp_cloud", "openai"] as string[],
    client_apis: ["paystack", "flutterwave", "stripe"] as string[],
  },

  enterprise: {
    name: "Enterprise",
    price_monthly: 0,
    price_annual: 0,
    per_student_fee_monthly: 800,
    duration_days: null,
    max_students: -1,
    max_teachers: -1,
    max_classes: -1,
    storage_gb: -1,
    portals: ["admin", "teacher", "parent", "student", "bursar", "hq", "alumni"] as const,
    color: "#f59e0b",
    badge: "amber",
    description: "Unlimited power for school groups and institutions",
    features: {
      admin_portal: true,
      basic_profiles: true,
      class_management: true,
      manual_attendance: true,
      view_grades: true,
      school_website: true,
      school_calendar_view: true,
      qr_attendance: true,
      face_biometrics: true,
      geofence: true,
      teacher_portal: true,
      parent_portal: true,
      student_portal: true,
      bursar_portal: true,
      hq_portal: true,
      fee_management: true,
      paystack_payments: true,
      flutterwave_payments: true,
      stripe_payments: true,
      grade_publishing: true,
      report_cards: true,
      lesson_plans: true,
      ai_timetable: true,
      teacher_performance_ai: true,
      burnout_prediction: true,
      student_at_risk: true,
      parent_engagement_score: true,
      school_health_certificate: true,
      bulk_import: true,
      email_notifications: true,
      sms_notifications: true,
      whatsapp_notifications: true,
      push_notifications: true,
      school_blog: true,
      alumni_portal: true,
      offline_attendance: true,
      api_access: true,
      white_label: true,
      custom_domain: true,
      multi_branch: true,
      dedicated_database: true,
      priority_support: true,
      remove_branding: true,
      advanced_analytics: true,
      exportable_reports: true,
      paystack_split: true,
      audit_logs: true,
      news_management: true,
      cms_management: true,
      sports_management: true,
      meal_management: true,
      transport_basic: true,
      bus_live_tracking: true,
      parent_bus_app: true,
      fleet_management: true,
      expense_tracking: true,
      expense_ai_insights: true,
      vibeora_intelligence: true,
      school_ads: true,
      support_tickets: true,
      ai_admissions_review: true,
      digital_twin: true,
    },
    platform_apis: [
      "resend_email",
      "twilio_sms",
      "whatsapp_cloud",
      "openai",
      "google_vision_ai",
      "google_maps",
    ] as string[],
    client_apis: [
      "paystack",
      "flutterwave",
      "stripe",
      "whatsapp_business",
      "africas_talking",
    ] as string[],
  },
} as const;

export type TierName = keyof typeof SUBSCRIPTION_TIERS;
export type TierFeatures = typeof SUBSCRIPTION_TIERS.enterprise.features;
export type FeatureKey = keyof TierFeatures;

export function getTier(tier: string | null | undefined): TierName {
  if (tier && tier in SUBSCRIPTION_TIERS) return tier as TierName;
  return "trial";
}

export function getTierFeatures(tier: string | null | undefined): TierFeatures {
  return SUBSCRIPTION_TIERS[getTier(tier)].features as TierFeatures;
}

/**
 * @deprecated MISSION-R-73: legacy signature retained for API stability
 * (consumers relocate in MISSION-R-121). `tier` is decorative and
 * `activeFeatures` — the legacy `schools.active_features` column — is a dead
 * input: no access decision reads it. Use the canonical contract surface
 * (the feature-access entry point over the runtime feature gate) for access decisions.
 */
export function hasTierFeature(tier: string | null | undefined, feature: FeatureKey): boolean {
  void tier;
  void feature;
  return true;
}

/**
 * Resolves whether a feature is ACTIVE for a school right now.
 * All features are unlocked site-wide; any school-specific toggle should be
 * treated as a convenience override, not a trap. Super admins retain full
 * access to unlock modules for any school without tier hardcoding.
 *
 * @deprecated MISSION-R-73: the `activeFeatures` argument — the legacy
 * `schools.active_features` column — is a DEAD INPUT; the decision never
 * reads it and the school-column coupling is killed at this signature.
 * Kept only so live consumers compile unchanged until MISSION-R-121
 * relocates them. Access decisions go through the canonical contract
 * surface (the feature-access entry point over the runtime feature gate).
 */
export function isFeatureActive(
  tier: string | null | undefined,
  activeFeatures: Record<string, unknown> | null | undefined,
  feature: FeatureKey,
): boolean {
  void tier;
  void activeFeatures;
  void feature;
  return true;
}

export const ALL_TIERS: TierName[] = ["trial", "starter", "growth", "professional", "enterprise"];
