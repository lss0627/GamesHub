# 场景、动画与声音创作

状态：已实现并更新本地服务；实际网页交付、版本回退与全量回归通过。

## 使用方式

打开项目的「场景与动效」。添加文字、色块、分组，或从已上传的 PNG/JPEG 素材加入图片。画布支持拖动、10px吸附、缩放、方向键微调；属性面板支持位置、尺寸、旋转、透明度、颜色、阶段显示和精灵表行列。父分组影响子对象的位置、旋转和透明度。撤销与重做最多保留100步，本地未保存草稿可恢复和导出。

选择对象后添加动画，编辑位置、尺寸、旋转、透明度或精灵帧的关键帧，并拖动时间轴或播放预览。数值采用线性插值，精灵表按离散帧切换。动画可在开始、得分/进度增长、受伤、胜利、失败或游戏中点击时触发。

声音可用内置正弦提示音，也可导入当前浏览器能解码的音频。客户端解码并转成PCM WAV，服务端完整检查、清除额外容器数据并通过现有扫描/存储流程。最长60秒、保存文件不超过5MiB；立体声建议59秒以内。设置总音量、各声音音量、事件和循环；循环只用于开始事件。试听最多10秒。游戏中可用右下角按钮或M静音；暂停和重开会处理播放状态。

AI编排建议基于当前已保存的创作。建议通过同一数据校验和素材检查后返回，采用到画布后可以继续修改或撤销；保存和制作仍是独立状态。「保存并制作试玩」将确切创作内容写入本次GameSpec，并进入现有编译、行为测试和浏览器验收流程。

## 范围与边界

本版本是现有十类Unity 2D游戏共享的960×600创作层，包含实际运行的Unity对象层级、文字/色块/图片、关键帧和声音。原模板在运行时生成的敌人、平台、碰撞和关卡规则仍通过玩法方案与受控代码开发来修改。它尚不等同于通用Unity Editor：没有3D场景、物理关卡绘制、骨骼动画、Animator状态机或完整音频工作站。

最多100个对象、20个动画片段、每段50条轨道、每轨120个关键帧、20个声音绑定；创作JSON最多180000字符，单次使用的独立媒体总量限制32MiB。坐标与数值均有明确边界。分组变化保持初始世界位置和角度，动画轨道仍是局部坐标，需要按新分组检查。

草稿保存在租户隔离的design文档中，以revision阻止覆盖其他标签页；制作期间拒绝修改。发布版本把创作数据放入GameSpec的gamerhub_creative扩展，Unity文件及媒体由source attempt保护。发布检查比较运行时实际读取的数据hash和对象/动画/声音数量，并确认启动与暂停；缺少创作运行时不能交付。

## 实现入口

- `packages/contracts/src/creative.ts`：共享严格结构与图校验。
- `packages/game-spec/src/creative.ts`：文档解析、GameSpec绑定、插值和层级坐标。
- `packages/assets/src/audio.ts`：有限PCM解析与持久化。
- `apps/platform-api/src/services/design-service.ts`：读取、保存、AI建议与已确认规格。
- `apps/local-dev/src/apply-creative.ts`：验证项目素材hash后导入资源。
- `apps/local-dev/src/browser-playtest.ts`：发布前实际创作数据检查。
- `apps/studio-web/src/features/creator/CreativeStudio.tsx`：可视化创作界面。
- `unity/Templates/Runner/Assets/Game/Scripts/CreativeRuntime.cs`：Unity创作层与声音。

HTTP接口：`GET/POST /v1/projects/{projectId}/creative`、`POST .../creative/suggest`、`POST .../creative/apply`。保存和应用携带revision；建议还需prompt。素材沿用项目assets接口，规范化音频MIME为audio/wav。执行Agent可以读取已确认创作配置，不能直接绕过规格写入创作JSON。

## 验证记录

最终回归：TypeScript298通过/3跳过（82个文件通过、1个跳过），Python48通过/1跳过，浏览器UI26通过；Unity创作专项4通过。完整构建、类型检查、lint通过（420个文件）。跳过项仍为原有需外部环境的检查。日志在`artifacts/creative-authoring/*-final.log`。

实际项目：[星光工坊验收](http://127.0.0.1:3000/projects/222ffd2e-c152-4520-88cf-15ca434e2170)。真实UI编排了漂浮文字、四帧精灵表、原创背景音乐和得分提示音；真实AI添加胜利淡出动画并保留已有编排。实际Unity通过Clicker7、Creative4、自定义升级4项。

首次画面人工检查发现：创作数据与音频正常，但原游戏界面遮住了创作层。修复了Unity `GUI.depth`的恢复逻辑，并加入实际像素回归。旧截图取样RGB为[54.25,73,75.5]，同一检查失败；修复后RGB为[255,81,90]，检查通过。不能把运行数据存在当作可见画面成功。发布门禁检查运行数据一致性和生命周期，当前专项验收另做可见像素与人工截图核对。

修复后的实际run为`25c454fb-b614-43aa-952d-cdbb70e75213`，通过可见精灵、多个动画帧、真实Web Audio输出（采样RMS峰值0.043186）、暂停、静音、得分、胜利和重新开始。完整记录见`artifacts/creative-authoring/real-flow.json`，截图见`ready.png`、`playing.png`、`won.png`。这项完整WebGL验收使用Clicker；创作运行时由十类2D模板共享，尚未逐类重复所有媒体组合。

第二版run`d477196d-7e45-42af-ab77-fdee7f699ea1`修改了招牌文字、位置和总音量，成功发布。回退run`a000cd57-a135-4607-8a1c-2a121ab1d55b`成功恢复前一版；创作源文件与运行时hash均匹配基线，第二版草稿仍保留，原有自定义玩法源文件SHA256始终不变。回退截图再次通过可见像素检查。记录见`artifacts/creative-authoring/recovery.json`与`restored.png`。

服务更新前检查了10个项目，无活动制作任务且无Unity进程。最后更新了本地API、预览服务和工作台。演示项目保留前版试玩与第二版草稿，方便检查版本差异；原用户项目没有参与本次修改或恢复实验。

![真实网页中的漂浮招牌和精灵动画](../artifacts/creative-authoring/playing.png)

Unity音频按官方支持范围使用AudioSource和完整非流式AudioClip；浏览器首次手势解锁与编解码行为参见[Unity 6 Web音频文档](https://docs.unity3d.com/6000.0/Documentation/Manual/webgl-audio.html)。实际可闻输出另以浏览器Web Audio分析器采样验证。
