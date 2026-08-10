/**
 * Citation receipts for Church source tools — parallel to action receipts.
 * Prevents inventing talks, speakers, people, or quotes without a live fetch.
 */

export const CHURCH_CITATION_TOOLS = new Set([
  "search_church_site",
  "fetch_church_url",
]);

const SUCCESS_INSTRUCTION =
  "CITATION RECEIPT: Verification SUCCEEDED (ok=true). Cite ONLY names, titles, quotes, people, and facts that appear in this payload. Include the source URL for each citation. Do not invent speakers, talks, people, paraphrased “themes as talks,” or lesson resources that are not in this text. If Derek’s request is not supported here, say you cannot verify it.";

const FAILURE_INSTRUCTION =
  "CITATION RECEIPT: Verification FAILED (ok=false). Do NOT invent a talk, speaker, person, quote, link, or lesson resource. Tell Derek plainly that you could not verify it and offer to search again with a clearer query.";

export function isChurchCitationTool(name: string): boolean {
  return CHURCH_CITATION_TOOLS.has(name);
}

export function annotateCitationToolOutput(
  name: string,
  output: string,
): string {
  if (!isChurchCitationTool(name)) return output;

  try {
    const parsed = JSON.parse(output) as {
      ok?: boolean;
      instruction?: string;
    };
    const instruction =
      parsed.ok === true ? SUCCESS_INSTRUCTION : FAILURE_INSTRUCTION;
    const merged = parsed.instruction
      ? `${instruction} ${parsed.instruction}`
      : instruction;
    return JSON.stringify({ ...parsed, instruction: merged });
  } catch {
    return JSON.stringify({
      ok: false,
      error: "Church tool returned non-JSON output.",
      raw: output.slice(0, 500),
      instruction: FAILURE_INSTRUCTION,
    });
  }
}

/** True when tool JSON indicates a successful church verification. */
export function churchToolSucceeded(output: string): boolean {
  try {
    const parsed = JSON.parse(output) as { ok?: boolean };
    return parsed.ok === true;
  } catch {
    return false;
  }
}
