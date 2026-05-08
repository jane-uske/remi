"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { Sidebar, type NavId } from "./Sidebar";
import { FeatureCards } from "./FeatureCards";
import { ProgressRings } from "./ProgressRings";
import { MasteryGauge } from "./MasteryGauge";
import { AssessmentCard } from "./AssessmentCard";
import { DailyGoals } from "./DailyGoals";
import { LearningCalendar } from "./LearningCalendar";
import { CapabilityGrid } from "./CapabilityGrid";
import { MiniChat } from "./MiniChat";
import { RemiCharacterSection } from "./RemiCharacterSection";
import { PersonaCard } from "./PersonaCard";
import { useJapaneseProgress } from "@/hooks/useJapaneseProgress";

/* Map nav IDs to display labels (must match Sidebar NAV_ITEMS) */
const NAV_LABELS: Record<NavId, string> = {
  overview: "学习总览",
  daily: "每日目标",
  progress: "学习进度",
  capability: "能力地图",
  practice: "对话练习",
  review: "日志复盘",
};

/** Reusable section title shown at the top of every non-overview view */
function SectionTitle({ label }: { label: string }) {
  return (
    <section className="bg-[var(--jp-canvas)] px-4 pb-6 pt-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1200px]">
        <h2
          className="text-[28px] font-semibold text-[var(--jp-ink)] sm:text-[34px]"
          style={{
            fontFamily: "var(--jp-font-display)",
            letterSpacing: "-0.374px",
            lineHeight: 1.1,
          }}
        >
          {label}
        </h2>
      </div>
    </section>
  );
}

