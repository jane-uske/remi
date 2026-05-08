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

export function JapaneseDashboard() {
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

  return (
    <div className="flex min-h-dvh">
      <Sidebar
        active={activeNav}
        onNavigate={setActiveNav}
        mobileOpen={mobileSidebarOpen}
        onMobileClose={closeMobileSidebar}
        collapsed={sidebarCollapsed}
        onToggle={toggleCollapsed}
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

        {/* Main content area */}
        <main className="flex-1 overflow-y-auto bg-[var(--jp-parchment)]">
          {/* Welcome header section */}
          <section className="bg-[var(--jp-canvas)] px-4 pb-10 pt-10 sm:px-6 lg:px-8">
            <div className="mx-auto flex max-w-[1200px] flex-col items-start gap-6 sm:flex-row sm:items-center">
              <div
                className="flex h-[72px] w-[72px] shrink-0 items-center justify-center rounded-full bg-[var(--jp-parchment)]"
                style={{ border: "1px solid var(--jp-hairline)" }}
              >
                <span
                  className="text-[28px] font-semibold text-[var(--jp-primary)]"
                  style={{ fontFamily: "var(--jp-font-display)" }}
                >
                  R
                </span>
              </div>
              <div>
                <h2
                  className="text-[28px] font-semibold text-[var(--jp-ink)] sm:text-[34px]"
                  style={{
                    fontFamily: "var(--jp-font-display)",
                    letterSpacing: "-0.374px",
                    lineHeight: 1.1,
                  }}
                >
                  おかえりなさい。
                </h2>
                <p
                  className="mt-2 text-[17px] text-[var(--jp-ink-48)]"
                  style={{
                    fontFamily: "var(--jp-font-text)",
                    lineHeight: 1.47,
                    letterSpacing: "-0.374px",
                  }}
                >
                  今日の学習を始めましょう。Remi があなたの日本語力を次のレベルへ導きます。
                </p>
              </div>
              <div className="shrink-0 sm:ml-auto">
                <Link
                  href="/"
                  className="inline-flex items-center gap-2 rounded-[9999px] bg-[var(--jp-primary)] px-7 py-3 text-[17px] font-normal text-white active:scale-95"
                  style={{
                    fontFamily: "var(--jp-font-text)",
                    letterSpacing: "-0.374px",
                    lineHeight: 1,
                  }}
                >
                  开始对话练习
                </Link>
              </div>
            </div>
          </section>

          <div className="mx-auto max-w-[1200px] space-y-[var(--jp-space-xl)] p-4 sm:p-6 lg:px-8 lg:py-10">
            {/* Row 1: Feature cards */}
            <FeatureCards />

            {/* Row 2: Progress + Mastery + Assessment */}
            <div className="grid grid-cols-1 gap-4 sm:gap-[var(--jp-space-lg)] md:grid-cols-2 lg:grid-cols-3">
              <ProgressRings />
              <MasteryGauge />
              <AssessmentCard />
            </div>

            {/* Row 3: Daily Goals + Calendar */}
            <div className="grid grid-cols-1 gap-4 sm:gap-[var(--jp-space-lg)] md:grid-cols-2">
              <DailyGoals />
              <LearningCalendar />
            </div>

            {/* Row 4: Capability grid */}
            <CapabilityGrid />
          </div>

          {/* Dark-mode tile: AI 学習路径 */}
          <section
            className="px-4 sm:px-6 lg:px-8"
            style={{
              backgroundColor: "var(--jp-tile-1)",
              paddingTop: "var(--jp-space-section)",
              paddingBottom: "var(--jp-space-section)",
            }}
          >
            <div className="mx-auto max-w-[1200px] text-center">
              <h2
                className="text-[28px] font-semibold text-white sm:text-[40px]"
                style={{
                  fontFamily: "var(--jp-font-display)",
                  lineHeight: 1.1,
                  letterSpacing: "0",
                }}
              >
                AI 学習路径
              </h2>
              <p
                className="mx-auto mt-4 max-w-[600px] text-[17px]"
                style={{
                  fontFamily: "var(--jp-font-text)",
                  lineHeight: 1.47,
                  letterSpacing: "-0.374px",
                  color: "var(--jp-body-muted)",
                }}
              >
                Remi が蓄積した学習データを基に、あなただけの N5 から N1 への最短ルートを自動設計。
                弱点を重点的に補強し、効率的にレベルアップ。
              </p>
              <div className="mx-auto mt-8 grid max-w-[800px] grid-cols-1 gap-6 sm:grid-cols-3">
                {[
                  { step: "01", title: "現在地を診断", desc: "AIが語彙・文法・聴解を総合分析" },
                  { step: "02", title: "最適な計画を生成", desc: "目標レベルまでの学習プランを自動作成" },
                  { step: "03", title: "毎日アダプティブ調整", desc: "進捗に合わせてリアルタイムに最適化" },
                ].map((item) => (
                  <div key={item.step} className="text-left">
                    <span
                      className="text-[14px] font-semibold"
                      style={{ color: "var(--jp-primary-on-dark)" }}
                    >
                      {item.step}
                    </span>
                    <h3
                      className="mt-2 text-[17px] font-semibold text-white"
                      style={{
                        fontFamily: "var(--jp-font-display)",
                        letterSpacing: "-0.374px",
                      }}
                    >
                      {item.title}
                    </h3>
                    <p
                      className="mt-1 text-[14px]"
                      style={{
                        lineHeight: 1.43,
                        letterSpacing: "-0.224px",
                        color: "var(--jp-body-muted)",
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
                  className="inline-flex items-center gap-2 rounded-[9999px] px-7 py-3 text-[17px] font-normal active:scale-95"
                  style={{
                    fontFamily: "var(--jp-font-text)",
                    letterSpacing: "-0.374px",
                    lineHeight: 1,
                    color: "var(--jp-tile-1)",
                    backgroundColor: "var(--jp-primary-on-dark)",
                  }}
                >
                  学習プランを作成
                </Link>
              </div>
            </div>
          </section>
        </main>
      </div>

      {/* Floating chat button + MiniChat overlay */}
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
