# 本地媒体吸顶实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Obsidian 阅读视图和实时预览编辑模式中让单个本地音频或视频越过窗格顶部后保持原始尺寸吸顶，并在滚回时无跳动恢复。

**Architecture:** 阅读视图使用 `StickyMediaController` 移动原媒体节点并管理原位占位；实时预览使用 `LivePreviewStickyMediaController` 保留 CodeMirror widget，并通过窗格级媒体副本同步播放状态。插件主类通过 Markdown 后处理器发现阅读视图媒体，通过 MutationObserver 发现实时预览媒体。

**Tech Stack:** TypeScript、Obsidian Plugin API、DOM API、Node.js 内置测试运行器、tsx、jsdom、esbuild。

## Global Constraints

- 仅处理 Vault 本地 `audio` 与 `video`，不处理网页 iframe。
- 每篇笔记只考虑一个媒体元素。
- 吸顶时保持媒体原始宽度和尺寸。
- 不修改 Obsidian 滚动容器的 `overflow`。
- 阅读视图必须移动原媒体节点。
- 实时预览禁止移动 CodeMirror widget，必须使用插件自有副本并同步播放状态。
- 在阅读视图和实时预览编辑模式中生效，纯源码模式不生效。
- 所有新增代码注释和 Git 提交说明使用中文，提交标题保留 `test:`、`feat:` 等英文前缀。

---

### Task 1: 建立吸顶控制器的失败测试

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `tests/sticky-media.test.ts`
- Create: `src/sticky-media.ts`

**Interfaces:**
- Consumes: 浏览器 `HTMLElement`、`HTMLMediaElement`、滚动和 resize 事件。
- Produces: `StickyMediaController` 类，构造签名为 `constructor(media: HTMLMediaElement, scrollEl: HTMLElement, hostEl: HTMLElement)`，公开 `attach(): void`、`refresh(): void`、`destroy(): void`。

- [ ] **Step 1: 添加测试依赖和测试脚本**

运行：

```bash
npm install --save-dev jsdom @types/jsdom tsx
```

在 `package.json` 中加入：

```json
"test": "tsx --test tests/**/*.test.ts"
```

- [ ] **Step 2: 创建可导入但尚未实现行为的控制器外壳**

```ts
export class StickyMediaController {
	constructor(
		private readonly media: HTMLMediaElement,
		private readonly scrollEl: HTMLElement,
		private readonly hostEl: HTMLElement,
	) {}

	attach(): void {}
	refresh(): void {}
	destroy(): void {}
}
```

- [ ] **Step 3: 编写吸顶与恢复的失败测试**

测试用 jsdom 创建：

```html
<div class="view-content">
  <div class="markdown-preview-view">
    <div class="internal-embed media-embed"><audio></audio></div>
    <p>正文</p>
  </div>
</div>
```

为 `scrollEl`、包装元素和锚点提供可变的 `getBoundingClientRect()`，断言：

```ts
assert.equal(host.querySelector(".tsp-sticky-media-layer audio"), media);
assert.equal(document.querySelectorAll("audio").length, 1);
assert.equal(placeholder.style.height, "80px");
```

把锚点坐标移回滚动容器顶部以下并调用 `refresh()`，断言媒体回到锚点后、吸顶层移除且占位高度清空。

- [ ] **Step 4: 编写包装回退、清理与 resize 的失败测试**

增加一个没有 `.internal-embed` 包装层、只有裸 `<video>` 的场景，断言吸顶后移动的是该 video 自身且仍只有一个 video 节点。

断言 `destroy()`：

- 将吸顶媒体放回原位置。
- 移除 `.tsp-sticky-placeholder` 与 `.tsp-sticky-media-layer`。
- 移除 host 上的 `.tsp-sticky-host-context`。
- 后续 `scroll` 事件不再改变 DOM。

断言 host 宽度变窄后触发 `resize`，吸顶层宽度不超过 host 可用宽度。

- [ ] **Step 5: 运行测试并确认因功能缺失而失败**

运行：

```bash
npm test
```

预期：断言失败，原因是媒体未移动到 `.tsp-sticky-media-layer`，不是测试语法或环境错误。

- [ ] **Step 6: 提交红灯测试**

```bash
git add package.json package-lock.json tests/sticky-media.test.ts src/sticky-media.ts
git commit -m "test: 添加媒体吸顶行为测试"
```

