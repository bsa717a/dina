export const STANDING_INSTRUCTION_STATUSES = ["active", "archived"] as const;
export type StandingInstructionStatus =
  (typeof STANDING_INSTRUCTION_STATUSES)[number];

export const MAX_ACTIVE_STANDING_INSTRUCTIONS = 15;

export type StandingInstructionRecord = {
  id: string;
  title: string;
  content: string;
  status: StandingInstructionStatus;
  source: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};
