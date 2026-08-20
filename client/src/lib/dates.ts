export const MS_DAY = 86_400_000;

export function toIso(d: Date): string {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10);
}

export function fromIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayIso(): string {
  return toIso(new Date());
}

export function addDays(iso: string, n: number): string {
  const d = fromIso(iso);
  d.setDate(d.getDate() + n);
  return toIso(d);
}

export function diffDays(a: string, b: string): number {
  return Math.round((fromIso(b).getTime() - fromIso(a).getTime()) / MS_DAY);
}

/** Inclusive day count, matching the "Days" column of the spreadsheet. */
export function durationDays(start: string | null, end: string | null): number {
  if (!start || !end) return 0;
  return diffDays(start, end) + 1;
}

export function rangeBetween(start: string, end: string): string[] {
  const out: string[] = [];
  let cursor = start;
  let guard = 0;
  while (cursor <= end && guard++ < 3650) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

/** Monday of the week containing `iso`. */
export function startOfWeek(iso: string): string {
  const d = fromIso(iso);
  const shift = (d.getDay() + 6) % 7;
  return addDays(iso, -shift);
}

export function isWeekend(iso: string): boolean {
  const day = fromIso(iso).getDay();
  return day === 0 || day === 6;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "8/17" — the compact label used in the spreadsheet's day header. */
export function shortDay(iso: string): string {
  const d = fromIso(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function dayOfWeek(iso: string): string {
  return DOW[fromIso(iso).getDay()];
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = fromIso(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function formatShort(iso: string | null): string {
  if (!iso) return '—';
  const d = fromIso(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function monthLabel(iso: string): string {
  const d = fromIso(iso);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

export function monthName(month: number): string {
  return MONTHS[month];
}

/** Days in the given month, laid out as calendar weeks starting Monday. */
export function monthGrid(year: number, month: number): (string | null)[][] {
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const total = new Date(year, month + 1, 0).getDate();
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= total; day += 1) cells.push(toIso(new Date(year, month, day)));
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
