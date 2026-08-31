import { Menu, Notice, setIcon, App } from "obsidian";
import { SubtitleManager } from "./subtitle";

export class CustomMediaPlayer {
    private container: HTMLElement;
    private controls: HTMLElement;
    private progressBar: HTMLInputElement;
    private currentTimeLabel: HTMLElement;
    private durationLabel: HTMLElement;
    private playBtn: HTMLElement;
    private tooltip: HTMLElement | null = null;
    private volumeBtn: HTMLElement;
    private volumeSlider: HTMLInputElement;

    private hideTimeout: number | null = null;
    private isMouseOver = false;

    private lastFrameTime: number | null = null;
    private measuredFrameDuration: number | null = null;
    private frameCallbackBound: boolean = false;

    private subtitleManager: SubtitleManager;

    constructor(private media: HTMLMediaElement, private app: App) {
        this.container = createDiv({ cls: "custom-media-player", attr: { tabindex: "0" } });
        media.parentNode?.insertBefore(this.container, media);
        this.container.appendChild(media);
        media.style.width = "100%";
    }

    build() {
        this.controls = createDiv({ cls: "media-controls" });

        this.playBtn = this.createButton("play", () => this.togglePlay());
        this.controls.appendChild(this.playBtn);

        const volContainer = createDiv({ cls: "media-volume-container" });
        this.volumeBtn = this.createButton("volume-2", (e) => {
            e.stopPropagation();
            this.media.muted = !this.media.muted;
            this.updateVolumeIcon();
        });
        volContainer.appendChild(this.volumeBtn);

        this.volumeSlider = createEl("input", {
            type: "range",
            cls: "media-volume-slider",
            attr: { min: "0", max: "1", step: "0.01" },
            value: String(this.media.volume),
        });
        this.volumeSlider.addEventListener("input", () => {
            this.media.volume = parseFloat(this.volumeSlider.value);
            this.media.muted = false;
            this.updateVolumeIcon();
        });
        volContainer.appendChild(this.volumeSlider);
        this.controls.appendChild(volContainer);

        this.progressBar = createEl("input", {
            type: "range",
            cls: "media-progress",
            attr: { min: "0", max: "100", value: "0" },
        });
        this.controls.appendChild(this.progressBar);

        this.currentTimeLabel = createSpan({ cls: "media-time", text: "00:00" });
        this.controls.appendChild(this.currentTimeLabel);

        this.durationLabel = createSpan({ cls: "media-time", text: " / 00:00" });
        this.controls.appendChild(this.durationLabel);

        this.controls.appendChild(this.createButton("settings", (e) => this.showSettings(e)));

        this.container.appendChild(this.controls);

        this.subtitleManager = new SubtitleManager(this.media, this.container, this.app);

        this.showControls();

        this.container.addEventListener("mouseenter", () => {
            this.isMouseOver = true;
            this.showControls();
        });
        this.container.addEventListener("mouseleave", () => {
            this.isMouseOver = false;
            if (!this.media.paused) this.hideControls();
        });
        this.container.addEventListener("mousemove", () => this.resetHideTimer());

        this.media.addEventListener("play", () => {
            this.setPlayIcon("pause");
            this.dispatchMediaEvent('media-play');
            if (!this.isMouseOver) this.hideControls();
        });
        this.media.addEventListener("pause", () => {
            this.setPlayIcon("play");
            this.dispatchMediaEvent('media-pause');
            this.showControls();
            this.clearHideTimer();
        });
        this.media.addEventListener("ended", () => {
            this.setPlayIcon("play");
            this.dispatchMediaEvent('media-pause');
        });

        this.media.addEventListener("click", () => this.togglePlay());

        this.progressBar.addEventListener("input", () => {
            this.media.currentTime = (parseFloat(this.progressBar.value) / 100) * this.media.duration;
        });
        this.progressBar.addEventListener("click", (e) => {
            const rect = this.progressBar.getBoundingClientRect();
            this.media.currentTime = Math.max(0, ((e.clientX - rect.left) / rect.width) * this.media.duration);
        });
        this.progressBar.addEventListener("mousemove", (e) => this.showTooltip(e));
        this.progressBar.addEventListener("mouseleave", () => this.hideTooltip());

        this.media.addEventListener("timeupdate", () => this.updateProgress());
        this.media.addEventListener("loadedmetadata", () => this.updateDuration());
        this.media.addEventListener("seeked", () => this.updateProgress());

        this.container.addEventListener("keydown", (e) => {
            if (this.media.readyState < 1) return;
            const key = e.key.toLowerCase();
            let handled = true;
            if (e.shiftKey && e.key === "ArrowLeft") this.seekKeyframe(-1);
            else if (e.shiftKey && e.key === "ArrowRight") this.seekKeyframe(1);
            else if (e.key === "ArrowLeft") this.seek(-5);
            else if (e.key === "ArrowRight") this.seek(5);
            else if (key === "d") this.seekFrame(-1);
            else if (key === "f") this.seekFrame(1);
            else if (key === "c") this.subtitleManager.setEnabled(!this.subtitleManager.isEnabled());
            else handled = false;
            if (handled) e.preventDefault();
        });

        this.setupFrameTracking();
        this.updateVolumeIcon();
    }

