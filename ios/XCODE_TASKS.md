# Xcode 必须完成的任务

> 本文档列出所有无法在沙箱中完成、需要在 Xcode 中处理的任务。
> 沙箱中已完成的纯 Swift 文件已就位，可直接拖入项目。

---

## 一、Cubism SDK 集成 (Phase 1 — 最高优先级)

### 1.1 下载 Cubism SDK for Native

- 前往 https://www.live2d.com/sdk/download/native/ 下载最新版 Cubism SDK for Native
- 需要注册 Live2D 账号并同意 SDK 使用协议
- 下载包含两部分：
  - **CubismNativeFramework** (开源 C++ 源码)
  - **libLive2DCubismCore.a** (闭源静态库，arm64 iOS 版本)

### 1.2 在项目中配置 Cubism SDK

1. 将 `CubismNativeFramework/` 源码文件夹添加到 Xcode 项目
2. 将 `libLive2DCubismCore.a` (iOS arm64) 添加到 Link Binary With Libraries
3. 创建 Bridging Header (`RemiChatLite-Bridging-Header.h`)：
   ```objc
   #import "Live2DBridge.h"
   ```
4. 在 Build Settings 中：
   - 设置 Objective-C Bridging Header 路径
   - Header Search Paths 添加 Cubism SDK include 目录
   - Library Search Paths 添加 libLive2DCubismCore.a 所在目录
   - Other Linker Flags 添加 `-lLive2DCubismCore`

### 1.3 编写 Obj-C++ 桥接层

创建以下文件（需要 Xcode 因为涉及 C++/Obj-C++ 编译）：

**`Live2D/Live2DBridge.h`**
```objc
#import <Foundation/Foundation.h>
#import <Metal/Metal.h>

@interface Live2DBridge : NSObject

+ (BOOL)initializeCubism;
+ (void *)loadModelFromMoc:(NSData *)mocData;
+ (void)setModelParameter:(void *)model paramId:(NSString *)paramId value:(float)value;
+ (float)getModelParameter:(void *)model paramId:(NSString *)paramId;
+ (void)updateModel:(void *)model deltaTimeSeconds:(float)dt;
+ (void)drawModel:(void *)model
    metalDevice:(id<MTLDevice>)device
    commandBuffer:(id<MTLCommandBuffer>)commandBuffer
    renderPassDescriptor:(MTLRenderPassDescriptor *)rpd
    drawableSize:(CGSize)size;
+ (void)releaseModel:(void *)model;
+ (void)loadModelTextures:(void *)model texturePaths:(NSArray<NSString *> *)paths device:(id<MTLDevice>)device;
+ (void)loadModelPhysics:(void *)model physicsData:(NSData *)data;

@end
```

**`Live2D/Live2DBridge.mm`**
- 引入 `CubismNativeFramework` 的 C++ 头文件
- 实现上述方法，桥接 Cubism C++ API
- 参考 Cubism SDK 示例项目 `Samples/Metal/` 中的渲染流程

### 1.4 完善 RemiLive2DRenderer.swift

沙箱中已创建的 `RemiLive2DRenderer.swift` 包含 `// TODO: Call Cubism SDK` 占位符。
需要在 Xcode 中补全以下调用：

```swift
// loadModel() 中：
Live2DBridge.initializeCubism()
let modelPtr = Live2DBridge.loadModel(fromMoc: mocData)
Live2DBridge.loadModelTextures(modelPtr, texturePaths: texturePaths, device: device)
Live2DBridge.loadModelPhysics(modelPtr, physicsData: physicsData)

// drawFrame(in:) 中：
Live2DBridge.setModelParameter(modelPtr, paramId: "ParamMouthOpenY", value: frame.mouthOpen)
Live2DBridge.setModelParameter(modelPtr, paramId: "ParamMouthForm", value: frame.mouthForm)
// ... 设置所有参数
Live2DBridge.updateModel(modelPtr, deltaTimeSeconds: Float(dt))
Live2DBridge.drawModel(modelPtr, metalDevice: device, commandBuffer: cmdBuf, ...)
```

---

## 二、Bundle 资源配置 (Phase 1)

### 2.1 Live2D 模型文件

