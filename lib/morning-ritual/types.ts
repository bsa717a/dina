export type CfmLesson = {
  lessonNumber: string;
  lessonKey: string;
  start: string;
  end: string;
  scriptureBlock: string;
  url: string;
};

export type BomReading = {
  day: number;
  totalDays: number;
  date: string;
  reading: string;
  url: string;
};

export type WeekMediaItem = {
  type: "talk" | "video" | "art" | "help" | "other";
  title: string;
  url?: string;
  note?: string;
};

export type WeekDayPlan = {
  dayIndex: number;
  weekday: string;
  scriptureFocus: string;
  media: WeekMediaItem[];
};

export type WeekPlan = {
  lessonKey: string;
  lessonNumber: string;
  scriptureBlock: string;
  url: string;
  weekStart: string;
  days: WeekDayPlan[];
  /** Full inventory shown on Day 1 only. */
  weekSupplemental: WeekMediaItem[];
};

export type MorningRitualContext = {
  date: string;
  longDate: string;
  weekday: string;
  cfm: CfmLesson | null;
  bom: BomReading | null;
  dayIndex: number;
  todayPlan: WeekDayPlan | null;
  weekPlan: WeekPlan | null;
  validationNotes: string[];
};
