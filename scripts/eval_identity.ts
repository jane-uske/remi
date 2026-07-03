// ── Eval Identity（评测隔离止血）──────────────────────────────────────────
//
// 背景：scripts/ 下打真实 /api/chat 或 /ws 的评测脚本（memory_probe_eval.ts 等）
// 默认不带任何 Authorization —— 服务端 infra/user_identity.ts 的
// resolveRequestUserIdentity() 在无 token 时把 storageUserId 落到共享常量
// DEV_STORAGE_USER_ID（"00000000-0000-4000-8000-000000000001"）。本机
// REMI_AUTH_ALLOW_LOOPBACK_BYPASS=1 时这个 id 正是真实用户本人的 loopback 身份——
// 已实锤：生产库里出现了整套评测剧本喂出来的假人设记忆。
//
// 修复不改服务端一行代码：server/gateway/loopback_identity.ts 的
// POST /api/loopback-identity 端点本来就是为"给 loopback 请求一个稳定的、与
// 共享 DEV 用户不同的身份"而建的（deviceId → 稳定 legacy JWT，
// normalizeToStorageUserId 对合法 UUID 直接透传做 storageUserId）。评测脚本
// 只需把 deviceId 设成固定的评测专用 UUID，换到 token 后作为 Bearer 挂在
// 每次 /api/chat* 请求和 /ws 连接上即可——resolveRequestUserIdentity() 对
// SSE 和 WS 是同一份代码（server/session/index.ts 的 ConnectionSession 与
// server/gateway/sse_chat.ts 的 handleChat 都调它），两条通道一次性打通。
//
// 使用方式：
//   import { fetchEvalToken, EVAL_USER_ID, withEvalAuthHeaders, evalWsUrl } from "./eval_identity";
//   const token = await fetchEvalToken(base);
//   fetch(url, { headers: withEvalAuthHeaders(token) })
//   new WebSocket(evalWsUrl(wsUrl, token))
//
// 若目标服务端未开 REMI_AUTH_ALLOW_LOOPBACK_BYPASS，或不是从 loopback 发起
// 请求，/api/loopback-identity 会返回 403 —— fetchEvalToken 会把这个情况
// 当作硬错误抛出（评测脚本应该失败退出，而不是静默回退到污染路径）。

/** 评测专用用户 UUID —— 固定值，所有评测脚本共用，与真实用户的 loopback 身份完全隔离。 */
export const EVAL_USER_ID = "eeeeeeee-0000-4000-8000-00000000feed";

/** 供 /api/loopback-identity 使用的 deviceId —— 复用同一常量，语义就是"评测专用设备"。 */
export const EVAL_DEVICE_ID = EVAL_USER_ID;

/**
 * 向 base 换取一个 legacy JWT，其 subject = deviceId（默认 EVAL_DEVICE_ID）。
 * 该 token 作为 Bearer 挂在后续请求上时，resolveRequestUserIdentity() 会把
 * storageUserId 解析为 deviceId 本身（UUID 透传），与真实用户的匿名/loopback
 * 身份（DEV_STORAGE_USER_ID）完全不同。
 *
 * 仅在服务端 REMI_AUTH_ALLOW_LOOPBACK_BYPASS=1 且请求来自 loopback 时可用
 * （见 server/gateway/loopback_identity.ts）—— 这正是探针脚本运行的场景。
 */
export async function fetchEvalToken(
  base: string,
  deviceId: string = EVAL_DEVICE_ID,
): Promise<string> {
  const res = await fetch(`${base.replace(/\/$/, "")}/api/loopback-identity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceId }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `[eval_identity] /api/loopback-identity 换取评测 token 失败 (${res.status}): ${body}\n` +
        `确认目标服务端 REMI_AUTH_ALLOW_LOOPBACK_BYPASS=1 且本次请求来自 loopback（127.0.0.1/localhost）。`,
    );
  }
  const data = (await res.json()) as { token?: string };
  if (!data.token) {
    throw new Error("[eval_identity] /api/loopback-identity 响应缺少 token 字段");
  }
  return data.token;
}

/** 给 HTTP 请求挂上评测身份的 Authorization header。 */
export function withEvalAuthHeaders(
  token: string,
  extra?: Record<string, string>,
): Record<string, string> {
  return { ...extra, Authorization: `Bearer ${token}` };
}

/**
 * 给 WS URL 挂上评测身份 —— extractWsToken()（server/gateway/index.ts）和
 * resolveRequestUserIdentity() 的 extractQueryToken() 都认 `?token=` 查询参数，
 * 原生 `ws` 包的 WebSocket 构造函数不方便传自定义 header，query string 是
 * 两端都支持、改动最小的方式。
 */
export function evalWsUrl(wsUrl: string, token: string): string {
  const url = new URL(wsUrl);
  url.searchParams.set("token", token);
  return url.toString();
}
