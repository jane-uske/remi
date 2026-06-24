# PR8 — Voice Quality Eval（真实数据）

> MEASURE ONLY：未改行为、未把任何 shadow 转 on、未接新模型、未改 Brain、未改默认 legacy。
> 场景数 22；turn detector real sidecar: 已接（真实 LiveKit turn-detector-multilingual EOU）；live latency: 已采（ws://127.0.0.1:3000/ws）
> ⚠️ live 探针向运行中的 :3000 发了少量文本 turn（会进真实会话历史）；latency 为文本路径 input→首 token/首音，语音路径需再叠加 STT。
> 复现：`NODE_OPTIONS="--no-experimental-strip-types" ./node_modules/.bin/ts-node --transpile-only scripts/voice_quality_eval.ts [--live --ws ws://127.0.0.1:3000/ws]`（可选 REMI_TURN_DETECTOR_ENDPOINT 接真实 LiveKit sidecar）

## 1. repairing（低置信）触发分析
- 触发率：4/22（18%）
- reason 分布：tentative=2, non_speech=2
- **false positive（clean speech 被误判低置信）：0/17（0%）**

## 2. SmartTurn(stub) vs legacy 分歧
- 分歧率：20/22（91%）；其中 SmartTurn 更早切：20
- 分歧场景：short-2(legacy=LIKELY_END/smart=CONFIRMED_END)；long-1(legacy=LIKELY_END/smart=CONFIRMED_END)；long-2(legacy=LIKELY_END/smart=CONFIRMED_END)；midpause-1(legacy=LIKELY_END/smart=CONFIRMED_END)；midpause-2(legacy=LIKELY_END/smart=CONFIRMED_END)；hesit-1(legacy=HOLD/smart=LIKELY_END)；hesit-2(legacy=HOLD/smart=LIKELY_END)；hesit-3(legacy=HOLD/smart=LIKELY_END)；noise-1(legacy=HOLD/smart=LIKELY_END)；noise-2(legacy=HOLD/smart=LIKELY_END)；revise-1(legacy=LIKELY_END/smart=CONFIRMED_END)；revise-2(legacy=LIKELY_END/smart=CONFIRMED_END)；trail-1(legacy=HOLD/smart=LIKELY_END)；trail-2(legacy=HOLD/smart=LIKELY_END)；barge-1(legacy=HOLD/smart=LIKELY_END)；correct-1(legacy=LIKELY_END/smart=CONFIRMED_END)；smalltalk-1(legacy=HOLD/smart=LIKELY_END)；smalltalk-2(legacy=HOLD/smart=LIKELY_END)；cmd-1(legacy=LIKELY_END/smart=CONFIRMED_END)；cmd-2(legacy=LIKELY_END/smart=CONFIRMED_END)
- 真实 LiveKit EOU（高=模型判完整；expectComplete=人工标注是否真完整）：
  - short-1 「你好啊」 eou=0.09 expectComplete=true
  - short-2 「在吗？」 eou=0.765 expectComplete=true
  - long-1 「我最近在做一个语音助手项目，想让」 eou=0.209 expectComplete=true
  - long-2 「今天下午我去了趟超市，买了点菜和」 eou=0.07 expectComplete=true
  - midpause-1 「我想了想，还是算了吧。」 eou=0.402 expectComplete=true
  - midpause-2 「这个方案……我觉得可以试试。」 eou=0.371 expectComplete=true
  - hesit-1 「嗯」 eou=0.009 expectComplete=false
  - hesit-2 「那个」 eou=0.013 expectComplete=false
  - hesit-3 「啊这个」 eou=0 expectComplete=false
  - noise-1 「咳咳」 eou=0.201 expectComplete=false
  - noise-2 「哈哈哈」 eou=0.211 expectComplete=false
  - revise-1 「我想去北京，不对，是去上海。」 eou=0.007 expectComplete=true
  - revise-2 「明天，呃，后天再说吧。」 eou=0.619 expectComplete=true
  - trail-1 「我先去买点东西然后」 eou=0.009 expectComplete=false
  - trail-2 「因为我觉得」 eou=0.001 expectComplete=false
  - barge-1 「等一下我说个事」 eou=0.094 expectComplete=true
  - barge-2 「不是那个意思」 eou=0.163 expectComplete=true
  - correct-1 「我的意思是说，我们应该先做评测。」 eou=0.048 expectComplete=true
  - smalltalk-1 「今天天气真不错」 eou=0.12 expectComplete=true
  - smalltalk-2 「你今天过得怎么样」 eou=0.781 expectComplete=true
  - cmd-1 「帮我把明天上午十点的会议改到下午」 eou=0.107 expectComplete=true
  - cmd-2 「给我总结一下刚才那段话的要点，分」 eou=0.247 expectComplete=true
