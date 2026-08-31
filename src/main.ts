import { Plugin, MarkdownPostProcessorContext, MarkdownView, TFile, setIcon } from "obsidian";
import { StickyMediaManager } from "./sticky-media";
import { CustomMediaPlayer } from "./custom-player";

const SPEAKER_LINE_RE = /^(.+?)\s+((?:(?:\d{1,3}:)?\d{1,3}:\d{2}(?:\.\d{1,3})?))\s*$/;
const INLINE_TS_RE = /(?:(?:(\d{1,3}):)?(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?)/g;
const MEDIA_EMBED_RE = /!\[\[.+?\.(mp3|webm|wav|m4a|ogg|3gp|flac|mp4|mov|avi|mkv|mpeg)\]\]/i;

export default class TimestampPlayerPlugin extends Plugin {
    private stickyManager: StickyMediaManager;

    onload() {
        this.stickyManager = new StickyMediaManager(this.app);
        this.stickyManager.initialize();

        this.registerMarkdownPostProcessor(
            async (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
                if (!(await this.hasMediaEmbed(ctx))) return;
                this.processTimestamps(el);
                this.rewriteMediaElements(el);
                this.stickyManager.setupForElement(el);
            }
        );

        this.registerEvent(
            this.app.workspace.on("layout-change", () => this.stickyManager.scan())
        );
    }

    onunload() {
        this.clearPlaybackState();
        this.stickyManager.destroy();
    }

    private async hasMediaEmbed(ctx: MarkdownPostProcessorContext): Promise<boolean> {
        const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
        if (!(file instanceof TFile)) return false;
        const content = await this.app.vault.cachedRead(file);
        return MEDIA_EMBED_RE.test(content);
    }

    private processTimestamps(el: HTMLElement) {
        for (const p of Array.from(el.querySelectorAll("p"))) {
            const texts = Array.from(p.childNodes)
                .filter(n => n.nodeType === Node.TEXT_NODE && (n.textContent?.trim() ?? "")) as Text[];
            for (const node of texts.reverse()) {
                const text = node.textContent!.trim();
                const speakerMatch = text.match(SPEAKER_LINE_RE);
                if (speakerMatch) {
                    this.replaceSpeakerLine(node, speakerMatch);
                } else if (INLINE_TS_RE.test(text)) {
                    INLINE_TS_RE.lastIndex = 0;
                    this.replaceInlineTimestamps(node);
                }
            }
        }
    }

    private parseTimeString(timeStr: string): number {
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
        node.parentNode?.replaceChild(wrapper, node);
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

        node.parentNode?.replaceChild(fragment, node);
    }

    private activeBtn: HTMLElement | null = null;
    private activeMedia: HTMLMediaElement | null = null;
    private activeContainer: HTMLElement | null = null;
    private boundTimeUpdate: (() => void) | null = null;
    private boundEnded: (() => void) | null = null;
    private boundPause: (() => void) | null = null;
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

    private togglePlay(btn: HTMLElement, seconds: number) {
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

    private clearPlaybackState() {
        this.releaseCurrentMedia();
        this.activeMedia = null;
        this.activeContainer = null;
    }

    private rewriteMediaElements(el: HTMLElement) {
        const mediaElements = el.querySelectorAll<HTMLMediaElement>("audio, video");
        for (const media of Array.from(mediaElements)) {
            if (media.hasAttribute("data-custom-player")) continue;
            media.setAttribute("data-custom-player", "true");
            media.removeAttribute("controls");
            const player = new CustomMediaPlayer(media, this.app);
            player.build();

            const container = media.closest('.custom-media-player');
            if (container) {
                container.addEventListener('media-play', () => {
                    if (this.activeMedia !== media) this.switchToMedia(media);
                    else this.setPlayIcon("pause");
                });
                container.addEventListener('media-pause', () => {
                    if (this.activeMedia === media) this.setPlayIcon("play");
                });
            }
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