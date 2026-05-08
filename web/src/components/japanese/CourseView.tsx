"use client";

import { useState } from "react";
import type { JlptLevel, CourseUnit, Lesson, LessonType, LessonStatus } from "@/types/japanese";

/* ---------- Curriculum data ---------- */

const CURRICULUM: Record<JlptLevel, CourseUnit[]> = {
  N5: [
    {
      id: "n5-u1",
      title: "第一单元 · 自我介绍",
      level: "N5",
      lessons: [
        { id: "n5-u1-l1", title: "は / が 基础用法", type: "grammar", durationMin: 15, status: "completed", xp: 20, desc: "主语标记助词的区别与用法" },
        { id: "n5-u1-l2", title: "挨拶言葉 100 词", type: "vocabulary", durationMin: 20, status: "completed", xp: 30, desc: "日常问候与礼貌表达" },
        { id: "n5-u1-l3", title: "自己紹介会話", type: "conversation", durationMin: 10, status: "in_progress", xp: 25, desc: "和 Remi 练习自我介绍场景" },
        { id: "n5-u1-l4", title: "数字・时间・日期", type: "grammar", durationMin: 15, status: "available", xp: 20, desc: "数字读法与时间表达" },
        { id: "n5-u1-l5", title: "单元测验", type: "reading", durationMin: 10, status: "locked", xp: 40, desc: "综合测验，完成前4课解锁" },
      ],
    },
    {
      id: "n5-u2",
      title: "第二单元 · 日常生活",
      level: "N5",
      lessons: [
        { id: "n5-u2-l1", title: "动词 て形 变换", type: "grammar", durationMin: 20, status: "locked", xp: 25, desc: "て形的规律与用途" },
        { id: "n5-u2-l2", title: "形容词：い形 / な形", type: "grammar", durationMin: 15, status: "locked", xp: 20, desc: "两类形容词的用法区别" },
        { id: "n5-u2-l3", title: "购物场景听力", type: "listening", durationMin: 15, status: "locked", xp: 30, desc: "便利店・超市对话练习" },
        { id: "n5-u2-l4", title: "日常动词 200 词", type: "vocabulary", durationMin: 25, status: "locked", xp: 35, desc: "高频动词与场景例句" },
      ],
    },
  ],
  N4: [
    {
      id: "n4-u1",
      title: "第一单元 · 敬语入门",
      level: "N4",
      lessons: [
        { id: "n4-u1-l1", title: "ます体 → 敬语转换", type: "grammar", durationMin: 20, status: "available", xp: 30, desc: "ます形与敬语体系基础" },
        { id: "n4-u1-l2", title: "敬语词汇 50 组", type: "vocabulary", durationMin: 20, status: "locked", xp: 30, desc: "尊敬语・谦让语核心词汇" },
        { id: "n4-u1-l3", title: "工作场景对话", type: "conversation", durationMin: 15, status: "locked", xp: 35, desc: "会社での敬语会話練習" },
      ],
    },
    {
      id: "n4-u2",
      title: "第二单元 · 复合句型",
      level: "N4",
      lessons: [
        { id: "n4-u2-l1", title: "〜て / 〜でいる", type: "grammar", durationMin: 20, status: "locked", xp: 25, desc: "持续状态与进行时表达" },
        { id: "n4-u2-l2", title: "〜ても / 〜なくても", type: "grammar", durationMin: 15, status: "locked", xp: 25, desc: "让步条件句型" },
        { id: "n4-u2-l3", title: "N4 阅读练习 1", type: "reading", durationMin: 20, status: "locked", xp: 40, desc: "短文阅读理解与解析" },
        { id: "n4-u2-l4", title: "单元综合测验", type: "reading", durationMin: 15, status: "locked", xp: 50, desc: "N4 第二单元综合检测" },
      ],
    },
  ],
  N3: [
    {
      id: "n3-u1",
      title: "第一单元 · 表达意图与推测",
      level: "N3",
      lessons: [
        { id: "n3-u1-l1", title: "〜つもり / 〜予定", type: "grammar", durationMin: 20, status: "locked", xp: 35, desc: "表达计划与打算" },
        { id: "n3-u1-l2", title: "〜らしい / 〜そうだ", type: "grammar", durationMin: 20, status: "locked", xp: 35, desc: "推测与传闻的表达方式" },
        { id: "n3-u1-l3", title: "新闻日语听力", type: "listening", durationMin: 25, status: "locked", xp: 45, desc: "NHK ラジオニュース 听解练习" },
      ],
    },
  ],
  N2: [
    {
      id: "n2-u1",
      title: "第一单元 · 书面语与正式表达",
      level: "N2",
      lessons: [
        { id: "n2-u1-l1", title: "〜にもかかわらず", type: "grammar", durationMin: 20, status: "locked", xp: 40, desc: "书面语转折句型" },
        { id: "n2-u1-l2", title: "商务日语词汇", type: "vocabulary", durationMin: 25, status: "locked", xp: 40, desc: "ビジネスシーンの必須語彙" },
      ],
    },
  ],
  N1: [
    {
      id: "n1-u1",
      title: "第一单元 · 文学语言与慣用句",
      level: "N1",
      lessons: [
        { id: "n1-u1-l1", title: "慣用句 100 句精讲", type: "vocabulary", durationMin: 30, status: "locked", xp: 50, desc: "高频慣用句与文化背景" },
        { id: "n1-u1-l2", title: "长文读解训练", type: "reading", durationMin: 30, status: "locked", xp: 55, desc: "N1 级别长篇阅读与解析" },
      ],
    },
  ],
};