### Task 2: 实现吸顶控制器

**Files:**
- Modify: `src/sticky-media.ts`
- Test: `tests/sticky-media.test.ts`

**Interfaces:**
- Consumes: Task 1 定义的构造参数和公开方法。
- Produces: DOM 类名 `.tsp-sticky-host-context`、`.tsp-sticky-anchor`、`.tsp-sticky-placeholder`、`.tsp-sticky-media-layer`。

- [ ] **Step 1: 解析媒体包装元素并建立锚点**

实现包装元素选择：

```ts
const candidate = media.closest<HTMLElement>(".internal-embed, .media-embed");
this.wrapper = candidate && scrollEl.contains(candidate) ? candidate : media;
```

`attach()` 在包装元素之前插入 `.tsp-sticky-anchor`，注册 `scroll` 与 `window.resize`，然后调用 `refresh()`。重复调用必须幂等。

- [ ] **Step 2: 实现 dock**

当 `anchor.getBoundingClientRect().top < scrollEl.getBoundingClientRect().top`：

1. 记录包装元素当前矩形。
2. 创建同尺寸 `.tsp-sticky-placeholder` 并放在锚点之后。
3. 在 host 中创建 `.tsp-sticky-media-layer`。
4. 根据 host、scroll 和包装元素矩形设置 `top`、`left`、`width`。
5. 把原包装元素移动到 layer。

- [ ] **Step 3: 实现 restore 与 destroy**

当锚点回到顶部阈值以下：

```ts
anchor.after(wrapper);
placeholder.remove();
layer.remove();
```

`destroy()` 先恢复可恢复的媒体，再移除监听器、观察器和 host 类名；多次调用不得报错。

- [ ] **Step 4: 实现尺寸同步**

窗口 resize 或 `ResizeObserver` 回调中：

- 占位高度同步包装元素高度。
- layer 左边距跟随原内容位置。
- layer 宽度使用吸顶前宽度与 host 可用宽度的较小值。

- [ ] **Step 5: 运行测试并确认全部通过**

运行：

```bash
npm test
```

预期：所有吸顶、恢复、唯一媒体节点、resize 与 destroy 测试通过。

- [ ] **Step 6: 提交控制器实现**

```bash
git add src/sticky-media.ts tests/sticky-media.test.ts
git commit -m "feat: 实现媒体窗格级吸顶控制器"
```

### Task 3: 接入 Obsidian 插件与样式

**Files:**
- Modify: `src/main.ts`
- Modify: `styles.css`
- Test: `tests/sticky-media.test.ts`

**Interfaces:**
- Consumes: `StickyMediaController` 的 `attach()`、`refresh()`、`destroy()`。
- Produces: `findStickyMediaContext(renderRoot: HTMLElement): StickyMediaContext | null`；每个 `.markdown-preview-view` 最多一个控制器；插件卸载和布局变化时无残留。

- [ ] **Step 1: 编写 Obsidian 阅读视图上下文发现的失败测试**

分别构造：

- `.view-content > .markdown-reading-view > .markdown-preview-view > renderRoot > audio`
- `.view-content > .markdown-source-view.is-live-preview > .cm-editor > .cm-scroller > renderRoot > audio`

调用 `findStickyMediaContext(renderRoot)`，断言阅读视图返回 `.markdown-preview-view`、实时预览返回 `.cm-scroller`，两者都返回 `.view-content` host。对 iframe、无媒体、纯源码模式和不在 Markdown 视图中的媒体断言返回 `null`。

- [ ] **Step 2: 运行测试确认新场景失败**

运行：

```bash
npm test
```

预期：因 `findStickyMediaContext` 尚未导出而失败。

- [ ] **Step 3: 实现上下文发现并接入主插件**

在 `src/sticky-media.ts` 实现：

```ts
export interface StickyMediaContext {
	media: HTMLMediaElement;
	scrollEl: HTMLElement;
	hostEl: HTMLElement;
}

export function findStickyMediaContext(renderRoot: HTMLElement): StickyMediaContext | null;
```

在 `src/main.ts` 加入：

```ts
private stickyControllers = new Map<HTMLElement, StickyMediaController>();
```

Markdown 后处理流程在时间戳处理后：

