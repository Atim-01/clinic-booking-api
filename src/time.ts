/**
 * Format a Date to ISO 8601 string in UTC.
 * Omit milliseconds if they are zero, otherwise include three digits.
 * Examples: 2026-12-10T09:00:00Z or 2026-12-10T09:00:00.123Z
 */
export function formatISO(date: Date): string {
  const iso = date.toISOString();
  // Check if milliseconds are .000
  if (iso.endsWith('.000Z')) {
    return iso.replace('.000Z', 'Z');
  }
  return iso;
}
