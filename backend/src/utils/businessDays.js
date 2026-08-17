'use strict';

/**
 * businessDays.js — business-day arithmetic in Asia/Kolkata.
 *
 * The framework's SLAs are stated in BUSINESS days, not calendar days:
 *   · delivery date confirmed within 1 business day of Work Order acceptance
 *   · installation lead time <= 5 business days
 *   · corrective action plan documented within 5 business days
 *
 * Without this module those SLAs silently become calendar days and every
 * Friday-afternoon event reports as breached on Monday morning.
 *
 * Weekend = Saturday + Sunday. Public holidays come from the HOLIDAYS env var,
 * a comma-separated list of ISO dates, e.g.
 *   HOLIDAYS=2026-01-26,2026-03-25,2026-08-15,2026-10-02
 * Leave it unset and only weekends are excluded.
 */

const TZ = process.env.TZ_BUSINESS || 'Asia/Kolkata';

let _holidayCache = null;
let _holidaySource = null;

/** ISO date strings (YYYY-MM-DD) treated as non-working days. */
function holidays() {
  const raw = process.env.HOLIDAYS || '';
  if (_holidaySource !== raw) {
    _holidaySource = raw;
    _holidayCache = new Set(
      raw.split(',').map((s) => s.trim()).filter(Boolean)
        .map((s) => s.slice(0, 10)),
    );
  }
  return _holidayCache;
}

/** The calendar date in the business timezone, as YYYY-MM-DD. */
function isoDateInTz(date, tz = TZ) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  /* en-CA formats as YYYY-MM-DD, which is what we want. */
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

/** Day of week in the business timezone: 0 = Sunday .. 6 = Saturday. */
function dayOfWeekInTz(date, tz = TZ) {
  const d = date instanceof Date ? date : new Date(date);
  const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name);
}

function isWeekend(date) {
  const dow = dayOfWeekInTz(date);
  return dow === 0 || dow === 6;
}

function isHoliday(date) {
  const iso = isoDateInTz(date);
  return iso !== null && holidays().has(iso);
}

function isBusinessDay(date) {
  return !isWeekend(date) && !isHoliday(date);
}

/**
 * Add N business days to a date, preserving the time of day.
 * addBusinessDays(friday, 1) → the following Monday.
 * N = 0 returns the input unchanged, even on a weekend.
 */
function addBusinessDays(date, n) {
  const d = new Date(date instanceof Date ? date.getTime() : new Date(date).getTime());
  if (!Number.isFinite(n) || n === 0) return d;
  const step = n > 0 ? 1 : -1;
  let remaining = Math.abs(Math.trunc(n));
  while (remaining > 0) {
    d.setDate(d.getDate() + step);
    if (isBusinessDay(d)) remaining -= 1;
  }
  return d;
}

/**
 * Whole business days between two instants, `from` exclusive and `to` inclusive.
 * Returns a negative number when `to` precedes `from`.
 */
function businessDaysBetween(from, to) {
  const a = from instanceof Date ? new Date(from) : new Date(from);
  const b = to instanceof Date ? new Date(to) : new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;

  const sign = b >= a ? 1 : -1;
  const start = sign === 1 ? a : b;
  const end   = sign === 1 ? b : a;

  /* Walk calendar dates so partial days at either end do not double-count. */
  let count = 0;
  const cursor = new Date(start);
  const endIso = isoDateInTz(end);
  /* Guard against pathological inputs (a stray year-3000 date). */
  let guard = 0;
  while (isoDateInTz(cursor) !== endIso && guard < 20000) {
    cursor.setDate(cursor.getDate() + 1);
    if (isBusinessDay(cursor)) count += 1;
    guard += 1;
  }
  return sign * count;
}

/** True when `to` is more than `n` business days after `from`. */
function isPastBusinessDays(from, n, now) {
  const ref = now instanceof Date ? now : new Date();
  return businessDaysBetween(from, ref) > n;
}

