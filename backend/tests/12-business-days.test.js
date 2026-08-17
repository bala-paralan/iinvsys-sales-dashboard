'use strict';
/**
 * businessDays.js — first coverage.
 *
 * The framework states its SLAs in BUSINESS days (delivery date confirmed within
 * 1 business day; installation lead time ≤ 5; corrective action within 5).
 * Without this module those quietly become calendar days and every
 * Friday-afternoon event reports as breached on Monday morning — which is the
 * kind of bug that shows up as an unexplained dip in a compliance KPI months
 * later, not as an error.
 *
 * Anchors, all in Asia/Kolkata:
 *   2026-08-13 Thu · 08-14 Fri · 08-15 Sat · 08-16 Sun · 08-17 Mon
 */
const bd = require('../src/utils/businessDays');

/** 06:00Z ≈ 11:30 IST — comfortably mid-day in the business timezone. */
const at = (iso) => new Date(`${iso}T06:00:00Z`);

const ORIGINAL_HOLIDAYS = process.env.HOLIDAYS;
afterEach(() => {
  if (ORIGINAL_HOLIDAYS === undefined) delete process.env.HOLIDAYS;
  else process.env.HOLIDAYS = ORIGINAL_HOLIDAYS;
});

describe('timezone handling', () => {
  it('defaults to Asia/Kolkata', () => {
    expect(bd.TZ).toBe('Asia/Kolkata');
  });

  it('resolves the calendar date in IST, not UTC', () => {
    /* 19:00Z is 00:30 IST the NEXT day. A naive UTC read would call this the
       14th and put a deadline a full day early. */
    expect(bd.isoDateInTz(new Date('2026-08-14T19:00:00Z'))).toBe('2026-08-15');
    expect(bd.isoDateInTz(new Date('2026-08-14T12:00:00Z'))).toBe('2026-08-14');
  });

  it('returns null for an invalid date rather than throwing', () => {
    expect(bd.isoDateInTz(new Date('nonsense'))).toBeNull();
  });
});

describe('weekend and holiday detection', () => {
  it.each([
    ['2026-08-13', false], ['2026-08-14', false],
    ['2026-08-15', true],  ['2026-08-16', true],
    ['2026-08-17', false],
  ])('%s weekend=%s', (iso, expected) => {
    expect(bd.isWeekend(at(iso))).toBe(expected);
  });

  it('reads holidays from the HOLIDAYS env var', () => {
    process.env.HOLIDAYS = '2026-08-13';
    expect(bd.isHoliday(at('2026-08-13'))).toBe(true);
    expect(bd.isBusinessDay(at('2026-08-13'))).toBe(false);
  });

  it('re-reads HOLIDAYS when it changes, rather than serving a stale cache', () => {
    process.env.HOLIDAYS = '2026-08-13';
    expect(bd.isHoliday(at('2026-08-13'))).toBe(true);

    process.env.HOLIDAYS = '2026-08-20';
    expect(bd.isHoliday(at('2026-08-13'))).toBe(false);
    expect(bd.isHoliday(at('2026-08-20'))).toBe(true);
  });

  it('treats an unset HOLIDAYS as weekends-only', () => {
    delete process.env.HOLIDAYS;
    expect(bd.isHoliday(at('2026-08-13'))).toBe(false);
    expect(bd.isBusinessDay(at('2026-08-13'))).toBe(true);
  });

  it('tolerates whitespace and full ISO timestamps in the list', () => {
    process.env.HOLIDAYS = ' 2026-08-13 , 2026-08-20T00:00:00Z ';
    expect(bd.isHoliday(at('2026-08-13'))).toBe(true);
    expect(bd.isHoliday(at('2026-08-20'))).toBe(true);
  });
});

