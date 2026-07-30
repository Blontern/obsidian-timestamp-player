export interface StickyMediaContext {
	media: HTMLMediaElement;
	scrollEl: HTMLElement;
	hostEl: HTMLElement;
}

export function findStickyMediaCandidates(
	root: ParentNode,
	mode?: "preview" | "source",
): HTMLMediaElement[] {
	const selectors: string[] = [];
	if (!mode || mode === "preview") {
		selectors.push(".markdown-reading-view audio", ".markdown-reading-view video");
	}
	if (!mode || mode === "source") {
		selectors.push(
			".markdown-source-view.is-live-preview audio",
			".markdown-source-view.is-live-preview video",
		);
	}

	return Array.from(root.querySelectorAll<HTMLMediaElement>(selectors.join(", ")));
}

export function findStickyScrollContainer(
	root: ParentNode,
	mode: "preview" | "source",
): HTMLElement | null {
	if (mode === "preview") {
		return root.querySelector<HTMLElement>(
			".markdown-reading-view .markdown-preview-view",
		);
	}

	return root.querySelector<HTMLElement>(
		".markdown-source-view.is-live-preview .cm-scroller",
	);
}

export function findStickyMediaContext(renderRoot: HTMLElement): StickyMediaContext | null {
	const media = renderRoot.matches("audio, video")
		? renderRoot as HTMLMediaElement
		: renderRoot.querySelector<HTMLMediaElement>("audio, video");
	if (!media) return null;

	const readingScrollEl = renderRoot.closest<HTMLElement>(".markdown-preview-view");
	const readingView = readingScrollEl?.closest<HTMLElement>(".markdown-reading-view");
	const readingHostEl = readingScrollEl?.closest<HTMLElement>(".view-content");
	if (readingScrollEl && readingView && readingHostEl) {
		return { media, scrollEl: readingScrollEl, hostEl: readingHostEl };
	}

	const livePreviewScrollEl = renderRoot.closest<HTMLElement>(".cm-scroller");
	const livePreviewView = livePreviewScrollEl?.closest<HTMLElement>(
		".markdown-source-view.is-live-preview",
	);
	const livePreviewHostEl = livePreviewScrollEl?.closest<HTMLElement>(".view-content");
	if (livePreviewScrollEl && livePreviewView && livePreviewHostEl) {
		return { media, scrollEl: livePreviewScrollEl, hostEl: livePreviewHostEl };
	}

	return null;
}

export class StickyMediaController {
	private readonly wrapper: HTMLElement;
	private anchor: HTMLElement | null = null;
	private placeholder: HTMLElement | null = null;
	private layer: HTMLElement | null = null;
	private resizeObserver: ResizeObserver | null = null;
	private attached = false;
	private docked = false;
	private destroyed = false;
	private originalWidth = 0;
	private originalHeight = 0;
	private originalLeftInHost = 0;
	private readonly boundRefresh = () => this.refresh();

	get isActive(): boolean {
		return this.attached && !this.destroyed;
	}

	constructor(
		private readonly media: HTMLMediaElement,
		private readonly scrollEl: HTMLElement,
		private readonly hostEl: HTMLElement,
	) {
		const candidate = media.closest<HTMLElement>(".internal-embed, .media-embed");
		this.wrapper = candidate && scrollEl.contains(candidate) ? candidate : media;
	}

	attach(): void {
		if (this.attached || this.destroyed || !this.wrapper.isConnected) return;

		this.anchor = this.media.ownerDocument.createElement("div");
		this.anchor.className = "tsp-sticky-anchor";
		this.anchor.setAttribute("aria-hidden", "true");
		this.wrapper.before(this.anchor);

		this.scrollEl.addEventListener("scroll", this.boundRefresh, { passive: true });
		this.media.ownerDocument.defaultView?.addEventListener("resize", this.boundRefresh);

		const ResizeObserverCtor = this.media.ownerDocument.defaultView?.ResizeObserver;
		if (ResizeObserverCtor) {
			this.resizeObserver = new ResizeObserverCtor(this.boundRefresh);
			this.resizeObserver.observe(this.wrapper);
			this.resizeObserver.observe(this.hostEl);
		}

		this.attached = true;
		this.refresh();
	}