/* ---------- Helpers ---------- */

const LEVEL_COLORS: Record<JlptLevel, { bg: string; text: string; ring: string }> = {
  N5: { bg: "#ecf3ff", text: "#0066cc", ring: "#0066cc" },
  N4: { bg: "#edfaf2", text: "#1d8348", ring: "#34c759" },
  N3: { bg: "#fff5e8", text: "#b45309", ring: "#ff9500" },
  N2: { bg: "#f5f0ff", text: "#6b21a8", ring: "#af52de" },
  N1: { bg: "#fff0f0", text: "#991b1b", ring: "#ff3b30" },
};

const TYPE_META: Record<LessonType, { icon: string; label: string }> = {
  grammar:      { icon: "✍️", label: "语法" },
  vocabulary:   { icon: "📚", label: "词汇" },
  conversation: { icon: "💬", label: "对话" },
  reading:      { icon: "📖", label: "阅读" },
  listening:    { icon: "🎧", label: "听力" },
};

const STATUS_META: Record<LessonStatus, { label: string; color: string; bg: string }> = {
  completed:   { label: "已完成", color: "#1d8348", bg: "rgba(52,199,89,0.10)" },
  in_progress: { label: "进行中", color: "#0066cc", bg: "rgba(0,102,204,0.10)" },
  available:   { label: "可开始", color: "#b45309", bg: "rgba(255,149,0,0.10)" },
  locked:      { label: "未解锁", color: "#86868b", bg: "rgba(0,0,0,0.05)" },
};

function levelUnitProgress(units: CourseUnit[]): number {
  const all = units.flatMap((u) => u.lessons);
  if (!all.length) return 0;
  const done = all.filter((l) => l.status === "completed").length;
  return Math.round((done / all.length) * 100);
}

/* ---------- Lesson card ---------- */

