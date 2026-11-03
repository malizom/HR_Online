/**
 * South African public holidays (Public Holidays Act 36 of 1994). A holiday falling on a Sunday
 * is observed on the following Monday (s2(1)). Easter-based holidays are computed.
 */
export interface Holiday { date: string; observedDate: string; name: string }

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

/** Anonymous Gregorian algorithm (Meeus/Jones/Butcher). */
export function easterSunday(y: number): Date {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return utc(y, month, day);
}

export function saPublicHolidays(year: number): Holiday[] {
  const easter = easterSunday(year);
  const list: [Date, string][] = [
    [utc(year, 1, 1), "New Year's Day"],
    [utc(year, 3, 21), "Human Rights Day"],
    [addDays(easter, -2), "Good Friday"],
    [addDays(easter, 1), "Family Day"],
    [utc(year, 4, 27), "Freedom Day"],
    [utc(year, 5, 1), "Workers' Day"],
    [utc(year, 6, 16), "Youth Day"],
    [utc(year, 8, 9), "National Women's Day"],
    [utc(year, 9, 24), "Heritage Day"],
    [utc(year, 12, 16), "Day of Reconciliation"],
    [utc(year, 12, 25), "Christmas Day"],
    [utc(year, 12, 26), "Day of Goodwill"],
  ];
  return list.map(([d, name]) => ({ date: iso(d), observedDate: iso(d.getUTCDay() === 0 ? addDays(d, 1) : d), name }));
}
