"use client";

import { useState } from "react";
import Link from "next/link";
import { AuroraBackground } from "@/components/AuroraBackground";
import { useRouteChromeColor } from "@/lib/mobile/useRouteChromeColor";

/** The portal is a dark-only aurora route; pin the Safari chrome + deep
 *  background to its hero color so the top status-bar / Dynamic Island area
 *  matches the hero instead of showing a pale band under a light system theme. */
const PORTAL_CHROME_COLOR = "#0a0612";

interface RemiLandingProps {
  /** Called when the user chooses to enter (CTA). Preserves the prior contract
   *  used by RemiHomeGate: () => router.push("/sign-in"). */
  onEnter: () => void;
}

/** The 5 emotions Remi actually ships (see lib/emotionLabels.ts), each given a
 *  portal tint that washes the aurora + presence dot when hovered. */
const EMOTIONS = [
  { id: "neutral", zh: "中性", en: "NEUTRAL", c: "#9fb8c4", desc: "默认从容，稳定在场" },
  { id: "happy", zh: "开心", en: "HAPPY", c: "#ffce5c", desc: "轻快上扬，乐于回应" },
  { id: "curious", zh: "好奇", en: "CURIOUS", c: "#a855f7", desc: "追问探索，眼里有光" },
  { id: "shy", zh: "害羞", en: "SHY", c: "#ff9ec4", desc: "微微迟疑，语气放软" },
  { id: "sad", zh: "难过", en: "SAD", c: "#6aa6ff", desc: "低落安静，想要陪伴" },
] as const;

const DEFAULT_EMOTION = 2; // curious

const PILLARS = [
  { idx: "01", h: "像真人一样对话", p: "能听、能停顿、能接话、能被打断，顺着语境自然回应，而不是一问一答的机器节奏。" },
  { idx: "02", h: "像持续存在的人", p: "人格稳定、长期记忆、有关系感 —— 越聊越像「她」，而不是每次都从零开始。" },
  { idx: "03", h: "跨终端始终在线", p: "手机、电脑、网页、手表，各终端用最适合自己的形态，承载同一个她的存在。" },
  { idx: "04", h: "像真实角色在场", p: "语音、表情、3D 形象与嘴型同步，让陪伴有声音、有神情、真实在场。" },
];

const CAPS = [
  { tag: "Dual Brain", t: "双脑架构", p: "Fast Brain 低延迟流式回复，Slow Brain 后台深度分析，多轮上下文稳定承接。" },
  { tag: "Memory V2", t: "长期记忆", p: "自动提取偏好与事实，向量召回叠加关系层，支撑越聊越懂的连续性。" },
  { tag: "5 Emotions", t: "情绪系统", p: "中性 / 开心 / 好奇 / 害羞 / 难过 实时识别与维护，驱动回复语气与形象表现。" },
  { tag: "STT · TTS", t: "语音交互", p: "全双工语音输入输出，逐句流式合成，五种 TTS 后端，说到一半也能随时被打断。" },
  { tag: "VRM · Live2D", t: "虚拟形象", p: "三维角色与 Live2D 形象，情绪驱动表情、动作触发与嘴型同步。" },
  { tag: "WebSocket", t: "实时通信", p: "全双工实时通道，流式 token 推送，毫秒级打断控制，SSE 文本兜底。" },
  { tag: "ComfyUI", t: "生成式图像", p: "自然语言生图：生成、精修、重绘、换风格。图像意图代理跨会话追踪引用。" },
  { tag: "Video Gen", t: "视频生成", p: "对话中自然触发视频生成，意图驱动而非菜单操作，和文字流融为一体。" },
  { tag: "Tool Use", t: "工具调用", p: "LLM 原生 function-calling：图片生成、视频生成、模式切换、语音风格 —— 由意图触发。" },
  { tag: "Performance", t: "表演层", p: "角色扮演 / Cosplay 作为临时信封包裹核心人格，沉淀过滤器决定哪些记忆回流。" },
  { tag: "RemiWorld", t: "空间世界", p: "体素小岛上的家：日夜光照、离线回归、注意力系统、世界事件回写记忆。" },
  { tag: "Plugins", t: "能力扩展", p: "解耦式能力层：日期回顾、家庭记忆、生图生视频、模式控制 —— 注册即用。" },
];

const CLIENTS = [
  { dev: "Web", h: "网页", p: "Next.js + 3D 形象，浏览器里即开即聊的完整在场体验。" },
  { dev: "Desktop", h: "桌面", p: "Tauri 透明悬浮窗，她常驻桌面一角，随叫随到。" },
  { dev: "iOS", h: "手机", p: "原生 Swift，语音双工 + Live2D 形象，随身陪伴。" },
  { dev: "watchOS", h: "手表", p: "情绪手环：表情脸 + 语音 + 健康关怀，腕上的她。" },
];

