function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error && "message" in error) {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === "string") return msg;
  }
  return "";
}

function errorStatus(error: unknown): number | undefined {
  if (
    typeof error === "object" &&
    error &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
  ) {
    return (error as { status: number }).status;
  }
  return undefined;
}

function errorCode(error: unknown): string {
  if (typeof error !== "object" || !error) return "";
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string") return code;
  const nested = (error as { error?: { code?: unknown } }).error?.code;
  return typeof nested === "string" ? nested : "";
}

const CREDITS_PATTERN =
  /no credits remaining|insufficient_quota|insufficient quota|exceeded your current quota|billing_hard_limit|payment required/i;

/**
 * Detect OpenAI billing / credit exhaustion (not transient rate limits).
 * Do NOT treat bare HTTP 429 as credits — OpenAI also uses 429 for rate limits.
 */
export function isOpenAICreditsError(error: unknown): boolean {
  const message = errorMessage(error);
  const code = errorCode(error);
  const status = errorStatus(error);

  if (CREDITS_PATTERN.test(message) || CREDITS_PATTERN.test(code)) {
    return true;
  }

  // Some billing failures surface as 402 Payment Required.
  if (status === 402) return true;

  return false;
}

/** Transient OpenAI rate limiting (safe to retry; do not block the app). */
export function isOpenAIRateLimitError(error: unknown): boolean {
  if (isOpenAICreditsError(error)) return false;
  const message = errorMessage(error);
  const code = errorCode(error);
  const status = errorStatus(error);
  return (
    status === 429 ||
    /rate[_ ]?limit/i.test(message) ||
    /rate_limit_exceeded/i.test(code)
  );
}

export function openAICreditsUserMessage() {
  return "OpenAI has no credits remaining on this API key. Add credits at https://platform.openai.com/settings/organization/billing/ then try again.";
}

/**
 * Short-circuit further OpenAI calls after a credits failure so the scheduled
 * scan does not keep burning failed requests.
 */
let creditsBlockedUntil = 0;

export function markOpenAICreditsExhausted(minutes = 30) {
  creditsBlockedUntil = Date.now() + minutes * 60_000;
}

export function isOpenAICreditsBlocked(): boolean {
  return Date.now() < creditsBlockedUntil;
}

export function clearOpenAICreditsBlock() {
  creditsBlockedUntil = 0;
}
