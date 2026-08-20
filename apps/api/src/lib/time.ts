/**
 * Timezone helpers.
 *
 * Everything is stored in UTC, but "today" and "this month" are questions about
 * the user's wall clock — a follow-up at 09:00 in Kolkata is not today in UTC.
 * These turn a zone name into the UTC instants that bound a local day or month.
 */

/**
 * Milliseconds to add to a UTC instant to get the local wall-clock reading.
 *
 * Intl has no millisecond field, so the instant is truncated to whole seconds
 * before comparing — otherwise the sub-second part leaks into the offset and
 * every end-of-day boundary lands a fraction late.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const whole = new Date(Math.floor(instant.getTime() / 1000) * 1000);

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(whole);

  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const asIfUtc = Date.UTC(
    Number(lookup.year),
    Number(lookup.month) - 1,
    Number(lookup.day),
    // Intl renders midnight as hour 24 in some locales; normalise it.
    Number(lookup.hour) % 24,
    Number(lookup.minute),
    Number(lookup.second),
  );

  return asIfUtc - whole.getTime();
}

/** The local calendar date, as `{ year, month, day }` in the given zone. */
function localParts(instant: Date, timeZone: string): { year: number; month: number; day: number } {
  const iso = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);

  const [year, month, day] = iso.split('-').map(Number);
  return { year: year!, month: month!, day: day! };
}

/** Converts a local wall-clock reading in `timeZone` into the UTC instant. */
function fromLocal(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  // Two passes settle the offset even when a day crosses a DST boundary.
  let instant = new Date(naive - zoneOffsetMs(new Date(naive), timeZone));
  instant = new Date(naive - zoneOffsetMs(instant, timeZone));
  return instant;
}

export interface Range {
  start: Date;
  end: Date;
}

/** Midnight to 23:59:59.999 of the local day containing `now`. */
export function dayRange(now: Date, timeZone: string): Range {
  const { year, month, day } = localParts(now, timeZone);
  const start = fromLocal(timeZone, year, month, day);
  // Derive the end from the next day's midnight rather than building 23:59:59.999
  // directly, so the boundary can never drift by a fraction of a second.
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1));
  const nextStart = fromLocal(
    timeZone,
    nextDay.getUTCFullYear(),
    nextDay.getUTCMonth() + 1,
    nextDay.getUTCDate(),
  );
  return { start, end: new Date(nextStart.getTime() - 1) };
}

/** From the start of the local day containing `now`, forward `days` days. */
export function forwardRange(now: Date, timeZone: string, days: number): Range {
  const today = dayRange(now, timeZone);
  return { start: now, end: new Date(today.end.getTime() + (days - 1) * 86_400_000) };
}

/** First to last instant of the local month containing `now`. */
export function monthRange(now: Date, timeZone: string): Range {
  const { year, month } = localParts(now, timeZone);
  const nextMonth = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return {
    start: fromLocal(timeZone, year, month, 1),
    end: new Date(fromLocal(timeZone, nextMonth.year, nextMonth.month, 1).getTime() - 1),
  };
}

/** The last `count` local months, oldest first, each as a labelled range. */
export function recentMonths(
  now: Date,
  timeZone: string,
  count: number,
): Array<Range & { key: string; label: string }> {
  const { year, month } = localParts(now, timeZone);
  const months: Array<Range & { key: string; label: string }> = [];

  for (let back = count - 1; back >= 0; back -= 1) {
    const offset = month - 1 - back;
    const targetYear = year + Math.floor(offset / 12);
    const targetMonth = ((offset % 12) + 12) % 12 + 1;
    const next =
      targetMonth === 12
        ? { year: targetYear + 1, month: 1 }
        : { year: targetYear, month: targetMonth + 1 };

    months.push({
      key: `${targetYear}-${String(targetMonth).padStart(2, '0')}`,
      label: new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(
        new Date(Date.UTC(targetYear, targetMonth - 1, 1)),
      ),
      start: fromLocal(timeZone, targetYear, targetMonth, 1),
      end: new Date(fromLocal(timeZone, next.year, next.month, 1).getTime() - 1),
    });
  }

  return months;
}
