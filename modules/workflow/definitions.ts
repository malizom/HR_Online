/**
 * Workflow definitions (doc 01 §4 "Workflow engine", ADR-07; doc 02 §6).
 * Definitions live in code and are versioned; instances record the version they started on.
 * S0 ships leave_request v1 (approval only). S2 adds awaiting_cover and handover states as v2.
 */
export type Who = "assignee" | "admin" | "owner";

export interface Transition { from: string[]; action: string; to: string; who: Who[]; requiresComment?: boolean }
export interface Definition { key: string; version: number; initial: string; terminal: string[]; transitions: Transition[] }

export const DEFINITIONS: Record<string, Definition> = {
  leave_request: {
    key: "leave_request",
    version: 1,
    initial: "pending_approval",
    terminal: ["declined", "cancelled", "completed"],
    transitions: [
      { from: ["pending_approval"], action: "approve", to: "approved", who: ["assignee", "admin"] },
      { from: ["pending_approval"], action: "decline", to: "declined", who: ["assignee", "admin"] },
      { from: ["pending_approval", "approved"], action: "cancel", to: "cancelled", who: ["owner"] },
      { from: ["approved"], action: "complete", to: "completed", who: ["admin"] },
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