	refresh(): void {
		if (!this.attached || this.destroyed || !this.anchor) return;
		if (!this.scrollEl.isConnected || !this.hostEl.isConnected || !this.anchor.isConnected) {
			this.destroy();
			return;
		}

		const scrollRect = this.scrollEl.getBoundingClientRect();
		const triggerRect = this.docked
			? this.anchor.getBoundingClientRect()
			: this.wrapper.getBoundingClientRect();

		if (triggerRect.top < scrollRect.top) {
			if (!this.docked) this.dock();
			this.syncDockedGeometry();
		} else if (this.docked) {
			this.restore();
		}
	}

	destroy(): void {
		if (this.destroyed) return;

		this.scrollEl.removeEventListener("scroll", this.boundRefresh);
		this.media.ownerDocument.defaultView?.removeEventListener("resize", this.boundRefresh);
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;

		if (this.docked && this.anchor?.isConnected) {
			this.anchor.after(this.wrapper);
		}

		this.placeholder?.remove();
		this.layer?.remove();
		this.anchor?.remove();
		this.hostEl.classList.remove("tsp-sticky-host-context");

		this.placeholder = null;
		this.layer = null;
		this.anchor = null;
		this.docked = false;
		this.attached = false;
		this.destroyed = true;
	}

	private dock(): void {
		if (!this.anchor || this.docked) return;

		const wrapperRect = this.wrapper.getBoundingClientRect();
		const hostRect = this.hostEl.getBoundingClientRect();
		this.originalWidth = wrapperRect.width;
		this.originalHeight = wrapperRect.height;
		this.originalLeftInHost = wrapperRect.left - hostRect.left;

		this.placeholder = this.media.ownerDocument.createElement("div");
		this.placeholder.className = "tsp-sticky-placeholder";
		this.placeholder.setAttribute("aria-hidden", "true");
		this.placeholder.style.height = `${this.originalHeight}px`;
		this.placeholder.style.width = `${this.originalWidth}px`;
		this.anchor.after(this.placeholder);

		this.layer = this.media.ownerDocument.createElement("div");
		this.layer.className = "tsp-sticky-media-layer";
		this.hostEl.classList.add("tsp-sticky-host-context");
		this.hostEl.appendChild(this.layer);
		this.layer.appendChild(this.wrapper);

		this.docked = true;
	}

	private restore(): void {
		if (!this.docked || !this.anchor) return;

		if (this.anchor.isConnected) {
			this.anchor.after(this.wrapper);
		}
		this.placeholder?.remove();
		this.layer?.remove();
		this.hostEl.classList.remove("tsp-sticky-host-context");

		this.placeholder = null;
		this.layer = null;
		this.docked = false;
	}

	private syncDockedGeometry(): void {
		if (!this.docked || !this.anchor || !this.placeholder || !this.layer) return;

		const hostRect = this.hostEl.getBoundingClientRect();
		const scrollRect = this.scrollEl.getBoundingClientRect();
		const anchorRect = this.anchor.getBoundingClientRect();
		const anchorLeftInHost = anchorRect.left - hostRect.left;
		const left = Number.isFinite(anchorLeftInHost)
			? anchorLeftInHost
			: this.originalLeftInHost;
		const availableWidth = Math.max(0, hostRect.width - Math.max(0, left));
		const width = Math.min(this.originalWidth, availableWidth);

		this.placeholder.style.height = `${this.originalHeight}px`;
		this.placeholder.style.width = `${width}px`;
		this.layer.style.top = `${scrollRect.top - hostRect.top}px`;
		this.layer.style.left = `${left}px`;
		this.layer.style.width = `${width}px`;
	}
}

export class LivePreviewStickyMediaController {
	private media: HTMLMediaElement;
	private wrapper: HTMLElement;
	private layer: HTMLElement | null = null;
	private cloneMedia: HTMLMediaElement | null = null;
	private attached = false;
	private docked = false;
	private destroyed = false;
	private threshold = 0;
	private originalWidth = 0;
	private originalLeftInHost = 0;
	private readonly boundRefresh = () => this.refresh();
	private readonly boundResize = () => {
		if (!this.docked) this.measureSource();
		this.refresh();
	};

	get isActive(): boolean {
		return this.attached && !this.destroyed;
	}

	constructor(
		media: HTMLMediaElement,
		private readonly scrollEl: HTMLElement,
		private readonly hostEl: HTMLElement,
	) {
		this.media = media;
		this.wrapper = this.resolveWrapper(media);
	}

	attach(): void {
		if (this.attached || this.destroyed) return;

		this.measureSource();
		this.scrollEl.addEventListener("scroll", this.boundRefresh, { passive: true });
		this.media.ownerDocument.defaultView?.addEventListener("resize", this.boundResize);
		this.attached = true;
		this.refresh();
	}

