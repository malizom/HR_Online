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
  settings: any; emergencyContact: { name: string; relationship: string; phone: string } | null;
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
  const green = ["Verified", "Approved", "Complete", "Acknowledged", "Handed over", "Accepted", "succeeded"];
  const red = ["Rejected", "Declined", "Cover declined", "failed", "Certificate needed"];
  const amber = ["Pending", "Awaiting cover", "In review", "Handover due", "Not acknowledged", "On notice"];
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
