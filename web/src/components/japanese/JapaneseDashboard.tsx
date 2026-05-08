"use client";

import { useState } from "react";
import Link from "next/link";
import { Sidebar, type NavId } from "./Sidebar";
import { FeatureCards } from "./FeatureCards";
import { ProgressRings } from "./ProgressRings";
import { MasteryGauge } from "./MasteryGauge";
import { AssessmentCard } from "./AssessmentCard";
import { DailyGoals } from "./DailyGoals";
import { LearningCalendar } from "./LearningCalendar";
import { CapabilityGrid } from "./CapabilityGrid";

export function JapaneseDashboard() {
  const [activeNav, setActiveNav] = useState<NavId>("overview");

  return (
    <div className="flex min-h-dvh">
      <Sidebar active={activeNav} onNavigate={setActiveNav} />

      <div className="flex flex-1 flex-col">
        {/* Top nav — Apple sub-nav-frosted style */}
        <header
          className="sticky top-0 z-10 flex h-[52px] items-center justify-between border-b border-[var(--jp-hairline)] px-8"
          style={{
            backgroundColor: "rgba(245, 245, 247, 0.8)",
            backdropFilter: "saturate(180%) blur(20px)",
            WebkitBackdropFilter: "saturate(180%) blur(20px)",
          }}
        >
          <div className="flex items-center gap-3">
            <h1
              className="text-[21px] font-semibold text-[var(--jp-ink)]"
              style={{
                fontFamily: "var(--jp-font-display)",
                letterSpacing: "0.231px",
              }}
            >
              Remi Japanese Mode
            </h1>
            <span className="text-[14px] text-[var(--jp-ink-48)]">
              N5→N1 陪伴式日语成长系统
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="rounded-[var(--jp-radius-pill)] bg-[var(--jp-primary)] px-[22px] py-[7px] text-[14px] text-white transition-transform active:scale-95"
              style={{ fontFamily: "var(--jp-font-text)" }}
            >
              返回聊天
            </Link>
          </div>
        </header>

        {/* Main content area */}
        <main className="flex-1 overflow-y-auto bg-[var(--jp-parchment)]">
          <div className="mx-auto max-w-[1200px] space-y-6 p-8">
            {/* Row 1: Feature cards */}
            <FeatureCards />

            {/* Row 2: Progress + Mastery + Assessment */}
            <div className="grid grid-cols-3 gap-[var(--jp-space-lg)]">
              <ProgressRings />
              <MasteryGauge />
              <AssessmentCard />
            </div>

            {/* Row 3: Daily Goals + Calendar */}
            <div className="grid grid-cols-2 gap-[var(--jp-space-lg)]">
              <DailyGoals />
              <LearningCalendar />
            </div>

            {/* Row 4: Capability grid */}
            <CapabilityGrid />
          </div>
        </main>
      </div>
    </div>
  );
}
