import type {
  BusinessTemplateKey,
  CustomFieldDataType,
  CustomFieldScope,
} from "@prisma/client";

import {
  CONFIG_SECTIONS,
  type ConfigSectionValue,
} from "@/lib/orgs/config-3b-validation";

/**
 * Platform business-template definitions (NOT persisted).
 * Suggested categories/fields and example offerings are SUGGESTIONS/EXAMPLES ONLY —
 * never auto-activated or stored as customer facts.
 */

export type TemplateQuestion = {
  id: string;
  prompt: string;
  help?: string;
};

export type SuggestedCustomField = {
  key: string;
  label: string;
  dataType: CustomFieldDataType;
  scope: CustomFieldScope;
  options?: string[];
};

export type TemplateExampleOffering = {
  name: string;
  description?: string;
  category?: string;
};

export type BusinessTemplateDefinition = {
  key: BusinessTemplateKey;
  version: number;
  label: string;
  description: string;
  questions: TemplateQuestion[];
  suggestedCategories: string[];
  /** Suggestions only — never auto-created as definitions. */
  suggestedCustomFields: SuggestedCustomField[];
  importMappingHints: string[];
  qualificationPromptMetadata: string[];
  applicableSections: ConfigSectionValue[];
  /** Examples only — never persisted as BusinessService facts. */
  exampleServices: TemplateExampleOffering[];
  /** Examples only — never persisted as BusinessProduct facts. */
  exampleProducts: TemplateExampleOffering[];
};

/** Build template applicability by filtering the one canonical section order. */
function orderedSections(
  applicable: ReadonlySet<ConfigSectionValue> = new Set(CONFIG_SECTIONS),
): ConfigSectionValue[] {
  return CONFIG_SECTIONS.filter((section) => applicable.has(section));
}

const ALL_SECTIONS = orderedSections();
const SERVICE_HEAVY_SECTIONS = orderedSections();
const PRODUCT_HEAVY_SECTIONS = orderedSections();

const TEMPLATE_DEFINITIONS: Record<
  BusinessTemplateKey,
  BusinessTemplateDefinition
