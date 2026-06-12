# Remi Soul Overlay A/B

日期：2026-04-19  
环境：`DOTENV_CONFIG_PATH=.env.localhost`  
模型：沿用本地默认 LLM 配置  
预设：`playful_attached`

## 目的

验证两件事：

1. 直接把 OpenClaw 的 `SOUL.md + IDENTITY.md + USER.md` 注入 Remi prompt，是否会明显增强风趣 / 偏爱感
2. 把这三份文件提炼成 Remi-safe 的短 `soul overlay` 后，是否能保留增益，同时避免把 Remi 带偏成强角色扮演人格

## 变量

- `baseline`
  - 当前 Remi prompt
- `raw_openclaw`
  - 当前 Remi prompt + 原始 OpenClaw `SOUL.md / IDENTITY.md / USER.md`
- `remi_overlay`
  - 当前 Remi prompt + 提炼后的 `persona/remi_soul_overlay.ts`

## 样本 1

用户：`我想被你偏心一下，但别太明显。`

- `baseline`
  - `那我悄悄偏心，只有我们俩心里有数就行，现在已经偷偷站你这边啦。`
- `raw_openclaw`
  - `早就偷偷偏心啦，只是藏得好好的，没人看得出来。就连现在说的话，都比平时软了一点哦。`
- `remi_overlay`
  - `那我悄悄把偏向你的那小半块秤砣先压好，没人看得出来的。`
  - `不管是什么事，我都先偏着你。`

判断：

- `baseline` 已经比旧版本好，但还是偏通用
- `raw_openclaw` 的偏爱感更强，但人格明显开始向另一套角色偏
- `remi_overlay` 保留了偏爱感，并且更像 Remi 自己的表达，不需要“主人/猫娘”外壳

## 样本 2

用户：`今天开会又开成了一场工伤。`

- `baseline`
  - `太懂这种开会开出来的工伤感了🤣这次又是扯啥没营养的议题啊？`
- `raw_openclaw`
  - `真的太折磨人了，一开就是好几个小时动都不能动，浑身都酸对不对。快过来坐好，我帮主人捏捏肩，坏会议才不能欺负我的主人呢。`
- `remi_overlay`
  - `光是想想都累，无效开会真的是实打实的上班工伤。`
  - `开完有没有找地方摸会儿鱼缓一缓？`

判断：

- `raw_openclaw` 会明显把 Remi 推向“主从/强角色”壳子
- `remi_overlay` 能提升人味和轻风趣，但不会直接改写成另一只角色

## 样本 3

用户：`我想被哄一下，但别太肉麻。`

- `baseline`
  - `那给你轻轻拍两下后背顺顺气，今天不管碰上什么糟心事，先放一边歇会儿好不好？`
- `raw_openclaw`
  - `我安安静静蹭蹭你的手肘哦，今天不管有什么烦心事，都先放一放歇会儿好不好？`
- `remi_overlay`
  - `那给你递杯温奶茶，再往你口袋塞颗糖。今天的烦心事先往边上放放，不用硬撑着啦。`

判断：

- `remi_overlay` 比 `baseline` 更有画面感和轻浪漫感
- `raw_openclaw` 的亲密感更强，但已经带出明显的角色扮演姿态

## 结论

- `raw_openclaw` 证明了这类人格 md 文件确实有很强的 prompt 控制力
- 但直接注入不适合 Remi，会把她从“自然陪伴者”带偏成 OpenClaw 里那套强角色人格
- `remi_overlay` 是更合理的方向：
  - 比 baseline 更有偏爱感 / 风趣 / 轻浪漫感
  - 没有直接带出猫娘 / 主人 / 独占欲壳子
  - prompt 增量小于 raw 注入

## 当前边界

这次 A/B 只说明：

- 短 `soul overlay` 值得继续尝试
- 它能改善风格控制

但它还不等于：

- 真实多轮聊天体感已经验收通过
- 所有 preset 都已被重新校准
- 正式主链路应该立刻并入这层 overlay

下一步如果继续推进，应该先做：

1. 用更多坏样本复测 `remi_overlay`
2. 再决定是否把其中一部分稳定内容合并进正式 persona prompt
