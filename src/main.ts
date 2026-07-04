import { Plugin, MarkdownPostProcessorContext, MarkdownView, TFile } from "obsidian";

const SPEAKER_LINE_RE = /^(.+?)\s+(\d{1,3}):(\d{2})\s*$/;
const INLINE_TS_RE = /(\d{1,3}:\d{2})/g;
const MEDIA_EMBED_RE = /!\[\[.+?\.(mp3|webm|wav|m4a|ogg|3gp|flac|mp4|mov|avi|mkv|mpeg)\]\]/i;

export default class TimestampPlayerPlugin extends Plugin {
	onload() {
		this.registerMarkdownPostProcessor(
			async (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
				if (!(await this.hasMediaEmbed(ctx))) return;
				this.processTimestamps(el);
			}
		);
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

	private replaceSpeakerLine(node: Text, match: RegExpMatchArray) {
		const speaker = match[1];
		const minutes = parseInt(match[2], 10);
		const seconds = parseInt(match[3], 10);
		const totalSeconds = minutes * 60 + seconds;
		const timeStr = match[2] + ":" + match[3];

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
			const tsStr = m[1];
			const parts = tsStr.split(":");
			const totalSeconds = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
			fragment.appendChild(this.createTimestampBtn(tsStr, totalSeconds));
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

		const icon = createSpan({ cls: "tsp-play-icon", text: "▶" });
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
				if (icon) icon.textContent = "▶";
			}
		};
		media.addEventListener("timeupdate", this.boundTimeUpdate);
		media.addEventListener("ended", this.boundEnded);
		media.addEventListener("pause", this.boundPause);
		media.addEventListener("play", () => {
			if (this.activeBtn) {
				const icon = this.activeBtn.querySelector(".tsp-play-icon");
				if (icon) icon.textContent = "⏸";
			}
		});
	}

	/** Find the media element that this button belongs to (the last audio or video element before it in document order) */
	private findMediaForBtn(container: HTMLElement, btn: HTMLElement): HTMLMediaElement | null {
		const all = Array.from(container.querySelectorAll("audio, video, .tsp-timestamp"));
		let lastMedia: HTMLMediaElement | null = null;
		for (const el of all) {
			if (el.tagName === "AUDIO" || el.tagName === "VIDEO") {
				lastMedia = el as HTMLMediaElement;
			} else if (el === btn) {
				return lastMedia;
			}
		}
		return lastMedia;
	}

	/** Get timestamp buttons that belong to the same audio and video section (between this media element and the next) */
	private getTimestampsForMedia(container: HTMLElement, media: HTMLMediaElement): HTMLElement[] {
		const all = Array.from(container.querySelectorAll("audio, video, .tsp-timestamp"));
		const mediaIndex = all.indexOf(media);
		if (mediaIndex === -1) return [];

		const result: HTMLElement[] = [];
		for (let i = mediaIndex + 1; i < all.length; i++) {
			const el = all[i];
			if (el.tagName === "AUDIO" || el.tagName === "VIDEO") break;
			result.push(el as HTMLElement);
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
			if (prevIcon) prevIcon.textContent = "▶";
			this.activeBtn.removeClass("tsp-active");
		}
		btn.addClass("tsp-active");
		const icon = btn.querySelector(".tsp-play-icon");
		if (icon) icon.textContent = "⏸";
		this.activeBtn = btn;
	}

	private resetActiveBtn() {
		if (this.activeBtn) {
			const icon = this.activeBtn.querySelector(".tsp-play-icon");
			if (icon) icon.textContent = "▶";
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
}
