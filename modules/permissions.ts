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
  | "delegation.manage_own" | "delegation.manage_any" | "dashboard.admin" | "my_information.download";

const ADMIN_ONLY: Action[] = [
  "leave.request_on_behalf", "people.manage", "people.offboard", "documents.review", "onboarding.complete", "settings.manage",
  "reports.firm", "payroll.export", "imports.run", "audit.view", "delegation.manage_any", "dashboard.admin", "profile.view_sensitive",
];

export function can(who: Who, action: Action, about: About = {}): boolean {
  const self = !!about.personId && about.personId === who.id;
  const isLineManager = !!about.managerId && about.managerId === who.id;
  if (who.role === "viewer") return action === "calendar.view";
  if (ADMIN_ONLY.includes(action)) {
    // Sensitive data: the owner sees their own; HR sees everyone's. Managers never see it.
    if (action === "profile.view_sensitive") return who.role === "admin" || self;
    return who.role === "admin";
  }
  switch (action) {
    case "calendar.view": case "leave.request": case "profile.edit_own": case "my_information.download": return true;
    case "leave.view": case "profile.view": case "leave.view_reason": return who.role === "admin" || self || isLineManager;
    case "reports.team": case "delegation.manage_own": return who.role === "admin" || who.isManager;
    default: return false;
  }
}

/** Navigation entries the person sees (doc 06 §2), derived from `can`, never hard-coded per role. */
export function navFor(who: Who & { onboardingComplete: boolean }) {
  const items: string[] = [];
  if (who.role === "viewer") return ["Team calendar"];
  items.push("Home");
  if (!who.onboardingComplete || who.role === "admin") items.push("Onboarding");
  items.push("My leave");
  if (who.isManager || who.role === "admin") items.push("Approvals");
  items.push("Team calendar", "My profile");
  if (can(who, "people.manage")) items.push("People", "Documents to review");
  if (can(who, "reports.team")) items.push("Reports");
  if (can(who, "settings.manage")) items.push("Settings", "Audit");
  return items;
}
