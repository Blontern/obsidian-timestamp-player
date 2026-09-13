import { App, MarkdownView } from "obsidian";

export interface StickyMediaContext {
    media: HTMLMediaElement;
    scrollEl: HTMLElement;
    hostEl: HTMLElement;
}

const MODE_SELECTORS = {
    preview: [".markdown-reading-view audio", ".markdown-reading-view video"],
    source: [".markdown-source-view.is-live-preview audio", ".markdown-source-view.is-live-preview video"],
    scroll: {
        preview: ".markdown-reading-view .markdown-preview-view",
        source: ".markdown-source-view.is-live-preview .cm-scroller"
    }
} as const;

export function findStickyMediaCandidates(root: ParentNode, mode?: "preview" | "source"): HTMLMediaElement[] {
    const sel = mode ? MODE_SELECTORS[mode] : [...MODE_SELECTORS.preview, ...MODE_SELECTORS.source];
    return Array.from(root.querySelectorAll<HTMLMediaElement>(sel.join(", ")));
}

export function findStickyScrollContainer(root: ParentNode, mode: "preview" | "source"): HTMLElement | null {
    return root.querySelector<HTMLElement>(MODE_SELECTORS.scroll[mode]);
}

export function findStickyMediaContext(el: HTMLElement): StickyMediaContext | null {
    const media = el.matches("audio, video") ? el as HTMLMediaElement : el.querySelector<HTMLMediaElement>("audio, video");
    if (!media) return null;
    const scrollEl = el.closest<HTMLElement>(".markdown-preview-view") ?? el.closest<HTMLElement>(".cm-scroller");
    if (!scrollEl) return null;
    const hostEl = scrollEl.closest<HTMLElement>(".view-content");
    return hostEl ? { media, scrollEl, hostEl } : null;
}

function resolveWrapper(media: HTMLMediaElement, scrollEl: HTMLElement): HTMLElement {
    const player = media.closest<HTMLElement>(".custom-media-player");
    if (player && scrollEl.contains(player)) return player;
    const cand = media.closest<HTMLElement>(".internal-embed, .media-embed");
    return cand && scrollEl.contains(cand) ? cand : media;
}

interface MediaGroup { ctls: BaseController[]; }

abstract class BaseController {
    protected attached = false;
    protected docked = false;
    protected destroyed = false;
    protected wrapper: HTMLElement;
    public anchor: HTMLElement | null = null;

    get isActive(): boolean { return this.attached && !this.destroyed && this.media.isConnected; }
    isDocked(): boolean { return this.docked; }
    getStickyHeight(): number { return this.wrapper.getBoundingClientRect().height; }

    constructor(public readonly media: HTMLMediaElement, protected readonly scrollEl: HTMLElement, protected readonly hostEl: HTMLElement) {
        this.wrapper = resolveWrapper(media, scrollEl);
    }

    abstract attach(): void;
    abstract getTriggerRect(): DOMRect;
    abstract dock(): void;
    abstract restore(): void;
    abstract destroy(): void;
    refresh(): void {}
}

export class StickyMediaController extends BaseController {
    private placeholder: HTMLElement | null = null;
    private layer: HTMLElement | null = null;
    private resizeObserver: ResizeObserver | null = null;
    private origW = 0;
    private origH = 0;
    private origLeft = 0;
    private origParent: Node | null = null;
    private origNext: Node | null = null;
    private readonly onResize = () => this.refresh();

    constructor(media: HTMLMediaElement, scrollEl: HTMLElement, hostEl: HTMLElement, private mgr: StickyMediaManager) {
        super(media, scrollEl, hostEl);
    }

    attach() {
        if (this.attached || this.destroyed || !this.wrapper.isConnected) return;
        this.installAnchor();

        const win = this.media.ownerDocument.defaultView;
        win?.addEventListener("resize", this.onResize);
        const RC = win?.ResizeObserver;
        if (RC) {
            this.resizeObserver = new RC(this.onResize);
            this.resizeObserver.observe(this.wrapper);
            this.resizeObserver.observe(this.hostEl);
        }
        this.attached = true;
        this.refresh();
    }

    private installAnchor() {
        this.anchor = this.media.ownerDocument.createElement("div");
        this.anchor.className = "tsp-sticky-anchor";
        this.anchor.setAttribute("aria-hidden", "true");
        this.wrapper.before(this.anchor);
        this.mgr.registerMediaAnchor(this.media, this.anchor);
    }

    getTriggerRect(): DOMRect {
        if (this.anchor?.isConnected) return this.anchor.getBoundingClientRect();
        return this.wrapper.getBoundingClientRect();
    }

    refresh() {
        if (!this.attached || this.destroyed) return;
        if (!this.scrollEl.isConnected || !this.hostEl.isConnected) {
            this.destroy();
            return;
        }

        // CodeMirror 虚拟化容错
        if (this.anchor && !this.anchor.isConnected) {
            if (this.docked) {
                // 已 dock：媒体本身在 sticky 层里，位置由 origLeft 兜底；
                // restore() 会通过 origParent 兜底把媒体放回去。
            } else if (this.wrapper.isConnected) {
                // 未 dock：CM 重建了承载行，重新安装 anchor 继续追踪
                this.mgr.unregisterMediaAnchor(this.media);
                this.installAnchor();
            } else {
                this.destroy();
                return;
            }
        }

        if (this.docked) this.syncGeo();
    }