function LessonCard({ lesson }: { lesson: Lesson }) {
  const type = TYPE_META[lesson.type];
  const status = STATUS_META[lesson.status];
  const isLocked = lesson.status === "locked";

  return (
    <div
      style={{
        borderRadius: "14px",
        background: isLocked ? "#fafafa" : "white",
        border: `1px solid ${isLocked ? "rgba(0,0,0,0.06)" : "rgba(0,0,0,0.08)"}`,
        padding: "16px",
        opacity: isLocked ? 0.7 : 1,
        transition: "box-shadow 150ms ease, transform 150ms ease",
        cursor: isLocked ? "not-allowed" : "pointer",
      }}
      className={isLocked ? "" : "hover:shadow-md active:scale-[0.98]"}
    >
      <div className="flex items-start gap-3">
        {/* Status / type icon */}
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "10px",
            background: status.bg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            fontSize: "18px",
          }}
        >
          {isLocked ? "🔒" : type.icon}
        </div>

        <div className="flex-1 min-w-0">
          <p
            style={{
              fontFamily: "var(--jp-font-display)",
              fontSize: "14px",
              fontWeight: 600,
              letterSpacing: "-0.2px",
              color: isLocked ? "var(--jp-ink-48)" : "var(--jp-ink)",
              lineHeight: 1.3,
            }}
          >
            {lesson.title}
          </p>
          {lesson.desc && (
            <p
              style={{
                fontFamily: "var(--jp-font-text)",
                fontSize: "12px",
                color: "var(--jp-ink-48)",
                marginTop: "3px",
                lineHeight: 1.4,
              }}
            >
              {lesson.desc}
            </p>
          )}

          <div className="mt-2 flex items-center gap-3 flex-wrap">
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "3px",
                fontSize: "11px",
                color: "var(--jp-ink-48)",
                fontFamily: "var(--jp-font-text)",
              }}
            >
              ⏱ {lesson.durationMin} 分钟
            </span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "3px",
                fontSize: "11px",
                color: "#ff9500",
                fontFamily: "var(--jp-font-text)",
                fontWeight: 600,
              }}
            >
              ⭐ +{lesson.xp} XP
            </span>
            <span
              style={{
                display: "inline-flex",
                padding: "2px 8px",
                borderRadius: "9999px",
                fontSize: "11px",
                fontWeight: 600,
                color: status.color,
                background: status.bg,
                fontFamily: "var(--jp-font-text)",
              }}
            >
              {status.label}
            </span>
          </div>
        </div>

        {/* Completion checkmark */}
        {lesson.status === "completed" && (
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: "50%",
              background: "#34c759",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 6l3 3 5-5" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        )}
        {lesson.status === "in_progress" && (
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: "50%",
              background: "var(--jp-primary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg width="8" height="10" viewBox="0 0 8 10" fill="white">
              <path d="M0 0l8 5-8 5V0z" />
            </svg>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- Unit section ---------- */

function UnitSection({ unit }: { unit: CourseUnit }) {
  const done = unit.lessons.filter((l) => l.status === "completed").length;
  const total = unit.lessons.length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h4
            style={{
              fontFamily: "var(--jp-font-display)",
              fontSize: "16px",
              fontWeight: 700,
              letterSpacing: "-0.3px",
              color: "var(--jp-ink)",
            }}
          >
            {unit.title}
          </h4>
          <p
            style={{
              fontFamily: "var(--jp-font-text)",
              fontSize: "12px",
              color: "var(--jp-ink-48)",
              marginTop: "2px",
            }}
          >
            {done}/{total} 课已完成
          </p>
        </div>
        <span
          style={{
            fontFamily: "var(--jp-font-display)",
            fontSize: "20px",
            fontWeight: 700,
            color: done === total ? "#34c759" : "var(--jp-ink-48)",
          }}
        >
          {pct}%
        </span>
      </div>

      {/* Unit progress bar */}
      <div
        style={{
          height: "3px",
          width: "100%",
          borderRadius: "9999px",
          background: "var(--jp-divider)",
          overflow: "hidden",
          marginBottom: "14px",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            borderRadius: "9999px",
            background: "#34c759",
            transition: "width 600ms cubic-bezier(0.25,0.46,0.45,0.94)",
          }}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {unit.lessons.map((lesson) => (
          <LessonCard key={lesson.id} lesson={lesson} />
        ))}
      </div>
    </div>
  );
}

/* ---------- Main component ---------- */

const LEVELS: JlptLevel[] = ["N5", "N4", "N3", "N2", "N1"];

export function CourseView() {
  const [activeLevel, setActiveLevel] = useState<JlptLevel>("N4");

  const units = CURRICULUM[activeLevel];
  const colors = LEVEL_COLORS[activeLevel];
  const totalProgress = levelUnitProgress(units);
  const totalLessons = units.flatMap((u) => u.lessons).length;
  const completedLessons = units.flatMap((u) => u.lessons).filter((l) => l.status === "completed").length;

  return (
    <div>
      {/* Level tabs */}
      <div
        style={{
          borderRadius: "var(--jp-radius-lg)",
          background: "white",
          padding: "6px",
          display: "flex",
          gap: "4px",
          marginBottom: "20px",
          boxShadow: "var(--jp-shadow-card)",
        }}
      >
        {LEVELS.map((lvl) => {
          const lc = LEVEL_COLORS[lvl];
          const isActive = lvl === activeLevel;
          return (
            <button
              key={lvl}
              onClick={() => setActiveLevel(lvl)}
              style={{
                flex: 1,
                padding: "10px 8px",
                borderRadius: "12px",
                border: "none",
                cursor: "pointer",
                background: isActive ? lc.bg : "transparent",
                color: isActive ? lc.text : "var(--jp-ink-48)",
                fontFamily: "var(--jp-font-display)",
                fontSize: "15px",
                fontWeight: isActive ? 700 : 500,
                letterSpacing: "-0.2px",
                transition: "background 200ms ease, color 200ms ease",
              }}
              className="active:scale-95"
            >
              {lvl}
            </button>
          );
        })}
      </div>

      {/* Level header */}
      <div
        style={{
          borderRadius: "var(--jp-radius-lg)",
          background: colors.bg,
          padding: "20px 24px",
          marginBottom: "20px",
          display: "flex",
          alignItems: "center",
          gap: "20px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 200 }}>
          <div className="flex items-center gap-3 mb-2">
            <span
              style={{
                fontFamily: "var(--jp-font-display)",
                fontSize: "28px",
                fontWeight: 800,
                letterSpacing: "-1px",
                color: colors.text,
                lineHeight: 1,
              }}
            >
              {activeLevel}
            </span>
            <span
              style={{
                fontFamily: "var(--jp-font-text)",
                fontSize: "14px",
                color: colors.text,
                opacity: 0.7,
              }}
            >
              {activeLevel === "N5" ? "入门级" : activeLevel === "N4" ? "初级" : activeLevel === "N3" ? "中级" : activeLevel === "N2" ? "中上级" : "高级"}
            </span>
          </div>
          <div
            style={{
              height: "6px",
              width: "100%",
              maxWidth: "360px",
              borderRadius: "9999px",
              background: "rgba(0,0,0,0.08)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${totalProgress}%`,
                borderRadius: "9999px",
                background: colors.ring,
                transition: "width 700ms cubic-bezier(0.25,0.46,0.45,0.94)",
              }}
            />
          </div>
          <p
            style={{
              fontFamily: "var(--jp-font-text)",
              fontSize: "12px",
              color: colors.text,
              opacity: 0.7,
              marginTop: "6px",
            }}
          >
            {completedLessons}/{totalLessons} 课完成 · {units.length} 个单元
          </p>
        </div>

        <div className="flex gap-4">
          {[
            { n: String(totalLessons), l: "总课数" },
            { n: String(completedLessons), l: "已完成" },
            { n: `${totalProgress}%`, l: "完成度" },
          ].map(({ n, l }) => (
            <div key={l} style={{ textAlign: "center" }}>
              <div
                style={{
                  fontFamily: "var(--jp-font-display)",
                  fontSize: "22px",
                  fontWeight: 800,
                  letterSpacing: "-0.8px",
                  color: colors.text,
                  lineHeight: 1,
                }}
              >
                {n}
              </div>
              <div
                style={{
                  fontFamily: "var(--jp-font-text)",
                  fontSize: "11px",
                  color: colors.text,
                  opacity: 0.6,
                  marginTop: "3px",
                }}
              >
                {l}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Units */}
      <div className="space-y-8">
        {units.map((unit) => (
          <div
            key={unit.id}
            style={{
              borderRadius: "var(--jp-radius-lg)",
              background: "white",
              padding: "var(--jp-space-lg)",
              boxShadow: "var(--jp-shadow-card)",
            }}
          >
            <UnitSection unit={unit} />
          </div>
        ))}
      </div>
    </div>
  );
}
