"use client";

import { useEffect } from "react";
import type { JlptLevel } from "@/types/japanese";

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
  /** Whether the sidebar is open on mobile (overlay mode) */
  mobileOpen?: boolean;
  /** Called to close the sidebar on mobile */
  onMobileClose?: () => void;
  /** Whether the sidebar is collapsed to icon-only mode (tablet) */
  collapsed?: boolean;
  /** Called to toggle collapsed state */
  onToggle?: () => void;
  /** Current JLPT level from API */
  currentLevel?: JlptLevel;
  /** Target JLPT level from API */
  targetLevel?: JlptLevel;
}

export function Sidebar({
  active,
  onNavigate,
  mobileOpen = false,
  onMobileClose,
  collapsed = false,
  onToggle,
  currentLevel = "N4",
  targetLevel = "N1",
}: SidebarProps) {
  // Lock body scroll when mobile sidebar is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = "";
      };
    }
  }, [mobileOpen]);

  const sidebarWidth = collapsed ? "w-[68px]" : "w-[220px]";

  return (
    <>
      {/* Backdrop overlay -- mobile only */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={[
          "flex shrink-0 flex-col border-r border-[var(--jp-divider)] bg-[var(--jp-parchment)]",
          "transition-[width,transform] duration-200 ease-out",
          sidebarWidth,
          // Mobile: fixed overlay, hidden by default
          "fixed inset-y-0 left-0 z-50 md:relative md:z-auto",
          mobileOpen
            ? "translate-x-0"
            : "-translate-x-full md:translate-x-0",
        ].join(" ")}
      >
        {/* Header row with logo + collapse toggle */}
        <div className="flex items-center gap-3 px-4 py-5 md:px-6">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--jp-primary)] text-sm font-semibold text-white">
            R
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <p
                className="truncate text-[15px] font-semibold leading-tight"
                style={{ fontFamily: "var(--jp-font-display)" }}
              >
                Remi
              </p>
              <p className="truncate text-[12px] text-[var(--jp-ink-48)]">
                日语成长伙伴
              </p>
            </div>
          )}
          {/* Collapse toggle -- hidden on mobile (sidebar is overlay there) */}
          {onToggle && (
            <button
              onClick={onToggle}
              className="ml-auto hidden shrink-0 rounded-md p-1 text-[var(--jp-ink-48)] hover:bg-[var(--jp-hairline)] md:flex"
              aria-label={collapsed ? "展开侧边栏" : "折叠侧边栏"}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`transition-transform ${collapsed ? "rotate-180" : ""}`}
              >
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          )}
          {/* Close button -- mobile only */}
          {onMobileClose && (
            <button
              onClick={onMobileClose}
              className="ml-auto shrink-0 rounded-md p-1 text-[var(--jp-ink-48)] hover:bg-[var(--jp-hairline)] md:hidden"
              aria-label="关闭侧边栏"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <nav className="flex-1 px-2 py-2 md:px-3">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                onNavigate(item.id);
                // Auto-close sidebar on mobile after navigating
                onMobileClose?.();
              }}
              title={collapsed ? item.label : undefined}
              className={[
                "mb-1 flex w-full items-center rounded-[var(--jp-radius-sm)] py-2.5 text-left text-[14px]",
                collapsed
                  ? "justify-center px-2"
                  : "gap-3 px-3",
                active === item.id
                  ? "bg-[var(--jp-primary)] font-medium text-white"
                  : "text-[var(--jp-ink-80)] hover:bg-[var(--jp-hairline)]",
              ].join(" ")}
              style={{
                fontFamily: "var(--jp-font-text)",
                letterSpacing: "-0.224px",
              }}
            >
              <span className="shrink-0 text-base">{item.icon}</span>
              {!collapsed && <span className="truncate">{item.label}</span>}
            </button>
          ))}
        </nav>

        <div className="border-t border-[var(--jp-divider)] px-3 py-4 md:px-4">
          <div className="rounded-[var(--jp-radius-md)] bg-white p-3">
            {collapsed ? (
              <p className="text-center text-[20px] font-semibold text-[var(--jp-primary)]">
                {currentLevel}
              </p>
            ) : (
              <>
                <p
                  className="text-[12px] font-semibold text-[var(--jp-ink)]"
                  style={{ fontFamily: "var(--jp-font-display)" }}
                >
                  当前等级
                </p>
                <p className="mt-1 text-[24px] font-semibold text-[var(--jp-primary)]">
                  {currentLevel}
                </p>
                <p className="text-[12px] text-[var(--jp-ink-48)]">
                  目标: {targetLevel}
                </p>
              </>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

export type { NavId };
