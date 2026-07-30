import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { JSDOM } from "jsdom";
import * as stickyMediaModule from "../src/sticky-media";
import { StickyMediaController } from "../src/sticky-media";

interface MutableRect {
	top: number;
	left: number;
	width: number;
	height: number;
}

function toDomRect(rect: MutableRect): DOMRect {
	return {
		...rect,
		x: rect.left,
		y: rect.top,
		right: rect.left + rect.width,
		bottom: rect.top + rect.height,
		toJSON: () => ({}),
	};
}

function mockRect(element: Element, rect: MutableRect): void {
	element.getBoundingClientRect = () => toDomRect(rect);
}

describe("StickyMediaController", () => {
	let dom: JSDOM;

	beforeEach(() => {
		dom = new JSDOM("<!doctype html><html><body></body></html>", {
			pretendToBeVisual: true,
		});
		Object.defineProperty(globalThis, "window", {
			configurable: true,
			value: dom.window,
		});
		Object.defineProperty(globalThis, "document", {
			configurable: true,
			value: dom.window.document,
		});
		Object.defineProperty(globalThis, "HTMLElement", {
			configurable: true,
			value: dom.window.HTMLElement,
		});
	});

	afterEach(() => {
		dom.window.close();
		delete (globalThis as { window?: Window }).window;
		delete (globalThis as { document?: Document }).document;
		delete (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement;
	});

	test("媒体越过顶部后移动原节点并在滚回时恢复", () => {
		document.body.innerHTML = `
			<div class="view-content">
				<div class="markdown-preview-view">
					<div class="internal-embed media-embed"><audio></audio></div>
					<p>正文</p>
				</div>
			</div>
		`;
		const host = document.querySelector<HTMLElement>(".view-content")!;
		const scrollEl = document.querySelector<HTMLElement>(".markdown-preview-view")!;
		const wrapper = document.querySelector<HTMLElement>(".internal-embed")!;
		const media = document.querySelector<HTMLAudioElement>("audio")!;
		const hostRect = { top: 40, left: 20, width: 700, height: 600 };
		const scrollRect = { top: 100, left: 50, width: 600, height: 500 };
		const wrapperRect = { top: 130, left: 90, width: 420, height: 80 };
		mockRect(host, hostRect);
		mockRect(scrollEl, scrollRect);
		mockRect(wrapper, wrapperRect);

		const controller = new StickyMediaController(media, scrollEl, host);
		controller.attach();
		assert.equal(host.querySelector(".tsp-sticky-media-layer"), null);

		const anchor = document.querySelector<HTMLElement>(".tsp-sticky-anchor");
		assert.ok(anchor, "attach 应创建媒体原位锚点");
		const anchorRect = { top: 80, left: 90, width: 420, height: 0 };
		mockRect(anchor, anchorRect);
		wrapperRect.top = 80;
		controller.refresh();

		const layer = host.querySelector<HTMLElement>(".tsp-sticky-media-layer")!;
		const placeholder = scrollEl.querySelector<HTMLElement>(".tsp-sticky-placeholder")!;
		assert.equal(layer.querySelector("audio"), media);
		assert.equal(document.querySelectorAll("audio").length, 1);
		assert.equal(placeholder.style.height, "80px");

		anchorRect.top = 120;
		controller.refresh();
		assert.equal(host.querySelector(".tsp-sticky-media-layer"), null);
		assert.equal(scrollEl.querySelector(".tsp-sticky-placeholder"), null);
		assert.equal(anchor.nextElementSibling, wrapper);
		assert.equal(wrapper.querySelector("audio"), media);
	});

	test("裸视频元素也能吸顶且不会被克隆", () => {
		document.body.innerHTML = `
			<div class="view-content">
				<div class="markdown-preview-view"><video></video></div>
			</div>
		`;
		const host = document.querySelector<HTMLElement>(".view-content")!;
		const scrollEl = document.querySelector<HTMLElement>(".markdown-preview-view")!;
		const media = document.querySelector<HTMLVideoElement>("video")!;
		mockRect(host, { top: 0, left: 0, width: 500, height: 500 });
		mockRect(scrollEl, { top: 20, left: 0, width: 500, height: 480 });
		const mediaRect = { top: 40, left: 20, width: 320, height: 180 };
		mockRect(media, mediaRect);

		const controller = new StickyMediaController(media, scrollEl, host);
		controller.attach();
		const anchor = document.querySelector<HTMLElement>(".tsp-sticky-anchor");
		assert.ok(anchor, "attach 应为裸视频创建原位锚点");
		mockRect(anchor, { top: 0, left: 20, width: 320, height: 0 });
		mediaRect.top = 0;
		controller.refresh();

		assert.equal(host.querySelector(".tsp-sticky-media-layer video"), media);
		assert.equal(document.querySelectorAll("video").length, 1);
	});

	test("resize 限制吸顶层宽度且 destroy 完整恢复 DOM", () => {
		document.body.innerHTML = `
			<div class="view-content">
				<div class="markdown-preview-view">
					<div class="media-embed"><audio></audio></div>
				</div>
			</div>
		`;
		const host = document.querySelector<HTMLElement>(".view-content")!;
		const scrollEl = document.querySelector<HTMLElement>(".markdown-preview-view")!;
		const wrapper = document.querySelector<HTMLElement>(".media-embed")!;
		const media = document.querySelector<HTMLAudioElement>("audio")!;
		const hostRect = { top: 50, left: 20, width: 600, height: 500 };
		const wrapperRect = { top: 120, left: 80, width: 400, height: 80 };
		mockRect(host, hostRect);
		mockRect(scrollEl, { top: 100, left: 50, width: 500, height: 450 });
		mockRect(wrapper, wrapperRect);

		const controller = new StickyMediaController(media, scrollEl, host);
		const controllerWithState = controller as StickyMediaController & {
			readonly isActive?: boolean;
		};
		assert.equal(controllerWithState.isActive, false);
		controller.attach();
		assert.equal(controllerWithState.isActive, true);
		const anchor = document.querySelector<HTMLElement>(".tsp-sticky-anchor");
		assert.ok(anchor, "attach 应在清理前创建原位锚点");
		mockRect(anchor, { top: 80, left: 80, width: 400, height: 0 });
		wrapperRect.top = 80;
		controller.refresh();

		hostRect.width = 260;
		window.dispatchEvent(new dom.window.Event("resize"));
		const layer = host.querySelector<HTMLElement>(".tsp-sticky-media-layer")!;
		assert.ok(parseFloat(layer.style.width) <= 260);

		controller.destroy();
		assert.equal(controllerWithState.isActive, false);
		assert.equal(document.querySelector(".tsp-sticky-anchor"), null);
		assert.equal(document.querySelector(".tsp-sticky-placeholder"), null);
		assert.equal(document.querySelector(".tsp-sticky-media-layer"), null);
		assert.equal(wrapper.querySelector("audio"), media);
		assert.equal(host.classList.contains("tsp-sticky-host-context"), false);

		scrollEl.dispatchEvent(new dom.window.Event("scroll"));
		assert.equal(document.querySelector(".tsp-sticky-media-layer"), null);
	});

	test("从阅读视图后处理片段解析媒体、滚动容器和窗格", () => {
		document.body.innerHTML = `
			<div class="view-content">
				<div class="markdown-reading-view">
					<div class="markdown-preview-view">
						<div class="markdown-preview-section">
							<div id="render-root"><audio></audio></div>
						</div>
					</div>
				</div>
			</div>
		`;
		const findStickyMediaContext = (
			stickyMediaModule as typeof stickyMediaModule & {
				findStickyMediaContext?: (renderRoot: HTMLElement) => {
					media: HTMLMediaElement;
					scrollEl: HTMLElement;
					hostEl: HTMLElement;
				} | null;
			}
		).findStickyMediaContext;
		assert.equal(typeof findStickyMediaContext, "function", "应导出阅读视图上下文发现函数");

		const renderRoot = document.querySelector<HTMLElement>("#render-root")!;
		const context = findStickyMediaContext!(renderRoot);
		assert.equal(context?.media, renderRoot.querySelector("audio"));
		assert.equal(context?.scrollEl, document.querySelector(".markdown-preview-view"));
		assert.equal(context?.hostEl, document.querySelector(".view-content"));

		renderRoot.innerHTML = "<iframe></iframe>";
		assert.equal(findStickyMediaContext!(renderRoot), null);

		document.body.innerHTML = '<div id="source-root"><video></video></div>';
		const sourceRoot = document.querySelector<HTMLElement>("#source-root")!;
		assert.equal(findStickyMediaContext!(sourceRoot), null);
	});

	test("从实时预览后处理片段解析媒体、CodeMirror 滚动容器和窗格", () => {
		document.body.innerHTML = `
			<div class="view-content">
				<div class="markdown-source-view is-live-preview">
					<div class="cm-editor">
						<div class="cm-scroller">
							<div class="cm-content">
								<div id="live-preview-root"><audio></audio></div>
							</div>
						</div>
					</div>
				</div>
			</div>
		`;
		const findStickyMediaContext = (
			stickyMediaModule as typeof stickyMediaModule & {
				findStickyMediaContext: (renderRoot: HTMLElement) => {
					media: HTMLMediaElement;
					scrollEl: HTMLElement;
					hostEl: HTMLElement;
				} | null;
			}
		).findStickyMediaContext;
		const renderRoot = document.querySelector<HTMLElement>("#live-preview-root")!;
		const context = findStickyMediaContext(renderRoot);
		assert.equal(context?.media, renderRoot.querySelector("audio"));
		assert.equal(context?.scrollEl, document.querySelector(".cm-scroller"));
		assert.equal(context?.hostEl, document.querySelector(".view-content"));

		document.querySelector(".markdown-source-view")?.classList.remove("is-live-preview");
		assert.equal(findStickyMediaContext(renderRoot), null);
	});

	test("媒体扫描只返回阅读视图和实时预览中的本地媒体", () => {
		document.body.innerHTML = `
			<div id="workspace">
				<div class="markdown-reading-view"><audio id="reading-audio"></audio></div>
				<div class="markdown-source-view is-live-preview"><video id="live-video"></video></div>
				<div class="markdown-source-view"><audio id="source-audio"></audio></div>
				<div class="other-view"><video id="other-video"></video></div>
			</div>
		`;
		const findStickyMediaCandidates = (
			stickyMediaModule as typeof stickyMediaModule & {
				findStickyMediaCandidates?: (root: ParentNode) => HTMLMediaElement[];
			}
		).findStickyMediaCandidates;
		assert.equal(typeof findStickyMediaCandidates, "function", "应导出媒体候选扫描函数");

		const workspace = document.querySelector<HTMLElement>("#workspace")!;
		assert.deepEqual(
			findStickyMediaCandidates!(workspace).map((media) => media.id),
			["reading-audio", "live-video"],
		);
	});

	test("当前模式只返回允许吸顶的滚动容器", () => {
		document.body.innerHTML = `
			<div id="view-root">
				<div class="markdown-reading-view">
					<div class="markdown-preview-view"></div>
				</div>
				<div class="markdown-source-view is-live-preview">
					<div class="cm-scroller"></div>
				</div>
			</div>
		`;
		const findStickyScrollContainer = (
			stickyMediaModule as typeof stickyMediaModule & {
				findStickyScrollContainer?: (
					root: ParentNode,
					mode: "preview" | "source",
				) => HTMLElement | null;
			}
		).findStickyScrollContainer;
		assert.equal(
			typeof findStickyScrollContainer,
			"function",
			"应导出当前模式滚动容器发现函数",
		);

		const root = document.querySelector<HTMLElement>("#view-root")!;
		assert.equal(
			findStickyScrollContainer!(root, "preview"),
			root.querySelector(".markdown-preview-view"),
		);
		assert.equal(
			findStickyScrollContainer!(root, "source"),
			root.querySelector(".cm-scroller"),
		);

		root.querySelector(".markdown-source-view")?.classList.remove("is-live-preview");
		assert.equal(findStickyScrollContainer!(root, "source"), null);
	});

	test("实时预览吸顶不移动 CodeMirror 媒体且在虚拟化后保留副本", () => {
		document.body.innerHTML = `
			<div class="view-content">
				<div class="markdown-source-view is-live-preview">
					<div class="cm-scroller">
						<div class="cm-content">
							<div class="internal-embed media-embed"><audio></audio></div>
						</div>
					</div>
				</div>
			</div>
		`;
		const LivePreviewStickyMediaController = (
			stickyMediaModule as typeof stickyMediaModule & {
				LivePreviewStickyMediaController?: new (
					media: HTMLMediaElement,
					scrollEl: HTMLElement,
					hostEl: HTMLElement,
				) => {
					attach(): void;
					refresh(): void;
					updateMedia(media: HTMLMediaElement): void;
					destroy(): void;
				};
			}
		).LivePreviewStickyMediaController;
		assert.equal(
			typeof LivePreviewStickyMediaController,
			"function",
			"应导出实时预览吸顶控制器",
		);

		const host = document.querySelector<HTMLElement>(".view-content")!;
		const scrollEl = document.querySelector<HTMLElement>(".cm-scroller")!;
		const content = document.querySelector<HTMLElement>(".cm-content")!;
		const wrapper = document.querySelector<HTMLElement>(".internal-embed")!;
		const media = document.querySelector<HTMLAudioElement>("audio")!;
		mockRect(host, { top: 0, left: 0, width: 600, height: 500 });
		mockRect(scrollEl, { top: 20, left: 0, width: 600, height: 480 });
		mockRect(wrapper, { top: 140, left: 80, width: 400, height: 48 });

		const controller = new LivePreviewStickyMediaController!(media, scrollEl, host);
		controller.attach();
		scrollEl.scrollTop = 600;
		scrollEl.dispatchEvent(new dom.window.Event("scroll"));

		const layer = host.querySelector<HTMLElement>(".tsp-sticky-media-layer")!;
		assert.ok(layer, "越过阈值后应创建吸顶副本");
		assert.equal(wrapper.parentElement, content, "原媒体包装层必须留在 CodeMirror 中");
		assert.notEqual(layer.querySelector("audio"), media, "吸顶媒体应为插件自有副本");
		assert.equal(document.querySelectorAll("audio").length, 2);

		wrapper.remove();
		controller.refresh();
		assert.equal(layer.querySelectorAll("audio").length, 1, "原 widget 虚拟化后副本应保留");

		const restoredWrapper = document.createElement("div");
		restoredWrapper.className = "internal-embed media-embed";
		const restoredMedia = document.createElement("audio");
		restoredWrapper.appendChild(restoredMedia);
		content.prepend(restoredWrapper);
		mockRect(restoredWrapper, { top: 140, left: 80, width: 400, height: 48 });
		scrollEl.scrollTop = 0;
		controller.updateMedia(restoredMedia);
		controller.refresh();

		assert.equal(host.querySelector(".tsp-sticky-media-layer"), null);
		assert.equal(restoredWrapper.parentElement, content);
		controller.destroy();
	});
});
