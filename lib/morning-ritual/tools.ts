import { generateMorningBriefMarkdown } from "@/lib/morning-ritual/compose";

function ok(data: unknown) {
  return JSON.stringify({ ok: true, data });
}

function fail(error: unknown) {
  return JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
}

type Handler = (args: Record<string, unknown>) => Promise<string>;

const handlers: Record<string, Handler> = {
  generate_morning_brief: async () => {
    const result = await generateMorningBriefMarkdown();
    if (!result.ok) return fail(new Error(result.error || "Morning brief failed."));
    return ok({
      markdown: result.markdown,
      instruction:
        "Present the markdown Morning Ritual to Derek essentially as-is. Do not convert it into a Chief of Staff Daily Briefing. Do not drop the CFM deep study, BoM line, markets, or journal prompt. You may fix light formatting only.",
    });
  },
};

export function listMorningRitualToolNames() {
  return Object.keys(handlers);
}

export async function executeMorningRitualTool(name: string, argsJson: string) {
  const handler = handlers[name];
  if (!handler) return fail(new Error(`Unknown morning ritual tool: ${name}`));
  let args: Record<string, unknown> = {};
  try {
    args = argsJson ? (JSON.parse(argsJson) as Record<string, unknown>) : {};
  } catch {
    return fail(new Error("Invalid JSON arguments."));
  }
  try {
    return await handler(args);
  } catch (error) {
    return fail(error);
  }
}