沙箱中已将 hiyori-pro 模型文件复制到：
```
ios/RemiChatLite/Resources/live2d/hiyori-pro/
```

需要在 Xcode 中：
1. 将 `Resources/live2d/` 文件夹添加到 Xcode 项目（Create folder references，不是 groups）
2. 确认以下文件都包含在 Copy Bundle Resources 中：
   - `hiyori_pro_t11.model3.json`
   - `hiyori_pro_t11.moc3`
   - `hiyori_pro_t11.physics3.json`
   - `hiyori_pro_t11.2048/texture_00.png`
   - `hiyori_pro_t11.2048/texture_01.png`
   - 所有 `.motion3.json` 文件

### 2.2 验证 Bundle 路径

`RemiLive2DModelLoader.swift` 中使用：
```swift
Bundle.main.url(forResource: "hiyori_pro_t11.model3", withExtension: "json", subdirectory: "live2d/hiyori-pro")
```
确认此路径在真机上能正确定位。

---

## 三、新文件注册 (Phase 2-7)

沙箱中创建的所有 Swift 文件需要在 Xcode 项目中注册。
**如果项目使用 PBXFileSystemSynchronizedRootGroup（已确认是），Xcode 会自动发现新文件。**

但仍需确认以下文件都被编译：

| 文件 | Phase | 状态 |
|---|---|---|
| `RemiDesignTokens.swift` | 2 | ✅ 已创建 |
| `RemiAvatarStateStore.swift` | 3 | ✅ 已创建 |
| `RemiAvatarStageView.swift` | 2 | ✅ 已创建 |
| `RemiCompanionView.swift` | 2 | ✅ 已创建（含 RemiCompanionInputBar） |
| `RemiAvatarHeaderStrip.swift` | 5 | ✅ 已创建 |
| `RemiChatSheetView.swift` | 5 | ✅ 已创建 |
| `RemiChatBubbles.swift` | 5 | ✅ 已创建（BubbleCard + TypingDotsView + RemiChatBubbleStyle） |
| `RemiLipSyncEngine.swift` | 4 | ✅ 已创建 |
| `RemiAvatarIntentScheduler.swift` | 4 | ✅ 已创建 |
| `Live2D/RemiLive2DView.swift` | 1 | ✅ 已创建 |
| `Live2D/RemiLive2DRenderer.swift` | 1 | ✅ 已创建（需补 Cubism 调用） |
| `Live2D/RemiLive2DModelLoader.swift` | 1 | ✅ 已创建 |
| `Live2D/RemiLive2DParameterDriver.swift` | 1 | ✅ 已创建 |
| `Live2D/RemiLive2DLipCalibration.swift` | 4 | ✅ 已创建 |
| `RemiChatTransport.swift` | 7 | ✅ 已创建（extension 待生效） |
| `RemiChatVoiceLayer.swift` | 7 | ✅ 已创建（extension 待生效） |

---

## 四、RemiChatStore 拆分 (Phase 7)

### 4.1 访问级别调整

`RemiChatTransport.swift` 和 `RemiChatVoiceLayer.swift` 是 `RemiChatStore` 的 extension，
定义在不同文件中。Swift 不允许跨文件访问 `private` 成员。

需要在 **RemiChatStore.swift** 中将以下属性从 `private` 改为无修饰符（internal）：

**Transport 层需要的属性：**
```swift
var socket: URLSessionWebSocketTask?         // was private
var shouldReconnect = false                   // was private
var connectTask: Task<Void, Never>?           // was private
var reconnectTask: Task<Void, Never>?         // was private
var keepAliveTask: Task<Void, Never>?         // was private
var didSendClientContextForCurrentSocket = false  // was private
var pendingChatPayloads: [[String: Any]] = []     // was private
let authSource: RemiChatAuthSource            // was private let
var duplexTxFrameCount = 0                    // was private
```

