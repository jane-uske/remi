"use client";

import { useState } from "react";

const NAV_ITEMS = [
  { id: "overview", label: "学习总览", icon: "📊" },
  { id: "daily", label: "每日目标", icon: "🎯" },
  { id: "progress", label: "学习进度", icon: "📈" },
  { id: "capability", label: "能力地图", icon: "🗺️" },
  { id: "practice", label: "对话练习", icon: "💬" },
  { id: "review", label: "日志复盘", icon: "📝" },
] as const;

type NavId = (typeof NAV_ITEMS)[number]["id"];

interface SidebarProps {
  active: NavId;
  onNavigate: (id: NavId) => void;
}

export function Sidebar({ active, onNavigate }: SidebarProps) {
  return (
    <aside className="flex w-[220px] shrink-0 flex-col border-r border-[var(--jp-divider)] bg-[var(--jp-parchment)]">
      <div className="flex items-center gap-3 px-6 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--jp-primary)] text-sm font-semibold text-white">
          R
        </div>
        <div>
          <p
            className="text-[15px] font-semibold leading-tight"
            style={{ fontFamily: "var(--jp-font-display)" }}
          >
            Remi
          </p>
          <p className="text-[12px] text-[var(--jp-ink-48)]">日语成长伙伴</p>
        </div>
      </div>

      <nav className="flex-1 px-3 py-2">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            onClick={() => onNavigate(item.id)}
            className={`mb-1 flex w-full items-center gap-3 rounded-[var(--jp-radius-sm)] px-3 py-2.5 text-left text-[14px] transition-colors ${
              active === item.id
                ? "bg-[var(--jp-primary)] font-medium text-white"
                : "text-[var(--jp-ink-80)] hover:bg-[var(--jp-hairline)]"
            }`}
            style={{
              fontFamily: "var(--jp-font-text)",
              letterSpacing: "-0.224px",
            }}
          >
            <span className="text-base">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>

      <div className="border-t border-[var(--jp-divider)] px-4 py-4">
        <div className="rounded-[var(--jp-radius-md)] bg-white p-3">
          <p
            className="text-[12px] font-semibold text-[var(--jp-ink)]"
            style={{ fontFamily: "var(--jp-font-display)" }}
          >
            当前等级
          </p>
          <p className="mt-1 text-[24px] font-semibold text-[var(--jp-primary)]">
            N4
          </p>
          <p className="text-[12px] text-[var(--jp-ink-48)]">目标: N1</p>
        </div>
      </div>
    </aside>
  );
}

export type { NavId };