	updateMedia(media: HTMLMediaElement): void {
		if (this.destroyed) return;

		this.media = media;
		this.wrapper = this.resolveWrapper(media);
		this.measureSource();
		this.refresh();
	}

	refresh(): void {
		if (!this.attached || this.destroyed) return;
		if (!this.scrollEl.isConnected || !this.hostEl.isConnected) {
			this.destroy();
			return;
		}

		if (this.scrollEl.scrollTop > this.threshold) {
			if (!this.docked && this.media.isConnected) this.dock();
			this.syncDockedGeometry();
		} else if (this.docked && this.media.isConnected) {
			this.restore();
		}
	}

	destroy(): void {
		if (this.destroyed) return;

		this.scrollEl.removeEventListener("scroll", this.boundRefresh);
		this.media.ownerDocument.defaultView?.removeEventListener("resize", this.boundResize);
		if (this.docked && this.media.isConnected) {
			this.copyPlaybackState(this.cloneMedia, this.media);
		}
		this.layer?.remove();
		this.hostEl.classList.remove("tsp-sticky-host-context");
		this.layer = null;
		this.cloneMedia = null;
		this.docked = false;
		this.attached = false;
		this.destroyed = true;
	}

	private resolveWrapper(media: HTMLMediaElement): HTMLElement {
		const candidate = media.closest<HTMLElement>(".internal-embed, .media-embed");
		return candidate && this.scrollEl.contains(candidate) ? candidate : media;
	}

	private measureSource(): void {
		if (!this.wrapper.isConnected) return;

		const wrapperRect = this.wrapper.getBoundingClientRect();
		const scrollRect = this.scrollEl.getBoundingClientRect();
		const hostRect = this.hostEl.getBoundingClientRect();
		this.threshold = this.scrollEl.scrollTop + wrapperRect.top - scrollRect.top;
		this.originalWidth = wrapperRect.width;
		this.originalLeftInHost = wrapperRect.left - hostRect.left;
	}

	private dock(): void {
		const cloneWrapper = this.wrapper.cloneNode(true) as HTMLElement;
		const cloneMedia = cloneWrapper.matches("audio, video")
			? cloneWrapper as HTMLMediaElement
			: cloneWrapper.querySelector<HTMLMediaElement>("audio, video");
		if (!cloneMedia) return;

		this.layer = this.media.ownerDocument.createElement("div");
		this.layer.className = "tsp-sticky-media-layer";
		this.hostEl.classList.add("tsp-sticky-host-context");
		this.hostEl.appendChild(this.layer);
		this.layer.appendChild(cloneWrapper);
		this.cloneMedia = cloneMedia;
		this.copyPlaybackState(this.media, cloneMedia);

		if (!this.media.paused) {
			this.media.pause();
			void cloneMedia.play().catch(() => {});
		}
		this.docked = true;
	}

	private restore(): void {
		this.copyPlaybackState(this.cloneMedia, this.media);
		const shouldResume = this.cloneMedia ? !this.cloneMedia.paused : false;
		this.layer?.remove();
		this.hostEl.classList.remove("tsp-sticky-host-context");
		this.layer = null;
		this.cloneMedia = null;
		this.docked = false;

		if (shouldResume) {
			void this.media.play().catch(() => {});
		}
	}

	private syncDockedGeometry(): void {
		if (!this.docked || !this.layer) return;

		const hostRect = this.hostEl.getBoundingClientRect();
		const scrollRect = this.scrollEl.getBoundingClientRect();
		const availableWidth = Math.max(
			0,
			hostRect.width - Math.max(0, this.originalLeftInHost),
		);
		this.layer.style.top = `${scrollRect.top - hostRect.top}px`;
		this.layer.style.left = `${this.originalLeftInHost}px`;
		this.layer.style.width = `${Math.min(this.originalWidth, availableWidth)}px`;
	}

	private copyPlaybackState(
		source: HTMLMediaElement | null,
		target: HTMLMediaElement | null,
	): void {
		if (!source || !target) return;

		try {
			target.currentTime = source.currentTime;
			target.volume = source.volume;
			target.muted = source.muted;
			target.playbackRate = source.playbackRate;
			target.loop = source.loop;
		} catch {
			// 媒体尚未载入元数据时，浏览器可能拒绝设置播放位置。
		}
	}
}
