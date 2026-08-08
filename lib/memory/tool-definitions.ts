import type OpenAI from "openai";
import {
  MEMORY_CATEGORIES,
  MEMORY_IMPORTANCE,
  MEMORY_STATUSES,
} from "@/lib/memory/types";

type FunctionTool = OpenAI.Responses.FunctionTool;

function fn(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
): FunctionTool {
  return {
    type: "function",
    name,
    description,
    parameters: {
      type: "object",
      additionalProperties: false,
      ...parameters,
    },
    strict: false,
  };
}

export function getMemoryToolDefinitions(): FunctionTool[] {
  return [
    fn(
      "search_memory",
      "Retrieve relevant structured memories (not chat history). Use before answering questions about Derek, people, projects, preferences, or past decisions.",
      {
        properties: {
          query: { type: "string" },
          limit: { type: "number" },
          categories: {
            type: "array",
            items: { type: "string", enum: [...MEMORY_CATEGORIES] },
          },
        },
        required: ["query"],
      },
    ),
    fn(
      "list_memories",
      "List memories, optionally filtered by category/domain or status (active, pending_approval, archived).",
      {
        properties: {
          category: { type: "string", enum: [...MEMORY_CATEGORIES] },
          status: { type: "string", enum: [...MEMORY_STATUSES] },
          limit: { type: "number" },
        },
        required: [],
      },
    ),
    fn(
      "remember",
      "Store durable knowledge about Derek per Memory Rules. NOT for temporary debugging or casual chat. Foundational categories (identity, values, preferences, health, family, etc.) are stored as pending_approval until Derek approves. Safe people/project facts may activate immediately. Pass correctId to update instead of duplicating.",
      {
        properties: {
          category: { type: "string", enum: [...MEMORY_CATEGORIES] },
          title: { type: "string" },
          content: { type: "string" },
          confidence: {
            type: "number",
            description: "0-1 confidence score",
          },
          confidenceLabel: {
            type: "string",
            enum: ["Confirmed", "High", "Medium", "Low"],
            description: "Preferred Memory Rules label; maps to numeric confidence",
          },
          importance: { type: "string", enum: [...MEMORY_IMPORTANCE] },
          correctId: {
            type: "string",
            description: "Existing memory id to correct instead of creating anew",
          },
          relatedIds: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["category", "title", "content"],
      },
    ),
    fn(
      "correct_memory",
      "Correct an existing memory by id (preferred over creating duplicates). Activates the memory.",
      {
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          content: { type: "string" },
          category: { type: "string", enum: [...MEMORY_CATEGORIES] },
          confidence: { type: "number" },
          importance: { type: "string", enum: [...MEMORY_IMPORTANCE] },
        },
        required: ["id"],
      },
    ),
    fn(
      "approve_memory",
      "Approve a pending_approval memory so it becomes permanent active memory. Use after Derek explicitly approves.",
      {
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    ),
    fn("archive_memory", "Archive an outdated memory (soft delete / forget).", {
      properties: { id: { type: "string" } },
      required: ["id"],
    }),
    fn(
      "merge_memories",
      "Merge duplicate memories into one survivor; losers become merged and point at the survivor.",
      {
        properties: {
          survivorId: { type: "string" },
          mergeIds: { type: "array", items: { type: "string" } },
          title: { type: "string" },
          content: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["survivorId", "mergeIds"],
      },
    ),
  ];
}
