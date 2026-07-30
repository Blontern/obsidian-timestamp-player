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
});
