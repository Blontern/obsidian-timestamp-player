import { Menu, Notice, setIcon } from "obsidian";

export class CustomMediaPlayer {
    private container: HTMLElement;
    private controls: HTMLElement;
    private progressBar: HTMLInputElement;
    private currentTimeLabel: HTMLElement;
    private durationLabel: HTMLElement;
    private playBtn: HTMLElement;
    private settingsBtn: HTMLElement;
    private tooltip: HTMLElement | null = null;
    private volumeBtn: HTMLElement;
    private volumeSlider: HTMLInputElement;

    private hideTimeout: number | null = null;
    private isMouseOver = false;

    constructor(private media: HTMLMediaElement) {
        this.container = document.createElement("div");
        this.container.className = "custom-media-player";

        // ----- 音频特殊处理：设置最小高度，隐藏媒体元素（无画面） -----
        if (media.tagName === "AUDIO") {
            this.container.style.minHeight = "50px";
            media.style.display = "none";  // 音频无需显示元素，仅用控制栏
        }

        media.parentNode?.insertBefore(this.container, media);
        this.container.appendChild(media);
        media.style.width = "100%";
    }

    build() {
        this.controls = document.createElement("div");
        this.controls.className = "media-controls";

        // ----- 播放按钮 -----
        this.playBtn = this.createButton("play", () => this.togglePlay());
        this.controls.appendChild(this.playBtn);

        // ----- 音量控制 -----
        const volContainer = document.createElement("div");
        volContainer.className = "media-volume-container";
        this.volumeBtn = this.createButton("volume-2", (e) => {
            e.stopPropagation();
            this.media.muted = !this.media.muted;
            this.updateVolumeIcon();
        });
        volContainer.appendChild(this.volumeBtn);

        this.volumeSlider = document.createElement("input");
        this.volumeSlider.type = "range";
        this.volumeSlider.min = "0";
        this.volumeSlider.max = "1";
        this.volumeSlider.step = "0.01";
        this.volumeSlider.className = "media-volume-slider";
        this.volumeSlider.value = String(this.media.volume);
        this.volumeSlider.addEventListener("input", () => {
            const val = parseFloat(this.volumeSlider.value);
            this.media.volume = val;
            this.media.muted = false;
            this.updateVolumeIcon();
        });
        volContainer.appendChild(this.volumeSlider);
        this.controls.appendChild(volContainer);

        // ----- 进度条 -----
        this.progressBar = document.createElement("input");
        this.progressBar.type = "range";
        this.progressBar.min = "0";
        this.progressBar.max = "100";
        this.progressBar.value = "0";
        this.progressBar.className = "media-progress";
        this.controls.appendChild(this.progressBar);

        // ----- 时间标签 -----
        this.currentTimeLabel = document.createElement("span");
        this.currentTimeLabel.className = "media-time";
        this.currentTimeLabel.textContent = "00:00";
        this.controls.appendChild(this.currentTimeLabel);

        this.durationLabel = document.createElement("span");
        this.durationLabel.className = "media-time";
        this.durationLabel.textContent = " / 00:00";
        this.controls.appendChild(this.durationLabel);

        // ----- 设置按钮 -----
        this.settingsBtn = this.createButton("settings", (e) => this.showSettings(e));
        this.controls.appendChild(this.settingsBtn);

        // ----- 将控制栏加入容器 -----
        this.container.appendChild(this.controls);

        // 初始显示控制栏
        this.showControls();

        // ----- 鼠标悬停与自动隐藏 -----
        this.container.addEventListener("mouseenter", () => {
            this.isMouseOver = true;
            this.showControls();
        });
        this.container.addEventListener("mouseleave", () => {
            this.isMouseOver = false;
            if (!this.media.paused) this.hideControls();
        });
        this.container.addEventListener("mousemove", () => this.resetHideTimer());

        // ----- 媒体事件监听 -----
        this.media.addEventListener("play", () => {
            setIcon(this.playBtn, "pause");
            this.dispatchMediaEvent('media-play');
            if (!this.isMouseOver) {
                this.hideControls();
            }
        });
        this.media.addEventListener("pause", () => {
            setIcon(this.playBtn, "play");
            this.dispatchMediaEvent('media-pause');
            this.showControls();
            this.clearHideTimer();
        });
        this.media.addEventListener("ended", () => {
            setIcon(this.playBtn, "play");
            this.dispatchMediaEvent('media-pause');
        });

        // ----- 点击媒体切换播放 -----
        this.media.addEventListener("click", () => this.togglePlay());

        // ----- 进度条事件 -----
        this.progressBar.addEventListener("input", () => {
            const pct = parseFloat(this.progressBar.value) / 100;
            this.media.currentTime = pct * this.media.duration;
        });
        this.progressBar.addEventListener("click", (e) => {
            const rect = this.progressBar.getBoundingClientRect();
            const pct = (e.clientX - rect.left) / rect.width;
            this.media.currentTime = Math.max(0, pct * this.media.duration);
        });
        this.progressBar.addEventListener("mousemove", (e) => this.showTooltip(e));
        this.progressBar.addEventListener("mouseleave", () => this.hideTooltip());

        // ----- 媒体事件 -----
        this.media.addEventListener("timeupdate", () => this.updateProgress());
        this.media.addEventListener("loadedmetadata", () => this.updateDuration());
        this.media.addEventListener("seeked", () => this.updateProgress());

        this.updateVolumeIcon();
    }

