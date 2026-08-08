/** Format Graph calendar wall-clock datetimes (often timezone-less). */
function parseGraphWallClock(value: string): Date | null {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/,
  );
  if (match) {
    return new Date(
      Date.UTC(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        Number(match[4]),
        Number(match[5]),
        Number(match[6] || 0),
      ),
    );
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatAttentionWhen(
  start?: string | null,
  end?: string | null,
): string | null {
  if (!start) return null;
  const startDate = parseGraphWallClock(start);
  if (!startDate) return start;

  const datePart = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(startDate);

  const timeFmt = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });

  const startTime = timeFmt.format(startDate);
  const endDate = end ? parseGraphWallClock(end) : null;
  if (endDate) {
    return `${datePart} · ${startTime} – ${timeFmt.format(endDate)}`;
  }
  return `${datePart} · ${startTime}`;
}

export function isCalendarAttentionSource(source: string) {
  return source === "calendar" || source === "meeting_invite";
}