1. 从当前 `el` 查找第一个 `audio, video`。
2. 找到祖先 `.markdown-preview-view` 与 `.view-content`。
3. 同一 preview 已绑定同一媒体时调用 `refresh()`。
4. 媒体变化时销毁旧控制器、创建并 `attach()` 新控制器。
5. 注册 `layout-change` 清理已断开 DOM 的控制器。
6. `onunload()` 销毁全部控制器并清空 map。

实时预览补充接入：

1. MutationObserver 监听 workspace 中媒体 widget 的创建与替换。
2. `setTimeout(0)` 合并同一事件循环内的 DOM 变化。
3. `.cm-scroller` 使用 `LivePreviewStickyMediaController`，不插入锚点、不移动原 widget。
4. 越过阈值时创建媒体副本；滚回时同步状态并移除副本。

- [ ] **Step 4: 添加窗格级样式**

在 `styles.css` 中加入：

```css
.tsp-sticky-host-context {
	position: relative;
}

.tsp-sticky-media-layer {
	position: absolute;
	z-index: var(--layer-popover, 30);
	box-sizing: border-box;
	background: var(--background-primary);
}

.tsp-sticky-placeholder {
	box-sizing: border-box;
}
```

吸顶层不添加缩放、阴影或固定高度。

- [ ] **Step 5: 运行自动化验证**

运行：

```bash
npm test
npm run build
```

预期：测试全部通过，esbuild 构建退出码为 0。

- [ ] **Step 6: 提交插件接入**

```bash
git add src/main.ts src/sticky-media.ts styles.css tests/sticky-media.test.ts
git commit -m "feat: 在阅读视图启用本地媒体吸顶"
```

### Task 4: Windows Obsidian 集成测试

**Files:**
- Create in test Vault: `Sticky Media Test.md`
- Create in test Vault: `sticky-media-test.wav`
- Deploy: `.obsidian/plugins/timestamp-player/main.js`
- Deploy: `.obsidian/plugins/timestamp-player/manifest.json`
- Deploy: `.obsidian/plugins/timestamp-player/styles.css`

**Interfaces:**
- Consumes: Task 3 的构建产物和 `Obsidian Sandbox` Vault。
- Produces: Windows Obsidian 1.12.7 中的实际滚动、DOM、错误和控制台验证证据。

- [ ] **Step 1: 生成本地测试音频和长笔记**

使用系统媒体工具生成数秒测试音频；笔记开头嵌入：

```markdown
![[sticky-media-test.wav]]

测试者 00:00
第一段测试文本。
```

继续生成足够多的时间戳段落，使阅读视图出现滚动条。

- [ ] **Step 2: 部署最新构建产物**

将 `main.js`、`manifest.json`、`styles.css` 复制到：

```text
D:\Users\lenovo\AppData\Roaming\obsidian\Obsidian Sandbox\.obsidian\plugins\timestamp-player
```

保留 `.hotreload`，确认 Hot Reload 自动替换插件实例。

- [ ] **Step 3: 打开测试笔记并切换阅读视图**

显式指定：

```bash
obsidian vault="Obsidian Sandbox" open path="Sticky Media Test.md"
```

切换阅读视图后，确认页面包含一个 `audio`、一个 `.tsp-sticky-anchor`，且没有吸顶层。

- [ ] **Step 4: 验证吸顶和恢复**

通过 Obsidian app 上下文设置 `.markdown-preview-view.scrollTop` 并触发 `scroll`：

- 滚过媒体后存在一个 `.tsp-sticky-media-layer`。
- layer 顶部与滚动区域顶部一致。
- 阅读视图始终只有一个 `audio`；实时预览吸顶时保留 CodeMirror 原媒体并创建一个插件自有副本。
- placeholder 高度大于 0。
- 滚回顶部后 layer 消失，audio 回到原文档位置。
- 实时预览滚到底部后媒体嵌入源码仍存在，滚回后副本消失且播放位置、音量、静音和速度同步回原媒体。

- [ ] **Step 5: 检查运行错误**

运行：

```bash
obsidian vault="Obsidian Sandbox" dev:errors
obsidian vault="Obsidian Sandbox" dev:console level=error
```

预期：没有插件引起的开发错误或错误级控制台消息。

- [ ] **Step 6: 最终回归验证**

运行：

```bash
npm test
npm run build
git diff --check
git status --short --branch
```

预期：测试与构建成功、无空白错误、只保留计划内改动。
