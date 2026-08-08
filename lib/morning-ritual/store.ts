import { prisma } from "@/lib/db/client";
import type { WeekPlan } from "@/lib/morning-ritual/types";

export async function getWeekPlan(
  lessonKey: string,
  weekStart: string,
): Promise<WeekPlan | null> {
  const row = await prisma.morningRitualWeekPlan.findUnique({
    where: { lessonKey_weekStart: { lessonKey, weekStart } },
  });
  if (!row) return null;
  try {
    return JSON.parse(row.planJson) as WeekPlan;
  } catch {
    return null;
  }
}

export async function saveWeekPlan(plan: WeekPlan): Promise<WeekPlan> {
  await prisma.morningRitualWeekPlan.upsert({
    where: {
      lessonKey_weekStart: {
        lessonKey: plan.lessonKey,
        weekStart: plan.weekStart,
      },
    },
    create: {
      lessonKey: plan.lessonKey,
      weekStart: plan.weekStart,
      planJson: JSON.stringify(plan),
    },
    update: {
      planJson: JSON.stringify(plan),
    },
  });
  return plan;
}
