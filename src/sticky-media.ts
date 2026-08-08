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
    const cand = media.closest<HTMLElement>(".internal-embed, .media-embed");
    return cand && scrollEl.contains(cand) ? cand : media;
}

function copyPlaybackState(src: HTMLMediaElement | null, dst: HTMLMediaElement | null): void {
    if (!src || !dst) return;
    try {
        dst.currentTime = src.currentTime;
        dst.volume = src.volume;
        dst.muted = src.muted;
        dst.playbackRate = src.playbackRate;
        dst.loop = src.loop;
    } catch {}
}

type Controller = BaseController;

interface MediaGroup { ctls: Controller[]; active: Controller | null; }

abstract class BaseController {
    protected attached = false;
    protected docked = false;
    protected destroyed = false;
    protected wrapper: HTMLElement;

    get isActive(): boolean { return this.attached && !this.destroyed && this.media.isConnected; }
    isDocked(): boolean { return this.docked; }

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
    private anchor: HTMLElement | null = null;
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
        this.anchor = this.media.ownerDocument.createElement("div");
        this.anchor.className = "tsp-sticky-anchor";
        this.anchor.setAttribute("aria-hidden", "true");
        this.wrapper.before(this.anchor);
        this.mgr.registerMediaAnchor(this.media, this.anchor);
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

    getTriggerRect(): DOMRect {
        return (this.anchor?.isConnected) ? this.anchor.getBoundingClientRect() : this.wrapper.getBoundingClientRect();
    }

    refresh() {
        if (!this.attached || this.destroyed || !this.anchor) return;
        if (!this.scrollEl.isConnected || !this.hostEl.isConnected || !this.anchor.isConnected) {
            this.destroy();
            return;
        }
        if (this.docked) this.syncGeo();
    }

    dock() {
        if (this.docked || !this.anchor) return;
        this.origParent = this.wrapper.parentNode;
        this.origNext = this.wrapper.nextSibling;
        const wr = this.wrapper.getBoundingClientRect(), hr = this.hostEl.getBoundingClientRect();
        this.origW = wr.width; this.origH = wr.height; this.origLeft = wr.left - hr.left;

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
        if (!this.docked || !this.anchor) return;
        if (this.anchor.isConnected) this.anchor.after(this.wrapper);
        else if (this.origParent) {
            try { this.origParent.insertBefore(this.wrapper, this.origNext); } catch { this.origParent.appendChild(this.wrapper); }
        } else this.hostEl.appendChild(this.wrapper);
        this.placeholder?.remove();
        this.layer?.remove();
        this.hostEl.classList.remove("tsp-sticky-host-context");
        this.placeholder = this.layer = null;
        this.docked = false;
    }

    destroy() {
        if (this.destroyed) return;
        const win = this.media.ownerDocument.defaultView;
        win?.removeEventListener("resize", this.onResize);
        this.resizeObserver?.disconnect();
        this.resizeObserver = null;
        this.mgr.unregisterMediaAnchor(this.media);
        if (this.docked) {
            if (this.anchor?.isConnected) this.anchor.after(this.wrapper);
            else if (this.origParent) {
                try { this.origParent.insertBefore(this.wrapper, this.origNext); } catch { this.origParent.appendChild(this.wrapper); }
            } else this.hostEl.appendChild(this.wrapper);
            this.placeholder?.remove();
            this.layer?.remove();
            this.docked = false;
        }
        this.anchor?.remove();
        this.hostEl.classList.remove("tsp-sticky-host-context");
        this.placeholder = this.layer = this.anchor = null;
        this.origParent = this.origNext = null;
        this.attached = false; this.destroyed = true;
    }

    private syncGeo() {
        if (!this.docked || !this.anchor || !this.placeholder || !this.layer) return;
        const hr = this.hostEl.getBoundingClientRect(), sr = this.scrollEl.getBoundingClientRect();
        const ar = this.anchor.getBoundingClientRect();
        const left = Number.isFinite(ar.left - hr.left) ? ar.left - hr.left : this.origLeft;
        const w = Math.min(this.origW, Math.max(0, hr.width - Math.max(0, left)));
        this.placeholder.style.cssText = `height:${this.origH}px;width:${w}px`;
        this.layer.style.cssText = `top:${sr.top - hr.top}px;left:${left}px;width:${w}px`;
    }
}

export class LivePreviewStickyMediaController extends BaseController {
    private layer: HTMLElement | null = null;
    private clone: HTMLMediaElement | null = null;
    private origW = 0;
    private origLeft = 0;
    private readonly onResize = () => { if (!this.docked) this.measure(); this.refresh(); };

    constructor(media: HTMLMediaElement, scrollEl: HTMLElement, hostEl: HTMLElement) {
        super(media, scrollEl, hostEl);
    }

