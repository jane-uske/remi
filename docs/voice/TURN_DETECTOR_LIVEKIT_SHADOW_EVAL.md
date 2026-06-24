# LiveKit Turn Detector — 真实权重 shadow 评测报告

> 日期：2026-06-24　模型：`livekit/turn-detector` `onnx/model_q8.onnx@v0.4.1-intl`（多语种 EOU）
> 运行：`scripts/turn_detector_server.py --backend livekit` + `scripts/turn_detector_shadow_eval.ts`
> 性质：**纯 shadow，未改变任何线上行为**。仅 PR5b 通道 + 真实模型推理。

## 0. 关键修正（解读语义）

LiveKit 的 `languages.json` zh 阈值 = **0.0066**，但它是 **`unlikely_threshold`**：
- `EOU_prob < 0.0066` → 用户**大概率还没说完**，应**更耐心等待**（延长静音超时）。
- `EOU_prob ≥ 0.0066` → 不额外延时，交给常规 VAD 静音判定。

即：**这个模型的作用是"该多等的时候多等"，不是"早切"**。评测据此解读。
（zh 阈值 tpr=0.993 / tnr=0.866——为高召回调得很激进。）

## 1. turn-end：legacy vs LiveKit（真实 EOU）

EOU 概率（真实模型，归一化+chat template+`outputs.flatten()[-1]`）：

| 中文场景 | 文本 | legacy 状态 | EOU 概率 | 解读 |
|---------|------|------------|---------|------|
| 完整问句 | 你今天过得怎么样 | LIKELY_END | **0.781** | 都判完整 ✓ |
| 完整祈使 | 帮我订个明天的机票 | — | **0.756** | 完整 ✓ |
| 礼貌完整 | 谢谢你的帮助 | — | **0.744** | 完整 ✓ |
| 语气词结尾 | 那就这样吧 | LIKELY_END | **0.541** | 完整 ✓ |
| 无标点完整 | 我觉得这个方案可以 | **HOLD** | **0.263** | **分歧**：legacy 过度等待，LiveKit 识别为完整 |
| 完整陈述 | 我今天过得还不错 | LIKELY_END | 0.248 | LiveKit 确认完整更快 |
| 条件（偏完整）| 如果你愿意的话 | — | 0.136 | 模糊带 |
| 思考停顿 | 让我想一下这个事情 | — | 0.083 | 模糊带 |
| 犹豫填充 | 这个嗯 | HOLD | 0.019 | 都判未完 ✓ |
| 尾部连接词 | 我先去买点东西然后 | HOLD | 0.0095 | 都判未完 ✓ |
| 转折未完 | 虽然这样但是 | HOLD | 0.0052 | 都判未完 ✓ |
| 因果未完 | 因为我觉得 | HOLD | 0.0009 | 都判未完 ✓ |
| 短未完 | 我想 | HOLD | 0.0001 | 都判未完 ✓ |

**分离度极好**：完整句 0.25–0.78，未完句 0.0001–0.019，模糊带 0.08–0.14。

**两类有价值的分歧**：
1. **完整但无标点的陈述**（"我觉得这个方案可以" 0.263、"我今天过得还不错" 0.248）：legacy 卡在 HOLD/LIKELY_END 继续等静音，LiveKit 已识别完整 → **LiveKit 能降这类延迟**。
2. **完整问句/祈使/礼貌句**（0.54–0.78）：legacy 多为 LIKELY_END（待确认），LiveKit 高置信 → **更快 commit**。
3. **未完句**（连接词/因果/转折/犹豫，全 < 0.02）：legacy 与 LiveKit **一致 HOLD** → **零回退风险**。

## 2. barge-in：legacy vs LiveKit

⚠️ **LiveKit turn-detector 只做 turn-END，不做 barge-in。** 评测里 `/barge-in` 是 sidecar 的派生启发式（`1 - EOU`），**不代表 LiveKit 真实能力**。

