import { expect } from "chai";
import {
  normalizeExtractedFact,
  isStateLikeFact,
  DATE_STAMP_SUFFIX_RE,
  STATE_WORDS,
  passesIdentityEvidenceGate,
  identityGateRejectionReason,
  HIGH_RISK_IDENTITY_KEYS,
  normalizeFactKey,
} from "../../brains/fact_postprocess";

const OBS_DATE = "2026-06-28";

describe("fact_postprocess: normalizeExtractedFact", () => {
  // ── 规则 1：key 归一化 ──
  describe("规则 1：key 归一化", () => {
    it("剥离 key 里的指示性时间词（基线真实坏例：今晚安排）", () => {
      const result = normalizeExtractedFact(
        { key: "今晚安排", value: "邀请 Remi 共进晚餐（2026-06-04记）", confidence: 0.8, source: "user" },
        "2026-06-04",
      );
      expect(result).to.not.equal(null);
      expect(result!.key).to.equal("安排");
      // value 已经带日期标注，不重复附加
      expect(result!.value).to.equal("邀请 Remi 共进晚餐（2026-06-04记）");
    });

    it("斜杠分隔取第一段（基线真实坏例：居住地/活动区域）", () => {
      // "居住地"归一化后命中规则 5 的高危键清单，需要提供第一人称直陈证据
      // （userMessage）才能通过——测试本身验证的是"斜杠分段"这条归一化机制，
      // 与规则 5 是否触发是两件事，因此这里补一个真实合法的直陈来源，不影响
      // 本用例原本要验证的行为。
      const result = normalizeExtractedFact(
        { key: "居住地/活动区域", value: "集美", confidence: 0.7, source: "user" },
        OBS_DATE,
        "我住在集美",
      );
      expect(result).to.not.equal(null);
      expect(result!.key).to.equal("居住地");
    });

    it("第一段剥离时间词后为空则回退到下一段（今晚/安排 → 安排）", () => {
      const result = normalizeExtractedFact(
        { key: "今晚/安排", value: "开会", confidence: 0.8, source: "user" },
        OBS_DATE,
      );
      expect(result).to.not.equal(null);
      expect(result!.key).to.equal("安排");
    });

    it("key 纯粹是指示性时间词本身、救不回来 → 整条 fact 丢弃", () => {
      const result = normalizeExtractedFact(
        { key: "今晚", value: "某个值", confidence: 0.8, source: "user" },
        OBS_DATE,
      );
      expect(result).to.equal(null);
    });

    it("剥离后变得很短/很泛（安排/状态）也保留，不做进一步智能改写", () => {
      const result = normalizeExtractedFact(
        { key: "最近状态", value: "一切正常", confidence: 0.8, source: "user" },
        OBS_DATE,
      );
      expect(result).to.not.equal(null);
      expect(result!.key).to.equal("状态");
    });

    it("超过 12 字的 key 截断（无自然空白可切分时硬截断到 12 字）", () => {
      const longKey = "个人职业发展方向与行业细分领域偏好"; // 17 字，无标点无时间词
      const result = normalizeExtractedFact(
        { key: longKey, value: "后端", confidence: 0.8, source: "user" },
        OBS_DATE,
      );
      expect(result).to.not.equal(null);
      expect(result!.key.length).to.be.at.most(12);
      expect(longKey.startsWith(result!.key)).to.equal(true);
      expect(result!.key).to.equal(longKey.slice(0, 12));
    });

    it("普通 key 不含标点/时间词/超长，原样通过", () => {
      // "职业"是规则 5 的高危键，同上一条用例，补第一人称直陈来源
      // （userMessage）满足门槛，不影响本用例验证的"平凡 key 原样通过"行为。
      const result = normalizeExtractedFact(
        { key: "职业", value: "程序员", confidence: 0.9, source: "user" },
        OBS_DATE,
        "我是程序员",
      );
      expect(result).to.deep.equal({ key: "职业", value: "程序员" });
    });
  });

  // ── 规则 2：状态类自动补日期 ──
  describe("规则 2：状态类自动补日期", () => {
    it("状态类词表命中（基线真实坏例：无日期状态）→ value 末尾自动附观察日期", () => {
      const result = normalizeExtractedFact(
        { key: "身体状况", value: "胃痛、失眠", confidence: 0.7, source: "user" },
        "2026-06-28",
      );
      expect(result).to.not.equal(null);
      expect(result!.value).to.equal("胃痛、失眠（6月28日记）");
    });

    it("value 侧命中状态词表（加班）也补日期，即使 key 是中性词", () => {
      const result = normalizeExtractedFact(
        { key: "近期", value: "工作至凌晨两点", confidence: 0.7, source: "user" },
        "2026-06-01",
      );
      expect(result).to.not.equal(null);
      expect(result!.value).to.equal("工作至凌晨两点（6月1日记）");
    });

    it("value 已带 M月D日记 标注 → 不重复附加（幂等）", () => {
      const result = normalizeExtractedFact(
        { key: "身体状况", value: "胃痛、失眠（6月28日记）", confidence: 0.7, source: "user" },
        "2026-06-28",
      );
      expect(result).to.not.equal(null);
      expect(result!.value).to.equal("胃痛、失眠（6月28日记）");
    });

    it("value 已带 YYYY-MM-DD记 标注（ANALYSIS_PROMPT 自产格式）→ 不重复附加", () => {
      const result = normalizeExtractedFact(
        { key: "身体状况", value: "在还债（2026-06-28记）", confidence: 0.7, source: "user" },
        "2026-06-28",
      );
      expect(result).to.not.equal(null);
      expect(result!.value).to.equal("在还债（2026-06-28记）");
    });

    it("（20 开头但不含'记'的年份括注不算已标注（基线真实坏例：明年去上海（2027年）过了这种情况）", () => {
      // LLM 把"明年"换算成了"2027年"（换算了指代年份，满足了 temporal_poison
      // 规则），但那是"这件事哪年发生"，不是"这条记忆哪天记下的"——两者不是
      // 一回事。「（20」弱前缀单独出现不该被当成"已经有观察日期标注"。
      const result = normalizeExtractedFact(
        { key: "计划行程", value: "明年去上海（2027年）", confidence: 0.8, source: "user" },
        "2026-06-16",
      );
      expect(result).to.not.equal(null);
      expect(result!.value).to.equal("明年去上海（2027年）（6月16日记）");
    });
  });

  // ── 规则 3：残留时间词兜底 ──
  describe("规则 3：value 残留指示性时间词兜底", () => {
    it("非状态类 fact 但 value 仍含指示性时间词 → 同样补观察日期标注", () => {
      const result = normalizeExtractedFact(
        { key: "纪念日", value: "现在的纪念日是6月1日", confidence: 0.8, source: "user" },
        "2026-06-01",
      );
      expect(result).to.not.equal(null);
      // 不属于状态类词表（isStateLikeFact 应为 false），走的是规则 3 兜底
      expect(isStateLikeFact("纪念日", "现在的纪念日是6月1日")).to.equal(false);
      expect(result!.value).to.equal("现在的纪念日是6月1日（6月1日记）");
    });
  });

  // ── 规则 4：低置信过滤 ──
  describe("规则 4：低置信过滤", () => {
    it("confidence < 0.6 且 source=assistant → 丢弃", () => {
      const result = normalizeExtractedFact(
        { key: "喜欢的颜色", value: "蓝色", confidence: 0.4, source: "assistant" },
        OBS_DATE,
      );
      expect(result).to.equal(null);
    });

    it("confidence < 0.6 但 source=user（用户原话，不是推断）→ 不过滤", () => {
      const result = normalizeExtractedFact(
        { key: "喜欢的颜色", value: "蓝色", confidence: 0.4, source: "user" },
        OBS_DATE,
      );
      expect(result).to.not.equal(null);
    });

    it("confidence 缺失（未提供）→ 不过滤", () => {
      const result = normalizeExtractedFact(
        { key: "喜欢的颜色", value: "蓝色", source: "assistant" },
        OBS_DATE,
      );
      expect(result).to.not.equal(null);
    });

    it("confidence 恰好等于 0.6（边界，不小于阈值）→ 不过滤", () => {
      const result = normalizeExtractedFact(
        { key: "喜欢的颜色", value: "蓝色", confidence: 0.6, source: "assistant" },
        OBS_DATE,
      );
      expect(result).to.not.equal(null);
    });

    it("confidence 高（>=0.6）即使 source=assistant 也不过滤", () => {
      const result = normalizeExtractedFact(
        { key: "喜欢的颜色", value: "蓝色", confidence: 0.9, source: "assistant" },
        OBS_DATE,
      );
      expect(result).to.not.equal(null);
    });
  });

  // ── 边界输入 ──
  describe("边界输入", () => {
    it("空 key → null", () => {
      expect(normalizeExtractedFact({ key: "", value: "x" }, OBS_DATE)).to.equal(null);
    });

    it("空 value → null", () => {
      expect(normalizeExtractedFact({ key: "x", value: "" }, OBS_DATE)).to.equal(null);
    });

    it("纯空白 key/value → null", () => {
      expect(normalizeExtractedFact({ key: "   ", value: "  " }, OBS_DATE)).to.equal(null);
    });
  });
});