    // ----- 控制栏显隐 -----
    private showControls() {
        this.controls.classList.add("is-visible");
        this.clearHideTimer();
    }

    private hideControls() {
        if (this.media.paused) {
            this.showControls();
            return;
        }
        if (this.hideTimeout === null) {
            this.hideTimeout = window.setTimeout(() => {
                this.controls.classList.remove("is-visible");
                this.hideTimeout = null;
            }, 1000);
        }
    }

    private resetHideTimer() {
        this.clearHideTimer();
        if (!this.controls.classList.contains("is-visible")) {
            this.showControls();
        }
        if (!this.media.paused) {
            this.hideControls();
        }
    }

    private clearHideTimer() {
        if (this.hideTimeout !== null) {
            window.clearTimeout(this.hideTimeout);
            this.hideTimeout = null;
        }
    }

    // ----- 播放控制 -----
    private togglePlay() {
        if (this.media.paused) {
            this.media.play().catch(() => {});
        } else {
            this.media.pause();
        }
    }

    // ----- 同步时间戳播放状态 -----
    private dispatchMediaEvent(type: string) {
        const event = new CustomEvent(type, {
            bubbles: true,
            detail: { media: this.media }
        });
        this.container.dispatchEvent(event);
    }

    private updateProgress() {
        if (!this.media.duration) return;
        const pct = (this.media.currentTime / this.media.duration) * 100;
        this.progressBar.value = String(pct);
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
        let icon = "volume-2";
        if (muted || vol === 0) icon = "volume-off";
        else if (vol < 0.33) icon = "volume-1";
        else icon = "volume-2";
        setIcon(this.volumeBtn, icon);
        this.volumeSlider.value = muted ? "0" : String(vol);
    }

    private showTooltip(e: MouseEvent) {
        if (!this.media.duration) return;
        const rect = this.progressBar.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const seconds = pct * this.media.duration;
        if (!this.tooltip) {
            this.tooltip = document.createElement("div");
            this.tooltip.className = "media-tooltip";
            document.body.appendChild(this.tooltip);
        }
        this.tooltip.textContent = this.formatTime(seconds);
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
                            const textarea = document.createElement("textarea");
                            textarea.value = ts;
                            document.body.appendChild(textarea);
                            textarea.select();
                            document.execCommand("copy");
                            textarea.remove();
                            new Notice("时间戳已复制: " + ts);
                        });
                });
        });

        menu.addItem((item) => {
            item.setTitle("播放速度")
                .setIcon("speed")
                .onClick(() => {
                    const subMenu = new Menu();
                    [0.5, 0.75, 1.0, 1.25, 1.5, 2.0].forEach(sp => {
                        subMenu.addItem(sub => sub.setTitle(sp + "x").onClick(() => this.media.playbackRate = sp));
                    });
                    const rect = (e.target as HTMLElement).getBoundingClientRect();
                    subMenu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
                });
        });

        if (this.media.tagName === "VIDEO") {
            menu.addItem((item) => {
                item.setTitle("全屏")
                    .setIcon("expand")
                    .onClick(() => {
                        if (document.fullscreenElement) {
                            document.exitFullscreen().catch(() => {});
                        } else {
                            this.container.requestFullscreen?.().catch(() => {});
                        }
                    });
            });

            if ('requestPictureInPicture' in this.media) {
                menu.addItem((item) => {
                    item.setTitle("画中画")
                        .setIcon("picture-in-picture")
                        .onClick(() => {
                            if (document.pictureInPictureElement) {
                                document.exitPictureInPicture?.().catch(() => {});
                            } else {
                                (this.media as HTMLVideoElement).requestPictureInPicture?.().catch(() => {});
                            }
                        });
                });
            }
        }

        const rect = (e.target as HTMLElement).getBoundingClientRect();
        menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
    }

    private createButton(iconName: string, onClick: (e: MouseEvent) => void): HTMLElement {
        const btn = document.createElement("button");
        btn.className = "media-btn";
        setIcon(btn, iconName);
        btn.addEventListener("click", onClick);
        return btn;
    }
}