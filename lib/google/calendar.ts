import { getDefaultTimeZone } from "@/lib/env";
import { googleRequest } from "@/lib/google/auth";

const CAL = "https://www.googleapis.com/calendar/v3";

export type GoogleCalendarEvent = {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  status?: string;
  htmlLink?: string;
  hangoutLink?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  organizer?: { email?: string; displayName?: string; self?: boolean };
  creator?: { email?: string; displayName?: string };
  attendees?: Array<{
    email?: string;
    displayName?: string;
    responseStatus?: string;
    self?: boolean;
    organizer?: boolean;
  }>;
};

export async function listGoogleCalendarEvents(args: {
  timeMin?: string;
  timeMax?: string;
  maxResults?: number;
  q?: string;
  singleEvents?: boolean;
}) {
  const timeZone = getDefaultTimeZone();
  const params = new URLSearchParams({
    singleEvents: String(args.singleEvents ?? true),
    orderBy: "startTime",
    maxResults: String(Math.min(Math.max(args.maxResults ?? 50, 1), 100)),
    timeZone,
  });
  if (args.timeMin) params.set("timeMin", args.timeMin);
  if (args.timeMax) params.set("timeMax", args.timeMax);
  if (args.q?.trim()) params.set("q", args.q.trim());

  return googleRequest<{ items?: GoogleCalendarEvent[] }>(
    `${CAL}/calendars/primary/events?${params}`,
  );
}

export async function getGoogleCalendarEvent(eventId: string) {
  return googleRequest<GoogleCalendarEvent>(
    `${CAL}/calendars/primary/events/${encodeURIComponent(eventId)}`,
  );
}

export async function createGoogleCalendarEvent(input: {
  summary: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  attendees?: string[];
  timeZone?: string;
}) {
  const timeZone = input.timeZone || getDefaultTimeZone();
  const allDay = /^\d{4}-\d{2}-\d{2}$/.test(input.start);
  return googleRequest<GoogleCalendarEvent>(`${CAL}/calendars/primary/events`, {
    method: "POST",
    body: {
      summary: input.summary,
      description: input.description,
      location: input.location,
      start: allDay
        ? { date: input.start }
        : { dateTime: input.start, timeZone },
      end: allDay ? { date: input.end } : { dateTime: input.end, timeZone },
      attendees: (input.attendees || []).map((email) => ({ email })),
    },
  });
}

export async function updateGoogleCalendarEvent(
  eventId: string,
  input: {
    summary?: string;
    description?: string;
    location?: string;
    start?: string;
    end?: string;
    timeZone?: string;
  },
) {
  const timeZone = input.timeZone || getDefaultTimeZone();
  const body: Record<string, unknown> = {};
  if (input.summary !== undefined) body.summary = input.summary;
  if (input.description !== undefined) body.description = input.description;
  if (input.location !== undefined) body.location = input.location;
  if (input.start) {
    const allDay = /^\d{4}-\d{2}-\d{2}$/.test(input.start);
    body.start = allDay
      ? { date: input.start }
      : { dateTime: input.start, timeZone };
  }
  if (input.end) {
    const allDay = /^\d{4}-\d{2}-\d{2}$/.test(input.end);
    body.end = allDay
      ? { date: input.end }
      : { dateTime: input.end, timeZone };
  }

  return googleRequest<GoogleCalendarEvent>(
    `${CAL}/calendars/primary/events/${encodeURIComponent(eventId)}`,
    { method: "PATCH", body },
  );
}

export async function deleteGoogleCalendarEvent(eventId: string) {
  return googleRequest(
    `${CAL}/calendars/primary/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE" },
  );
}

export async function respondGoogleCalendarEvent(
  eventId: string,
  response: "accepted" | "declined" | "tentative",
) {
  const event = await getGoogleCalendarEvent(eventId);
  const attendees = (event.attendees || []).map((a) =>
    a.self ? { ...a, responseStatus: response } : a,
  );
  if (!attendees.some((a) => a.self)) {
    attendees.push({ self: true, responseStatus: response });
  }
  return googleRequest<GoogleCalendarEvent>(
    `${CAL}/calendars/primary/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      body: { attendees },
    },
  );
}
