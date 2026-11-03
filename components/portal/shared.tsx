"use client";
// Shared types and helpers for the portal screens (design doc 06).

export type Role = "admin" | "manager" | "staff" | "viewer";
export type Person = {
  id: string; owner: string; name: string; email: string; role: Role; status: "Draft" | "In review" | "Complete"; admitted: boolean;
  phone?: string; title?: string; department?: string; departmentId?: string | null; start?: string; reportsToId?: string | null;
  isManager?: boolean; directReports?: number; isFeeEarner?: boolean; employeeNo?: string; employmentStatus?: string; lastWorkingDay?: string; employmentType?: string;
};
export type Doc = { id: string; owner: string; category: string; name: string; status: string; reason?: string };
export type CoverItem = { matterRef: string; itemType: string; due: string; location: string };
export type Leave = {
  id: string; owner: string; name: string; type: string; typeCode: string; start: string; end: string; startHalf?: string | null; endHalf?: string | null;
  days: number | null; note?: string; reason?: string; status: string; state: string; requestNo?: string; actions: string[];
  balanceAfter: number | null; clashCount: number; warnings: string[]; certificateRequired: boolean; certificateReceived: boolean; certificateDocumentId: string | null;
  cover: { name: string; personId: string; handoverConfirmed: boolean; received: boolean; items: CoverItem[] } | null;
};
export type Balance = {
  code: string; label: string; cycleStart: string; cycleEnd: string; entitlement: number; available: number; projected: number;
  taken: number; reserved: number; accrued: number; carriedIn: number; carriedExpires: string | null;
  statement: { date: string; kind: string; days: number; reason: string }[];
};
export type CalEntry = { id: string; name: string; start: string; end: string };
export type Category = { code: string; label: string; description: string; appliesWhen: string; required: boolean };
export type Colleague = { id: string; name: string; department: string; isFeeEarner: boolean; title: string };
export type HrData = {
  me: Person; people: Person[]; colleagues: Colleague[]; documents: Doc[]; leave: Leave[]; calendar: CalEntry[]; today: string;
  departments: { id: string; name: string }[]; leaveTypes: { id: string; code: string; label: string; category: string; allowsHalfDay: boolean; requiresCover: boolean }[];
  categories: Category[]; firm: { name: string; primary: string; accent: string };
  nav: string[]; can: { onBehalf: boolean; payroll: boolean; imports: boolean };
  balances: Balance[]; holidays: { date: string; name: string }[]; closures: { name: string; start: string; end: string }[];
  acknowledgements: { id: string; title: string; issuedAt: string; acknowledgedAt: string | null; text: string }[];
  delegations: { id: string; delegatorId: string; delegateId: string; start: string; end: string }[];
  dashboard: Record<string, any> | null; team: { approvalsWaiting: number; oldestDays: number; teamAwayThisWeek: number; teamSize: number } | null;
  demo?: boolean; settings: any; emergencyContact: { name: string; relationship: string; phone: string } | null;
  // Later releases (R2/R3)
  requests: any[]; reviews: any[]; assets: { assets: any[]; mine: any[] }; policies: any[]; announcements: any[]; offboardings: any[];
  reminders: { text: string; page: string; level: "info" | "warn" | "alert" }[];
  requestKinds: Record<string, string>; letterTemplates: Record<string, string>; credentialKinds: Record<string, string>;
};

/** Which release each later feature belongs to (scope register). R1 is the go-live scope; the rest is shown in the demo with a label. */
export const RELEASE: Record<string, "R2" | "R3"> = {
  Requests: "R2", Policies: "R2", Performance: "R2", Credentials: "R2", Offboarding: "R2", Roster: "R2",
  Assets: "R3", "HR cases": "R3", Announcements: "R3",
};
export function Rel({ r }: { r?: string }) { return r ? <span className="rel" title={`Planned for release ${r.slice(1)} — shown in the demo`}>{r}</span> : null; }

export const get = async (q: string) => { const r = await fetch(`/api/hr?${q}`); const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; };
export const STATE_LABEL: Record<string, string> = {
  pending_approval: "Pending", pending_manager: "With manager", pending_hr: "With HR", approved: "Approved", declined: "Declined", cancelled: "Cancelled", paid: "Paid",
  open: "Open", in_progress: "In progress", completed: "Complete", self_assessment: "Self-assessment", manager_review: "Manager review", employee_ack: "To acknowledge",
  locked: "Complete", confirmed: "Confirmed", extended: "Extended", terminated: "Ended",
};
export const ACTION_LABEL: Record<string, string> = {
  approve: "Approve", approve_manager: "Approve (manager)", decline: "Decline", cancel: "Withdraw", mark_paid: "Mark paid", start: "Start", complete: "Complete",
  submit_self: "Submit self-assessment", submit_feedback: "Submit feedback", acknowledge: "Acknowledge", confirm: "Confirm appointment", extend: "Extend probation", terminate: "End employment",
};

export type Post = (body: FormData | Record<string, unknown>, opts?: { reload?: boolean }) => Promise<any>;

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Mon 14 Dec 2026" (doc 06 §5). */
export function longDate(s?: string | null) {
  if (!s) return "—";
  const d = new Date(`${s.slice(0, 10)}T00:00:00Z`);
  return `${DAY[d.getUTCDay()]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
export const shortDate = (s?: string | null) => (s ? longDate(s).split(" ").slice(1).join(" ") : "—");
export const range = (a: string, b: string) => (a === b ? longDate(a) : `${longDate(a)} → ${longDate(b)}`);
export const days = (n: number | null | undefined) => (n == null ? "—" : `${Number(n).toFixed(n % 1 ? 1 : 0)} ${Number(n) === 1 ? "day" : "days"}`);
export const nameOf = (list: { id: string; name: string }[], id?: string | null) => list.find(x => x.id === id)?.name ?? "—";

export function Badge({ s }: { s: string }) {
  const green = ["Verified", "Approved", "Complete", "Acknowledged", "Handed over", "Accepted", "succeeded", "Valid", "Paid", "Confirmed", "Office", "Returned"];
  const red = ["Rejected", "Declined", "Cover declined", "failed", "Certificate needed", "Lapsed", "Ended"];
  const amber = ["Pending", "Awaiting cover", "In review", "Handover due", "Not acknowledged", "On notice", "Expiring", "With manager", "With HR", "Self-assessment", "Manager review", "To acknowledge", "Open", "In progress", "Extended", "Away"];
  return <span className={"badge " + (green.includes(s) ? "green" : red.includes(s) ? "red" : amber.includes(s) ? "amber" : "")}>{s}</span>;
}

export function Field({ name, label, type = "text", def = "", req = false, ...rest }: { name: string; label: string; type?: string; def?: string | number; req?: boolean } & React.InputHTMLAttributes<HTMLInputElement>) {
  return <label>{label}<input name={name} type={type} defaultValue={def} required={req} {...rest} /></label>;
}

export function download(fileName: string, content: string, mime = "text/csv") {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement("a");
  a.href = url; a.download = fileName; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const KIND_LABEL: Record<string, string> = {
  opening: "Opening balance", accrual: "Earned", taken: "Taken", reversal: "Cancelled — returned", adjustment: "Adjustment",
  carry_over_in: "Carried in", carry_over_out: "Carried out", forfeiture: "Forfeited", payout: "Paid out", closure: "Firm closure",
};
