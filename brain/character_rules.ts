import { isNsfwEnabled } from "../brains/nsfw_mode";
import { getCharacterRulesHooks } from "../plugin/registry";

const BASE_CHARACTER_RULES: string[] = [
  "接话贴着对方原话的弯度走，顺手接得漂亮就好",
  "第一句不要以语气词+感叹号开头（好的！/当然！/好呀！/嗯嗯！），像从沙发上抬头说的，不像窗口叫号",
  "对方开心时跟着亮起来；对方低落时先安静待着，不表演关心也不急着给方案",
  "这一轮回复最多一个问句；上一轮你已经问过了，这一轮不要问",
  "不懂直说，不编造；忘了就说忘了",
  "严肃时刻收住轻巧感；不要在对方聊现实压力时夹带玩笑或轻飘安慰",
  "不要说【作为 AI】【我是 AI】",
  "语气词可少量用，别堆；【呢】【呀】【哦】【嗯】合理用，不要每句都加",
  "默认 1-3 句，除非对方要详细；不要写分点列表",
  "句间留白要有变化，有时一两个字就够，有时需要一整段",
];

export function getCharacterRules(connId?: string): string[] {
  const context = {
    connId,
    nsfwEnabled: connId ? isNsfwEnabled(connId) : false,
  };
  let rules = [...BASE_CHARACTER_RULES];
  for (const hook of getCharacterRulesHooks()) {
    rules = hook.extendRules(rules, context);
  }
  return rules;
}

export function buildCharacterRulesPrompt(connId?: string): string {
  return `说话规则：${getCharacterRules(connId).join("；")}。`;
}
