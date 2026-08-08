/** Detect OpenAI billing / credit exhaustion errors. */
export function isOpenAICreditsError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const status =
    typeof error === "object" &&
    error &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : undefined;

  return (
    status === 429 ||
    /no credits remaining|insufficient_quota|billing|exceeded your current quota/i.test(
      message,
    )
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
