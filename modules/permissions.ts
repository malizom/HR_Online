/**
 * Permission model (design doc 03 §6). Roles give firm-wide powers; relationships (self, manager of, assignee)
 * give record-level powers. Every command asks here; the UI uses the same answers to build navigation.
 * There is no approver role: approving follows the organogram (ADR-09) and lives in the workflow engine.
 */
export type Role = "admin" | "manager" | "staff" | "viewer";
export interface Who { id: string; role: Role; isManager: boolean }
export interface About { personId?: string | null; managerId?: string | null }

export type Action =
  | "calendar.view" | "leave.request" | "leave.request_on_behalf" | "leave.view" | "leave.view_reason"
  | "profile.edit_own" | "profile.view" | "profile.view_sensitive"
  | "people.manage" | "people.offboard" | "documents.review" | "onboarding.complete"
  | "settings.manage" | "reports.firm" | "reports.team" | "payroll.export" | "imports.run" | "audit.view"
  | "delegation.manage_own" | "delegation.manage_any" | "dashboard.admin" | "my_information.download"
  // Later releases (scope register D2, E–N)
  | "credentials.manage" | "policies.manage" | "assets.manage" | "announcements.manage" | "offboarding.manage" | "cases.open"
  | "reviews.manage_team" | "roster.view" | "payroll.changes" | "requests.submit";

const ADMIN_ONLY: Action[] = [
  "leave.request_on_behalf", "people.manage", "people.offboard", "documents.review", "onboarding.complete", "settings.manage",
  "reports.firm", "payroll.export", "imports.run", "audit.view", "delegation.manage_any", "dashboard.admin", "profile.view_sensitive",
  "credentials.manage", "policies.manage", "assets.manage", "announcements.manage", "offboarding.manage", "cases.open", "payroll.changes",
];

export function can(who: Who, action: Action, about: About = {}): boolean {
  const self = !!about.personId && about.personId === who.id;
  const isLineManager = !!about.managerId && about.managerId === who.id;
  // Reception (viewer) sees the calendar and the court/office roster (E4) — availability only, never reasons.
  if (who.role === "viewer") return action === "calendar.view" || action === "roster.view";
  if (ADMIN_ONLY.includes(action)) {
    // Sensitive data: the owner sees their own; HR sees everyone's. Managers never see it.
    if (action === "profile.view_sensitive") return who.role === "admin" || self;
    return who.role === "admin";
  }
  switch (action) {
    case "calendar.view": case "leave.request": case "profile.edit_own": case "my_information.download": return true;
    case "leave.view": case "profile.view": case "leave.view_reason": return who.role === "admin" || self || isLineManager;
    case "reports.team": case "delegation.manage_own": case "reviews.manage_team": case "roster.view": return who.role === "admin" || who.isManager;
    case "requests.submit": return true;
    default: return false;
  }
}

/** Navigation entries the person sees (doc 06 §2), derived from `can`, never hard-coded per role. */
export function navFor(who: Who & { onboardingComplete: boolean }) {
  const items: string[] = [];
  if (who.role === "viewer") return ["Team calendar", "Roster"];
  items.push("Home");
  if (!who.onboardingComplete || who.role === "admin") items.push("Onboarding");
  items.push("My leave");
  if (who.isManager || who.role === "admin") items.push("Approvals");
  items.push("Requests", "Team calendar");
  if (can(who, "roster.view")) items.push("Roster");
  items.push("My profile", "Policies", "Performance");
  if (can(who, "people.manage")) items.push("People", "Documents to review", "Credentials", "Assets", "Offboarding", "HR cases", "Announcements");
  if (can(who, "reports.team")) items.push("Reports");
  if (can(who, "settings.manage")) items.push("Settings", "Audit");
  return items;
}
