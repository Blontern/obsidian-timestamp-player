import { App, MarkdownView, setIcon } from "obsidian";
import { StickyMediaManager } from "./sticky-media";
import { CustomMediaPlayer } from "./custom-player";

const SPEAKER_LINE_RE = /^(.+?)\s+((?:(?:\d{1,3}:)?\d{1,3}:\d{2}(?:\.\d{1,3})?))\s*$/;
const INLINE_TS_RE = /(?:(?:(\d{1,3}):)?(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?)/g;

export class TimestampManager {
    private activeBtn: HTMLElement | null = null;
    private activeMedia: HTMLMediaElement | null = null;
    private activeContainer: HTMLElement | null = null;
    private boundTimeUpdate: (() => void) | null = null;
    private boundEnded: (() => void) | null = null;
    private boundPause: (() => void) | null = null;

    constructor(
        private app: App,
        private stickyManager: StickyMediaManager
    ) {}

    processTimestamps(el: HTMLElement) {
        for (const p of Array.from(el.querySelectorAll<HTMLElement>("p"))) {
            // 幂等：已经处理过就跳过
            if (p.querySelector(".tsp-timestamp")) continue;

            const texts = this.collectTextNodes(p);

            for (const node of texts.reverse()) {
                const text = node.textContent?.trim() ?? "";
                if (!text) continue;

                const speakerMatch = text.match(SPEAKER_LINE_RE);
                if (speakerMatch) {
                    this.replaceSpeakerLine(node, speakerMatch);
                } else {
                    INLINE_TS_RE.lastIndex = 0;
                    if (INLINE_TS_RE.test(text)) {
                        this.replaceInlineTimestamps(node);
                    }
                }
            }
        }
    }

    /** 递归收集元素下的文本节点，跳过语义元素和自身产物 */
    private collectTextNodes(el: HTMLElement): Text[] {
        const result: Text[] = [];
        const SKIP_TAGS = new Set(["CODE", "PRE", "A", "SCRIPT", "STYLE"]);

        const walk = (node: Node) => {
            if (node.nodeType === Node.ELEMENT_NODE) {
                const e = node as HTMLElement;
                if (SKIP_TAGS.has(e.tagName)) return;
                if (
                    e.classList.contains("tsp-timestamp") ||
                    e.classList.contains("tsp-speaker") ||
                    e.classList.contains("tsp-play-icon") ||
                    e.classList.contains("tsp-time")
                ) return;
            }
            if (node.nodeType === Node.TEXT_NODE) {
                if (node.textContent?.trim()) result.push(node as Text);
            } else {
                for (const child of Array.from(node.childNodes)) walk(child);
            }
        };
        walk(el);
        return result;
    }

    public parseTimeString(timeStr: string): number {
        const trimmed = timeStr.trim();
        if (!trimmed) return 0;
        const dotIndex = trimmed.indexOf(".");
        const mainPart = dotIndex === -1 ? trimmed : trimmed.substring(0, dotIndex);
        let millis = 0;
        const millisPart = dotIndex === -1 ? "" : trimmed.substring(dotIndex + 1);
        if (millisPart) {
            const n = parseFloat("0." + millisPart);
            if (!isNaN(n)) millis = Math.round(n * 1000);
        }
        const parts = mainPart.split(":").map(s => parseInt(s, 10));
        if (parts.length === 2) {
            return (parts[0] || 0) * 60 + (parts[1] || 0) + millis / 1000;
        }
        if (parts.length === 3) {
            return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0) + millis / 1000;
        }
        return 0;
    }

    private replaceSpeakerLine(node: Text, match: RegExpMatchArray) {
        const speaker = match[1];
        const timeStr = match[2];
        const totalSeconds = this.parseTimeString(timeStr);

        const wrapper = createFragment();
        wrapper.appendChild(createSpan({ cls: "tsp-speaker", text: speaker + " " }));
        wrapper.appendChild(this.createTimestampBtn(timeStr, totalSeconds));

        const parent = node.parentNode;
        if (!parent) return;

        // CodeMirror 的安全处理：父节点是 CM 装饰 span 且只有一个子节点时，
        // 就地替换内容，避免整块 span 被替换引发 CM 重新布局异常。
        if (this.isCmSpan(parent) && parent.childNodes.length === 1) {
            parent.replaceChildren(wrapper);
        } else {
            parent.replaceChild(wrapper, node);
        }
    }

    private replaceInlineTimestamps(node: Text) {
        const text = node.textContent ?? "";
        const fragment = createFragment();
        let lastIndex = 0;

        INLINE_TS_RE.lastIndex = 0;
        let m: RegExpExecArray | null;

        while ((m = INLINE_TS_RE.exec(text)) !== null) {
            if (m.index > lastIndex) {
                fragment.appendChild(activeDocument.createTextNode(text.slice(lastIndex, m.index)));
            }
            const timeStr = m[0];
            const totalSeconds = this.parseTimeString(timeStr);
            fragment.appendChild(this.createTimestampBtn(timeStr, totalSeconds));
            lastIndex = m.index + m[0].length;
        }

        if (lastIndex < text.length) {
            fragment.appendChild(activeDocument.createTextNode(text.slice(lastIndex)));
        }

        const parent = node.parentNode;
        if (!parent) return;

        if (this.isCmSpan(parent) && parent.childNodes.length === 1) {
            parent.replaceChildren(fragment);
        } else {
            parent.replaceChild(fragment, node);
        }
    }

    /** 判断节点是否为 CodeMirror 的装饰性 span（类名包含 cm- 前缀） */
    private isCmSpan(node: Node): node is HTMLElement {
        return node instanceof HTMLElement && /(^|\s)cm-/.test(node.className);
    }

    private createTimestampBtn(timeStr: string, totalSeconds: number): HTMLSpanElement {
        const btn = createSpan({ cls: "tsp-timestamp" });
        btn.setAttribute("data-seconds", String(totalSeconds));
        btn.setAttribute("role", "button");
        btn.setAttribute("aria-label", `Play from ${timeStr}`);

        const icon = createSpan({ cls: "tsp-play-icon" });
        setIcon(icon, "play");
        btn.appendChild(icon);
        btn.appendChild(createSpan({ cls: "tsp-time", text: timeStr }));

        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.togglePlay(btn, totalSeconds);
        });

        return btn;
    }

    public togglePlay(btn: HTMLElement, seconds: number) {
        if (this.activeBtn === btn && this.activeMedia) {
            if (this.activeMedia.paused) {
                this.activeMedia.play().catch(() => {});
            } else {
                this.activeMedia.pause();
            }
            return;
        }

        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return;

        const container = view.containerEl;
        const media = this.findMediaForBtn(container, btn);
        if (!media) return;

        this.activateMedia(media, container);

        media.currentTime = Math.min(seconds, media.duration || Infinity);
        media.play().catch(() => {});

        this.setActiveBtn(btn);
    }

    private findMediaForBtn(container: HTMLElement, btn: HTMLElement): HTMLMediaElement | null {
        const all = container.querySelectorAll<HTMLElement>("audio, video, .tsp-sticky-anchor, .tsp-timestamp");
        let lastMedia: HTMLMediaElement | null = null;

        for (const el of Array.from(all)) {
            if (el.tagName === "AUDIO" || el.tagName === "VIDEO") {
                const media = el as HTMLMediaElement;
                if (!this.stickyManager.getAnchorForMedia(media)) {
                    lastMedia = media;
                }
            }
            else if (el.classList.contains("tsp-sticky-anchor")) {
                const media = this.stickyManager.getMediaForAnchor(el);
                if (media) lastMedia = media;
            }
            else if (el === btn) {
                return lastMedia;
            }
        }
        return lastMedia;
    }

    private getTimestampsForMedia(container: HTMLElement, media: HTMLMediaElement): HTMLElement[] {
        const representative = this.stickyManager.getAnchorForMedia(media) || media;
        const all = container.querySelectorAll<HTMLElement>("audio, video, .tsp-sticky-anchor, .tsp-timestamp");

        let repIndex = -1;
        for (let i = 0; i < all.length; i++) {
            if (all[i] === representative) {
                repIndex = i;
                break;
            }
        }
        if (repIndex === -1) return [];

        const result: HTMLElement[] = [];
        for (let i = repIndex + 1; i < all.length; i++) {
            const el = all[i];
            let isNextRep = false;
            if (el.tagName === "AUDIO" || el.tagName === "VIDEO") {
                if (!this.stickyManager.getAnchorForMedia(el as HTMLMediaElement)) {
                    isNextRep = true;
                }
            } else if (el.classList.contains("tsp-sticky-anchor")) {
                isNextRep = true;
            }
            if (isNextRep) break;

            if (el.classList.contains("tsp-timestamp")) {
                result.push(el);
            }
        }
        return result;
    }

    private findActiveTimestamp(container: HTMLElement, media: HTMLMediaElement, time?: number): HTMLElement | null {
        const currentTime = time ?? media.currentTime;
        const buttons = this.getTimestampsForMedia(container, media)
            .map((el) => ({ el, seconds: parseFloat(el.getAttribute("data-seconds") || "0") }))
            .sort((a, b) => a.seconds - b.seconds);
        let target: HTMLElement | null = null;
        for (const b of buttons) {
            if (b.seconds <= currentTime) {
                target = b.el;
            } else {
                break;
            }
        }
        return target;
    }

    private onTimeUpdate() {
        if (!this.activeMedia || !this.activeContainer) return;
        const target = this.findActiveTimestamp(this.activeContainer, this.activeMedia);
        if (target && target !== this.activeBtn) {
            this.setActiveBtn(target);
        }
    }

    private setPlayIcon(icon: "play" | "pause") {
        if (!this.activeBtn) return;
        const el = this.activeBtn.querySelector(".tsp-play-icon");
        if (el) setIcon(el as HTMLElement, icon);
    }

    private setActiveBtn(btn?: HTMLElement | null) {
        if (this.activeBtn) {
            this.setPlayIcon("play");
            this.activeBtn.removeClass("tsp-active");
        }
        this.activeBtn = btn ?? null;
        if (btn) {
            btn.addClass("tsp-active");
            this.setPlayIcon(this.activeMedia && !this.activeMedia.paused ? "pause" : "play");
        }
    }

    private detachMediaListeners() {
        if (this.activeMedia) {
            if (this.boundTimeUpdate) this.activeMedia.removeEventListener("timeupdate", this.boundTimeUpdate);
            if (this.boundEnded) this.activeMedia.removeEventListener("ended", this.boundEnded);
            if (this.boundPause) this.activeMedia.removeEventListener("pause", this.boundPause);
        }
        this.boundTimeUpdate = null;
        this.boundEnded = null;
        this.boundPause = null;
    }

    private releaseCurrentMedia() {
        this.detachMediaListeners();
        this.setActiveBtn(null);
    }

    private bindMediaListeners(media: HTMLMediaElement) {
        this.boundTimeUpdate = () => this.onTimeUpdate();
        this.boundEnded = () => this.clearPlaybackState();
        this.boundPause = () => this.setPlayIcon("play");
        media.addEventListener("timeupdate", this.boundTimeUpdate);
        media.addEventListener("ended", this.boundEnded);
        media.addEventListener("pause", this.boundPause);
        media.addEventListener("play", () => this.setPlayIcon("pause"));
    }

    clearPlaybackState() {
        this.releaseCurrentMedia();
        this.activeMedia = null;
        this.activeContainer = null;
    }

    /** 遍历容器内的所有媒体元素并包装（阅读模式后处理器入口） */
    rewriteMediaElements(el: HTMLElement) {
        const mediaElements = el.querySelectorAll<HTMLMediaElement>("audio, video");
        for (const media of Array.from(mediaElements)) {
            this.wrapMediaElement(media);
        }
    }

    /** 包装单个媒体元素为 custom player（幂等，MutationObserver 入口） */
    wrapMediaElement(media: HTMLMediaElement) {
        if (media.hasAttribute("data-custom-player")) return;
        if (media.closest(".custom-media-player")) return;

        media.setAttribute("data-custom-player", "true");
        media.removeAttribute("controls");

        const player = new CustomMediaPlayer(media, this.app);
        player.build();

        const container = media.closest(".custom-media-player");
        if (container) {
            container.addEventListener("media-play", () => {
                if (this.activeMedia !== media) this.switchToMedia(media);
                else this.setPlayIcon("pause");
            });
            container.addEventListener("media-pause", () => {
                if (this.activeMedia === media) this.setPlayIcon("play");
            });
        }
    }

    private activateMedia(media: HTMLMediaElement, container: HTMLElement | null) {
        this.releaseCurrentMedia();

        if (this.activeMedia && this.activeMedia !== media && !this.activeMedia.paused) {
            this.activeMedia.pause();
        }

        this.activeMedia = media;
        this.activeContainer = container;
        this.bindMediaListeners(media);
    }

    private switchToMedia(media: HTMLMediaElement) {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        this.activateMedia(media, view?.containerEl || null);

        if (this.activeContainer) {
            const target = this.findActiveTimestamp(this.activeContainer, media);
            if (target) this.setActiveBtn(target);
        }
    }
}