**Voice 层需要的属性：**
```swift
let voiceCapture: RemiVoiceCapture            // was private let
let voicePlayer: RemiVoicePlayer              // was private let
let audioSession = RemiAudioSessionCoordinator()  // was private let
var pendingVoiceStartMode: VoiceCaptureMode?  // was private
var activeVoiceMode: VoiceCaptureMode?        // was private
var voiceStartTask: Task<Void, Never>?        // was private
var voiceResultTimeoutTask: Task<Void, Never>? // was private
var acceptingCapturedAudioFrames = false       // was private
var outboundAudioFrames: [Data] = []          // was private
var audioFrameSendInFlight = false            // was private
var pendingDuplexStopAfterDrain = false       // was private
var audioDrainTask: Task<Void, Never>?        // was private
var audioDrainForceDeadlineNs: UInt64?        // was private
var lastMeaningfulVoicePartial = ""           // was private
var lastUserTranscriptAtMs: Int64 = 0         // was private
```

**静态常量也需要改为 internal：**
```swift
static let duplexIdleCaption = ...
static let duplexConnectingCaption = ...
static let pushToTalkListeningCaption = ...
static let pushToTalkResultTimeoutNs: UInt64 = ...
static let pushToTalkPartialGraceTimeoutNs: UInt64 = ...
static let audioDrainPollNs: UInt64 = ...
static let audioDrainForceStopNs: UInt64 = ...
```

**VoiceCaptureMode enum** 需要从 `RemiChatStore.swift` 的 file-private 移到 `RemiChatVoiceLayer.swift`（已包含）或提取为 internal enum。

### 4.2 从 RemiChatStore.swift 中移除已迁移的方法

迁移后，RemiChatStore.swift 应仅保留：
- 所有 `@Published` 属性声明
- `init()`, `start()`, `stop()`, `sendDraft()`
- `consumeServerMessage()` (消息分发)
- `appendMessage()`, `markAwaitingAssistantResponse()`, `clearAssistantResponseWait()`
- `appendAssistantChunk()`, `finalizeAssistantMessage()`, `appendUserTranscript()`, `mergeTranscript()`, `normalizeTranscript()`
- `consumeHistoryPage()`, `loadMoreHistory()`, `restartForIdentityChangeIfNeeded()`
- `trimMessages()`, `persistMessages()`, `loadCachedMessages()`, `reloadCachedMessagesForCurrentIdentity()`
- `deduplicatedMessages()`, `prependOlderMessages()`, `requestAutoScrollToBottom()`, `log()`

### 4.3 VoiceCaptureMode 处理

`VoiceCaptureMode` 目前在 `RemiChatStore.swift` 顶部定义为 `private enum`。
两个选项：
1. 改为 `enum VoiceCaptureMode`（internal），保留在 RemiChatStore.swift
2. 移到 `RemiChatVoiceLayer.swift` 中（已在该文件中有定义，但二者不能同时存在）

**推荐方案**：删除 RemiChatStore.swift 中的定义，使用 RemiChatVoiceLayer.swift 中的定义。

---

## 五、RemiChatRootView 入口切换 (Phase 2)

✅ **已完成** — `chatView()` 方法已改为返回 `RemiCompanionView`。

打开 Xcode 后验证：
1. 编译通过
2. `RemiCompanionView` 正确显示 Live2D 舞台 + 聊天 sheet
3. 登录/登出流程不受影响

---

## 六、ContentView.swift 清理 (Phase 7)

现有的 `ContentView.swift` (1106 行) 包含：
- `ChatView` — 原始聊天界面（被 RemiCompanionView 替代）
- `BubbleCard` — 已提取到 `RemiChatBubbles.swift`
- `TypingDotsView` — 已提取到 `RemiChatBubbles.swift`
- `DuplexVoiceDemoView` — 已被 Companion 语音整合替代

### 清理步骤：
1. 确认 `RemiCompanionView` 工作正常后
2. 从 `ContentView.swift` 中删除 `BubbleCard` 和 `TypingDotsView`（避免重复定义）
3. 标记 `ChatView` 和 `DuplexVoiceDemoView` 为 `@available(*, deprecated)`
4. 如果确认不再需要，整个文件可删除

---

## 七、RemiServerWireMessage 扩展的集成验证 (Phase 2)

沙箱中已修改 `RemiServerWireMessage.swift` 添加了 5 种新消息类型。
沙箱中已修改 `RemiChatStore.swift` 添加了对应的处理逻辑。