    dock() {
        if (this.docked || !this.anchor?.isConnected) return;
        this.origParent = this.wrapper.parentNode;
        this.origNext = this.wrapper.nextSibling;
        const wr = this.wrapper.getBoundingClientRect();
        const hr = this.hostEl.getBoundingClientRect();
        this.origW = wr.width;
        this.origH = wr.height;
        this.origLeft = wr.left - hr.left;

        this.placeholder = this.media.ownerDocument.createElement("div");
        this.placeholder.className = "tsp-sticky-placeholder";
        this.placeholder.setAttribute("aria-hidden", "true");
        this.placeholder.style.cssText = `height:${this.origH}px;width:${this.origW}px`;
        this.anchor.after(this.placeholder);

        this.layer = this.media.ownerDocument.createElement("div");
        this.layer.className = "tsp-sticky-media-layer";
        this.hostEl.classList.add("tsp-sticky-host-context");
        this.hostEl.appendChild(this.layer);
        this.layer.appendChild(this.wrapper);
        this.docked = true;
        this.syncGeo();
    }

    restore() {
        if (!this.docked) return;
        this.moveBack();
        this.placeholder?.remove();
        this.layer?.remove();
        this.hostEl.classList.remove("tsp-sticky-host-context");
        this.placeholder = this.layer = null;
        this.docked = false;
    }

    private moveBack() {
        if (this.anchor?.isConnected) {
            this.anchor.after(this.wrapper);
        } else if (this.origParent) {
            try { this.origParent.insertBefore(this.wrapper, this.origNext); }
            catch { this.hostEl.appendChild(this.wrapper); }
        } else {
            this.hostEl.appendChild(this.wrapper);
        }
    }

    destroy() {
        if (this.destroyed) return;
        const win = this.media.ownerDocument.defaultView;
        win?.removeEventListener("resize", this.onResize);
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.mgr.unregisterMediaAnchor(this.media);
        if (this.docked) {
            this.moveBack();
            this.placeholder?.remove();
            this.layer?.remove();
            this.docked = false;
        }
        this.anchor?.remove();
        this.hostEl.classList.remove("tsp-sticky-host-context");
        this.placeholder = this.layer = this.anchor = null;
        this.origParent = this.origNext = null;
        this.attached = false;
        this.destroyed = true;
    }

    private syncGeo() {
        if (!this.docked || !this.placeholder || !this.layer) return;
        const hr = this.hostEl.getBoundingClientRect();
        const sr = this.scrollEl.getBoundingClientRect();
        let left = this.origLeft;
        if (this.anchor?.isConnected) {
            const ar = this.anchor.getBoundingClientRect();
            if (Number.isFinite(ar.left - hr.left)) left = ar.left - hr.left;
        }
        const w = Math.min(this.origW, Math.max(0, hr.width - Math.max(0, left)));
        this.placeholder.style.cssText = `height:${this.origH}px;width:${w}px`;
        this.layer.style.cssText = `top:${sr.top - hr.top}px;left:${left}px;width:${w}px`;
    }
}

export class StickyMediaManager {
    private groups = new Map<HTMLElement, MediaGroup>();
    private mo: MutationObserver | null = null;
    private timer: number | null = null;
    private readonly anchorMap = new Map<HTMLElement, HTMLMediaElement>();
    private readonly mediaMap = new WeakMap<HTMLMediaElement, HTMLElement>();

    constructor(private app: App) {}

    initialize() { this.startObs(); }

    registerMediaAnchor(media: HTMLMediaElement, anchor: HTMLElement) {
        this.anchorMap.set(anchor, media);
        this.mediaMap.set(media, anchor);
    }
    unregisterMediaAnchor(media: HTMLMediaElement) {
        const a = this.mediaMap.get(media);
        if (a) { this.anchorMap.delete(a); this.mediaMap.delete(media); }
    }
    getMediaForAnchor(anchor: HTMLElement): HTMLMediaElement | null { return this.anchorMap.get(anchor) || null; }
    getAnchorForMedia(media: HTMLMediaElement): HTMLElement | null { return this.mediaMap.get(media) || null; }

    setupForElement(renderRoot: HTMLElement) {
        const ctx = findStickyMediaContext(renderRoot);
        if (!ctx) return;
        const { media, scrollEl, hostEl } = ctx;

        let g = this.groups.get(scrollEl);
        if (!g) {
            g = { ctls: [] };
            this.groups.set(scrollEl, g);
            scrollEl.addEventListener("scroll", () => this.arbitrate(scrollEl), { passive: true });
        }

        if (g.ctls.some(c => c.media === media)) return;
        const ctrl = new StickyMediaController(media, scrollEl, hostEl, this);
        ctrl.attach();
        g.ctls.push(ctrl);
    }

