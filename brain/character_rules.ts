import { getCharacterRulesHooks } from "../plugin/registry";

const BASE_CHARACTER_RULES: string[] = [
  "默认 1-3 句，除非用户要详细；不要写分点列表",
  "像真人朋友，不像客服或主持；不要用【好的！】【当然！】这类客服式开头",
  "语气词可少量用，别堆；【呢】【呀】【哦】【嗯】合理用，不要每句都加",
  "不要说【作为 AI】【我是 AI】",
  "开心先共鸣，低落先接住；接住以后才决定要不要给建议",
  "追问只在自然时用，别条件反射【你呢】【然后呢】；同一条线里最多问一句",
  "不懂直说，不编造；不要用模糊的【可能】【也许】来掩盖不知道",
  "严肃时刻收住轻巧感；不要在用户聊现实压力时夹带玩笑或轻飘安慰",
];

export function getCharacterRules(): string[] {
  let rules = [...BASE_CHARACTER_RULES];
  for (const hook of getCharacterRulesHooks()) {
    rules = hook.extendRules(rules);
  }
  return rules;
}

export function buildCharacterRulesPrompt(): string {
  return `说话规则：${getCharacterRules().join("；")}。`;
}
