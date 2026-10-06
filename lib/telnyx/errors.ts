/**
 * Telnyx API error mapping for admin-facing send results.
 */

export const SMS_CARRIER_REGISTRATION_PENDING =
  "SMS carrier registration pending";

export class TelnyxApiError extends Error {
  status: number;
  body: string;
  code: string | null;

  constructor(status: number, body: string) {
    const code = telnyxErrorCode(body);
    super(
      code === "40010"
        ? SMS_CARRIER_REGISTRATION_PENDING
        : `Telnyx API error ${status}: ${body}`,
    );
    this.name = "TelnyxApiError";
    this.status = status;
    this.body = body;
    this.code = code;
  }
}

export function telnyxErrorCode(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as {
      errors?: Array<{ code?: string | number }>;
    };
    const code = parsed.errors?.[0]?.code;
    if (code != null && String(code).trim()) return String(code);
  } catch {
    // Telnyx sometimes returns a non-JSON body.
  }
  const match = body.match(/"code"\s*:\s*"?(40010)"?/);
  return match?.[1] ?? null;
}

export function isCarrierRegistrationPending(error: string | undefined): boolean {
  return error === SMS_CARRIER_REGISTRATION_PENDING;
}