    attach() {
        if (this.attached || this.destroyed) return;
        this.measure();
        this.media.ownerDocument.defaultView?.addEventListener("resize", this.onResize);
        this.attached = true;
        this.refresh();
    }

    getTriggerRect(): DOMRect { return this.wrapper.getBoundingClientRect(); }

    refresh() {
        if (!this.attached || this.destroyed) return;
        if (!this.scrollEl.isConnected || !this.hostEl.isConnected) { this.destroy(); return; }
        if (this.docked) this.syncGeo();
    }

    dock() {
        if (this.docked || !this.media.isConnected) return;
        const cw = this.wrapper.cloneNode(true) as HTMLElement;
        const cm = cw.matches("audio, video") ? cw as HTMLMediaElement : cw.querySelector<HTMLMediaElement>("audio, video");
        if (!cm) return;
        this.layer = this.media.ownerDocument.createElement("div");
        this.layer.className = "tsp-sticky-media-layer";
        this.hostEl.classList.add("tsp-sticky-host-context");
        this.hostEl.appendChild(this.layer);
        this.layer.appendChild(cw);
        this.clone = cm;
        copyPlaybackState(this.media, cm);
        if (!this.media.paused) {
            this.media.pause();
            cm.play().catch(() => {});
        }
        this.docked = true;
        this.syncGeo();
    }

    restore() {
        if (!this.docked) return;
        copyPlaybackState(this.clone, this.media);
        const resume = this.clone?.paused === false;
        this.layer?.remove();
        this.hostEl.classList.remove("tsp-sticky-host-context");
        this.layer = this.clone = null;
        this.docked = false;
        if (resume) this.media.play().catch(() => {});
    }

    destroy() {
        if (this.destroyed) return;
        this.media.ownerDocument.defaultView?.removeEventListener("resize", this.onResize);
        if (this.docked && this.media.isConnected) copyPlaybackState(this.clone, this.media);
        this.layer?.remove();
        this.hostEl.classList.remove("tsp-sticky-host-context");
        this.layer = this.clone = null;
        this.docked = false;
        this.attached = false; this.destroyed = true;
    }

    private measure() {
        if (!this.wrapper.isConnected) return;
        const wr = this.wrapper.getBoundingClientRect(), hr = this.hostEl.getBoundingClientRect();
        this.origW = wr.width; this.origLeft = wr.left - hr.left;
    }

    private syncGeo() {
        if (!this.docked || !this.layer) return;
        const hr = this.hostEl.getBoundingClientRect(), sr = this.scrollEl.getBoundingClientRect();
        const avail = Math.max(0, hr.width - Math.max(0, this.origLeft));
        this.layer.style.cssText = `top:${sr.top - hr.top}px;left:${this.origLeft}px;width:${Math.min(this.origW, avail)}px`;
    }

    getMedia(): HTMLMediaElement { return this.media; }
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

    setupForElement(renderRoot: HTMLElement, _path: string) {
        const ctx = findStickyMediaContext(renderRoot);
        if (!ctx) return;
        const { media, scrollEl, hostEl } = ctx;
        let g = this.groups.get(scrollEl);
        if (!g) {
            g = { ctls: [], active: null };
            this.groups.set(scrollEl, g);
            scrollEl.addEventListener("scroll", () => this.arbitrate(scrollEl), { passive: true });
        }
        const exists = g.ctls.some(c => c instanceof StickyMediaController ? c.media === media : c instanceof LivePreviewStickyMediaController && c.getMedia() === media);
        if (exists) return;
        const ctrl = scrollEl.matches(".cm-scroller")
            ? new LivePreviewStickyMediaController(media, scrollEl, hostEl)
            : new StickyMediaController(media, scrollEl, hostEl, this);
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
                this.setupForElement(media, view.file.path);
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
        let best: Controller | null = null, bestTop = -Infinity;
        for (const c of g.ctls) {
            if (!c.isActive) continue;
            const r = c.getTriggerRect();
            if (r.top < sr.top && r.top > bestTop) { bestTop = r.top; best = c; }
        }
        for (const c of g.ctls) {
            const should = c === best;
            if (should && !c.isDocked()) c.dock();
            else if (!should && c.isDocked()) c.restore();
        }
        g.active = best;
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
            const toRemove: Controller[] = [];
            for (const c of g.ctls) {
                if (!c.isActive) toRemove.push(c);
                else c.refresh();
            }
            for (const c of toRemove) {
                const idx = g.ctls.indexOf(c);
                if (idx > -1) g.ctls.splice(idx, 1);
                if (g.active === c) g.active = null;
                c.destroy();
            }
            if (g.ctls.length === 0) {
                el.removeEventListener("scroll", () => {});
                this.groups.delete(el);
            }
        }
    }
}