> = {
  PROFESSIONAL_SERVICES: {
    key: "PROFESSIONAL_SERVICES",
    version: 1,
    label: "Professional services",
    description:
      "Consultancies, agencies, and expertise-led firms that sell packaged or hourly services.",
    questions: [
      {
        id: "primary_offering",
        prompt: "What is your primary service offering?",
        help: "Use the name customers would recognize.",
      },
      {
        id: "engagement_model",
        prompt: "Do you typically bill by project, retainer, or hourly?",
      },
      {
        id: "qualification_focus",
        prompt:
          "What must be true before a lead is worth a sales conversation?",
      },
    ],
    suggestedCategories: ["Advisory", "Implementation", "Retainer"],
    suggestedCustomFields: [
      {
        key: "engagement_type",
        label: "Engagement type",
        dataType: "SINGLE_SELECT",
        scope: "OFFERING",
        options: ["Project", "Retainer", "Hourly"],
      },
      {
        key: "target_company_size",
        label: "Target company size",
        dataType: "SINGLE_SELECT",
        scope: "PROSPECT",
        options: ["1-10", "11-50", "51-200", "201+"],
      },
    ],
    importMappingHints: [
      "Map service name → offering name",
      "Map rate card → price description",
      "Map specialty tags → categories",
    ],
    qualificationPromptMetadata: [
      "Budget readiness",
      "Decision timeline",
      "Problem urgency",
    ],
    applicableSections: SERVICE_HEAVY_SECTIONS,
    exampleServices: [
      {
        name: "Strategy consultation",
        description: "EXAMPLE ONLY — not auto-created",
        category: "Advisory",
      },
      {
        name: "Implementation sprint",
        description: "EXAMPLE ONLY — not auto-created",
        category: "Implementation",
      },
    ],
    exampleProducts: [],
  },
  HOME_TRADE_SERVICES: {
    key: "HOME_TRADE_SERVICES",
    version: 1,
    label: "Home & trade services",
    description:
      "Field service, trades, and home-service businesses with service areas and job types.",
    questions: [
      {
        id: "trade_focus",
        prompt: "Which trades or home services do you primarily offer?",
      },
      {
        id: "coverage",
        prompt: "Which cities, regions, or postal prefixes do you cover?",
      },
      {
        id: "emergency",
        prompt: "Do you offer same-day or emergency visits?",
      },
    ],
    suggestedCategories: ["Maintenance", "Install", "Emergency"],
    suggestedCustomFields: [
      {
        key: "job_type",
        label: "Job type",
        dataType: "SINGLE_SELECT",
        scope: "OFFERING",
        options: ["Maintenance", "Install", "Repair", "Emergency"],
      },
      {
        key: "property_type",
        label: "Property type",
        dataType: "SINGLE_SELECT",
        scope: "PROSPECT",
        options: ["Residential", "Commercial"],
      },
    ],
    importMappingHints: [
      "Map zone/postal → service area",
      "Map job codes → service categories",
      "Map crew notes → internal labels",
    ],
    qualificationPromptMetadata: [
      "Service area match",
      "Job urgency",
      "Access constraints",
    ],
    applicableSections: SERVICE_HEAVY_SECTIONS,
    exampleServices: [
      {
        name: "Standard service call",
        description: "EXAMPLE ONLY — not auto-created",
        category: "Maintenance",
      },
    ],
    exampleProducts: [],
  },
  PRODUCT_BUSINESS: {
    key: "PRODUCT_BUSINESS",
    version: 1,
    label: "Product business",
    description:
      "Companies that primarily sell physical or digital products with a catalogue focus.",
    questions: [
      {
        id: "catalogue_shape",
        prompt: "How is your catalogue organized (SKU, family, or line)?",
      },
      {
        id: "fulfillment",
        prompt: "Do you ship, pick-up, or deliver locally?",
      },
      {
        id: "lead_intent",
        prompt: "What buyer intent signals matter most for outreach?",
      },
    ],
    suggestedCategories: ["Core", "Accessory", "Bundle"],
    suggestedCustomFields: [
      {
        key: "sku_family",
        label: "SKU family",
        dataType: "TEXT",
        scope: "OFFERING",
      },
      {
        key: "preferred_fulfillment",
        label: "Preferred fulfillment",
        dataType: "SINGLE_SELECT",
        scope: "PROSPECT",
        options: ["Ship", "Pickup", "Local delivery"],
      },
    ],
    importMappingHints: [
      "Map SKU → product sku",
      "Map product family → category",
      "Map list price text → price description",
    ],
    qualificationPromptMetadata: [
      "Purchase quantity",
      "Fulfillment preference",
      "Budget band",
    ],
    applicableSections: PRODUCT_HEAVY_SECTIONS,
    exampleServices: [],
    exampleProducts: [
      {
        name: "Starter kit",
        description: "EXAMPLE ONLY — not auto-created",
        category: "Core",
      },
    ],
  },
  SUBSCRIPTIONS_PLANS: {
    key: "SUBSCRIPTIONS_PLANS",
    version: 1,
    label: "Subscriptions & plans",
    description:
      "Recurring plans, memberships, and subscription packages with renewal-oriented qualification.",
    questions: [
      {
        id: "plan_tiers",
        prompt: "What plan tiers do customers choose between?",
      },
      {
        id: "billing_cadence",
        prompt: "What billing cadences do you support?",
      },
      {
        id: "churn_signals",
        prompt: "Which signals indicate a prospect is ready to subscribe?",
      },
    ],
    suggestedCategories: ["Starter", "Growth", "Enterprise"],
    suggestedCustomFields: [
      {
        key: "plan_tier",
        label: "Plan tier",
        dataType: "SINGLE_SELECT",
        scope: "OFFERING",
        options: ["Starter", "Growth", "Enterprise"],
      },
      {
        key: "billing_cadence",
        label: "Billing cadence",
        dataType: "SINGLE_SELECT",
        scope: "PROSPECT",
        options: ["Monthly", "Annual"],
      },
    ],
    importMappingHints: [
      "Map plan code → offering key",
      "Map seat/quantity → custom field",
      "Map renewal date hints → notes",
    ],
    qualificationPromptMetadata: [
      "Seat count",
      "Billing preference",
      "Current tool stack",
    ],
    applicableSections: ALL_SECTIONS,
    exampleServices: [
      {
        name: "Growth plan onboarding",
        description: "EXAMPLE ONLY — not auto-created",
        category: "Growth",
      },
    ],
    exampleProducts: [
      {
        name: "Annual growth plan",
        description: "EXAMPLE ONLY — not auto-created",
        category: "Growth",
      },
    ],
  },
  APPOINTMENT_BASED: {
    key: "APPOINTMENT_BASED",
    version: 1,
    label: "Appointment-based",
    description:
      "Clinics, salons, and booking-led businesses centered on availability and appointments.",
    questions: [
      {
        id: "appointment_types",
        prompt: "What appointment types do customers book?",
      },
      {
        id: "duration_norms",
        prompt: "What are typical appointment durations?",
      },
      {
        id: "no_show",
        prompt: "How do you handle cancellations and no-shows today?",
      },
    ],
    suggestedCategories: ["Consult", "Treatment", "Follow-up"],
    suggestedCustomFields: [
      {
        key: "appointment_type",
        label: "Appointment type",
        dataType: "SINGLE_SELECT",
        scope: "OFFERING",
        options: ["Consult", "Treatment", "Follow-up"],
      },
      {
        key: "preferred_time_window",
        label: "Preferred time window",
        dataType: "SINGLE_SELECT",
        scope: "PROSPECT",
        options: ["Morning", "Afternoon", "Evening"],
      },
    ],
    importMappingHints: [
      "Map visit type → service",
      "Map duration → duration minutes",
      "Map provider specialty → category",
    ],
    qualificationPromptMetadata: [
      "Preferred time window",
      "First-time vs returning",
      "Service urgency",
    ],
    applicableSections: SERVICE_HEAVY_SECTIONS,
    exampleServices: [
      {
        name: "Initial consultation",
        description: "EXAMPLE ONLY — not auto-created",
        category: "Consult",
      },
    ],
    exampleProducts: [],
  },
  CUSTOM_MIXED: {
    key: "CUSTOM_MIXED",
    version: 1,
    label: "Custom / mixed",
    description:
      "Flexible starting point for organizations that mix services, products, and custom workflows.",
    questions: [
      {
        id: "mix_shape",
        prompt: "Do you sell mostly services, products, or both?",
      },
      {
        id: "must_configure",
        prompt: "Which configuration areas matter most in the first week?",
      },
      {
        id: "custom_fields_need",
        prompt:
          "What unique data do you need to track that is not covered elsewhere?",
      },
    ],
    suggestedCategories: ["General", "Custom"],
    suggestedCustomFields: [
      {
        key: "segment",
        label: "Segment",
        dataType: "TEXT",
        scope: "BUSINESS",
      },
    ],
    importMappingHints: [
      "Map unknown columns to custom fields after review",
      "Prefer explicit confirmation before activating suggestions",
    ],
    qualificationPromptMetadata: [
      "Primary need",
      "Fit confidence",
      "Next step preference",
    ],
    applicableSections: ALL_SECTIONS,
    exampleServices: [],
    exampleProducts: [],
  },
};