| 场景 | legacy | real(派生) |
|------|--------|-----------|
| 有partial 290ms | candidate | confirmed |
| 有partial 350ms | confirmed | confirmed |
| 有partial 220ms(短) | candidate | none |
| 无partial 350ms | confirmed | none |
| 无partial 500ms | confirmed | candidate |

**结论**：barge-in 不该用这个模型评判。barge-in 瓶颈仍由 PR4（interim 提前感知）+ PR5a 门槛逻辑承接，与本模型无关。

## 3. latency 分布（真实模型）

| 指标 | 值 |
|------|-----|
| samples | 16 |
| **p50** | **5 ms** |
| **p90** | **8 ms** |
| max | 10 ms |

含 HTTP 本地往返 + ONNX 推理。**远低于 50ms 实时预算**；进程内部署会更快。**延迟完全不是障碍。**

## 4. 有 partial vs 无 partial（关键发现）

| 组 | 模型有效性 |
|----|-----------|
| **有 partial（有文本）** | 模型给出强判别 EOU 信号（0.0001–0.78），**这是它唯一发挥作用的场景** |
| **无 partial（无文本）** | 文本模型**无输入**，返回默认 0.15，**完全无信号**，只能靠 VAD/legacy 静音兜底 |

**这条把 PR4 和 PR5 直接绑定**：真实 turn detector **必须有 interim partial 文本才能工作**。
没有 PR4 的 partial（默认 STT 无增量文本），这个模型是瞎的。
→ **limited on 的前置条件 = PR4 的 `canStreamPartials()` 为真。**

## 5. 结论：是否值得进入 limited on

**值得，但范围要严格收窄。** 依据：

| 维度 | 评估 |
|------|------|
| 延迟 | ✅ p90 8ms，实时无压力 |
| 中文判别力 | ✅ 完整/未完分离干净（0.25–0.78 vs <0.02） |
| 回退风险 | ✅ 未完句与 legacy 一致 HOLD，不会更早切人话 |
| 收益点 | ✅ 完整无标点陈述、完整问句：legacy 过度等待，LiveKit 降延迟 |
| 依赖 | ⚠️ 必须有 interim partial（PR4），否则无效 |
| barge-in | ❌ 不在此模型职责内 |

**推荐的 limited on 形态（零回退风险版）**：
1. **只接 turn-END，不碰 barge-in。**
2. **只在 `canStreamPartials()` 为真（PR4 已供 partial）时启用**，否则纯 legacy。
3. **非对称使用**：
   - `EOU < 阈值` → **只用于"延长耐心"**（阻止 legacy 过早 confirmed），不允许比 legacy 更早切。
   - `EOU ≥ 阈值` → 允许把 legacy 的 LIKELY_END 提升为 CONFIRMED_END（降完整句延迟）。
   - 这样**单向只改善**：要么更耐心（少切人话），要么更快确认完整句，绝不会更早切未完句。
4. **阈值需为 Remi 调**：zh 默认 0.0066 偏激进（高召回），陪伴场景更怕切人话，建议起步用更高阈值（如 0.05–0.10）做 A/B，宁可慢半拍也别打断。
5. **保留 legacy 为地板**：任何时刻 legacy 仍可独立决策，real provider 不可用立即回退。

**下一步（若批准 limited on）**：把 PR5b 的异步 shadow 升级为"非对称 gated on"，加 per-session 开关 + 真实通话 A/B 指标（打断率、平均 turn 延迟、用户重述率），用真实中文通话验证收益。**仍不进 PR6。**

---

### 复现

```bash
# venv（避开系统 PEP668 限制）
python3 -m venv /tmp/td_venv && /tmp/td_venv/bin/pip install onnxruntime transformers huggingface_hub numpy
# 真实模型 sidecar
/tmp/td_venv/bin/python scripts/turn_detector_server.py --backend livekit --port 8111
# 评测（用 zh 阈值）
REMI_TURN_DETECTOR_ENDPOINT=http://127.0.0.1:8111 REMI_TURN_DETECTOR_EOU_THRESHOLD=0.0066 \
  ./node_modules/.bin/ts-node --transpile-only scripts/turn_detector_shadow_eval.ts
```