const EXPLORE_LINKS = [
  { href: "/world", label: "RemiWorld", desc: "她的小世界", icon: "🏝️" },
  { href: "/demo", label: "3D Demo", desc: "角色形象实验", icon: "🎭" },
  { href: "/benchmark", label: "Benchmark", desc: "延迟与性能", icon: "⚡" },
  { href: "/remi", label: "Developer", desc: "技术文档与架构", icon: "🔧" },
];

export function RemiLanding({ onEnter }: RemiLandingProps) {
  useRouteChromeColor(PORTAL_CHROME_COLOR);
  const [hover, setHover] = useState<number | null>(null);
  const [pinned, setPinned] = useState(DEFAULT_EMOTION);
  const active = hover ?? pinned;
  const emo = EMOTIONS[active];

  return (
    <main className="remi-portal relative min-h-dvh w-full overflow-x-hidden" style={{ color: "var(--foreground)" }}>
      <AuroraBackground tint={emo.c} />

      {/* content above the canvas */}
      <div className="relative z-[2]">
        {/* nav */}
        <nav className="flex items-center justify-between px-6 py-5 md:px-10" style={{ paddingTop: "max(1.25rem, calc(env(safe-area-inset-top) + 0.75rem))" }}>
          <div className="flex items-center gap-3 text-lg font-semibold tracking-wide">
            <span
              className="remi-portal-pulse h-2.5 w-2.5 rounded-full"
              style={{ background: emo.c, boxShadow: `0 0 16px ${emo.c}` }}
            />
            Remi
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 sm:flex">
              {EXPLORE_LINKS.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  className="rounded-full px-3.5 py-2 text-[13px] font-medium transition-colors hover:bg-white/8"
                  style={{ color: "var(--remi-dim)" }}
                >
                  {l.label}
                </Link>
              ))}
            </div>
            <button
              onClick={onEnter}
              className="remi-landing-cta cursor-pointer rounded-full px-5 py-2.5 text-sm font-medium"
            >
              开始对话
            </button>
          </div>
        </nav>

        {/* hero */}
        <header className="mx-auto flex min-h-[88vh] max-w-5xl flex-col justify-center px-6 md:flex-row md:items-center md:gap-12 md:px-10">
          <div className="flex-1">
            <span
              className="inline-flex w-fit items-center gap-2.5 rounded-full px-3.5 py-1.5 text-[13px] tracking-wide"
              style={{ background: "var(--remi-surface)", border: "1px solid var(--remi-border)", color: "var(--remi-dim)" }}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: emo.c, boxShadow: `0 0 12px ${emo.c}` }} />
              当前在场 · {emo.zh}
            </span>
            <h1
              className="mt-6 font-semibold leading-[0.92] tracking-tight"
              style={{ fontSize: "clamp(64px, 13vw, 150px)" }}
            >
              Remi
            </h1>
            <p className="mt-5 text-lg md:text-2xl" style={{ letterSpacing: ".02em" }}>
              能聊天 ·{" "}
              <b style={{ color: "var(--remi-accent)", fontWeight: 500 }}>有记忆</b> · 懂情绪 · 能说话 ·{" "}
              <b style={{ color: "var(--remi-accent)", fontWeight: 500 }}>会生图</b> ·{" "}
              <b style={{ color: "var(--remi-accent)", fontWeight: 500 }}>有世界</b>
            </p>
            <p className="mt-5 max-w-xl text-base md:text-lg" style={{ color: "var(--remi-dim)" }}>
              一个有实时交互感、人格连续性、跨终端存在感与陪伴感的实时 AI 伴侣 —— 不是更会拼接上下文的聊天机器人，而是一个数字生命的雏形。
            </p>
            <div className="mt-9 flex flex-wrap gap-3.5">
              <button onClick={onEnter} className="remi-landing-cta cursor-pointer rounded-full px-8 py-3 text-base font-medium">
                和 Remi 聊聊 →
              </button>
              <a
                href="#features"
                className="rounded-full px-7 py-3 text-base font-medium transition-transform hover:-translate-y-0.5"
                style={{ background: "var(--remi-surface)", border: "1px solid var(--remi-border)", color: "var(--foreground)" }}
              >
                了解她的能力
              </a>
            </div>
            <p className="mt-5 text-[13px] tracking-wide" style={{ color: "var(--remi-dim)" }}>
              移动鼠标拨动极光 · 点击泛起涟漪
            </p>
          </div>

          {/* hero visual */}
          <div className="group mt-10 flex-shrink-0 md:mt-0">
            <div className="relative overflow-hidden rounded-2xl shadow-[0_32px_80px_rgba(168,85,247,0.22)]" style={{ border: "1px solid var(--remi-glass-edge)" }}>
              <img
                src="/assets/remi/posters/remi-social-hero.png"
                alt="Remi — virtual idol concept"
                className="h-auto w-full max-w-xs select-none object-cover transition duration-700 group-hover:scale-[1.02] sm:max-w-sm"
                draggable={false}
              />
              <div className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/10" />
            </div>
          </div>
        </header>

        {/* pillars */}
        <Section id="about" eyebrow="设计理念" title="让她像「活着」一样在场" sub="Remi 的目标不是功能更多，而是更像一个真实存在、持续陪伴的人。">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            {PILLARS.map((p) => (
              <Card key={p.idx} className="p-8">
                <div className="text-[13px] font-semibold tracking-widest" style={{ color: "var(--remi-accent)" }}>{p.idx}</div>
                <h3 className="mt-3.5 text-xl font-semibold">{p.h}</h3>
                <p className="mt-2.5 text-[15px]" style={{ color: "var(--remi-dim)" }}>{p.p}</p>
              </Card>
            ))}
          </div>
        </Section>

        {/* capabilities */}
        <Section id="features" eyebrow="核心能力" title="支撑「活人感」的系统" sub="双脑调度、长期记忆、情绪与语音、生成式创作、工具调用 —— 构成一条低延迟、可打断的实时陪伴主链路。">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {CAPS.map((c) => (
              <Card key={c.t} className="p-7">
                <div className="text-xs uppercase tracking-widest" style={{ color: emo.c }}>{c.tag}</div>
                <h3 className="mt-2.5 text-lg font-semibold">{c.t}</h3>
                <p className="mt-2.5 text-[14.5px]" style={{ color: "var(--remi-dim)" }}>{c.p}</p>
              </Card>
            ))}
          </div>
        </Section>

        {/* emotion system */}
        <Section id="emotion" eyebrow="情绪系统" title="五种情绪，会染色整个世界" sub="Remi 维护五种情绪状态，驱动她的回复风格与形象表现。悬停感受一下 —— 连她身后的极光都会随心情变色。">
          <div className="grid grid-cols-1 items-center gap-10 md:grid-cols-2">
            <Card className="flex flex-col items-center gap-6 p-8">
              <div
                className="remi-portal-orb h-48 w-48 rounded-full"
                style={{
                  background: `radial-gradient(circle at 38% 34%, color-mix(in srgb, ${emo.c} 92%, white) 0%, ${emo.c} 36%, color-mix(in srgb, ${emo.c} 38%, #07101a) 100%)`,
                  boxShadow: `0 0 70px color-mix(in srgb, ${emo.c} 55%, transparent), inset -8px -10px 38px rgba(0,0,0,.4)`,
                }}
              />
              <div className="text-center">
                <div className="text-2xl font-semibold tracking-wide" style={{ color: emo.c }}>{emo.zh}</div>
                <div className="mt-1 text-xs uppercase tracking-[0.25em]" style={{ color: "var(--remi-dim)" }}>{emo.en}</div>
                <div className="mt-3 text-[15px]" style={{ color: "var(--remi-dim)" }}>{emo.desc}</div>
              </div>
            </Card>
            <div>
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-5 md:grid-cols-3 lg:grid-cols-5">
                {EMOTIONS.map((e, i) => (
                  <button
                    key={e.id}
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    onClick={() => setPinned(i)}
                    className="flex cursor-pointer flex-col items-center rounded-2xl px-2.5 py-4 transition-transform hover:-translate-y-0.5"
                    style={{
                      background: "var(--remi-surface)",
                      border: `1px solid ${active === i ? e.c : "var(--remi-border)"}`,
                    }}
                  >
                    <span
                      className="mb-2.5 h-5 w-5 rounded-full"
                      style={{ background: e.c, boxShadow: active === i ? `0 0 18px ${e.c}` : `0 0 8px ${e.c}` }}
                    />
                    <span className="text-[13px]" style={{ color: active === i ? "var(--foreground)" : "var(--remi-dim)" }}>{e.zh}</span>
                  </button>
                ))}
              </div>
              <p className="mt-5 text-[13px]" style={{ color: "var(--remi-dim)" }}>悬停查看 · 点击锁定一种心情</p>
            </div>
          </div>
        </Section>

        {/* clients */}
        <Section id="clients" eyebrow="跨终端存在" title="四端共享同一个她" sub="同一套实时协议，四端按各自所长承载 Remi 的在场。">
          <div className="grid grid-cols-1 gap-4.5 sm:grid-cols-2 lg:grid-cols-4">
            {CLIENTS.map((c) => (
              <Card key={c.dev} className="p-7">
                <div className="text-xs uppercase tracking-widest" style={{ color: "var(--remi-accent)" }}>{c.dev}</div>
                <h3 className="mt-3.5 text-xl font-semibold">{c.h}</h3>
                <p className="mt-2 text-[14px]" style={{ color: "var(--remi-dim)" }}>{c.p}</p>
              </Card>
            ))}
          </div>
        </Section>

        {/* explore — route links */}
        <Section id="explore" eyebrow="探索更多" title="不止聊天，还有更多入口" sub="3D 角色实验、空间世界、性能基准、开发者文档 —— Remi 的每个面都可以单独打开看看。">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {EXPLORE_LINKS.map((l) => (
              <Link key={l.href} href={l.href}>
                <Card className="group/card cursor-pointer p-7 transition-transform hover:-translate-y-1">
                  <div className="text-2xl">{l.icon}</div>
                  <h3 className="mt-3 text-lg font-semibold group-hover/card:text-[var(--remi-accent)]" style={{ transition: "color .2s" }}>{l.label}</h3>
                  <p className="mt-1.5 text-[14px]" style={{ color: "var(--remi-dim)" }}>{l.desc}</p>
                  <div className="mt-3 text-xs font-medium" style={{ color: "var(--remi-accent)" }}>{l.href} →</div>
                </Card>
              </Link>
            ))}
          </div>
        </Section>

        {/* enter */}
        <section id="enter" className="mx-auto max-w-5xl px-6 pt-12 md:px-10" style={{ paddingBottom: "max(6rem, calc(env(safe-area-inset-bottom) + 1.5rem))" }}>
          <Card className="px-8 py-16 text-center md:px-12">
            <h2 className="mx-auto max-w-2xl text-3xl font-semibold leading-tight tracking-tight md:text-5xl">
              让 Remi 陪你说说话
            </h2>
            <p className="mx-auto mt-4 max-w-md text-base md:text-lg" style={{ color: "var(--remi-dim)" }}>
              她在线，带着此刻的心情等你。打个招呼，开始一段会越来越像「她」的关系。
            </p>
            <div className="mt-8 flex justify-center">
              <button onClick={onEnter} className="remi-landing-cta cursor-pointer rounded-full px-9 py-3.5 text-lg font-medium">
                开始对话 →
              </button>
            </div>
          </Card>
          <footer
            className="mt-12 flex flex-wrap items-center justify-between gap-4 pt-8 text-[13px]"
            style={{ borderTop: "1px solid var(--remi-border)", color: "var(--remi-dim)" }}
          >
            <div className="flex items-center gap-2.5 text-base font-semibold" style={{ color: "var(--foreground)" }}>
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: "var(--remi-accent)", boxShadow: "0 0 12px var(--remi-accent)" }} />
              Remi
            </div>
            <div className="flex flex-wrap gap-6 tracking-wide">
              <span>实时 AI 陪伴系统</span>
              <span>数字生命雏形</span>
              <span>© 2026</span>
            </div>
          </footer>
        </section>
      </div>
    </main>
  );
}

function Section({
  id, eyebrow, title, sub, children,
}: { id: string; eyebrow: string; title: string; sub: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mx-auto max-w-5xl px-6 py-24 md:px-10">
      <div className="mb-14">
        <span
          className="inline-flex items-center gap-2.5 text-xs font-medium uppercase tracking-[0.3em]"
          style={{ color: "var(--remi-accent)" }}
        >
          <span className="inline-block h-px w-6" style={{ background: "var(--remi-accent)", opacity: 0.6 }} />
          {eyebrow}
        </span>
        <h2 className="mt-4 text-3xl font-semibold leading-tight tracking-tight md:text-4xl">{title}</h2>
        <p className="mt-4 max-w-xl text-base" style={{ color: "var(--remi-dim)" }}>{sub}</p>
      </div>
      {children}
    </section>
  );
}

function Card({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={`remi-portal-card rounded-3xl ${className}`}
      style={{
        background: "var(--remi-surface)",
        border: "1px solid var(--remi-glass-edge)",
        backdropFilter: "blur(20px) saturate(1.2)",
        WebkitBackdropFilter: "blur(20px) saturate(1.2)",
      }}
    >
      {children}
    </div>
  );
}
