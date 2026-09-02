// cligentic block: date-filter
//
// Parsing + resolution for the --from and --last global flags.
// Centralizes the rules so every list-style command can filter uniformly.
//
// Date input (--from):
//   • Supports any date-fns parseable format. ISO 8601 strings are tried first
//     and are preferred (YYYY-MM-DD, YYYY-MM-DDTHH:mm:ssZ, etc.).
//   • When only a day is present (e.g. "15"), it's interpreted as day-15 of the
//     current month and year.
//   • When only month + day are present (e.g. "03-15" or "15-03"), the year is
//     filled with the current year. Ambiguous day-first inputs are rejected.
//   • A full date is always required — empty input is an error.
//
// Duration input (--last):
//   • Format: <n>y<n>m<n>d<n>h<n>m<n>s  (e.g. "1y2m3d4h5m6s", "7d", "24h").
//   • At least one indicator is required.
//   • Each indicator (y/m/d/h/m/s) may appear at most once.
//
// Resolution:
//   • --from sets the start of the window.
//   • --last is a shortcut for "the past <duration> ending now".
//   • Both may be combined: --from becomes the start and --last is ignored when
//     --from is present (we throw on conflict for clarity).
//
// Usage:
//   import { resolveDateRange, applyDateFilter } from "./foundation/date-filter";
//
//   const range = resolveDateRange(globals.from, globals.last);
//   const filtered = applyDateFilter(items, range, (item) => item.updateTime);

import { parse, isValid } from "date-fns";
import { AppError } from "./error-map.js";

export type DateRange = { from?: Date; to?: Date };

const DURATION_PATTERN = /^(?:(\d+)y)?(?:(\d+)m)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/;
//                                                            ^ second "m" (minutes) lives here

/**
 * Parse a free-form date string into a Date.
 *
 * Behavior:
 *  - ISO 8601 strings are tried first via Date constructor (handles full
 *    timestamps with timezone info).
 *  - dayjs/date-fns formats like "yyyy-MM-dd", "yyyy-MM-dd HH:mm:ss",
 *    "yyyy/MM/dd", "MM/dd/yyyy", "dd-MM-yyyy", "dd MMM yyyy", etc.
 *  - Pure day numbers ("15") → day-15 of current month/year.
 *  - "MM-dd" or "dd-MM" (ambiguous) — we reject and ask the user to use a year.
 */
export function parseDateInput(input: string, now: Date = new Date()): Date {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new AppError("INVALID_DATE", {
      name: "InvalidDate",
      human: "Date value cannot be empty. Use ISO format like 2025-01-31.",
    });
  }

  // Pure day number → day-N of current month/year.
  if (/^\d{1,2}$/.test(trimmed)) {
    const day = Number(trimmed);
    if (day < 1 || day > 31) {
      throw new AppError("INVALID_DATE", {
        name: "InvalidDate",
        human: `Invalid day: ${trimmed}`,
      });
    }
    const result = new Date(now.getFullYear(), now.getMonth(), day);
    if (result.getMonth() !== now.getMonth()) {
      throw new AppError("INVALID_DATE", {
        name: "InvalidDate",
        human: `Day ${day} is not valid in the current month.`,
      });
    }
    return result;
  }

  // Try strict ISO first — accepts "YYYY-MM-DD" and full ISO timestamps.
  const isoCandidate = new Date(trimmed);
  if (!isNaN(isoCandidate.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return isoCandidate;
  }

  // Try common date-fns formats. Order matters: year-first formats take
  // precedence to disambiguate from day-first inputs.
  const formats = [
    "yyyy-MM-dd'T'HH:mm:ssXXX",
    "yyyy-MM-dd'T'HH:mm:ssXX",
    "yyyy-MM-dd'T'HH:mm:ss",
    "yyyy-MM-dd HH:mm:ss",
    "yyyy-MM-dd",
    "yyyy/MM/dd",
    "yyyy.MM.dd",
    "MMM d, yyyy",
    "MMM d yyyy",
  ];

  for (const fmt of formats) {
    const parsed = parse(trimmed, fmt, now);
    if (isValid(parsed)) return parsed;
  }

  throw new AppError("INVALID_DATE", {
    name: "InvalidDate",
    human: `Could not parse date: "${input}". Use ISO format (YYYY-MM-DD) or a recognized date-fns format.`,
  });
}

