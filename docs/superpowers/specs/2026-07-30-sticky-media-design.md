# 本地媒体吸顶设计

## 目标

在 Obsidian 阅读视图和实时预览编辑模式中，当笔记开头的本地音频或视频滚出可视区域后，让播放器以原始宽度和尺寸固定在当前 Markdown 窗格顶部；滚回原位置时恢复到文档流。每篇笔记只考虑一个媒体元素。

## 约束

- 仅处理插件当前支持的 Vault 本地 `audio` 与 `video` 元素。
- 不支持 Bilibili 等网页 iframe。
- 不修改 Obsidian 的 `.markdown-reading-view`、`.markdown-preview-view` 或其他滚动容器的 `overflow`。
- 阅读视图移动原媒体节点，不克隆播放器。
- 实时预览不得移动 CodeMirror 管理的媒体 widget；使用插件自有副本，并双向同步播放位置、音量、静音和播放速度。
- 在阅读视图和实时预览编辑模式中生效，纯源码模式不生效。

## 根因与方案选择

Obsidian 的滚动发生在 `.markdown-preview-view`，外层多个容器使用 `overflow: hidden`。媒体还可能位于 Markdown 渲染器管理的内部容器中，直接依赖 `position: sticky` 会受到最近滚动祖先和包含块边界限制。修改这些内部容器的 `overflow`、布局或层级会影响页面滚动、折叠、增量渲染和主题兼容性。

阅读视图采用“原节点窗格级吸顶层”：

1. 在媒体原位置插入等高占位元素。
2. 当占位元素顶部越过阅读区域顶部时，把同一个媒体包装元素移动到当前 Markdown 窗格的吸顶层。
3. 吸顶层位于 `.view-content` 内，不参与 Markdown 滚动，并由插件控制位置、宽度和层级。
4. 当占位元素重新进入顶部阈值以下时，把媒体移回占位元素之前并移除占位与吸顶层。

实时预览采用“状态同步副本”：

1. MutationObserver 发现 `.markdown-source-view.is-live-preview` 中的本地媒体 widget。
2. 记录媒体相对 `.cm-scroller` 的滚动阈值，不移动或修改 CodeMirror widget。
3. 越过阈值时在 `.view-content` 中创建同尺寸媒体副本，并同步播放位置、音量、静音、速度和播放状态。
4. 即使 CodeMirror 虚拟化原 widget，吸顶副本仍保留。
5. 滚回原位置并等到 CodeMirror 恢复 widget 后，把状态同步回原媒体并移除副本。

不采用以下方案：

- 直接修改 Obsidian 滚动容器的 `overflow`：会破坏页面滚动。
- 使用 `display: contents` 打平 Markdown 内部容器：会改变 Obsidian 布局语义并影响主题及其他插件。
- 在实时预览中移动原播放器：CodeMirror 会把 widget DOM 变化同步成文档编辑，可能删除媒体嵌入行。

## 组件边界

新增两个职责分离的控制器：

- `StickyMediaController`：阅读视图中移动原节点，管理锚点、占位、恢复和 `ResizeObserver`。
- `LivePreviewStickyMediaController`：实时预览中保留原 widget，管理滚动阈值、吸顶副本和播放状态同步。
- 两者都提供幂等的 `attach()`、`refresh()` 与 `destroy()`，实时预览控制器额外提供 `updateMedia()` 接收 CodeMirror 重建的 widget。

插件主类负责：

- 阅读视图由 Markdown 后处理器发现媒体。
- 实时预览由 MutationObserver 发现媒体，DOM 变化使用零延时定时器合并扫描。
- 上下文发现函数分别识别阅读视图和带 `.is-live-preview` 的 CodeMirror 编辑器，排除纯源码模式。
- 同一个阅读视图只保留一个控制器。
- 视图切换、布局变化、插件卸载时清理失效控制器。
- 保留现有时间戳解析和播放逻辑。

## DOM 与样式

阅读视图吸顶后结构：

```text
.view-content.tsp-sticky-host-context
├── .markdown-reading-view
│   └── .markdown-preview-view
│       └── ... .tsp-sticky-placeholder
└── .tsp-sticky-media-layer
    └── 原媒体包装元素（移动，不克隆）
```

实时预览吸顶后结构：

```text
.view-content.tsp-sticky-host-context
├── .markdown-source-view.is-live-preview
│   └── .cm-scroller
│       └── .cm-content
│           └── 原媒体 widget（不移动）
└── .tsp-sticky-media-layer
    └── 插件自有媒体副本
```

样式规则：

- `.view-content.tsp-sticky-host-context` 使用 `position: relative`。
- `.tsp-sticky-media-layer` 使用 `position: absolute; top: 0`、较高 `z-index` 和主题背景色。
- 宽度以媒体吸顶前的包装元素矩形为准，并限制在当前 `.view-content` 范围内。
- 占位元素高度等于媒体包装元素高度，防止正文跳动。
- 吸顶层不增加阴影、缩放或紧凑化，保持原始视觉尺寸。

## 生命周期与异常处理

- 重复后处理或 MutationObserver 扫描不会重复绑定同一媒体。
- CodeMirror 重建媒体 widget 时，实时预览控制器更新源引用而不销毁正在吸顶的副本。
- 控制器同时绑定滚动容器和 `sourcePath`；Obsidian 复用编辑器 DOM 打开其他笔记时，旧吸顶层在 DOM 变更周期内清理。
- 媒体或视图从 DOM 移除时，控制器恢复或直接清理节点和监听器。
- `destroy()` 在媒体仍可恢复时将其放回原位置；原位置已被 Obsidian 重渲染移除时，仅移除吸顶层。
- `ResizeObserver` 不可用时仍可通过滚动和窗口 resize 更新尺寸。
- 多窗格分别拥有自己的控制器与吸顶层，不共享 DOM 状态。

## 测试

自动化测试使用 Node 内置测试运行器与 jsdom，验证：

- 媒体越过顶部阈值后移动到吸顶层。
- 使用原媒体节点而非克隆。
- 占位高度保持文档布局。
- 滚回后媒体恢复原位置。
- resize 会更新吸顶层宽度。
- destroy 会恢复 DOM 并移除类名、占位和监听器。
- 实时预览不会移动原 widget；虚拟化后副本继续存在，滚回后播放状态同步并清理副本。

Windows Obsidian 集成测试：

- 在 `Obsidian Sandbox` 创建包含本地测试音频、长时间戳正文的测试笔记。
- 部署构建产物并由 Hot Reload 自动重载。
- 在阅读视图滚动越过媒体，检查吸顶层几何位置和媒体节点唯一性。
- 在实时预览滚动到文档底部，检查吸顶副本仍存在、媒体嵌入源码未改变、播放状态可往返同步。
- 滚回顶部检查恢复。
- 检查 `dev:errors` 与错误级控制台输出。