describe('addBusinessDays', () => {
  it('Friday + 1 business day is Monday, not Saturday', () => {
    expect(bd.isoDateInTz(bd.addBusinessDays(at('2026-08-14'), 1))).toBe('2026-08-17');
  });

  it('Thursday + 1 is Friday', () => {
    expect(bd.isoDateInTz(bd.addBusinessDays(at('2026-08-13'), 1))).toBe('2026-08-14');
  });

  it('skips a configured holiday as well as the weekend', () => {
    process.env.HOLIDAYS = '2026-08-17';
    expect(bd.isoDateInTz(bd.addBusinessDays(at('2026-08-14'), 1))).toBe('2026-08-18');
  });

  it('n = 0 returns the instant unchanged, even on a Saturday', () => {
    const sat = at('2026-08-15');
    expect(bd.addBusinessDays(sat, 0).getTime()).toBe(sat.getTime());
  });

  it('walks backwards for a negative n', () => {
    expect(bd.isoDateInTz(bd.addBusinessDays(at('2026-08-17'), -1))).toBe('2026-08-14');
  });

  it('preserves the time of day', () => {
    const t = new Date('2026-08-14T09:17:33Z');
    expect(bd.addBusinessDays(t, 1).toISOString().slice(11)).toBe(t.toISOString().slice(11));
  });

  it('the 5-business-day SLA from a Thursday lands on the following Thursday', () => {
    /* Thu → Fri, Mon, Tue, Wed, Thu. Calendar days would say Tuesday, which is
       what the corrective-action SLA would wrongly enforce without this. */
    expect(bd.isoDateInTz(bd.addBusinessDays(at('2026-08-13'), 5))).toBe('2026-08-20');
  });
});

describe('businessDaysBetween', () => {
  it('counts Thursday → Friday as one', () => {
    expect(bd.businessDaysBetween(at('2026-08-13'), at('2026-08-14'))).toBe(1);
  });

  it('does not count the weekend', () => {
    expect(bd.businessDaysBetween(at('2026-08-14'), at('2026-08-17'))).toBe(1);
  });

  it('is zero across the same day', () => {
    expect(bd.businessDaysBetween(at('2026-08-13'), at('2026-08-13'))).toBe(0);
  });

  it('is negative when the range runs backwards', () => {
    expect(bd.businessDaysBetween(at('2026-08-17'), at('2026-08-14'))).toBe(-1);
  });

  it('excludes a configured holiday', () => {
    process.env.HOLIDAYS = '2026-08-14';
    expect(bd.businessDaysBetween(at('2026-08-13'), at('2026-08-17'))).toBe(1);
  });

  it('returns 0 for an invalid input rather than NaN', () => {
    expect(bd.businessDaysBetween(new Date('nope'), at('2026-08-13'))).toBe(0);
  });
});

describe('isPastBusinessDays — the shape the SLA sweeps use', () => {
  it('a Friday event is not yet 1 business day overdue on Monday', () => {
    expect(bd.isPastBusinessDays(at('2026-08-14'), 1, at('2026-08-17'))).toBe(false);
  });

  it('the same event IS overdue by Tuesday', () => {
    expect(bd.isPastBusinessDays(at('2026-08-14'), 1, at('2026-08-18'))).toBe(true);
  });

  it('a weekend alone never breaches a 1-business-day SLA', () => {
    expect(bd.isPastBusinessDays(at('2026-08-14'), 1, at('2026-08-16'))).toBe(false);
  });
});

describe('calendar helpers', () => {
  it('hoursBetween is signed and fractional', () => {
    expect(bd.hoursBetween(new Date('2026-08-13T00:00:00Z'), new Date('2026-08-13T12:30:00Z'))).toBe(12.5);
    expect(bd.hoursBetween(new Date('2026-08-13T12:00:00Z'), new Date('2026-08-13T00:00:00Z'))).toBe(-12);
  });

  it('hoursBetween drives the 48-hour delay rule', () => {
    expect(bd.hoursBetween(new Date('2026-08-13T00:00:00Z'), new Date('2026-08-15T00:00:00Z'))).toBe(48);
  });

  it('calendarDaysBetween ignores time of day', () => {
    expect(bd.calendarDaysBetween(new Date('2026-08-13T23:00:00Z'), new Date('2026-08-14T01:00:00Z'))).toBe(0);
    expect(bd.calendarDaysBetween(at('2026-08-13'), at('2026-08-16'))).toBe(3);
  });

  it('calendarDaysBetween counts weekends, unlike its business-day counterpart', () => {
    expect(bd.calendarDaysBetween(at('2026-08-14'), at('2026-08-17'))).toBe(3);
    expect(bd.businessDaysBetween(at('2026-08-14'), at('2026-08-17'))).toBe(1);
  });

  it('addDays is plain calendar arithmetic', () => {
    expect(bd.isoDateInTz(bd.addDays(at('2026-08-14'), 1))).toBe('2026-08-15');
  });
});