    scan() {
        this.cleanup();
        for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
            const view = leaf.view;
            if (!(view instanceof MarkdownView) || !view.file) continue;
            const mode = view.getMode();
            for (const media of findStickyMediaCandidates(view.containerEl, mode)) {
                this.setupForElement(media);
            }
        }
    }

    destroy() {
        this.mo?.disconnect();
        this.mo = null;
        if (this.timer !== null) {
            this.app.workspace.containerEl.ownerDocument.defaultView?.clearTimeout(this.timer);
            this.timer = null;
        }
        for (const [el, g] of this.groups) {
            el.removeEventListener("scroll", () => {});
            for (const c of g.ctls) c.destroy();
        }
        this.groups.clear();
        this.anchorMap.clear();
    }

    private arbitrate(scrollEl: HTMLElement) {
        const g = this.groups.get(scrollEl);
        if (!g) return;
        const sr = scrollEl.getBoundingClientRect();
        let best: BaseController | null = null, bestTop = -Infinity;
        for (const c of g.ctls) {
            if (!c.isActive) continue;
            const r = c.getTriggerRect();
            if (r.top < sr.top && r.top > bestTop) { bestTop = r.top; best = c; }
        }

        if (best && this.shouldUnstick(scrollEl, best, sr)) best = null;

        for (const c of g.ctls) {
            const should = c === best;
            if (should && !c.isDocked()) c.dock();
            else if (!should && c.isDocked()) c.restore();
        }
    }

    /**
     * 限位判定，命中任一条件返回 true：
    */
   private shouldUnstick(scrollEl: HTMLElement, ctrl: BaseController, sr: DOMRect): boolean {
       const anchor = ctrl.anchor;
       if (!anchor?.isConnected) return false;
       
       const { nextTop, lastTsBottom } = this.scanAfterAnchor(scrollEl, anchor);
       
       // 下一媒体元素顶部与其底部重叠时
       if (nextTop !== null && nextTop < sr.top + ctrl.getStickyHeight()) return true;
       // 自身时间戳全部滚出容器顶部时
       if (lastTsBottom !== null && lastTsBottom < sr.top) return true;
        return false;
    }

    /**
     * 从 anchor 向后扫描，返回：
     *  - nextTop：下一个媒体代表元素（.tsp-sticky-anchor 或未包装媒体）的视口 top
     *  - lastTsBottom：本段最后一个 .tsp-timestamp 的视口 bottom
     * 两者均可能为 null（本段无时间戳 / 后面无更多媒体）。
     */
    private scanAfterAnchor(
        scrollEl: HTMLElement,
        anchor: HTMLElement
    ): { nextTop: number | null; lastTsBottom: number | null } {
        const all = scrollEl.querySelectorAll<HTMLElement>(
            "audio, video, .tsp-sticky-anchor, .tsp-timestamp"
        );
        let nextTop: number | null = null;
        let lastTsBottom: number | null = null;
        let started = false;

        for (const el of Array.from(all)) {
            if (el === anchor) { started = true; continue; }
            if (!started) continue;

            if (el.classList.contains("tsp-sticky-anchor")) {
                nextTop = el.getBoundingClientRect().top;
                break;
            }
            if (el.tagName === "AUDIO" || el.tagName === "VIDEO") {
                // 已被包装的媒体，其代表元素是前面的 anchor，跳过
                if (!this.mediaMap.has(el as HTMLMediaElement)) {
                    nextTop = el.getBoundingClientRect().top;
                    break;
                }
                continue;
            }
            if (el.classList.contains("tsp-timestamp")) {
                lastTsBottom = el.getBoundingClientRect().bottom;
            }
        }
        return { nextTop, lastTsBottom };
    }

    private startObs() {
        const el = this.app.workspace.containerEl;
        const win = el.ownerDocument.defaultView;
        if (!win) return;
        this.mo = new win.MutationObserver(() => { this.cleanup(); this.schedule(); });
        this.mo.observe(el, { childList: true, subtree: true });
        this.scan();
    }

    private schedule() {
        if (this.timer !== null) return;
        const win = this.app.workspace.containerEl.ownerDocument.defaultView;
        if (!win) { this.scan(); return; }
        this.timer = win.setTimeout(() => { this.timer = null; this.scan(); }, 0);
    }

    private cleanup() {
        const valid = new Map<HTMLElement, string>();
        for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
            const view = leaf.view;
            if (!(view instanceof MarkdownView) || !view.file) continue;
            const s = findStickyScrollContainer(view.containerEl, view.getMode());
            if (s) valid.set(s, view.file.path);
        }
        for (const [el, g] of this.groups) {
            if (!valid.has(el)) {
                for (const c of g.ctls) c.destroy();
                el.removeEventListener("scroll", () => {});
                this.groups.delete(el);
                continue;
            }
            const toRemove: BaseController[] = [];
            for (const c of g.ctls) {
                if (!c.isActive) toRemove.push(c);
                else c.refresh();
            }
            for (const c of toRemove) {
                const idx = g.ctls.indexOf(c);
                if (idx > -1) g.ctls.splice(idx, 1);
                c.destroy();
            }
            if (g.ctls.length === 0) {
                el.removeEventListener("scroll", () => {});
                this.groups.delete(el);
            }
        }
    }
}