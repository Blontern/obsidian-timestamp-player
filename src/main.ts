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
                this.stickyManager.setupForElement(el, ctx.sourcePath);
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
        const paragraphs = el.querySelectorAll("p");

        for (const p of Array.from(paragraphs)) {
            const nodesToProcess: { node: Text; type: "speaker" | "inline"; match: RegExpMatchArray }[] = [];

            for (const node of Array.from(p.childNodes)) {
                if (node.nodeType !== Node.TEXT_NODE) continue;
                const text = node.textContent?.trim() ?? "";
                if (!text) continue;

                const speakerMatch = text.match(SPEAKER_LINE_RE);
                if (speakerMatch) {
                    nodesToProcess.push({ node: node as Text, type: "speaker", match: speakerMatch });
                } else if (INLINE_TS_RE.test(text)) {
                    INLINE_TS_RE.lastIndex = 0;
                    nodesToProcess.push({ node: node as Text, type: "inline", match: [] as unknown as RegExpMatchArray });
                }
            }

            for (const item of nodesToProcess.reverse()) {
                if (item.type === "speaker") {
                    this.replaceSpeakerLine(item.node, item.match);
                } else {
                    this.replaceInlineTimestamps(item.node);
                }
            }
        }
    }

	/**
	 * 解析时间字符串，返回总秒数（浮点数）
	 * 支持格式: [hh:]mm:ss[.SSS]
	 */
    private parseTimeString(timeStr: string): number {
        let hours = 0, minutes = 0, seconds = 0, millis = 0;
        const trimmed = timeStr.trim();
        if (!trimmed) return 0;

		// 分离毫秒部分
        let mainPart = trimmed;
        let millisPart = "";
        const dotIndex = trimmed.indexOf(".");
        if (dotIndex !== -1) {
            mainPart = trimmed.substring(0, dotIndex);
            millisPart = trimmed.substring(dotIndex + 1);
			// 解析毫秒，数字可能不足三位，按比例计算（如 .5 → 500ms）
            if (millisPart) {
                const millisNum = parseFloat("0." + millisPart);
                if (!isNaN(millisNum)) {
                    millis = Math.round(millisNum * 1000);
                }
            }
        }

        const parts = mainPart.split(":").map(s => parseInt(s, 10));
        if (parts.length === 2) {
			// mm:ss
            minutes = parts[0] || 0;
            seconds = parts[1] || 0;
        } else if (parts.length === 3) {
			// hh:mm:ss
            hours = parts[0] || 0;
            minutes = parts[1] || 0;
            seconds = parts[2] || 0;
        } else {
            return 0;
        }

        return hours * 3600 + minutes * 60 + seconds + millis / 1000;
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
    private switching = false;

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
		// If clicking the active button, toggle pause/play
        if (this.activeBtn === btn && this.activeMedia) {
            if (!this.activeMedia.paused) {
                this.activeMedia.pause();
            } else {
                this.activeMedia.play().catch(() => {});
            }
            return;
        }

        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return;

        const container = view.containerEl;
        const media = this.findMediaForBtn(container, btn);
        if (!media) return;

		// Detach old listeners before pausing to avoid stale callbacks
        this.detachMediaListeners();
        this.resetActiveBtn();

		// Pause previous media if different
        this.switching = true;
        if (this.activeMedia && this.activeMedia !== media && !this.activeMedia.paused) {
            this.activeMedia.pause();
        }
        this.switching = false;

		// Seek and play the matched media
        media.currentTime = Math.min(seconds, media.duration || Infinity);
        media.play().catch(() => {});

        this.activeMedia = media;
        this.activeContainer = container;
        this.setActiveBtn(btn);

		// Attach listeners for follow-along and cleanup
        this.boundTimeUpdate = () => this.onTimeUpdate();
        this.boundEnded = () => this.clearPlaybackState();
        this.boundPause = () => {
            if (this.switching) return;
            if (this.activeBtn) {
                const icon = this.activeBtn.querySelector(".tsp-play-icon");
                if (icon) setIcon(icon as HTMLElement, "play");
            }
        };
        media.addEventListener("timeupdate", this.boundTimeUpdate);
        media.addEventListener("ended", this.boundEnded);
        media.addEventListener("pause", this.boundPause);
        media.addEventListener("play", () => {
            if (this.activeBtn) {
                const icon = this.activeBtn.querySelector(".tsp-play-icon");
                if (icon) setIcon(icon as HTMLElement, "pause");
            }
        });
    }

    /**
     * 查找按钮所控制的媒体元素。
     * 一次查询所有相关元素，遍历时维护“最后一个代表元素”。
     */
    private findMediaForBtn(container: HTMLElement, btn: HTMLElement): HTMLMediaElement | null {
        const all = container.querySelectorAll<HTMLElement>("audio, video, .tsp-sticky-anchor, .tsp-timestamp");
        let lastMedia: HTMLMediaElement | null = null;

        for (const el of all) {
            // 如果是媒体元素
            if (el.tagName === "AUDIO" || el.tagName === "VIDEO") {
                const media = el as HTMLMediaElement;
                // 只有未被浮动的媒体才作为代表
                if (!this.stickyManager.getAnchorForMedia(media)) {
                    lastMedia = media;
                }
            }
            // 如果是锚点
            else if (el.classList.contains("tsp-sticky-anchor")) {
                const media = this.stickyManager.getMediaForAnchor(el);
                if (media) lastMedia = media;
            }
            // 如果是时间戳按钮
            else if (el === btn) {
                return lastMedia;
            }
        }
        return lastMedia;
    }

    /**
     * 获取属于某个媒体元素的所有时间戳按钮。
     * 先找到代表元素（媒体或锚点）的位置，然后向后收集 timestamp，直到遇到下一个代表元素。
     */
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
        // 从代表元素之后开始收集
        for (let i = repIndex + 1; i < all.length; i++) {
            const el = all[i];
            // 判断是否为“下一个代表元素”
            let isNextRep = false;
            if (el.tagName === "AUDIO" || el.tagName === "VIDEO") {
                // 未浮动的媒体是代表
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

    private onTimeUpdate() {
        if (!this.activeMedia || !this.activeContainer) return;
        const currentTime = this.activeMedia.currentTime;

        const buttons = this.getTimestampsForMedia(this.activeContainer, this.activeMedia)
            .map((el) => ({
                el,
                seconds: parseFloat(el.getAttribute("data-seconds") || "0"),
            }))
            .sort((a, b) => a.seconds - b.seconds);

        let target: HTMLElement | null = null;
        for (const b of buttons) {
            if (b.seconds <= currentTime) {
                target = b.el;
            } else {
                break;
            }
        }

        if (target && target !== this.activeBtn) {
            this.setActiveBtn(target);
        }
    }

    private setActiveBtn(btn: HTMLElement) {
        if (this.activeBtn) {
            const prevIcon = this.activeBtn.querySelector(".tsp-play-icon");
            if (prevIcon) setIcon(prevIcon as HTMLElement, "play");
            this.activeBtn.removeClass("tsp-active");
        }
        btn.addClass("tsp-active");
        const icon = btn.querySelector(".tsp-play-icon");
        if (icon) {
            const isPlaying = this.activeMedia && !this.activeMedia.paused;
            setIcon(icon as HTMLElement, isPlaying ? "pause" : "play");
        }
        this.activeBtn = btn;
    }

    private resetActiveBtn() {
        if (this.activeBtn) {
            const icon = this.activeBtn.querySelector(".tsp-play-icon");
            if (icon) setIcon(icon as HTMLElement, "play");
            this.activeBtn.removeClass("tsp-active");
            this.activeBtn = null;
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

    private clearPlaybackState() {
        this.detachMediaListeners();
        this.resetActiveBtn();
        this.activeMedia = null;
        this.activeContainer = null;
    }

    private rewriteMediaElements(el: HTMLElement) {
        const mediaElements = el.querySelectorAll<HTMLMediaElement>("audio, video");
        for (const media of mediaElements) {
            if (media.hasAttribute("data-custom-player")) continue;
            media.setAttribute("data-custom-player", "true");
            media.removeAttribute("controls");
            const player = new CustomMediaPlayer(media);
            player.build();
        }
    }
}