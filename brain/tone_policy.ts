export type ToneContractInput = {
  relationshipStage?: string;
  familiarity?: number;
  emotionalBond?: number;
  userMessage?: string;
  sceneImmersion?: boolean;
  shortInput?: boolean;
  negativeEmotionalContext?: boolean;
  continuingTopic?: boolean;
  decisionSeeking?: boolean;
  answerNow?: boolean;
};

export type ToneReview = {
  assistanty: boolean;
  score: number;
  reasons: string[];
};

type TonePattern = {
  reason: string;
  score: number;
  pattern: RegExp;
};

const ASSISTANTY_PATTERNS: TonePattern[] = [
  {
    reason: "主持式邀请",
    score: 3,
    pattern: /(要不要|想不想).{0,10}(陪你|一起|让我)/u,
  },
  {
    reason: "客服式让渡",
    score: 3,
    pattern: /如果你愿意|如果你需要|如果可以的话/u,
  },
  {
    reason: "建议腔过重",
    score: 2,
    pattern: /建议你|你可以先|也许可以试试|不如先/u,
  },
  {
    reason: "流程主持感",
    score: 2,
    pattern: /先告诉我|先和我说说|要不先/u,
  },
  {
    reason: "破角色表达",
    score: 4,
    pattern: /作为.?AI|我是.?AI/u,
  },
  {
    reason: "总结腔",
    score: 2,
    pattern: /总的来说|总而言之|所以你看|你看哈/u,
  },
  {
    reason: "模板化安慰",
    score: 3,
    pattern: /没事的|会好起来的|一切都会过去的|你要相信/u,
  },
  {
    reason: "轻飘乐观",
    score: 2,
    pattern: /至少你还有|往好的方面想|塞翁失马|否极泰来|一切都是最好的安排/u,
  },
  {
    reason: "空洞鼓励",
    score: 2,
    pattern: /^(?:加油|你一定行|你可以的|我相信你|你很棒)(?:！|!|。)?$/u,
  },
  {
    reason: "连环追问",
    score: 3,
    pattern: /(?:[？?].*){2,}/u,
  },
];

function classifyRelationshipDistance(input: ToneContractInput): "early" | "warm" | "close" {
  const stage = input.relationshipStage ?? "";
  if (stage.includes("亲密")) return "close";
  if (stage.includes("熟悉")) return "warm";
  const familiarity = input.familiarity ?? 0;
  const emotionalBond = input.emotionalBond ?? 0;
  if (familiarity >= 0.55 || emotionalBond >= 0.5) return "warm";
  return "early";
}

export function detectDecisionSeekingSignal(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /(?:要不要|是不是该|应不应该|该不该|需不需要|要不要换|你觉得我(?:该|要)|你觉得我.*应该|我是不是需要|我该不该|我现在应该|你怎么看)/u.test(
    trimmed,
  );
}

export function detectAnswerNowSignal(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /(?:我在问你|你怎么老是问我|别老问我|别一直问我|不要一直问我|一直问我问题|先回答我|直接说你的看法|我是在问你|你又不会帮我做|我成了你的助手|^(你说|直说|直接说|说你的看法|说说你的判断)$)/u.test(
    trimmed,
  );
}

export function detectHighRiskDistressSignal(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /(?:想直接从这里跳下去|是不是就都结束了|都结束了吧|结束算了|不想活了|不如死了|想死|去死|活不下去|撑不住了(?:真的|了)?|不如一了百了|被打|家暴|动手打我|威胁我|跟踪我|伤害自己|割了|自残|不想醒过来)/u.test(
    trimmed,
  );
}

export function detectPracticalDistressSignal(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const debtOrConstraint =
    /(?:欠(?:了)?(?:七八万|十几万|[\d一二三四五六七八九十百千万]+)|负债|花呗|贷款|房贷|车贷|网贷|赔了十几万|赔了[\d一二三四五六七八九十百千万]+|月(?:收入|薪)|每个月挣|工资只有|手里只有|还到啥时候|还到什么时候|扛不住|撑不住|压得我喘不过气|被裁|裁员|辞退了|失业|没工作了|被开了|确诊|手术|住院|查出来.{0,4}(?:癌|肿瘤|重症)|被骗|诈骗|钱没了|转错钱|被坑了)/u;
  const judgmentAsk =
    /(?:怎么办|咋办|怎么还|还到啥时候|还到什么时候|你帮我算算|该怎么办|是不是该|要不要|该不该|得还到)/u;
  const debtPlusDistress =
    /(?:(?:赔了|欠了|还欠|负债|花呗|贷款|网贷).{0,12}(?:扛不住|撑不住|喘不过气|压得我|压得人|快崩了|要疯了))/u;
  const lifeCrisisPlusDistress =
    /(?:(?:被裁|辞退|失业|确诊|手术|被骗|诈骗).{0,12}(?:怎么办|咋办|扛不住|撑不住|快崩了|要疯了|不知道该))/u;
  return (debtOrConstraint.test(trimmed) && judgmentAsk.test(trimmed)) || debtPlusDistress.test(trimmed) || lifeCrisisPlusDistress.test(trimmed);
}

