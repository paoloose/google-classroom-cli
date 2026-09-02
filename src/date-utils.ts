// Date helpers shared across command modules.

/**
 * Parse Google Classroom's { dueDate: {year, month, day}, dueTime: {hours, ...} }
 * structure into a JS Date. Defaults time to 23:59:59 if not specified.
 */
export function parseDueDate(cw: any): Date {
  const d = cw.dueDate;
  const t = cw.dueTime || { hours: 23, minutes: 59, seconds: 59 };
  return new Date(Date.UTC(d.year, (d.month || 1) - 1, d.day || 1, t.hours || 0, t.minutes || 0, t.seconds || 0));
}

/**
 * Human-friendly relative time (e.g. "3d4h", "45m12s", "Overdue").
 */
export function formatTimeLeft(tDate: Date, now: Date): string {
  const diffMs = tDate.getTime() - now.getTime();
  if (diffMs <= 0) return 'Overdue';
  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / (3600 * 24));
  const hours = Math.floor((totalSeconds % (3600 * 24)) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (totalSeconds < 69 * 60) {
    const m = Math.floor(totalSeconds / 60);
    return `${m}m${seconds}s`;
  } else if (totalSeconds >= 24 * 3600) {
    return `${days}d${hours}h`;
  } else {
    return `${hours}h${minutes}m`;
  }
}
