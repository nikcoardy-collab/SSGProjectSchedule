const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(v) {
  if (typeof v !== 'string' || !ISO.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * Normalises a set of picked days into the shape the schedule stores.
 * The rule from the spreadsheet: with several days picked, the task starts on the
 * earliest and ends on the latest; the individual picks are kept so the Gantt can
 * show gaps (e.g. work paused over a weekend).
 */
export function normaliseDates(selected) {
  if (!Array.isArray(selected)) return { selectedDates: [], startDate: null, endDate: null };
  const days = [...new Set(selected.filter(isIsoDate))].sort();
  if (days.length === 0) return { selectedDates: [], startDate: null, endDate: null };
  return { selectedDates: days, startDate: days[0], endDate: days[days.length - 1] };
}

/** Inclusive list of ISO days between two ISO dates. */
export function expandRange(start, end) {
  if (!isIsoDate(start) || !isIsoDate(end)) return [];
  const out = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  if (last < cursor) return [];
  while (cursor <= last) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

export function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
