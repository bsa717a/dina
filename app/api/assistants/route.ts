import { NextResponse } from "next/server";
import { listMemberAssistants } from "@/lib/assistants/catalog";
import { requireSession } from "@/lib/auth/session";
import { unauthorized } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  if (!(await requireSession())) return unauthorized();
  return NextResponse.json({
    assistants: listMemberAssistants().map((profile) => ({
      key: profile.key,
      name: profile.name,
      title: profile.title,
      age: profile.age,
      location: profile.location,
      tagline: profile.tagline,
      about: profile.about,
      skills: profile.skills,
      communication: profile.communication,
      philosophy: profile.philosophy,
      photoUrl: profile.photoUrl,
      accent: profile.accent,
    })),
  });
}
