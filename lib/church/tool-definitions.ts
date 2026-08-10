import type OpenAI from "openai";

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

export function getChurchToolDefinitions(): FunctionTool[] {
  return [
    fn(
      "search_church_site",
      "REQUIRED before citing any Church talk, speaker, quote, person, or lesson resource. Search ChurchofJesusChrist.org (General Conference, Come Follow Me, scriptures, manuals). Returns verified page excerpts + URLs only. Never invent talks or people — call this (or fetch_church_url) first.",
      {
        required: ["query"],
        properties: {
          query: {
            type: "string",
            description:
              "Search query, e.g. 'Nelson temple covenants General Conference' or 'Come Follow Me Alma 5 talk'.",
          },
        },
      },
    ),
    fn(
      "fetch_church_url",
      "Fetch a specific ChurchofJesusChrist.org URL and return page text for citation. Use when Derek provides a link or search_church_site returned a URL you need to read. Only churchofjesuschrist.org URLs are allowed.",
      {
        required: ["url"],
        properties: {
          url: {
            type: "string",
            description: "https://www.churchofjesuschrist.org/... URL",
          },
        },
      },
    ),
  ];
}
