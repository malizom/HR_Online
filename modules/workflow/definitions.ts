/**
 * Workflow definitions (doc 01 §4 "Workflow engine", ADR-07; doc 02 §6).
 * Definitions live in code and are versioned; instances record the version they started on.
 * leave_request v2 adds the cover step; handover is tracked on the coverage request, not as a state.
 */
export type Who = "assignee" | "admin" | "owner";

export interface Transition { from: string[]; action: string; to: string; who: Who[]; requiresComment?: boolean }
export interface Definition { key: string; version: number; initial: string; terminal: string[]; transitions: Transition[] }

export const DEFINITIONS: Record<string, Definition> = {
  /** v2 (doc 05 §1): fee-earners arrange cover before the request reaches the approver. */
  leave_request: {
    key: "leave_request",
    version: 2,
    initial: "pending_approval",
    terminal: ["declined", "cancelled", "completed"],
    transitions: [
      { from: ["awaiting_cover"], action: "accept_cover", to: "pending_approval", who: ["assignee"] },
      { from: ["awaiting_cover"], action: "decline_cover", to: "cover_declined", who: ["assignee"], requiresComment: true },
      { from: ["cover_declined"], action: "renominate", to: "awaiting_cover", who: ["owner"] },
      { from: ["pending_approval"], action: "approve", to: "approved", who: ["assignee", "admin"] },
      { from: ["pending_approval"], action: "decline", to: "declined", who: ["assignee", "admin"], requiresComment: true },
      { from: ["awaiting_cover", "cover_declined", "pending_approval", "approved"], action: "cancel", to: "cancelled", who: ["owner", "admin"] },
      { from: ["approved"], action: "complete", to: "completed", who: ["admin"] },
    ],
  },
  /** E1, E3, K1, G4 — one manager decision; expenses then get a paid marker from HR. */
  hr_approval: {
    key: "hr_approval", version: 1, initial: "pending_approval", terminal: ["declined", "cancelled", "paid", "approved_final"],
    transitions: [
      { from: ["pending_approval"], action: "approve", to: "approved", who: ["assignee", "admin"] },
      { from: ["pending_approval"], action: "decline", to: "declined", who: ["assignee", "admin"], requiresComment: true },
      { from: ["pending_approval"], action: "cancel", to: "cancelled", who: ["owner"] },
      { from: ["approved"], action: "mark_paid", to: "paid", who: ["admin"] },
    ],
  },
  /** I2 — training needs the manager and then HR (cost). */
  hr_approval_two_step: {
    key: "hr_approval_two_step", version: 1, initial: "pending_manager", terminal: ["approved", "declined", "cancelled"],
    transitions: [
      { from: ["pending_manager"], action: "approve_manager", to: "pending_hr", who: ["assignee"] },
      { from: ["pending_manager", "pending_hr"], action: "approve", to: "approved", who: ["admin"] },
      { from: ["pending_manager", "pending_hr"], action: "decline", to: "declined", who: ["assignee", "admin"], requiresComment: true },
      { from: ["pending_manager", "pending_hr"], action: "cancel", to: "cancelled", who: ["owner"] },
    ],
  },
  /** M1 — staff requests to HR (letters, certificates, UIF forms, queries). */
  hr_service: {
    key: "hr_service", version: 1, initial: "open", terminal: ["completed", "cancelled"],
    transitions: [
      { from: ["open"], action: "start", to: "in_progress", who: ["admin"] },
      { from: ["open", "in_progress"], action: "complete", to: "completed", who: ["admin"] },
      { from: ["open"], action: "cancel", to: "cancelled", who: ["owner"] },
    ],
  },
  /** H1 — probation: the manager (or HR) confirms, extends or ends it; outcome letter generated. */
  probation: {
    key: "probation", version: 1, initial: "in_progress", terminal: ["confirmed", "terminated"],
    transitions: [
      { from: ["in_progress", "extended"], action: "confirm", to: "confirmed", who: ["assignee", "admin"] },
      { from: ["in_progress"], action: "extend", to: "extended", who: ["assignee", "admin"], requiresComment: true },
      { from: ["in_progress", "extended"], action: "terminate", to: "terminated", who: ["admin"], requiresComment: true },
    ],
  },
  /** H2 — review cycle: self-assessment → manager feedback and rating → employee acknowledges → locked. */
  review: {
    key: "review", version: 1, initial: "self_assessment", terminal: ["locked"],
    transitions: [
      { from: ["self_assessment"], action: "submit_self", to: "manager_review", who: ["owner"] },
      { from: ["manager_review"], action: "submit_feedback", to: "employee_ack", who: ["assignee", "admin"] },
      { from: ["employee_ack"], action: "acknowledge", to: "locked", who: ["owner"] },
    ],
  },
  onboarding: {
    key: "onboarding",
    version: 1,
    initial: "draft",
    terminal: ["complete"],
    transitions: [
      { from: ["draft"], action: "submit", to: "in_review", who: ["owner"] },
      { from: ["in_review"], action: "return", to: "draft", who: ["admin"], requiresComment: true },
      { from: ["in_review"], action: "complete", to: "complete", who: ["admin"] },
    ],
  },
};

export function definition(key: string): Definition {
  const d = DEFINITIONS[key];
  if (!d) throw new Error(`Unknown workflow ${key}`);
  return d;
}
