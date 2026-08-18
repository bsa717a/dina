import { getRequestUser } from "@/lib/auth/context";
import { generateMorningBriefMarkdown } from "@/lib/morning-ritual/compose";
import {
  clearMorningBriefPending,
  effectiveSections,
  getMorningBriefPreference,
  markMorningBriefSetupPending,
  needsMorningBriefSetup,
  saveMorningBriefSections,
} from "@/lib/morning-ritual/preferences";
import {
  DEFAULT_OWNER_SECTIONS,
  formatSavedSetupMarkdown,
  formatSetupMarkdown,
  normalizeSectionIds,
  parseSectionSelection,
  sectionTitles,
} from "@/lib/morning-ritual/sections";
import {
  isMorningBriefRequest,
  isMorningBriefSetupRequest,
} from "@/lib/ai/tool-routing";

function ok(data: unknown) {
  return JSON.stringify({ ok: true, data });
}

function fail(error: unknown) {
  return JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string" && value.trim()) {
    return value.split(/[,]+/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

async function handleGenerateMorningBrief(args: Record<string, unknown>) {
  const user = getRequestUser();
  if (!user) return fail(new Error("Not authenticated."));

  const userText = String(args.userText || args.note || "").trim();
  const setupRequested =
    Boolean(args.setup) || isMorningBriefSetupRequest(userText);
  const pref = await getMorningBriefPreference(user.id);
  const parsedArgs = asStringArray(args.sections);
  const parsedText = userText ? parseSectionSelection(userText) : { kind: "unparsed" as const };

  const applySelection = async () => {
    if (parsedArgs.length) {
      return saveMorningBriefSections({
        userId: user.id,
        sections: normalizeSectionIds(parsedArgs),
      });
    }
    if (parsedText.kind === "all") {
      return saveMorningBriefSections({
        userId: user.id,
        sections: [...DEFAULT_OWNER_SECTIONS],
      });
    }
    if (parsedText.kind === "ids") {
      return saveMorningBriefSections({
        userId: user.id,
        sections: parsedText.ids,
      });
    }
    return null;
  };

  if (parsedText.kind === "cancel") {
    await clearMorningBriefPending(user.id);
    const current = effectiveSections(user, await getMorningBriefPreference(user.id));
    if (!current.length) {
      return ok({
        mode: "setup",
        markdown: formatSetupMarkdown({ userName: user.name }),
        instruction:
          "They cancelled without a saved brief. Present the setup list and wait for numbers.",
      });
    }
    return ok({
      mode: "saved",
      markdown: `Kept your current morning brief: ${sectionTitles(current).join(", ")}.`,
      instruction: "Confirm the kept sections. Do not generate a brief unless they ask.",
    });
  }

  const saved = await applySelection();
  if (saved) {
    if (!saved.sections.length) {
      await markMorningBriefSetupPending({
        userId: user.id,
        reason: setupRequested ? "setup" : "generate",
      });
      return ok({
        mode: "setup",
        markdown: formatSetupMarkdown({ userName: user.name }),
        instruction:
          "No valid sections were saved. Present the setup list and wait for numbers.",
      });
    }
    const askedForBrief = isMorningBriefRequest(userText) && !setupRequested;
    const shouldGenerate =
      askedForBrief || pref?.pendingReason === "generate";
    if (!shouldGenerate) {
      return ok({
        mode: "saved",
        markdown: formatSavedSetupMarkdown(saved.sections),
        instruction:
          "Present the saved section list. Do not generate the morning brief unless they also asked for it.",
      });
    }
    const generated = await generateMorningBriefMarkdown({
      sections: saved.sections,
      user,
    });
    if (!generated.ok) {
      return fail(new Error(generated.error || "Morning brief failed."));
    }
    return ok({
      mode: "brief",
      markdown: `${formatSavedSetupMarkdown(saved.sections)}\n\n---\n\n${generated.markdown}`,
      instruction:
        "Present the saved confirmation, then the morning brief markdown as-is. Keep news titles as clickable markdown links. Do not rewrite it into a CoS brief.",
    });
  }

  if (setupRequested || needsMorningBriefSetup(user, pref)) {
    const selected = effectiveSections(user, pref).length
      ? effectiveSections(user, pref)
      : pref?.sections || [];
    await markMorningBriefSetupPending({
      userId: user.id,
      reason: setupRequested ? "setup" : "generate",
      sections: selected,
    });
    return ok({
      mode: "setup",
      markdown: formatSetupMarkdown({
        selected,
        userName: user.name,
      }),
      instruction:
        "Present the Morning brief setup list as-is. Do not generate a brief until they pick sections. Do not convert this into a CoS briefing.",
    });
  }

  const sections = effectiveSections(user, pref);
  const result = await generateMorningBriefMarkdown({ sections, user });
  if (!result.ok) return fail(new Error(result.error || "Morning brief failed."));
  return ok({
    mode: "brief",
    markdown: result.markdown,
    instruction:
      "Present the markdown Morning Ritual essentially as-is. Do not convert it into a Chief of Staff Daily Briefing. Keep news titles as clickable markdown links. You may fix light formatting only.",
  });
}

type Handler = (args: Record<string, unknown>) => Promise<string>;

const handlers: Record<string, Handler> = {
  generate_morning_brief: handleGenerateMorningBrief,
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