    private setPlayIcon(icon: "play" | "pause") {
        setIcon(this.playBtn, icon);
    }

    private showControls() {
        this.controls.addClass("is-visible");
        this.clearHideTimer();
    }

    private hideControls() {
        if (this.media.paused) {
            this.showControls();
            return;
        }
        this.clearHideTimer();
        this.hideTimeout = window.setTimeout(() => {
            this.controls.removeClass("is-visible");
            this.hideTimeout = null;
        }, 1000);
    }

    private seek(offset: number) {
        if (!this.media.duration) return;
        this.media.currentTime = Math.max(0, Math.min(this.media.duration, this.media.currentTime + offset));
    }

    private seekFrame(dir: 1 | -1) {
        this.seek(dir * (this.measuredFrameDuration ?? 1 / 30));
    }

    private seekKeyframe(dir: 1 | -1) {
        if (!this.media.duration) return;
        const step = 0.5 * dir;
        const original = this.media.currentTime;
        const target = original + step;
        this.media.addEventListener("seeked", () => {
            if (Math.abs(this.media.currentTime - target) < 0.01) {
                this.media.currentTime = original + step * 5;
            }
        }, { once: true });
        this.media.currentTime = target;
    }

    private setupFrameTracking() {
        const video = this.media as HTMLVideoElement;
        if (!('requestVideoFrameCallback' in video) || this.frameCallbackBound) return;
        this.frameCallbackBound = true;

        const callback = (_now: number, meta: VideoFrameCallbackMetadata) => {
            const t = meta.presentationTime;
            if (this.lastFrameTime !== null) {
                const dur = t - this.lastFrameTime;
                if (dur > 0.001 && dur < 1.0) this.measuredFrameDuration = dur;
            }
            this.lastFrameTime = t;
            if (!this.media.paused) video.requestVideoFrameCallback(callback);
        };

        this.media.addEventListener("play", () => {
            video.requestVideoFrameCallback(callback);
        });
    }

    private resetHideTimer() {
        this.showControls();
        if (!this.media.paused) this.hideControls();
    }

    private clearHideTimer() {
        if (this.hideTimeout !== null) {
            window.clearTimeout(this.hideTimeout);
            this.hideTimeout = null;
        }
    }

    private togglePlay() {
        if (this.media.paused) {
            this.media.play().catch(() => {});
        } else {
            this.media.pause();
        }
    }

    private dispatchMediaEvent(type: string) {
        this.container.dispatchEvent(new CustomEvent(type, {
            bubbles: true,
            detail: { media: this.media },
        }));
    }

    private updateProgress() {
        if (!this.media.duration) return;
        this.progressBar.value = String((this.media.currentTime / this.media.duration) * 100);
        this.currentTimeLabel.textContent = this.formatTime(this.media.currentTime);
    }

    private updateDuration() {
        if (this.media.duration) {
            this.durationLabel.textContent = " / " + this.formatTime(this.media.duration);
        }
        this.updateProgress();
    }

