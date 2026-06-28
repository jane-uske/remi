import { loadPersonaPack } from "../persona/pack/loader";
import { DEFAULT_PERSONA_PACK_ID } from "../persona/pack/types";
import { createLogger } from "../infra/logger";
import { getConfig } from "../server/config";

const logger = createLogger("persona_pack_mode");

/**
 * 每连接当前选中的 persona pack id（运行时切换，角色卡平台 M2）。
 *
 * 与 {@link ./nsfw_mode} 同构——per-connection 的轻量状态，由 prompt_builder
 * 读取来决定加载哪张角色卡。未选择时回退到默认 pack（remi），所以 M1 行为不变。
 *
 * M2 只做内存态运行时切换；跨会话持久化（user_persona_presets 扩列 / 新表）与
 * 前端切换 UI 留给后续，避免在此动 DB 迁移。
 */
const activePackByConn = new Map<string, string>();

export function getActivePersonaPackId(connId?: string | null): string {
  // 默认 pack 可由 REMI_DEFAULT_PERSONA_PACK 配置（缺省 remi）；运行时 per-conn
  // 切换（setActivePersonaPack）优先级最高。
  const fallback = getConfig().REMI_DEFAULT_PERSONA_PACK || DEFAULT_PERSONA_PACK_ID;
  if (!connId) return fallback;
  return activePackByConn.get(connId) ?? fallback;
}

/**
 * 切换某连接的 active pack。只接受真实存在（可加载）的 pack，否则拒绝并保持原状，
 * 返回是否成功，供调用方回报用户。
 */
export function setActivePersonaPack(connId: string, packId: string): boolean {
  if (!loadPersonaPack(packId)) {
    logger.warn("拒绝切换到不存在的 persona pack", { connId, packId });
    return false;
  }
  activePackByConn.set(connId, packId);
  logger.info("切换 persona pack", { connId, packId });
  return true;
}

/** 连接结束时清理（与 clearNsfw 同步调用）。 */
export function clearActivePersonaPack(connId: string): void {
  activePackByConn.delete(connId);
}