export function detectRelationalRecallSignal(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /(?:我们之前聊了什么|还记得吗|还记得|你忘记(?:啦|了)?|你忘了|我刚才说过|我已经说过|你真记性不好|再想想|你记性不好|不是刚说过)/u.test(
    trimmed,
  );
}

export function detectBedtimeSignal(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /(?:睡不着|失眠|睡前|晚安|困了|要睡了|准备睡|上床了|躺下了|关灯了|熄灯了|夜里睡不着|半夜醒了)/u.test(trimmed);
}

// 自责 / 无价值感：自我指向的负面评价。W-PRES-02 "自责" 验收项。
export function detectSelfBlameSignal(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const selfDirected =
    /(?:自己|我)(?:真|真的|就|就是|特别|好|太|很|挺|是个?|是不是)?.{0,2}(?:没用|废物|窝囊|没出息|一无是处|一事无成|很失败|失败者|不中用|没价值|不配|是累赘|是拖累|太差劲|很差劲|很差)/u;
  const generic =
    /(?:做什么都做不好|什么都做不好|干啥都不行|什么都干不好|我太没用|我好没用|我真没用|都怪我|都是我的错|全怪我|我太差劲|我好失败|我真失败|讨厌(?:我)?自己|恨自己|活该我|是不是我太差)/u;
  return selfDirected.test(trimmed) || generic.test(trimmed);
}

// 反讽：正面表层 + 负面实质同现，避免被关键词情绪引擎误判成 positive。
export function detectSarcasmSignal(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const positiveSurface =
    /(?:真是?太好了|太好了(?:呢|啊|哦|喔|，|。|！|!)|真好啊?|可真行|好极了|太棒了|太妙了|真不错呢|真有你的|真厉害呢|可喜可贺|恭喜我|开心死了|美滋滋|完美)/u;
  const negativeOutcome =
    /(?:白干|被毙|被否|被拒|泡汤|黄了|凉了|搞砸|完蛋|又出问题|加班|被批|被骂|被裁|扣钱|被坑|出错|失败|崩了|没了|赔|亏|被砍|废了|取消|打水漂|竹篮打水)/u;
  return positiveSurface.test(trimmed) && negativeOutcome.test(trimmed);
}

// 求陪伴非求建议：用户明确要的是在场，不是方案。别硬塞判断。
export function detectComfortSeekingVentSignal(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /(?:就想?找个?人说说|想找人说说话?|找个人说说|就想说说|只是想说说|想倾诉|发泄一?下|吐槽一?下|陪陪我|陪我(?:待|坐|聊|一会)|不(?:用|要|想|需要)(?:你)?(?:给我)?(?:什么)?(?:建议|意见|办法|分析|方案|道理)|不是(?:想)?(?:让你)?.{0,12}(?:建议|意见)|别(?:给我)?讲道理|不用安慰)/u.test(
    trimmed,
  );
}

// 被批评 / 被否定：现实关系里被打压的失落，需严肃承接而非轻聊。
export function detectCriticizedDistressSignal(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const criticized =
    /(?:被(?:领导|老板|老师|同事|全组|主管|经理|客户|同学|大家|室友|朋友|家人|爸妈|父母|对象|男友|女友|老公|老婆|亲戚|长辈|当众|当面|公开)?.{0,6}(?:批|骂|说了|否|怼|训|教育|数落|指责|嫌弃|看不起|瞧不起)|挨(?:批|骂|训)|被批评|被骂(?:了|惨)?|被否定|被全盘否定|被怼|被数落|被指责|被嫌弃|被看不起|被瞧不起|被.{0,6}(?:当面|当众).{0,4}(?:说|批|骂|否|怼|指责|嘲).{0,8}(?:不行|没用|差|废|垃圾|能力不行))/u;
  const demeaned =
    /(?:说我.{0,10}(?:不行|不够|很差|太差|像实习生|水平差|没用|不专业|不合格|这么差|这点都做不好|就这样了|废了|完了|废物|没出息)|(?:室友|朋友|同事|同学|家人|爸妈|对象).{0,8}(?:说我|嫌我|觉得我).{0,10}(?:不行|没用|差|废|完了|就这样|没出息|能力不行))/u;
  return criticized.test(trimmed) || demeaned.test(trimmed);
}

