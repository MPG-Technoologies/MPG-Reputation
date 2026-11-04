/**
 * Shared types for the Free Reputation Check flow.
 * Used by both the frontend form and the backend report generator.
 */

export const MONTHLY_JOB_OPTIONS = [
  { value: "under_25", label: "Under 25", midpoint: 15 },
  { value: "25_75", label: "25 – 75", midpoint: 50 },
  { value: "76_200", label: "76 – 200", midpoint: 140 },
  { value: "over_200", label: "More than 200", midpoint: 260 },
  { value: "unknown", label: "Not sure", midpoint: null },
] as const;

export type MonthlyJobsValue = (typeof MONTHLY_JOB_OPTIONS)[number]["value"];

export const REQUEST_PROCESS_OPTIONS = [
  { value: "no", label: "We don't send review requests" },
  { value: "sometimes", label: "Sometimes — when someone remembers" },
  { value: "yes_manual", label: "Yes — manually, every time" },
  { value: "yes_automated", label: "Yes — an automated system sends them" },
] as const;

export type RequestProcessValue =
  (typeof REQUEST_PROCESS_OPTIONS)[number]["value"];

export const SOFTWARE_OPTIONS = [
  "None / paper & spreadsheets",
  "Jobber",
  "Housecall Pro",
  "ServiceTitan",
  "Square",
  "QuickBooks",
  "HubSpot",
  "Other",
] as const;

export const BUSINESS_CATEGORY_OPTIONS = [
  "Home services",
  "Trades (electrical, plumbing, HVAC…)",
  "Professional services",
  "Automotive services",
  "Other local service business",
] as const;

export const LOCATION_OPTIONS = [
  { value: "one", label: "One location" },
  { value: "multi", label: "Multiple locations" },
] as const;

export type LocationsValue = (typeof LOCATION_OPTIONS)[number]["value"];

export const FOLLOWUP_OPTIONS = [
  { value: "never", label: "We don't follow up" },
  { value: "sometimes", label: "Sometimes, when there's time" },
  { value: "always", label: "Every request gets a follow-up" },
] as const;

export type FollowUpValue = (typeof FOLLOWUP_OPTIONS)[number]["value"];

export const TRACKING_OPTIONS = [
  { value: "none", label: "We don't track requests" },
  { value: "scattered", label: "Scattered — inboxes, notes, memory" },
  { value: "centralized", label: "One system shows all request activity" },
] as const;

export type TrackingValue = (typeof TRACKING_OPTIONS)[number]["value"];

export const GAP_OPTIONS = [
  "Requests depend on someone remembering",
  "No follow-up when a request is ignored",
  "Requests go out long after the job",
  "We don't know which customers were asked",
  "No single place to see activity",
  "Our tools aren't connected",
] as const;

export interface ReputationCheckInput {
  businessName: string;
  website?: string;
  businessCategory: string;
  locations: LocationsValue;
  googleRating?: number | null;
  reviewCount?: number | null;
  monthlyJobs: MonthlyJobsValue;
  requestProcess: RequestProcessValue;
  followUp: FollowUpValue;
  tracking: TrackingValue;
  software: string;
  gaps: string[];
}

/** One bullet inside a report section. */
export interface ReportItem {
  /** observed = derived from inputs; provided = customer-stated estimate; action = suggested next step */
  kind: "observed" | "provided" | "gap" | "action";
  text: string;
}

export interface ReportSection {
  id: string;
  title: string;
  items: ReportItem[];
}

export interface ReputationReport {
  businessName: string;
  generatedAt: string;
  /** Estimated review-request opportunities per month, derived from the stated job volume. */
  estimatedMonthlyOpportunities: number | null;
  /** Qualitative process consistency band — derived only from stated answers. */
  consistencyBand: "not_present" | "ad_hoc" | "manual_consistent" | "automated";
  sections: ReportSection[];
}
