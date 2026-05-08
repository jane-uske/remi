import { NextResponse } from "next/server";
import type {
  JapaneseProgressData,
  CalendarDay,
} from "@/types/japanese";

// ---------------------------------------------------------------------------
// Mock-data helpers — swap these for real DB queries later.
// ---------------------------------------------------------------------------

function generateCalendarData(): CalendarDay[] {
  const data: CalendarDay[] = [];
  const today = new Date();
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    // Deterministic-ish seed so the calendar is stable across requests for
    // the same day (avoids layout flicker while still looking realistic).
    const seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    const level =
      i > 7
        ? ((seed * 9301 + 49297) % 233280) % 5
        : (((seed * 9301 + 49297) % 233280) % 4) + 1;
    data.push({ date: dateStr, level });
  }
  return data;
}

function buildMockProgress(): JapaneseProgressData {
  return {
    currentLevel: "N4",
    targetLevel: "N1",
    progress: {
      listening: 42,
      reading: 68,
      grammar: 39,
    },
    mastery: 43,
    assessment: {
      score: 86,
      total: 100,
      categories: [
        { label: "词汇", score: 90 },
        { label: "语法", score: 78 },
        { label: "听力", score: 85 },
        { label: "阅读", score: 92 },
      ],
    },
    dailyGoals: [
      { id: "vocab", title: "背诵 30 个 N3 词汇", progress: 73, icon: "\u{1f4d6}" },
      { id: "grammar", title: "完成 て形 语法练习", progress: 45, icon: "✏️" },
      { id: "listen", title: "听力精听 15 分钟", progress: 60, icon: "\u{1f3a7}" },
      { id: "speak", title: "与 Remi 对话 10 分钟", progress: 20, icon: "\u{1f5e3}️" },
    ],
    calendar: generateCalendarData(),
  };
}

// ---------------------------------------------------------------------------
// GET /api/japanese/progress
// ---------------------------------------------------------------------------

export async function GET() {
  // TODO: replace with real user-scoped data from the database.
  const data = buildMockProgress();
  return NextResponse.json(data);
}