describe("fact_postprocess: isStateLikeFact（与 memory_polish_eval 共用导出）", () => {
  it("key 命中状态词表 → true", () => {
    expect(isStateLikeFact("身体状况", "随便什么")).to.equal(true);
  });

  it("value 命中状态词表 → true", () => {
    expect(isStateLikeFact("职业", "最近在加班")).to.equal(true);
  });

  it("value 含 正在/仍在/刚 → true（即使没命中词表）", () => {
    expect(isStateLikeFact("职业", "正在忙一个项目")).to.equal(true);
  });

  it("既非状态词表也无时态标记 → false", () => {
    expect(isStateLikeFact("职业", "程序员")).to.equal(false);
  });

  it("任务给定的最小词表全部被词表覆盖", () => {
    // 状态/心情/情绪/身体/健康/疼/病/累/安排/计划/日程/工作至/加班
    const minimal = [
      "状态", "心情", "情绪", "身体", "健康", "疼", "病", "累", "安排",
      "计划", "日程", "工作至", "加班",
    ];
    for (const w of minimal) {
      expect(STATE_WORDS).to.include(w);
    }
  });
});

describe("fact_postprocess: DATE_STAMP_SUFFIX_RE（与 memory_polish_eval 的 hallucination_lite 共用）", () => {
  it("匹配 M月D日记 格式", () => {
    expect(DATE_STAMP_SUFFIX_RE.test("胃痛、失眠（6月28日记）")).to.equal(true);
  });

  it("匹配 YYYY-MM-DD记 格式", () => {
    expect(DATE_STAMP_SUFFIX_RE.test("在还债（2026-06-28记）")).to.equal(true);
  });

  it("不匹配没有日期戳的普通 value", () => {
    expect(DATE_STAMP_SUFFIX_RE.test("程序员")).to.equal(false);
  });

  it("挖掉日期戳后剩余内容不含意外产生的假实体（日+记 相邻问题）", () => {
    const value = "胃痛、失眠（6月28日记）";
    const stripped = value.replace(DATE_STAMP_SUFFIX_RE, "");
    expect(stripped).to.equal("胃痛、失眠");
    expect(stripped).to.not.include("记");
  });
});

