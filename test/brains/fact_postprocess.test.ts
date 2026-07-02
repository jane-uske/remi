import { expect } from "chai";
import {
  normalizeExtractedFact,
  isStateLikeFact,
  DATE_STAMP_SUFFIX_RE,
  STATE_WORDS,
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
      const result = normalizeExtractedFact(
        { key: "居住地/活动区域", value: "集美", confidence: 0.7, source: "user" },
        OBS_DATE,
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
      const result = normalizeExtractedFact(
        { key: "职业", value: "程序员", confidence: 0.9, source: "user" },
        OBS_DATE,
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