- ⚠️ 真完整但模型低 EOU(<0.15) 的样本（模型对长/复杂中文句欠准）：short-1(0.09)、long-2(0.07)、revise-1(0.007)、barge-1(0.094)、correct-1(0.048)、smalltalk-1(0.12)、cmd-1(0.107)

## 3. turn-commit 时延（legacy 模型，真实确定性）
- 完整句确认 gap 中位数：800ms（confirmedStableMs 默认 800）
- 未完句（trailing/hesitation/noise）应不确认：7/7 符合

## 4. pipeline 延迟（live probe）
- input→llm_first 中位数：3562ms
- llm_first→tts_first 中位数：1402ms
- input→首个 voice 中位数：4964ms
- 样本：「你好，今天感觉怎么样」llm=3562/tts=1402；「帮我想三个周末可以做」llm=2985/tts=1104；「我有点累，想听你说点」llm=3922/tts=2044

## 5. 结论与 PR9 建议

**Q1 当前最大语音体验瓶颈？**
- live 数据：input→llm_first **3562ms**，llm→tts_first 1402ms，input→首音 ≈4964ms。
- **瓶颈 = LLM 首 token（3562ms）**，远大于 turn-taking（亚秒）与 barge-in gate（320/900ms）。语音体验的延迟主因不在 FSM/turn detector，而在 LLM 首 token。

**Q2 SmartTurn 是否值得从 shadow 进 limited_on？**
- stub 分歧率 91%（偏激进）；PR5c 真实 LiveKit 在中文完整/未完句分离干净（0.25–0.78 vs <0.02），p90 8ms。
- 建议：**值得做（PR5d 非对称 limited_on 已就绪、零回退风险），但优先级不高**——它省的是 turn-commit 的 ~300ms，相对 LLM 首 token 3562ms 是小头。可作为低风险快赢顺手上 A/B。

**Q3 repairing 是否值得做 flag-gated 行为版？**
- false positive（clean speech 被判低置信）**0%**；触发集中在 non_speech/tentative。
- 误报低（0%），技术上可做，但**非当前优先**：澄清问句省不了 LLM 首 token 这个主延迟，且本身要再走一次慢 LLM。仅在高确定 reason（non_speech/empty）做，排在 LLM/TTS 之后。

**Q4 thinking_while_listening 是否值得做行为版？**
- live llm_first=3562ms ≫ 确认窗 ≈800ms。**LLM 越慢，预生成抢跑越值钱**：在用户说话期间就启动 LLM，可把这 3562ms 的大头与用户说话/确认窗重叠隐藏。
- **值得，且是隐藏 LLM 首 token 延迟的最直接手段**。注意：① 用户说话需足够久才能盖住全部延迟（短句命中率低）；② 预生成命中需 final 与 partial 前缀一致（已有 reuse 逻辑）；③ 工具调用不能在预生成窗内同步阻塞（plan §7.2）。

**Q5 TTS 是否当前第一优先级？**
- **不是**。TTS 首音 1402ms 是第二大头，但 LLM 首 token 3562ms 才是主延迟。先打 LLM 首 token（或预生成抢跑隐藏它），TTS 升级排第二。

**Q6 PR9 推荐方向？**
- **PR9 = 攻 LLM 首 token（3562ms）这个主延迟**：① 优先把 thinking_while_listening 做成行为版（预生成抢跑隐藏 LLM 延迟，本仓已有 reuse 骨架，收益最大）；② 排查 LLM 首 token 为何 3562ms（模型/端点/记忆召回是否在首 token 前同步阻塞）。
- 次优先：TTS 首音升级（第二大头）；SmartTurn limited_on 作低风险快赢顺手上；repairing 行为版最后、仅高确定 reason。
