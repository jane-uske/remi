import { extractKeywords, keywordOverlapScore, normalizeText } from "./text_utils";

const LIGHT_ACK_PATTERN =
  /^(?:你好呀?|您好|哈喽|hello|hi|嗨|嘿|在吗|在不在|晚安(?:啦|呀)?|早安|早上好|晚上好|睡了|嗯+|嗯嗯+|哦+|噢+|啊+|好+|好的|好哦|好哒|收到|行吧?|明白了?|知道了?|我知道了|ok(?:ay)?|okk+|ok\s+ok(?:\s+我?知道了)?)[!！?？~～。\s]*$/iu;

const EXPLICIT_RECALL_PATTERN =
  /(?:还?记得|记住|忘了|之前(?:聊|说|提)|我们之前|上次|刚才(?:说|聊)|刚刚(?:说|聊)|聊了什么|说过什么|提过什么|谁在照顾|还记得.*吗)/u;

const VOLATILE_MEMORY_KEY_PATTERN =
  /^(?:当前|此刻|目前|现在|刚才|刚刚|今天|今日|昨日|昨天|明日|明天|本次|此次|此前状态|当前状态|当前诉求|当前需求|当前行为|当前行动|当前事务|当前处理事项|当前正在|正在|用户需求|用户诉求|索要内容)/u;

export function isLightAcknowledgementTurn(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 24) return false;
  return LIGHT_ACK_PATTERN.test(trimmed);
}

export function isExplicitMemoryRecallRequest(text: string): boolean {
  return EXPLICIT_RECALL_PATTERN.test(text.trim());
}

export function isVolatileMemoryKey(key: string): boolean {
  return VOLATILE_MEMORY_KEY_PATTERN.test(key.trim());
}

export function hasDirectTextOverlap(entryText: string, userMessage: string): boolean {
  const userText = normalizeText(userMessage);
  const entry = normalizeText(entryText);
  if (!userText || !entry) return false;
  if (entry.includes(userText) || userText.includes(entry)) return true;
  return keywordOverlapScore(entry, extractKeywords(userMessage), 1, 1) > 0;
}
