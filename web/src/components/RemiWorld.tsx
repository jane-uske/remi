"use client";

/**
 * RemiWorld v0.1 —— React 壳 + HUD。
 * 引擎(three.js)与剧本(script)都在 lib/world，本组件只负责粘合与界面。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { RemiWorldEngine, type FocusInfo } from "@/lib/world/engine";
import { WorldScript, dayNumber, buildSituationalContext } from "@/lib/world/script";
import type { WorldTimeProfile } from "@/lib/world/worldTime";
import { useRemiChat } from "@/hooks/useRemiChat";

interface DialogueState {
  speaker: string;
  lines: string[];
  idx: number;
}

interface Toast {
  id: number;
  text: string;
}

const TYPE_MS_PER_CHAR = 34;

export default function RemiWorld() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<RemiWorldEngine | null>(null);
  const scriptRef = useRef<WorldScript | null>(null);
  const dialogueDoneRef = useRef<(() => void) | undefined>(undefined);
  const dialogueOpenedAtRef = useRef(0);
  const toastIdRef = useRef(0);
  const chatInputRef = useRef<HTMLInputElement | null>(null);

  // 真实对话管线（RW-P1-3）：与 / 同一个 Remi（同连接/记忆/人格）
  const chat = useRemiChat();
  // 世界事件缓冲（RW-P1-4b）：连接就绪前先攒着，open 后补发，避免丢事件
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const pendingWorldEventsRef = useRef<
    Array<"flower_planted" | "lantern_lit" | "revisit">
  >([]);
  const flushWorldEvents = useCallback(() => {
    const c = chatRef.current;
    if (!c.connected || pendingWorldEventsRef.current.length === 0) return;
    for (const e of pendingWorldEventsRef.current) c.sendWorldEvent(e);
    pendingWorldEventsRef.current = [];
  }, []);
  const recordWorldEvent = useCallback(
    (event: "flower_planted" | "lantern_lit" | "revisit") => {
      pendingWorldEventsRef.current.push(event);
      flushWorldEvents();
    },
    [flushWorldEvents],
  );

  const [debugMode, setDebugMode] = useState(false);
  const [started, setStarted] = useState(false);
  const [locked, setLocked] = useState(false);
  const [focus, setFocus] = useState<FocusInfo | null>(null);
  const [objective, setObjective] = useState("");
  const [dialogue, setDialogue] = useState<DialogueState | null>(null);
  const [typedChars, setTypedChars] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [day, setDay] = useState(1);
  const [activity, setActivity] = useState("");
  const [worldTime, setWorldTime] = useState<WorldTimeProfile | null>(null);
  // 实时对话面板（RW-P1-3）
  const [chatOpen, setChatOpen] = useState(false);
  const [chatOpener, setChatOpener] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");

  // ---- 引擎与剧本装配（一次） ----
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const pushToast = (text: string) => {
      const id = ++toastIdRef.current;
      setToasts((ts) => [...ts, { id, text }]);
      window.setTimeout(() => {
        setToasts((ts) => ts.filter((t) => t.id !== id));
      }, 3200);
    };

    const engine = new RemiWorldEngine(container, {
      onFocusChange: (f) => setFocus(f),
      onInteract: (id) => scriptRef.current?.handleInteract(id),
      onLockChange: (isLocked) => setLocked(isLocked),
      onNearRemi: () => scriptRef.current?.onNearRemi(),
      onRemiActivity: (label) => setActivity(label),
    });
    engineRef.current = engine;
    // TTS 口型信号源（RW-P1-3b）：lipSignalRef 是稳定 ref，捕获一次即可
    engine.setLipSource(chat.lipSignalRef);

    const script = new WorldScript(engine, {
      openDialogue: (speaker, lines, onDone) => {
        dialogueDoneRef.current = onDone;
        dialogueOpenedAtRef.current = performance.now();
        setDialogue({ speaker, lines, idx: 0 });
        setTypedChars(0);
        engine.setInteractEnabled(false);
        engine.onDialogueOpen(); // RW-P1-5：她停下手里的事，转向玩家
      },
      openLiveChat: (opener) => {
        // RW-P1-3：真实 LLM 对话。释放 FPS 控制让鼠标去点输入框
        setChatOpener(opener ?? null);
        setChatOpen(true);
        engine.setInteractEnabled(false);
        engine.setChatActive(true);
        engine.onDialogueOpen();
      },
      recordWorldEvent, // RW-P1-4b：世界事件进长期记忆（缓冲到连接就绪）
      setObjective: (text) => setObjective(text),
      toast: pushToast,
    });
    scriptRef.current = script;
    script.onWorldReady();
    setDay(dayNumber(script.getSave()));
    setWorldTime(script.getTimeProfile());

    const syncWorldClock = () => {
      const current = script.syncWorldTime();
      script.notePresence();
      setWorldTime(current);
      setDay(dayNumber(script.getSave()));
    };
    const worldClockTimer = window.setInterval(syncWorldClock, 60_000);
    const notePresence = () => script.notePresence();
    window.addEventListener("beforeunload", notePresence);

    // 截图/调景模式：?debug=1 隐藏遮罩，?cam=x,y,z,yaw,pitch 直接摆相机
    const params = new URLSearchParams(window.location.search);
    if (params.get("debug") === "1") {
      setDebugMode(true);
      setStarted(true);
      // 调试模式不依赖指针锁定，直接可玩（按住鼠标拖动视角）
      engine.enableFallbackControls();
      (window as unknown as Record<string, unknown>).__remiWorldEngine = engine;
      (window as unknown as Record<string, unknown>).__remiWorldScript = script;
      const cam = params.get("cam")?.split(",").map(Number);
      if (cam && cam.length === 5 && cam.every(Number.isFinite)) {
        engine.teleport(cam[0], cam[1], cam[2], cam[3], cam[4]);
      }
      // ?act=reading|window|flowers|bench|music 钉死某个日常行为（截图复现用）
      const act = params.get("act");
      if (act) {
        engine.forceBehavior(
          act as "reading" | "window" | "flowers" | "bench" | "music",
        );
      }
    }

    return () => {
      window.clearInterval(worldClockTimer);
      window.removeEventListener("beforeunload", notePresence);
      script.notePresence();
      engine.dispose();
      engineRef.current = null;
      scriptRef.current = null;
    };
    // 引擎/剧本只装配一次；chat.lipSignalRef 是稳定 ref，无需进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- 打字机 ----
  useEffect(() => {
    if (!dialogue) return;
    const line = dialogue.lines[dialogue.idx] ?? "";
    if (typedChars >= line.length) return;
    const timer = window.setTimeout(
      () => setTypedChars((n) => n + 1),
      TYPE_MS_PER_CHAR,
    );
    return () => window.clearTimeout(timer);
  }, [dialogue, typedChars]);

  // ---- 对话推进（E / 点击）----
  const advanceDialogue = useCallback(() => {
    if (!dialogue) return;
    // 刚由同一个按键打开的对话，不要立刻吃掉第一行
    if (performance.now() - dialogueOpenedAtRef.current < 180) return;
    const line = dialogue.lines[dialogue.idx] ?? "";
    if (typedChars < line.length) {
      setTypedChars(line.length);
      return;
    }
    if (dialogue.idx + 1 < dialogue.lines.length) {
      setDialogue({ ...dialogue, idx: dialogue.idx + 1 });
      setTypedChars(0);
      return;
    }
    setDialogue(null);
    engineRef.current?.setInteractEnabled(true);
    engineRef.current?.onDialogueClose(); // RW-P1-5：停顿后回到之前的行为
    const done = dialogueDoneRef.current;
    dialogueDoneRef.current = undefined;
    done?.();
  }, [dialogue, typedChars]);

  useEffect(() => {
    if (!dialogue) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "KeyE" || e.code === "Enter" || e.code === "Space") {
        e.preventDefault();
        advanceDialogue();
      }
    };
    const onClick = () => advanceDialogue();
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [dialogue, advanceDialogue]);

  // ---- 实时对话（RW-P1-3）----

  // 情绪信号 → Remi 表情
  useEffect(() => {
    engineRef.current?.setRemiEmotion(chat.emotion);
  }, [chat.emotion]);

  // 连接就绪后补发缓冲的世界事件（RW-P1-4b）
  useEffect(() => {
    if (chat.connected) flushWorldEvents();
  }, [chat.connected, flushWorldEvents]);

  // 打开时聚焦输入框
  useEffect(() => {
    if (chatOpen) {
      const id = window.setTimeout(() => chatInputRef.current?.focus(), 60);
      return () => window.clearTimeout(id);
    }
  }, [chatOpen]);

  const closeChat = useCallback(() => {
    setChatOpen(false);
    setChatOpener(null);
    setChatInput("");
    engineRef.current?.setChatActive(false);
    engineRef.current?.setInteractEnabled(true);
    engineRef.current?.onDialogueClose(); // 回到之前的行为
  }, []);

  const sendChat = useCallback(() => {
    const text = chatInput.trim();
    if (!text || !chat.connected) return;
    // RW-P1-4：附上世界情境，让她知道自己在世界里、刚在做什么、你就在身边
    const engine = engineRef.current;
    const script = scriptRef.current;
    let situational =
      engine && script
        ? buildSituationalContext({
            activity: engine.getRemiActivity(),
            save: script.getSave(),
            time: script.getTimeProfile(),
          })
        : undefined;
    // RW-P2-4：把剧本开场白注入情境，让 LLM 知道 Remi 刚对用户说了什么
    // （仅第一条消息携带，之后清掉避免重复）
    if (chatOpener && situational) {
      situational += `\n你刚刚对用户说了这句话："${chatOpener}"——这是你们这次对话的开场，不要再重复。`;
    } else if (chatOpener && !situational) {
      situational = `你刚刚对用户说了这句话："${chatOpener}"——这是你们这次对话的开场，不要再重复。`;
    }
    if (chatOpener) setChatOpener(null);
    chat.sendText(text, situational);
    setChatInput("");
  }, [chatInput, chat, chatOpener]);

  useEffect(() => {
    if (!chatOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        e.preventDefault();
        closeChat();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chatOpen, closeChat]);

  const enterWorld = useCallback(() => {
    setStarted(true);
    engineRef.current?.requestPointerLock();
  }, []);

  const currentLine = dialogue ? (dialogue.lines[dialogue.idx] ?? "") : "";
  const promptText =
    focus?.id === "remi" ? "与 Remi 对话" : focus ? `查看 · ${focus.label}` : "";

  // 实时对话面板要显示的 Remi 当前台词：优先流式中的文本，其次最近一条回复，再次开场白
  const lastRemiMessage = [...chat.messages]
    .reverse()
    .find((m) => m.role === "rem");
  const remiLine =
    chat.streamingText ||
    lastRemiMessage?.text ||
    chatOpener ||
    (chat.connected ? "" : "……（正在连接）");
  const remiThinking = chat.waiting && !chat.streamingText;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        background: "#241c2e",
        color: "#fff",
        fontFamily:
          'system-ui, -apple-system, "PingFang SC", "Noto Sans SC", sans-serif',
        userSelect: "none",
      }}
    >
      <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />

      {/* 顶部状态 + 目标 */}
      <div
        style={{
          position: "absolute",
          top: 16,
          left: 16,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            padding: "6px 12px",
            borderRadius: 10,
            background: "rgba(20,14,26,0.55)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.12)",
            fontSize: 12,
            letterSpacing: 0.4,
            color: "#ffe9d6",
          }}
        >
          RemiWorld v0.1 · Day {day} · {worldTime?.label ?? "黄昏"}
          {activity && (
            <span style={{ opacity: 0.7 }}> · Remi {activity}</span>
          )}
        </div>
        {objective && (
          <div
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              background: "rgba(20,14,26,0.45)",
              backdropFilter: "blur(8px)",
              border: "1px solid rgba(255,200,140,0.25)",
              fontSize: 13,
              maxWidth: 320,
              lineHeight: 1.5,
            }}
          >
            {objective}
          </div>
        )}
      </div>

      {/* 准星 */}
      {locked && !dialogue && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            fontSize: 18,
            opacity: 0.65,
            pointerEvents: "none",
            textShadow: "0 1px 3px rgba(0,0,0,0.6)",
          }}
        >
          +
        </div>
      )}

      {/* 交互提示 */}
      {locked && !dialogue && focus && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: "22%",
            transform: "translateX(-50%)",
            padding: "8px 16px",
            borderRadius: 999,
            background: "rgba(20,14,26,0.62)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.16)",
            fontSize: 14,
            pointerEvents: "none",
          }}
        >
          <kbd
            style={{
              display: "inline-block",
              padding: "1px 7px",
              marginRight: 8,
              borderRadius: 6,
              border: "1px solid rgba(255,255,255,0.35)",
              background: "rgba(255,255,255,0.12)",
              fontSize: 12,
            }}
          >
            E
          </kbd>
          {promptText}
        </div>
      )}

      {/* 对话框（故事板样式） */}
      {dialogue && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: 36,
            transform: "translateX(-50%)",
            width: "min(660px, 92vw)",
            padding: "16px 20px 12px",
            borderRadius: 16,
            background: "rgba(22,15,28,0.78)",
            backdropFilter: "blur(12px)",
            border: "1px solid rgba(255,255,255,0.14)",
            boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
          }}
        >
          <div
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#ffc9a3",
              marginBottom: 6,
            }}
          >
            {dialogue.speaker} ❀
          </div>
          <div style={{ fontSize: 16, lineHeight: 1.7, minHeight: 54 }}>
            {currentLine.slice(0, typedChars)}
          </div>
          <div
            style={{
              textAlign: "right",
              fontSize: 12,
              opacity: 0.65,
              marginTop: 6,
            }}
          >
            按 E 继续 ▸
          </div>
        </div>
      )}

      {/* 实时对话面板（RW-P1-3：真实 LLM） */}
      {chatOpen && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            bottom: 28,
            transform: "translateX(-50%)",
            width: "min(680px, 94vw)",
            padding: "16px 20px 14px",
            borderRadius: 18,
            background: "rgba(22,15,28,0.82)",
            backdropFilter: "blur(14px)",
            border: "1px solid rgba(255,255,255,0.16)",
            boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <span style={{ fontSize: 14, fontWeight: 700, color: "#ffc9a3" }}>
              Remi ❀
              <span style={{ opacity: 0.5, fontWeight: 400, marginLeft: 8 }}>
                {chat.connected
                  ? activity
                    ? `刚才在${activity.replace(/^在/, "")}`
                    : "在你身边"
                  : "连接中…"}
              </span>
            </span>
            <button
              onClick={closeChat}
              style={{
                border: "1px solid rgba(255,255,255,0.25)",
                background: "rgba(255,255,255,0.08)",
                color: "#ffe9d6",
                borderRadius: 8,
                fontSize: 12,
                padding: "3px 10px",
                cursor: "pointer",
              }}
            >
              结束对话 Esc
            </button>
          </div>

          <div
            style={{
              fontSize: 16,
              lineHeight: 1.7,
              minHeight: 56,
              maxHeight: 168,
              overflowY: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            {remiThinking ? (
              <span style={{ opacity: 0.55 }}>……</span>
            ) : (
              remiLine
            )}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <input
              ref={chatInputRef}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  sendChat();
                }
              }}
              placeholder={chat.connected ? "和 Remi 说点什么…" : "正在连接服务器…"}
              disabled={!chat.connected}
              style={{
                flex: 1,
                padding: "10px 14px",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.2)",
                background: "rgba(0,0,0,0.28)",
                color: "#fff",
                fontSize: 15,
                outline: "none",
              }}
            />
            <button
              onClick={sendChat}
              disabled={!chat.connected || !chatInput.trim()}
              style={{
                padding: "0 18px",
                borderRadius: 10,
                border: "1px solid rgba(255,200,140,0.5)",
                background:
                  chat.connected && chatInput.trim()
                    ? "rgba(255,160,90,0.28)"
                    : "rgba(255,255,255,0.06)",
                color: "#ffe9d6",
                fontSize: 15,
                cursor: chat.connected && chatInput.trim() ? "pointer" : "default",
              }}
            >
              发送
            </button>
          </div>
        </div>
      )}

      {/* Toast */}
      <div
        style={{
          position: "absolute",
          top: 18,
          right: 18,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          alignItems: "flex-end",
          pointerEvents: "none",
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              padding: "8px 14px",
              borderRadius: 10,
              background: "rgba(20,14,26,0.6)",
              backdropFilter: "blur(8px)",
              border: "1px solid rgba(255,200,140,0.3)",
              fontSize: 13,
              color: "#ffe9d6",
            }}
          >
            ✿ {t.text}
          </div>
        ))}
      </div>

      {/* 开始 / 暂停遮罩 */}
      {!debugMode && (!started || !locked) && !dialogue && !chatOpen && (
        <div
          onClick={enterWorld}
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            background:
              "linear-gradient(180deg, rgba(24,16,32,0.78), rgba(24,16,32,0.62))",
            backdropFilter: "blur(6px)",
            cursor: "pointer",
          }}
        >
          <div style={{ fontSize: 13, letterSpacing: 4, color: "#e8a06a" }}>
            A WORLD OF MEMORY
          </div>
          <div style={{ fontSize: 34, fontWeight: 800, color: "#ffe9d6" }}>
            RemiWorld <span style={{ fontSize: 16, fontWeight: 500 }}>v0.1</span>
          </div>
          <div style={{ fontSize: 14, opacity: 0.85 }}>
            一个世界，一段回忆，一份陪伴。
          </div>
          <div
            style={{
              marginTop: 10,
              padding: "10px 26px",
              borderRadius: 999,
              border: "1px solid rgba(255,200,140,0.5)",
              background: "rgba(255,160,90,0.16)",
              fontSize: 15,
              color: "#ffe9d6",
            }}
          >
            {started ? "点击继续" : "点击进入小世界"}
          </div>
          <div style={{ fontSize: 12, opacity: 0.6, marginTop: 6 }}>
            WASD 移动 · 鼠标环顾 · E 互动 · 空格跳跃 · Esc 暂停
          </div>
        </div>
      )}
    </div>
  );
}
