import { Menu, Notice, setIcon } from "obsidian";

export class CustomMediaPlayer {
    private container: HTMLElement;
    private progressBar: HTMLInputElement;
    private currentTimeLabel: HTMLElement;
    private durationLabel: HTMLElement;
    private playBtn: HTMLElement;
    private settingsBtn: HTMLElement;
    private tooltip: HTMLElement | null = null;

    constructor(private media: HTMLMediaElement) {
        this.container = document.createElement("div");
        this.container.className = "custom-media-player";
        media.parentNode?.insertBefore(this.container, media);
        this.container.appendChild(media);
        media.style.width = "100%";
    }

    build() {
        const controls = document.createElement("div");
        controls.className = "media-controls";

        // Play/pause button
        this.playBtn = this.createButton("play", () => this.togglePlay());
        controls.appendChild(this.playBtn);

        // Progress bar
        this.progressBar = document.createElement("input");
        this.progressBar.type = "range";
        this.progressBar.min = "0";
        this.progressBar.max = "100";
        this.progressBar.value = "0";
        this.progressBar.className = "media-progress";
        controls.appendChild(this.progressBar);

        // Time labels
        this.currentTimeLabel = document.createElement("span");
        this.currentTimeLabel.className = "media-time";
        this.currentTimeLabel.textContent = "00:00";
        controls.appendChild(this.currentTimeLabel);

        this.durationLabel = document.createElement("span");
        this.durationLabel.className = "media-time";
        this.durationLabel.textContent = " / 00:00";
        controls.appendChild(this.durationLabel);

        // Settings button
        this.settingsBtn = this.createButton("settings", (e) => this.showSettings(e));
        controls.appendChild(this.settingsBtn);

        this.container.appendChild(controls);

        // Progress bar events
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

        // Media events
        this.media.addEventListener("timeupdate", () => this.updateProgress());
        this.media.addEventListener("loadedmetadata", () => this.updateDuration());

        // Update play/pause icon on state changes
        this.media.addEventListener("play", () => {
            setIcon(this.playBtn, "pause");
        });
        this.media.addEventListener("pause", () => {
            setIcon(this.playBtn, "play");
        });
        this.media.addEventListener("ended", () => {
            setIcon(this.playBtn, "play");
        });

        // Update progress bar when seeking externally (e.g., timestamp click)
        this.media.addEventListener("seeked", () => this.updateProgress());
    }

    private togglePlay() {
        if (this.media.paused) {
            this.media.play().catch(() => {});
        } else {
            this.media.pause();
        }
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
        if (h > 0) {
            return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        } else {
            return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
    }

    private showTooltip(e: MouseEvent) {
        if (!this.media.duration) return;
        const rect = this.progressBar.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const seconds = pct * this.media.duration;
        const timeStr = this.formatTime(seconds);

        if (!this.tooltip) {
            this.tooltip = document.createElement("div");
            this.tooltip.className = "media-tooltip";
            document.body.appendChild(this.tooltip);
        }
        this.tooltip.textContent = timeStr;
        this.tooltip.style.left = (e.clientX - this.tooltip.offsetWidth / 2) + "px";
        this.tooltip.style.top = (rect.top - 30) + "px";
        this.tooltip.style.display = "block";
    }

    private hideTooltip() {
        if (this.tooltip) {
            this.tooltip.style.display = "none";
        }
    }

    private showSettings(e: MouseEvent) {
        const menu = new Menu();
        menu.addItem((item) => {
            item.setTitle("复制当前时间戳")
                .setIcon("copy")
                .onClick(() => {
                    const ts = this.formatTime(this.media.currentTime);
                    navigator.clipboard.writeText(ts).then(() => {
                        new Notice("时间戳已复制: " + ts);
                    }).catch(() => {
                        // Fallback
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
                    const speeds = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
                    for (const sp of speeds) {
                        subMenu.addItem((sub) => {
                            sub.setTitle(sp + "x")
                                .onClick(() => {
                                    this.media.playbackRate = sp;
                                });
                        });
                    }
                    // 显示子菜单在相同位置
                    const rect = (e.target as HTMLElement).getBoundingClientRect();
                    subMenu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
                });
        });

        // 显示主菜单
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