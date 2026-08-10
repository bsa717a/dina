/**
 * Sampling params some OpenAI models reject (gpt-5 / o-series reasoning).
 * Prefer omitting temperature entirely over sending the default.
 */

export function modelSupportsTemperature(model: string): boolean {
  const m = model.trim().toLowerCase();
  if (!m) return true;
  // Chat-tuned GPT-5 variants still accept temperature.
  if (m.startsWith("gpt-5-chat")) return true;
  if (m.startsWith("gpt-5")) return false;
  if (/^o[0-9]/.test(m)) return false;
  return true;
}

/** Spread into Responses/Chat create bodies: `{ ...withTemperature(model, 0.3) }`. */
export function withTemperature(
  model: string,
  temperature: number,
): { temperature: number } | Record<string, never> {
  return modelSupportsTemperature(model) ? { temperature } : {};
}