/**
 * Parse a duration string in the form "1y2m3d4h5m6s".
 *
 * Rules:
 *  - At least one indicator (y/m/d/h/m/s) must be present.
 *  - Each indicator may appear at most once.
 *  - Returns the duration in milliseconds.
 *
 * Note: months are calendar months (30 days approximation), years 365 days.
 * Seconds/minutes/hours are exact.
 */
export function parseDuration(input: string): number {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new AppError("INVALID_DURATION", {
      name: "InvalidDuration",
      human: "Duration value cannot be empty. Use formats like 7d, 24h, 1y2m.",
    });
  }

  const match = trimmed.match(DURATION_PATTERN);
  if (!match || match[0] !== trimmed) {
    throw new AppError("INVALID_DURATION", {
      name: "InvalidDuration",
      human: `Invalid duration: "${input}". Use format like 1y2m3d4h5m6s (each indicator at most once).`,
    });
  }

  const [, y, mo, d, h, mi, s] = match;
  const parts = [y, mo, d, h, mi, s];
  const present = parts.filter((p) => p !== undefined);
  if (present.length === 0) {
    throw new AppError("INVALID_DURATION", {
      name: "InvalidDuration",
      human: `Duration must include at least one indicator (y/m/d/h/m/s). Got: "${input}"`,
    });
  }

  const years = y ? Number(y) : 0;
  const months = mo ? Number(mo) : 0;
  const days = d ? Number(d) : 0;
  const hours = h ? Number(h) : 0;
  const minutes = mi ? Number(mi) : 0;
  const seconds = s ? Number(s) : 0;

  if ([years, months, days, hours, minutes, seconds].some((n) => n < 0)) {
    throw new AppError("INVALID_DURATION", {
      name: "InvalidDuration",
      human: `Duration components must be non-negative: "${input}"`,
    });
  }

  // Calendar-ish approximation: 30d/month, 365d/year.
  const ms =
    years * 365 * 24 * 60 * 60 * 1000 +
    months * 30 * 24 * 60 * 60 * 1000 +
    days * 24 * 60 * 60 * 1000 +
    hours * 60 * 60 * 1000 +
    minutes * 60 * 1000 +
    seconds * 1000;

  return ms;
}

/**
 * Combine --from and --last into a concrete date range.
 *
 * - `--last` alone → window is [now - last, now]
 * - `--from` alone → window is [from, +∞]
 * - both set → reject (caller must pick one)
 */
export function resolveDateRange(
  fromInput: string | undefined,
  lastInput: string | undefined,
  now: Date = new Date(),
): DateRange | undefined {
  if (!fromInput && !lastInput) return undefined;
  if (fromInput && lastInput) {
    throw new AppError("CONFLICTING_FLAGS", {
      name: "ConflictingFlags",
      human: "Use either --from or --last, not both.",
    });
  }

  if (fromInput) {
    return { from: parseDateInput(fromInput, now) };
  }

  // lastInput is defined here.
  const ms = parseDuration(lastInput!);
  const from = new Date(now.getTime() - ms);
  return { from, to: now };
}

/**
 * Filter an array of items by date range. The `dateOf` callback returns either
 * a Date, an ISO string, or null/undefined for items that don't carry a
 * relevant timestamp. Items with no date are kept (they pass through).
 */
export function applyDateFilter<T>(
  items: T[],
  range: DateRange | undefined,
  dateOf: (item: T) => Date | string | null | undefined,
): T[] {
  if (!range) return items;

  const fromMs = range.from?.getTime();
  const toMs = range.to?.getTime();

  return items.filter((item) => {
    const raw = dateOf(item);
    if (raw == null) return true; // no date available → keep
    const date = raw instanceof Date ? raw : new Date(raw);
    if (isNaN(date.getTime())) return true;
    const ms = date.getTime();
    if (fromMs !== undefined && ms < fromMs) return false;
    if (toMs !== undefined && ms > toMs) return false;
    return true;
  });
}