/** Whole hours between two instants. Negative when `to` precedes `from`. */
function hoursBetween(from, to) {
  const a = from instanceof Date ? from : new Date(from);
  const b = to instanceof Date ? to : new Date(to);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return (b.getTime() - a.getTime()) / 3600000;
}

/** Calendar days between two instants, ignoring time of day. */
function calendarDaysBetween(from, to) {
  const a = new Date(isoDateInTz(from) + 'T00:00:00Z');
  const b = new Date(isoDateInTz(to) + 'T00:00:00Z');
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.round((b - a) / 86400000);
}

function addDays(date, n) {
  const d = new Date(date instanceof Date ? date.getTime() : new Date(date).getTime());
  d.setDate(d.getDate() + n);
  return d;
}

/* ── Reporting windows ────────────────────────────────────────────────────
   The KPI endpoints report over calendar months in the BUSINESS timezone, not
   in UTC. A delivery signed at 09:00 IST on 1 August is 03:30 UTC on 1 August
   — but one signed at 02:00 IST on 1 August is 20:30 UTC on 31 JULY, and a
   UTC-bounded query would count it in the wrong month. These helpers convert
   an IST wall-clock date to the instant it actually occurred at. */

/** Milliseconds the tz wall clock is ahead of UTC at `date`. */
function tzOffsetMs(date, tz = TZ) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(date).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = Number(p.value);
    return acc;
  }, {});
  /* hour 24 is how en-CA renders midnight under hour12:false. */
  const hour = parts.hour === 24 ? 0 : parts.hour;
  return Date.UTC(parts.year, parts.month - 1, parts.day, hour, parts.minute, parts.second)
       - date.getTime();
}

/**
 * The instant at which the given wall-clock midnight occurs in `tz`.
 * Iterated twice so a zone whose offset changes across the boundary (DST)
 * still converges. Asia/Kolkata has no DST, so the first pass is exact.
 */
function startOfDayInTz(y, m, d, tz = TZ) {
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0);
  let guess = naive;
  for (let i = 0; i < 2; i += 1) guess = naive - tzOffsetMs(new Date(guess), tz);
  return new Date(guess);
}

/** Parse a YYYY-MM-DD string to the instant that day begins in `tz`. */
function dayStart(iso, tz = TZ) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return null;
  return startOfDayInTz(Number(m[1]), Number(m[2]), Number(m[3]), tz);
}

/**
 * A calendar-month window, HALF-OPEN: `[from, to)`.
 *
 * Half-open on purpose. An inclusive `to` set to the last day's midnight
 * silently drops everything that happened during that last day — the classic
 * off-by-one that makes a month-end report understate itself. `label` is still
 * rendered inclusively (`2026-07-01..2026-07-31`) because that is what a human
 * means by a July report.
 *
 * @param {Date}   now
 * @param {number} monthsBack 0 = the month `now` falls in, 1 = the one before
 */
function monthWindow(now = new Date(), monthsBack = 1, tz = TZ) {
  const iso = isoDateInTz(now, tz);
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  /* Date.UTC normalises month 0 and 13, so no manual year rollover. */
  const anchor = new Date(Date.UTC(y, m - 1 - monthsBack, 1));
  const ay = anchor.getUTCFullYear();
  const am = anchor.getUTCMonth() + 1;
  const from = startOfDayInTz(ay, am, 1, tz);
  const to = startOfDayInTz(am === 12 ? ay + 1 : ay, am === 12 ? 1 : am + 1, 1, tz);
  return { from, to, label: `${isoDateInTz(from, tz)}..${isoDateInTz(new Date(to - 1), tz)}` };
}

module.exports = {
  TZ,
  isoDateInTz, dayOfWeekInTz,
  isWeekend, isHoliday, isBusinessDay,
  addBusinessDays, businessDaysBetween, isPastBusinessDays,
  hoursBetween, calendarDaysBetween, addDays,
  tzOffsetMs, startOfDayInTz, dayStart, monthWindow,
};