// ── 规则 5：身份类高危键第一人称直陈门槛（"阿兵案"根治，2026-07-04）──
// 生产实锤：用户说"复述一下阿兵这个小说"，慢脑把小说主角名提炼成了用户画像
// 「姓名=阿兵」。本规则要求身份类高危键（姓名/住所/职业/家人等）入库前，
// 本轮用户消息必须含第一人称直陈证据，且不处于虚构叙事请求语境。
describe("fact_postprocess: passesIdentityEvidenceGate（规则 5：身份类高危键第一人称直陈门槛）", () => {
  it("第一人称直陈——'我叫X' → 通过", () => {
    expect(passesIdentityEvidenceGate("姓名", "我叫小明")).to.equal(true);
  });

  it("第一人称直陈——'我住在X' → 通过", () => {
    expect(passesIdentityEvidenceGate("住所", "我住在杭州")).to.equal(true);
  });

  it("第一人称直陈——'我今年X岁' → 通过", () => {
    expect(passesIdentityEvidenceGate("年龄", "我今年28岁了")).to.equal(true);
  });

  it("第一人称直陈——'我是X'（非虚构语境）→ 通过", () => {
    expect(passesIdentityEvidenceGate("职业", "我是一名程序员")).to.equal(true);
  });

  it("边界：'叫我主人' 是关系称呼类第一人称直陈 → 应通过（不是转述虚构角色名）", () => {
    expect(passesIdentityEvidenceGate("称呼", "叫我主人就好啦")).to.equal(true);
  });

  it("转述——'他叫X'（第三方，非用户本人）→ 拒绝", () => {
    expect(passesIdentityEvidenceGate("姓名", "他叫王五，是我同事")).to.equal(false);
  });

  it("虚构语境——小说复述请求（阿兵案真实坏例复现）→ 拒绝", () => {
    const msg =
      "给你讲个小说让你复述：《雨夜》，主角叫陈默，35岁，是杭州的一名外科医生，妻子叫林晚。复述一下这个故事";
    expect(passesIdentityEvidenceGate("姓名", msg)).to.equal(false);
    expect(passesIdentityEvidenceGate("职业", msg)).to.equal(false);
  });

  it("虚构语境——角色扮演请求 → 拒绝", () => {
    expect(
      passesIdentityEvidenceGate("职业", "我们来玩角色扮演吧，你扮演医生，我扮演病人"),
    ).to.equal(false);
  });

  it("虚构语境——'写个故事' 请求 → 拒绝，即使句式像第一人称直陈", () => {
    expect(passesIdentityEvidenceGate("姓名", "帮我写个故事，主角叫小李")).to.equal(false);
  });

  it("疑问句/自我怀疑——'我是不是' 不算第一人称直陈 → 拒绝", () => {
    expect(passesIdentityEvidenceGate("职业", "我是不是该辞职换个工作啊")).to.equal(false);
  });

  it("复合 key 命中词根即算高危（'配偶姓名'不是清单里的精确项，但包含'配偶'和'姓名'两个词根）——2026-07-04 dev 实测坏例：本探针跑 BC-T9 时 LLM 真实产出过此 key，虚构语境下应拒绝", () => {
    const fictionMsg =
      "给你讲个小说让你复述：《雨夜》，主角叫陈默，35岁，是杭州的一名外科医生，妻子叫林晚。复述一下这个故事";
    expect(passesIdentityEvidenceGate("配偶姓名", fictionMsg)).to.equal(false);
  });

  it("复合 key 命中词根——第一人称直陈证据下应正常通过（验证包含匹配不会变成'高危键复合形态一律拒绝'的误伤）", () => {
    expect(passesIdentityEvidenceGate("配偶姓名", "我妻子叫小红")).to.equal(true);
  });

  it("超长描述性 key 恰好夹带高危词根不应误判——'个人职业发展方向与行业细'（12字截断产物）不是在问用户职业本身，只是恰好包含'职业'二字", () => {
    // 真实坏例：修复"配偶姓名"复合键漏判、把匹配方式从精确相等改成包含匹配
    // 后，2026-07-04 本地验证时发现的新副作用——test/brains/fact_postprocess
    // .test.ts 已有的"超过 12 字的 key 截断"用例（"个人职业发展方向与行业
    // 细分领域偏好"截断后是"个人职业发展方向与行业细"）恰好包含"职业"，被
    // 误判成高危键。这条用例把该场景单独固化在 passesIdentityEvidenceGate
    // 层面，防止未来再次回归。
    expect(passesIdentityEvidenceGate("个人职业发展方向与行业细", "随便说点什么")).to.equal(true);
  });

  it("非身份类键——虚构语境下依然不受本规则影响，直接通过", () => {
    expect(
      passesIdentityEvidenceGate("喜欢的颜色", "给你讲个小说，主角喜欢蓝色"),
    ).to.equal(true);
  });

  it("非身份类键——没有任何直陈证据也不受影响，直接通过", () => {
    expect(passesIdentityEvidenceGate("交通工具", "随便扯淡")).to.equal(true);
  });

  it("空消息 → 高危键拒绝（没有证据来源）", () => {
    expect(passesIdentityEvidenceGate("姓名", "")).to.equal(false);
    expect(passesIdentityEvidenceGate("姓名", "   ")).to.equal(false);
  });

  it("HIGH_RISK_IDENTITY_KEYS 覆盖任务点名的类目样例", () => {
    for (const k of ["姓名", "称呼", "住所", "居住地", "籍贯", "年龄", "性别", "职业", "家人", "伴侣"]) {
      expect(HIGH_RISK_IDENTITY_KEYS.has(k), `expected key "${k}" in HIGH_RISK_IDENTITY_KEYS`).to.equal(true);
    }
  });
});