    private formatTime(seconds: number): string {
        if (!isFinite(seconds) || seconds < 0) return "00:00";
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return h > 0
            ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
            : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    private updateVolumeIcon() {
        const vol = this.media.volume;
        const muted = this.media.muted;
        setIcon(this.volumeBtn, muted || vol === 0 ? "volume-off" : vol < 0.33 ? "volume-1" : "volume-2");
        this.volumeSlider.value = muted ? "0" : String(vol);
    }

    private showTooltip(e: MouseEvent) {
        if (!this.media.duration) return;
        const rect = this.progressBar.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        if (!this.tooltip) {
            this.tooltip = createDiv({ cls: "media-tooltip" });
            document.body.appendChild(this.tooltip);
        }
        this.tooltip.textContent = this.formatTime(pct * this.media.duration);
        this.tooltip.style.left = (e.clientX - this.tooltip.offsetWidth / 2) + "px";
        this.tooltip.style.top = (rect.top - 30) + "px";
        this.tooltip.style.display = "block";
    }

    private hideTooltip() {
        if (this.tooltip) this.tooltip.style.display = "none";
    }

    private showSettings(e: MouseEvent) {
        const menu = new Menu();

        menu.addItem((item) => {
            item.setTitle("复制当前时间戳")
                .setIcon("copy")
                .onClick(() => {
                    const ts = this.formatTime(this.media.currentTime);
                    navigator.clipboard.writeText(ts)
                        .then(() => new Notice("时间戳已复制: " + ts))
                        .catch(() => {
                            const ta = document.createElement("textarea");
                            ta.value = ts;
                            document.body.appendChild(ta);
                            ta.select();
                            document.execCommand("copy");
                            ta.remove();
                            new Notice("时间戳已复制: " + ts);
                        });
                });
        });

        menu.addItem((item) => {
            item.setTitle("播放速度")
                .setIcon("speed")
                .onClick(() => {
                    const subMenu = new Menu();
                    [0.5, 0.75, 1.0, 1.25, 1.5, 2.0].forEach(sp =>
                        subMenu.addItem(sub => sub.setTitle(sp + "x").onClick(() => this.media.playbackRate = sp))
                    );
                    this.showMenuAt(subMenu, e.target as HTMLElement);
                });
        });

        if (this.media.tagName === "VIDEO") {
            menu.addItem((item) => {
                item.setTitle("全屏")
                    .setIcon("expand")
                    .onClick(() => {
                        document.fullscreenElement ? document.exitFullscreen().catch(() => {}) : this.container.requestFullscreen?.().catch(() => {});
                    });
            });

            if ('requestPictureInPicture' in this.media) {
                menu.addItem((item) => {
                    item.setTitle("画中画")
                        .setIcon("picture-in-picture")
                        .onClick(() => {
                            document.pictureInPictureElement ? document.exitPictureInPicture?.().catch(() => {}) : (this.media as HTMLVideoElement).requestPictureInPicture?.().catch(() => {});
                        });
                });
            }
        }

        menu.addItem((item) => {
            const isEnabled = this.subtitleManager.isEnabled();
            item.setTitle(isEnabled ? "关闭字幕" : "开启字幕")
                .setIcon("subtitles")
                .onClick(() => {
                    this.subtitleManager.setEnabled(!isEnabled);
                });
        });

        const seekItems = [
            { t: "快退 5 秒", i: "rewind", a: () => this.seek(-5) },
            { t: "快进 5 秒", i: "fast-forward", a: () => this.seek(5) },
            { t: "上一帧", i: "step-back", a: () => this.seekFrame(-1) },
            { t: "下一帧", i: "step-forward", a: () => this.seekFrame(1) },
            { t: "上一关键帧", i: "step-back", a: () => this.seekKeyframe(-1) },
            { t: "下一关键帧", i: "step-forward", a: () => this.seekKeyframe(1) },
        ];
        seekItems.forEach(item => menu.addItem(m => m.setTitle(item.t).setIcon(item.i).onClick(item.a)));

        this.showMenuAt(menu, e.target as HTMLElement);
    }

    private showMenuAt(menu: Menu, target: HTMLElement) {
        const rect = target.getBoundingClientRect();
        menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
        if (document.fullscreenElement === this.container) {
            const el = (menu as any).dom;
            if (el) {
                this.container.appendChild(el);
                el.style.zIndex = '9999';
            }
        }
    }

    private createButton(iconName: string, onClick: (e: MouseEvent) => void): HTMLElement {
        const btn = createEl("button", { cls: "media-btn" });
        setIcon(btn, iconName);
        btn.addEventListener("click", onClick);
        return btn;
    }
}