export function JapaneseDashboard() {
  const { data: progressData } = useJapaneseProgress();
  const [activeNav, setActiveNav] = useState<NavId>("overview");
  const [chatOpen, setChatOpen] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const openMobileSidebar = useCallback(() => setMobileSidebarOpen(true), []);
  const closeMobileSidebar = useCallback(() => setMobileSidebarOpen(false), []);
  const toggleCollapsed = useCallback(
    () => setSidebarCollapsed((prev) => !prev),
    [],
  );

  /* ---------- Per-view content renderers ---------- */

  const renderOverview = () => (
    <>
      {/* Hero section — Apple-style large statement */}
      <section
        className="px-4 pb-16 pt-16 sm:px-6 sm:pb-20 sm:pt-20 lg:px-8"
        style={{ background: "var(--jp-hero-gradient)" }}
      >
        <div className="mx-auto max-w-[900px] text-center">
          {/* Level badge */}
          <div className="mb-6 flex justify-center">
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                borderRadius: "9999px",
                border: "1px solid var(--jp-primary-border)",
                background: "var(--jp-primary-subtle)",
                padding: "6px 16px",
                fontSize: "13px",
                fontWeight: 600,
                color: "var(--jp-primary)",
                fontFamily: "var(--jp-font-text)",
                letterSpacing: "-0.1px",
              }}
            >
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  background: "var(--jp-primary)",
                  opacity: 0.7,
                  display: "inline-block",
                }}
              />
              JLPT {progressData?.currentLevel ?? "N4"} · 学习进行中
            </span>
          </div>

          {/* Main headline */}
          <h2
            style={{
              fontFamily: "var(--jp-font-display)",
              fontSize: "clamp(44px, 7vw, 72px)",
              fontWeight: 800,
              letterSpacing: "-1.5px",
              lineHeight: 1.02,
              color: "var(--jp-ink)",
            }}
          >
            おかえりなさい。
          </h2>
          <p
            style={{
              fontFamily: "var(--jp-font-text)",
              fontSize: "19px",
              lineHeight: 1.5,
              letterSpacing: "-0.3px",
              color: "var(--jp-ink-48)",
              marginTop: "16px",
            }}
            className="mx-auto max-w-[480px]"
          >
            今日の学習を始めましょう。
            <br className="hidden sm:block" />
            Remi があなたの日本語力を次のレベルへ導きます。
          </p>

          {/* Stat tiles */}
          <div className="mx-auto mt-10 grid max-w-[560px] grid-cols-3 gap-3">
            {[
              { n: "7", u: "天", l: "连续打卡" },
              { n: "1,234", u: "词", l: "词汇量" },
              { n: "32", u: "小时", l: "累计学习" },
            ].map(({ n, u, l }) => (
              <div
                key={l}
                style={{
                  borderRadius: "16px",
                  background: "rgba(255,255,255,0.85)",
                  backdropFilter: "blur(16px)",
                  WebkitBackdropFilter: "blur(16px)",
                  border: "1px solid rgba(0,0,0,0.05)",
                  padding: "16px 8px",
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--jp-font-display)",
                    fontSize: "clamp(22px, 4vw, 30px)",
                    fontWeight: 700,
                    letterSpacing: "-0.8px",
                    color: "var(--jp-ink)",
                    lineHeight: 1,
                  }}
                >
                  {n}
                  <span
                    style={{
                      fontSize: "14px",
                      fontWeight: 400,
                      color: "var(--jp-ink-48)",
                      marginLeft: "1px",
                    }}
                  >
                    {u}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: "11px",
                    color: "var(--jp-ink-48)",
                    marginTop: "4px",
                    fontFamily: "var(--jp-font-text)",
                    letterSpacing: "-0.1px",
                  }}
                >
                  {l}
                </div>
              </div>
            ))}
          </div>

          {/* CTA buttons */}
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href="/"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                borderRadius: "9999px",
                background: "var(--jp-primary)",
                padding: "14px 32px",
                fontSize: "17px",
                fontWeight: 500,
                color: "white",
                fontFamily: "var(--jp-font-text)",
                letterSpacing: "-0.3px",
                lineHeight: 1,
              }}
              className="active:scale-95"
            >
              开始今日课程
            </Link>
            <button
              onClick={() => setActiveNav("practice")}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                borderRadius: "9999px",
                background: "rgba(255,255,255,0.85)",
                border: "1px solid var(--jp-primary-border)",
                padding: "14px 32px",
                fontSize: "17px",
                fontWeight: 500,
                color: "var(--jp-primary)",
                fontFamily: "var(--jp-font-text)",
                letterSpacing: "-0.3px",
                lineHeight: 1,
              }}
              className="active:scale-95"
            >
              和 Remi 对话
            </button>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1200px] space-y-[var(--jp-space-xl)] p-4 sm:p-6 lg:px-8 lg:py-10">
        {/* Row 1: Feature cards */}
        <FeatureCards />

        {/* Row 2: Progress + Mastery + Assessment */}
        <div className="grid grid-cols-1 gap-4 sm:gap-[var(--jp-space-lg)] md:grid-cols-2 lg:grid-cols-3">
          <ProgressRings progress={progressData?.progress} />
          <MasteryGauge mastery={progressData?.mastery} currentLevel={progressData?.currentLevel} />
          <AssessmentCard assessment={progressData?.assessment} />
        </div>

        {/* Row 3: Daily Goals + Calendar */}
        <div className="grid grid-cols-1 gap-4 sm:gap-[var(--jp-space-lg)] md:grid-cols-2">
          <DailyGoals goals={progressData?.dailyGoals} />
          <LearningCalendar calendar={progressData?.calendar} />
        </div>

        {/* Row 4: Capability grid */}
        <CapabilityGrid onNavigate={setActiveNav} />

        {/* Row 5: Remi character + Persona card */}
        <div className="grid grid-cols-1 gap-4 sm:gap-[var(--jp-space-lg)] lg:grid-cols-[1fr_360px]">
          <RemiCharacterSection />
          <PersonaCard />
        </div>
      </div>

      {/* Dark-mode tile: AI 学習路径 */}
      <section
        className="px-4 sm:px-6 lg:px-8"
        style={{
          background: "linear-gradient(160deg, #0a0a0f 0%, #1a1a2e 50%, #0d0d1a 100%)",
          paddingTop: "var(--jp-space-section)",
          paddingBottom: "var(--jp-space-section)",
        }}
      >
        <div className="mx-auto max-w-[1100px] text-center">
          {/* Section badge */}
          <div className="mb-6 flex justify-center">
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                borderRadius: "9999px",
                border: "1px solid rgba(41,151,255,0.3)",
                background: "rgba(41,151,255,0.08)",
                padding: "6px 16px",
                fontSize: "12px",
                fontWeight: 600,
                color: "var(--jp-primary-on-dark)",
                fontFamily: "var(--jp-font-text)",
                letterSpacing: "0.5px",
                textTransform: "uppercase",
              }}
            >
              AI POWERED
            </span>
          </div>

          <h2
            style={{
              fontFamily: "var(--jp-font-display)",
              fontSize: "clamp(36px, 5vw, 52px)",
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: "-1px",
              color: "white",
            }}
          >
            AI 学習路径
          </h2>
          <p
            className="mx-auto mt-4 max-w-[560px]"
            style={{
              fontFamily: "var(--jp-font-text)",
              fontSize: "17px",
              lineHeight: 1.5,
              letterSpacing: "-0.3px",
              color: "#86868b",
            }}
          >
            Remi が蓄積した学習データを基に、N5 から N1 への
            <br className="hidden sm:block" />
            最短ルートを自動設計。弱点を集中的に補強します。
          </p>

          {/* Steps */}
          <div className="mx-auto mt-12 grid max-w-[860px] grid-cols-1 gap-4 sm:grid-cols-3 sm:gap-6">
            {[
              { n: "01", title: "現在地を診断", desc: "AI が語彙・文法・聴解を総合的に分析します" },
              { n: "02", title: "最適な計画を生成", desc: "目標レベルまでの学習プランを自動作成します" },
              { n: "03", title: "毎日アダプティブ", desc: "進捗に合わせリアルタイムに最適化します" },
            ].map((item, i) => (
              <div
                key={item.n}
                style={{
                  borderRadius: "16px",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  padding: "24px 20px",
                  textAlign: "left",
                  position: "relative",
                  backdropFilter: "blur(12px)",
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    width: "32px",
                    height: "32px",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: "9999px",
                    background: "rgba(41,151,255,0.15)",
                    fontSize: "12px",
                    fontWeight: 700,
                    color: "var(--jp-primary-on-dark)",
                    fontFamily: "var(--jp-font-display)",
                    marginBottom: "14px",
                  }}
                >
                  {i + 1}
                </span>
                <h3
                  style={{
                    fontFamily: "var(--jp-font-display)",
                    fontSize: "18px",
                    fontWeight: 700,
                    letterSpacing: "-0.4px",
                    color: "white",
                    lineHeight: 1.2,
                    marginBottom: "8px",
                  }}
                >
                  {item.title}
                </h3>
                <p
                  style={{
                    fontFamily: "var(--jp-font-text)",
                    fontSize: "14px",
                    lineHeight: 1.5,
                    letterSpacing: "-0.1px",
                    color: "#86868b",
                  }}
                >
                  {item.desc}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-10">
            <Link
              href="/"
              className="inline-flex items-center gap-2 active:scale-95"
              style={{
                borderRadius: "9999px",
                padding: "14px 32px",
                fontSize: "17px",
                fontWeight: 500,
                fontFamily: "var(--jp-font-text)",
                letterSpacing: "-0.3px",
                lineHeight: 1,
                color: "#0a0a0f",
                background: "var(--jp-primary-on-dark)",
              }}
            >
              学習プランを作成
            </Link>
          </div>
        </div>
      </section>
    </>
  );

  const renderDaily = () => (
    <>
      <SectionTitle label={NAV_LABELS.daily} />
      <div className="mx-auto max-w-[1200px] p-4 sm:p-6 lg:px-8 lg:py-10">
        <DailyGoals goals={progressData?.dailyGoals} />
      </div>
    </>
  );

  const renderProgress = () => (
    <>
      <SectionTitle label={NAV_LABELS.progress} />
      <div className="mx-auto max-w-[1200px] space-y-[var(--jp-space-xl)] p-4 sm:p-6 lg:px-8 lg:py-10">
        <div className="grid grid-cols-1 gap-4 sm:gap-[var(--jp-space-lg)] md:grid-cols-2 lg:grid-cols-3">
          <ProgressRings progress={progressData?.progress} />
          <MasteryGauge mastery={progressData?.mastery} currentLevel={progressData?.currentLevel} />
          <AssessmentCard assessment={progressData?.assessment} />
        </div>
        <LearningCalendar calendar={progressData?.calendar} />
      </div>
    </>
  );

  const renderCapability = () => (
    <>
      <SectionTitle label={NAV_LABELS.capability} />
      <div className="mx-auto max-w-[1200px] p-4 sm:p-6 lg:px-8 lg:py-10">
        <CapabilityGrid onNavigate={setActiveNav} />
      </div>
    </>
  );

  const renderPractice = () => (
    <>
      <SectionTitle label={NAV_LABELS.practice} />
      <div className="mx-auto max-w-[1200px] p-4 sm:p-6 lg:px-8 lg:py-10">
        <div
          className="mx-auto max-w-[680px] overflow-hidden rounded-[var(--jp-radius-lg)] border border-[var(--jp-hairline)] bg-white"
          style={{ minHeight: 480 }}
        >
          <MiniChat onClose={() => setActiveNav("overview")} />
        </div>
      </div>
    </>
  );

  const renderReview = () => {
    const goals = progressData?.dailyGoals ?? [];
    const completed = goals.filter((g) => g.progress >= 100).length;
    const mastery = progressData?.mastery ?? 43;
    const level = progressData?.currentLevel ?? "N4";

    return (
      <>
        <SectionTitle label={NAV_LABELS.review} />
        <div className="mx-auto max-w-[1200px] space-y-5 p-4 sm:p-6 lg:px-8 lg:py-10">
          {/* Today's summary stats */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { label: "综合掌握度", value: `${mastery}%`, color: "#0066cc" },
              { label: "今日目标", value: `${completed}/${goals.length}`, color: "#34c759" },
              { label: "当前等级", value: level, color: "#ff9500" },
              { label: "连续学习", value: "7天", color: "#af52de" },
            ].map((s) => (
              <div
                key={s.label}
                style={{
                  borderRadius: "var(--jp-radius-lg)",
                  background: "white",
                  padding: "20px",
                  boxShadow: "var(--jp-shadow-card)",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--jp-font-display)",
                    fontSize: "30px",
                    fontWeight: 800,
                    letterSpacing: "-1px",
                    color: s.color,
                    lineHeight: 1,
                  }}
                >
                  {s.value}
                </div>
                <div
                  style={{
                    fontFamily: "var(--jp-font-text)",
                    fontSize: "12px",
                    color: "var(--jp-ink-48)",
                    marginTop: "6px",
                  }}
                >
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          {/* Goals breakdown */}
          <DailyGoals goals={progressData?.dailyGoals} />

          {/* CTA to start practice */}
          <div
            style={{
              borderRadius: "var(--jp-radius-lg)",
              background: "var(--jp-card-blue)",
              padding: "28px 24px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "16px",
              boxShadow: "var(--jp-shadow-card)",
            }}
          >
            <div>
              <p
                style={{
                  fontFamily: "var(--jp-font-display)",
                  fontSize: "18px",
                  fontWeight: 700,
                  letterSpacing: "-0.4px",
                  color: "var(--jp-ink)",
                }}
              >
                今日も Remi と話しましょう
              </p>
              <p
                style={{
                  fontFamily: "var(--jp-font-text)",
                  fontSize: "14px",
                  color: "var(--jp-ink-48)",
                  marginTop: "4px",
                }}
              >
                对话练习是最快提升日语的方法
              </p>
            </div>
            <button
              onClick={() => setActiveNav("practice")}
              style={{
                borderRadius: "9999px",
                background: "var(--jp-primary)",
                padding: "12px 28px",
                fontSize: "15px",
                fontWeight: 600,
                color: "white",
                border: "none",
                cursor: "pointer",
                fontFamily: "var(--jp-font-text)",
                letterSpacing: "-0.2px",
                flexShrink: 0,
              }}
              className="active:scale-95"
            >
              开始对话练习
            </button>
          </div>
        </div>
      </>
    );
  };

  const renderContent = () => {
    switch (activeNav) {
      case "overview":
        return renderOverview();
      case "daily":
        return renderDaily();
      case "progress":
        return renderProgress();
      case "capability":
        return renderCapability();
      case "practice":
        return renderPractice();
      case "review":
        return renderReview();
      default:
        return renderOverview();
    }
  };

  /* Show the floating chat FAB on every view except "practice" */
  const showFloatingChat = activeNav !== "practice";

  return (
    <div className="flex min-h-dvh">
      <Sidebar
        active={activeNav}
        onNavigate={setActiveNav}
        mobileOpen={mobileSidebarOpen}
        onMobileClose={closeMobileSidebar}
        collapsed={sidebarCollapsed}
        onToggle={toggleCollapsed}
        currentLevel={progressData?.currentLevel}
        targetLevel={progressData?.targetLevel}
      />

      <div className="flex flex-1 flex-col">
        {/* Top nav -- Apple sub-nav-frosted style */}
        <header
          className="sticky top-0 z-10 flex h-[52px] items-center justify-between border-b border-[var(--jp-hairline)] px-4 md:px-8"
          style={{
            backgroundColor: "rgba(245, 245, 247, 0.8)",
            backdropFilter: "saturate(180%) blur(20px)",
            WebkitBackdropFilter: "saturate(180%) blur(20px)",
          }}
        >
          <div className="flex items-center gap-3">
            {/* Hamburger -- mobile only */}
            <button
              onClick={openMobileSidebar}
              className="flex shrink-0 items-center justify-center rounded-md p-1.5 text-[var(--jp-ink-80)] hover:bg-[var(--jp-hairline)] md:hidden"
              aria-label="打开菜单"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            {/* Remi logo pill -- mobile only (sidebar is hidden) */}
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--jp-primary)] text-xs font-semibold text-white md:hidden">
              R
            </div>
            <h1
              className="text-[17px] font-semibold text-[var(--jp-ink)] sm:text-[21px]"
              style={{
                fontFamily: "var(--jp-font-display)",
                letterSpacing: "0.231px",
              }}
            >
              <span className="hidden sm:inline">Remi Japanese Mode</span>
              <span className="sm:hidden">Remi</span>
            </h1>
            <span className="hidden text-[14px] text-[var(--jp-ink-48)] lg:inline">
              N5→N1 陪伴式日语成长系统
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="rounded-[var(--jp-radius-pill)] bg-[var(--jp-primary)] px-4 py-[7px] text-[13px] text-white transition-transform active:scale-95 sm:px-[22px] sm:text-[14px]"
              style={{ fontFamily: "var(--jp-font-text)" }}
            >
              返回聊天
            </Link>
          </div>
        </header>

        {/* Main content area -- switches based on activeNav */}
        <main className="flex-1 overflow-y-auto bg-[var(--jp-parchment)]">
          {renderContent()}
        </main>
      </div>

      {/* Floating chat button + MiniChat overlay -- hidden on "practice" view */}
      {showFloatingChat && (
        <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
          {chatOpen && (
            <div
              style={{
                animation: "jpSlideUp 0.2s ease-out",
              }}
            >
              <MiniChat onClose={() => setChatOpen(false)} />
            </div>
          )}

          {!chatOpen && (
            <button
              onClick={() => setChatOpen(true)}
              className="flex items-center gap-2 rounded-[var(--jp-radius-pill)] bg-[var(--jp-primary)] px-5 py-2.5 text-[14px] font-medium text-white transition-transform active:scale-95"
              style={{ fontFamily: "var(--jp-font-text)" }}
            >
              <span>💬</span>
              对话练习
            </button>
          )}
        </div>
      )}

      {/* keyframe for slide-up */}
      <style>{`
        @keyframes jpSlideUp {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