/** Current definition version per template key. */
export const TEMPLATE_DEFINITION_VERSION: Record<BusinessTemplateKey, number> =
  {
    PROFESSIONAL_SERVICES: TEMPLATE_DEFINITIONS.PROFESSIONAL_SERVICES.version,
    HOME_TRADE_SERVICES: TEMPLATE_DEFINITIONS.HOME_TRADE_SERVICES.version,
    PRODUCT_BUSINESS: TEMPLATE_DEFINITIONS.PRODUCT_BUSINESS.version,
    SUBSCRIPTIONS_PLANS: TEMPLATE_DEFINITIONS.SUBSCRIPTIONS_PLANS.version,
    APPOINTMENT_BASED: TEMPLATE_DEFINITIONS.APPOINTMENT_BASED.version,
    CUSTOM_MIXED: TEMPLATE_DEFINITIONS.CUSTOM_MIXED.version,
  };

export function getTemplateDefinition(
  key: BusinessTemplateKey,
): BusinessTemplateDefinition {
  return TEMPLATE_DEFINITIONS[key];
}

/** Applicable sections always follow the canonical server order. */
export function getApplicableConfigSections(
  key: BusinessTemplateKey,
): ConfigSectionValue[] {
  const applicable = new Set(TEMPLATE_DEFINITIONS[key].applicableSections);
  applicable.add("BUSINESS_TEMPLATE");
  applicable.add("REVIEW");
  return orderedSections(applicable);
}

export function listTemplateDefinitions(): BusinessTemplateDefinition[] {
  return Object.values(TEMPLATE_DEFINITIONS);
}