在 Xcode 中验证：
1. 连接到 Remi 服务器
2. 确认 `turn_state` 消息被正确解析（Debug console 应显示 `server turn_state ...`）
3. 确认 `stt_prediction` 预览文本显示
4. 确认 `avatar_frame` 的 emotion 更新
5. 确认 `avatar_intent` 的 emotion 更新
6. 确认 `tts_lip_sync` 消息被接收（虽然当前 handler 是空的）

---

## 八、Lip Sync 接线 (Phase 4)

### 8.1 RemiChatStore → RemiLipSyncEngine 桥接

在 `RemiChatStore.consumeServerMessage()` 中的 `.ttsLipSync` case 当前是 `break`。
需要改为转发到 `RemiLipSyncEngine`：

```swift
case .ttsLipSync(let rawCues, let generationId, let mode, let complete):
    lipSyncEngine.ingestCues(rawCues, generationId: generationId, mode: mode, complete: complete)
```

需要在 RemiChatStore 中添加对 `RemiLipSyncEngine` 的引用。

### 8.2 RemiLive2DRenderer → RemiLipSyncEngine 桥接

在 `RemiLive2DRenderer.drawFrame(in:)` 中，当前 `lipWeight` 固定为 0。
需要每帧从 `RemiLipSyncEngine.sample(nowMs:)` 获取 mouthOpen/mouthForm。

### 8.3 RemiAvatarIntentScheduler 接线

在 `RemiChatStore.consumeServerMessage()` 的 `.avatarIntent` case 中，
需要转发 beats 到 `RemiAvatarIntentScheduler.schedule()`。

---

## 九、性能优化 (Phase 8)

### 9.1 帧率控制
在 `RemiLive2DView.swift` 中，MTKView 的 `preferredFramesPerSecond` 设为 30。
需要根据场景动态调整：
- App 进入后台：0 fps（暂停渲染）
- Live2D 舞台不在屏幕上（sheet 全屏）：0 fps
- 非 speaking 状态：24 fps
- Speaking 状态 (lip sync active)：30 fps

### 9.2 热量监控
添加 `ProcessInfo.processInfo.thermalState` 监控：
- `.nominal` / `.fair`：正常渲染
- `.serious`：降到 15 fps + 简化 physics
- `.critical`：切换到静态 fallback 立绘

### 9.3 无障碍
- Live2D 舞台添加 `accessibilityLabel("Remi avatar")`
- 陪伴语添加 `accessibilityLabel`
- 语音按钮添加 `accessibilityHint`

---

## 十、Live2D 授权确认 (发布前)

- Cubism SDK Core 是免费使用的（开发阶段）
- **发布到 App Store 前**需要确认 Live2D Publishing License 条款
- 小规模 indie 项目可能免费，但需在 live2d.com 确认当前政策
- 授权页面：https://www.live2d.com/en/products/releaselicense

---

## 十一、完整回归测试清单 (Phase 8)

在所有改动完成后，执行以下回归测试：

- [ ] 文字聊天：发送消息 → 收到回复 → 消息显示正确
- [ ] Push-to-Talk：长按录音 → 松开 → 转写 → 回复
- [ ] Duplex 语音：开启 → 说话 → Remi 回应 → 关闭
- [ ] 历史记录：上滑加载更多 → 消息不重复
- [ ] 缓存：杀进程 → 重开 → 历史消息保留
- [ ] 认证：Clerk 登录/登出 → 正常切换
- [ ] 重连：断网 → 恢复 → 自动重连
- [ ] Live2D 渲染：角色站立 → 呼吸 + 眨眼 + 物理摆动
- [ ] 情绪变化：聊天情绪变化 → 角色表情 + 光晕颜色同步变化
- [ ] 口型同步：Remi 说话 → 嘴巴随语音开合
- [ ] 拖拽 sheet：上滑全屏聊天 → 角色缩到头栏 → 下滑恢复
- [ ] 陪伴语：turn state 变化 → 陪伴语文字实时更新
- [ ] 后台/前台：切到后台 → 回来 → 渲染恢复正常
- [ ] 暗色模式：切换 → 所有 UI 颜色正确
