"use client";

import type { CalendarDay } from "@/types/japanese";

function generateCalendarData(): CalendarDay[] {
  const data: CalendarDay[] = [];
  const today = new Date();
  for (let i = 89; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const level =
      i > 7 ? Math.floor(Math.random() * 5) : Math.floor(Math.random() * 4) + 1;
    data.push({ date: dateStr, level });
  }
  return data;
}

const LEVEL_COLORS = [
  "bg-[var(--jp-divider)]",
  "bg-blue-100",
  "bg-blue-200",
  "bg-blue-400",
  "bg-[var(--jp-primary)]",
];

const DEFAULT_CALENDAR = generateCalendarData();

interface LearningCalendarProps {
  calendar?: CalendarDay[];
}

export function LearningCalendar({ calendar = DEFAULT_CALENDAR }: LearningCalendarProps) {
  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < calendar.length; i += 7) {
    weeks.push(calendar.slice(i, i + 7));
  }

  return (
    <div className="rounded-[var(--jp-radius-lg)] border border-[var(--jp-hairline)] bg-white p-[var(--jp-space-lg)]">
      <h3
        className="mb-4 text-[17px] font-semibold text-[var(--jp-ink)]"
        style={{
          fontFamily: "var(--jp-font-display)",
          letterSpacing: "-0.374px",
        }}
      >
        学习日历
      </h3>
      <div className="flex gap-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {week.map((day) => (
              <div
                key={day.date}
                className={`h-3 w-3 rounded-[2px] ${LEVEL_COLORS[day.level]}`}
                title={`${day.date}: Level ${day.level}`}
                style={{ transition: "opacity 200ms ease" }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.7")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-[var(--jp-ink-48)]">
        <span>少</span>
        {LEVEL_COLORS.map((c, i) => (
          <div key={i} className={`h-2.5 w-2.5 rounded-[2px] ${c}`} />
        ))}
        <span>多</span>
      </div>
    </div>
  );
}
