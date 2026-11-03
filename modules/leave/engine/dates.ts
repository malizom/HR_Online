/** ISO-date helpers (YYYY-MM-DD), all in UTC so results never depend on the server timezone. */
export type ISODate = string;

export const toDate = (s: ISODate) => new Date(`${s}T00:00:00Z`);
export const iso = (d: Date): ISODate => d.toISOString().slice(0, 10);
export const addDays = (s: ISODate, n: number): ISODate => iso(new Date(toDate(s).getTime() + n * 86400000));
/** ISO weekday: 1 = Monday … 7 = Sunday. */
export const weekday = (s: ISODate) => ((toDate(s).getUTCDay() + 6) % 7) + 1;
export const diffDays = (a: ISODate, b: ISODate) => Math.round((toDate(b).getTime() - toDate(a).getTime()) / 86400000);

/** Same day-of-month N months later; clamps to month end (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(s: ISODate, n: number): ISODate {
  const d = toDate(s);
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + n, day = d.getUTCDate();
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(y, m, Math.min(day, last))));
}

/** Whole months completed from `from` up to and including `to` (a month completes on the day before the same date next month). */
export function completedMonths(from: ISODate, to: ISODate): number {
  if (to < from) return 0;
  let m = 0;
  while (addMonths(from, m + 1) <= addDays(to, 1)) m++;
  return m;
}

/** Months m for which `from + m months` has been reached by `to` (cycle indexing: a new cycle starts ON the anniversary). */
export function monthsElapsed(from: ISODate, to: ISODate): number {
  if (to < from) return 0;
  let m = 0;
  while (addMonths(from, m + 1) <= to) m++;
  return m;
}

export function* eachDay(start: ISODate, end: ISODate) {
  for (let d = start; d <= end; d = addDays(d, 1)) yield d;
}

const DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Mon 14 Dec 2026" — doc 06 §5 date style. */
export function longDate(s: ISODate) {
  const d = toDate(s);
  return `${DAY[weekday(s) - 1]} ${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Rounds to 2 dp and normalises -0 to 0. */
export const round2 = (n: number) => (Math.round(n * 100) / 100) || 0;
