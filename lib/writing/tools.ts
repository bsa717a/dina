import { draftInDereksVoice } from "@/lib/writing/draft";
import {
  WRITING_AUDIENCES,
  WRITING_MEDIUMS,
  type WritingAudience,
  type WritingMedium,
} from "@/lib/writing/types";
import { logger } from "@/lib/logger";

function ok(data: unknown) {
  return JSON.stringify({ ok: true, data });
}

function fail(error: unknown) {
  return JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : "Writing tool failed",
  });
}

const handlers: Record<
  string,
  (args: Record<string, unknown>) => Promise<string>
> = {
  draft_in_dereks_voice: async (args) => {
    const mediumRaw = String(args.medium || "email");
    const medium = (WRITING_MEDIUMS as readonly string[]).includes(mediumRaw)
      ? (mediumRaw as WritingMedium)
      : "email";
    const purpose = String(args.purpose || "").trim();
    if (!purpose) return fail(new Error("purpose is required."));

    const audienceRaw =
      typeof args.audience === "string" ? args.audience : undefined;
    const audience =
      audienceRaw &&
      (WRITING_AUDIENCES as readonly string[]).includes(audienceRaw)
        ? (audienceRaw as WritingAudience)
        : undefined;

    const draft = await draftInDereksVoice({
      medium,
      purpose,
      to: typeof args.to === "string" ? args.to : undefined,
      points: Array.isArray(args.points)
        ? args.points.filter((p): p is string => typeof p === "string")
        : undefined,
      audience,
      toneHint: typeof args.toneHint === "string" ? args.toneHint : undefined,
    });

    return ok({
      ...draft,
      sent: false,
      note: "Draft only. Ask Derek before send_email / create_reply_draft.",
    });
  },
};

export function listWritingToolNames() {
  return Object.keys(handlers);
}

export async function executeWritingTool(
  name: string,
  argsJson: string,
): Promise<string> {
  const handler = handlers[name];
  if (!handler) return fail(new Error(`Unknown writing tool: ${name}`));
  let args: Record<string, unknown> = {};
  try {
    args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
  } catch {
    return fail(new Error("Invalid JSON arguments."));
  }
  try {
    return await handler(args);
  } catch (error) {
    logger.error("writing_tool_failed", {
      tool: name,
      error: error instanceof Error ? error.message : "unknown",
    });
    return fail(error);
  }
}