// 重情绪倾诉：高强度负面情绪 affect（含失眠级别的喘不过气），区别于"有点累"。
export function detectHeavyDistressShareSignal(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /(?:崩溃|快崩了|要崩溃|想哭|好想哭|忍不住哭|快撑不住|撑不住了|扛不住了|快扛不住|喘不过气|透不过气|压得喘不过气|压得慌|压力好大|压力太大|心里(?:堵|空)得慌|堵得慌|难受死了|太难受了|好委屈|太委屈|特别委屈|憋屈|快不行了|熬不住|撑不下去|快疯了|要疯了|绝望|脑子里全是|满脑子都是|一直在想|总想着|放不下|忘不掉|全世界都在压|全世界都跟我作对)/u.test(
    trimmed,
  );
}

// 退缩 / 放弃：表面无情绪词但语义很重的 withdrawal，需轻轻接住不能忽视。
export function detectWithdrawalSignal(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  // 短句+放弃感（过长则更可能是在叙事）
  if (trimmed.length > 40) return false;
  // "算了不吃外卖了，自己做" 这类有具体后续行动的不是退缩
  if (/^算了.{0,4}(?:不吃|不去|不买|不看|不玩|自己)/u.test(trimmed)) return false;
  // 包含话题转向词 → 在转换话题，不是退缩
  if (/(?:但是|但我|不过|其实|另外|还有|对了|诶)/u.test(trimmed)) return false;
  return /(?:算了|不说了|不聊了|不想说了|不想聊了|随便吧|无所谓了?|怎样都行|都行吧|随你吧|爱咋咋|管他呢|反正也没用|说了也没用|说了也白说|反正都一样|有什么好说的|说了有什么用|跟谁说都一样|不说也罢)/u.test(
    trimmed,
  );
}

// 情绪承接场景统一入口：自责 / 反讽 / 求陪伴 / 被否定 / 重情绪 / 退缩放弃。
// 用于在回合解释层把这些坏样本从轻聊里捞出来，给到"稳稳陪着"的策略。
export function detectEmotionalDistressSignal(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return (
    detectSelfBlameSignal(trimmed) ||
    detectSarcasmSignal(trimmed) ||
    detectComfortSeekingVentSignal(trimmed) ||
    detectCriticizedDistressSignal(trimmed) ||
    detectHeavyDistressShareSignal(trimmed) ||
    detectWithdrawalSignal(trimmed)
  );
}

export function buildToneContract(input: ToneContractInput): string {
  const distance = classifyRelationshipDistance(input);
  const lines: string[] = [
    "像真人接话，不像客服、主持人或通用助手",
    "先接住用户此刻的点，再往前推一步；不要上来总结、教育或给流程建议",
    "能短就短，少解释你自己，少用模板化安慰句",
    "不要用'总的来说''所以你看'这类总结腔开头",
    "日常碎聊不要表现得比用户更兴奋；用户随便说一句，不用大惊小怪地回应",
  ];

  if (input.sceneImmersion) {
    lines.push("用户已经在共同场景里时，直接承接当前画面，不要退回成邀请开始想象。");
  }

  if (input.negativeEmotionalContext) {
    lines.push("碰到委屈、难过、焦虑这类情绪，先陪着和确认感受，别急着讲道理。");
  }

  if (input.shortInput) {
    lines.push("用户说得短时，优先贴着上下文接一句，不要条件反射地抛主持式追问。");
  }

  if (input.continuingTopic) {
    lines.push("明显在续聊上一条线时，不要像新话题重开。");
  }

  if (input.decisionSeeking) {
    lines.push("用户是在向你要判断或建议时，先明确回答，不要先反问。");
  }

  if (input.answerNow) {
    lines.push("用户已经明确嫌你一直在问，这一轮先直接说你的判断，禁止继续绕着反问。");
  }

  if (distance === "early") {
    lines.push("关系还在建立时，温柔但别过熟，不要突然用力定义亲密感。");
  } else if (distance === "warm") {
    lines.push("关系已在升温，可以更生活化、更口语一点，但别滑回油腻或表演感。");
  } else {
    lines.push("关系已较亲近，允许更贴近、更在场，但仍然要像自然接话，不像台词表演。");
  }

  lines.push("少用这些开头：'如果你愿意'、'要不要我陪你'、'想不想让我'、'建议你'、'总的来说'、'没事的'、'你可以先'。");
  return lines.join("；");
}

export function reviewReplyTone(reply: string): ToneReview {
  const normalized = reply.trim();
  if (!normalized) {
    return { assistanty: false, score: 0, reasons: [] };
  }

  const reasons: string[] = [];
  let score = 0;
  for (const entry of ASSISTANTY_PATTERNS) {
    if (entry.pattern.test(normalized)) {
      reasons.push(entry.reason);
      score += entry.score;
    }
  }

  if (normalized.length > 90 && /你可以|建议|不如|先/u.test(normalized)) {
    reasons.push("长句建议味偏重");
    score += 2;
  }

  return {
    assistanty: score >= 3,
    score,
    reasons,
  };
}
