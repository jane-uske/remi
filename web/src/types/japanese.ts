/** Shared types for the Japanese learning progress API. */

export interface DailyGoal {
  id: string;
  title: string;
  progress: number;
  icon: string;
}

export interface CalendarDay {
  date: string;
  /** Activity level 0–4. */
  level: number;
}

export interface SkillProgress {
  listening: number;
  reading: number;
  grammar: number;
}

export interface AssessmentCategory {
  label: string;
  score: number;
}

export interface Assessment {
  score: number;
  total: number;
  categories: AssessmentCategory[];
}

export type JlptLevel = "N5" | "N4" | "N3" | "N2" | "N1";

export interface JapaneseProgressData {
  currentLevel: JlptLevel;
  targetLevel: JlptLevel;
  progress: SkillProgress;
  mastery: number;
  assessment: Assessment;
  dailyGoals: DailyGoal[];
  calendar: CalendarDay[];
}

/* ---------- Course / Curriculum types ---------- */

export type LessonType = "grammar" | "vocabulary" | "conversation" | "reading" | "listening";
export type LessonStatus = "completed" | "in_progress" | "available" | "locked";

export interface Lesson {
  id: string;
  title: string;
  type: LessonType;
  durationMin: number;
  status: LessonStatus;
  xp: number;
  desc?: string;
}

export interface CourseUnit {
  id: string;
  title: string;
  level: JlptLevel;
  lessons: Lesson[];
}