describe("fact_postprocess: identityGateRejectionReason（规则 5 拒绝原因，供 INFO 日志）", () => {
  it("非高危键 → 始终返回 null（不触发规则 5 的日志路径）", () => {
    expect(identityGateRejectionReason("喜欢的颜色", "随便说点什么")).to.equal(null);
  });

  it("高危键 + 通过门槛 → 返回 null（不应为放行的 fact 打拒绝日志）", () => {
    expect(identityGateRejectionReason("姓名", "我叫小明")).to.equal(null);
  });

  it("高危键 + 虚构语境 → 返回非 null 原因，且原因文本点明虚构语境", () => {
    const reason = identityGateRejectionReason("姓名", "帮我编个故事，主角叫小李");
    expect(reason).to.not.equal(null);
    expect(reason).to.include("虚构");
  });

  it("高危键 + 缺少第一人称直陈证据（但非虚构语境）→ 返回非 null 原因，且原因文本点明缺证据", () => {
    const reason = identityGateRejectionReason("姓名", "他叫王五");
    expect(reason).to.not.equal(null);
    expect(reason).to.include("直陈");
  });
});

describe("fact_postprocess: normalizeExtractedFact 集成规则 5（完整链路，非仅门槛函数）", () => {
  it("身份类高危键 + 第一人称直陈证据 → 正常通过完整归一化流程", () => {
    const result = normalizeExtractedFact(
      { key: "姓名", value: "小明", confidence: 0.9, source: "user" },
      OBS_DATE,
      "我叫小明",
    );
    expect(result).to.deep.equal({ key: "姓名", value: "小明" });
  });

  it("身份类高危键 + 小说复述语境（阿兵案真实场景复现）→ 整条 fact 丢弃", () => {
    const result = normalizeExtractedFact(
      { key: "姓名", value: "陈默", confidence: 0.9, source: "user" },
      OBS_DATE,
      "给你讲个小说让你复述：《雨夜》，主角叫陈默，是杭州的一名外科医生。复述一下这个故事",
    );
    expect(result).to.equal(null);
  });

  it("身份类高危键 + 未传 userMessage（缺省空串）→ 拒绝（不会意外放行）", () => {
    const result = normalizeExtractedFact(
      { key: "姓名", value: "小明", confidence: 0.9, source: "user" },
      OBS_DATE,
    );
    expect(result).to.equal(null);
  });

  it("原始 key 需要先归一化才命中高危清单（'居住地/活动区域' → '居住地'）时，规则 5 仍按归一化后的 key 生效", () => {
    // 归一化本身在 fact_postprocess.test.ts 顶部"规则 1"里验证过会产出"居住地"；
    // 这里验证规则 5 确实是对归一化后的 key 判定，而不是对原始未归一化的 key。
    const rejected = normalizeExtractedFact(
      { key: "居住地/活动区域", value: "集美", confidence: 0.9, source: "user" },
      OBS_DATE,
      "他说他住在集美", // 非用户第一人称直陈
    );
    expect(rejected).to.equal(null);

    const accepted = normalizeExtractedFact(
      { key: "居住地/活动区域", value: "集美", confidence: 0.9, source: "user" },
      OBS_DATE,
      "我住在集美",
    );
    expect(accepted).to.deep.equal({ key: "居住地", value: "集美" });
  });

  it("非身份类键不受规则 5 影响，即使 userMessage 是虚构语境", () => {
    const result = normalizeExtractedFact(
      { key: "喜欢的颜色", value: "蓝色", confidence: 0.9, source: "user" },
      OBS_DATE,
      "给你讲个小说，主角喜欢蓝色",
    );
    expect(result).to.deep.equal({ key: "喜欢的颜色", value: "蓝色" });
  });
});

describe("fact_postprocess: normalizeFactKey（导出给调用方做日志归因）", () => {
  it("归一化结果与 normalizeExtractedFact 内部使用的 key 一致（用于日志场景重算同一个 key）", () => {
    expect(normalizeFactKey("居住地/活动区域")).to.equal("居住地");
    expect(normalizeFactKey("职业")).to.equal("职业");
  });
});
