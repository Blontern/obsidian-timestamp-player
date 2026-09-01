import { App, setIcon } from "obsidian";

interface SubtitleEntry {
    start: number;
    end?: number;
    text: string;
}

export class SubtitleManager {
    private container: HTMLElement;
    private textElement: HTMLElement | null = null;
    private area: HTMLElement | null = null;
    private coverEl: HTMLElement | null = null;
    private lyricLines: HTMLElement[] = [];
    private entries: SubtitleEntry[] = [];
    private updateBound: () => void;
    private enabled: boolean = true;
    private activeIndex = -1;
    private readonly isAudio: boolean;

    constructor(
        private media: HTMLMediaElement,
        parent: HTMLElement,
        private app: App
    ) {
        this.isAudio = media.tagName === "AUDIO";
        // 根据媒体类型创建容器：音频为封面+歌词滚动区，视频为底部单行字幕
        this.container = createDiv({ cls: this.isAudio ? "tsp-lyrics-container" : "tsp-subtitle-container" });
        if (this.isAudio) {
            this.area = createDiv({ cls: "tsp-lyrics-area" });
            this.coverEl = createDiv({ cls: "tsp-lyrics-cover" });
            setIcon(this.coverEl, "music");
            this.area.appendChild(this.coverEl);
            this.area.appendChild(this.container);
        } else {
            this.textElement = createDiv({ cls: "tsp-subtitle-text" });
            this.container.appendChild(this.textElement);
        }
        parent.insertBefore(this.area ?? this.container, parent.firstChild);

        // 绑定 timeupdate 事件
        this.updateBound = this.updateSubtitle.bind(this);
        this.media.addEventListener('timeupdate', this.updateBound);

        // 异步加载字幕
        this.loadSubtitles().catch(console.error);
    }

    // 设置启用状态
    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        (this.area ?? this.container).style.display = enabled ? '' : 'none';
    }

    // 获取启用状态
    isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * 查找与媒体同名的封面图片与字幕/歌词文件（.vtt, .srt, .lrc）并加载
     * 一次遍历同时匹配封面与字幕，避免多次扫描整个库
     */
    private async loadSubtitles() {
        const baseName = this.getBaseName();
        if (!baseName) return;

        const prefix = baseName + '.';
        const sameName = this.app.vault.getFiles().filter(f => f.name.startsWith(prefix));

        // 封面：同名图片优先，否则保留 music 图标（仅音频）
        const image = sameName.find(f =>
            ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(f.extension.toLowerCase())
        );
        if (image && this.coverEl) {
            this.coverEl.empty();
            this.coverEl.createEl('img', { attr: { src: this.app.vault.getResourcePath(image) } });
        }

        // 字幕/歌词：vtt / srt / lrc 任一格式
        const chosen = sameName.find(f =>
            ['vtt', 'srt', 'lrc'].includes(f.extension.toLowerCase())
        );
        
        if (!chosen) { this.container.hide(); return; }

        const content = await this.app.vault.read(chosen);
        this.entries = this.parseSubtitle(content, chosen.extension);
        if (this.isAudio) this.renderLyrics();
        this.updateSubtitle();
    }

    /**
     * 从媒体元素或嵌入元素中提取基础文件名（不含扩展名）
     */
    private getBaseName(): string {
        // 1. 从最近的 .internal-embed 获取 src（Obsidian 内部链接属性）
        const src = this.media.closest('.internal-embed')?.getAttribute('src');
        if (src) return this.stripExt(src.split('/').pop() || '');

        // 2. 从 media.src 解析
        try {
            const url = this.media.src;
            if (url && !url.startsWith('blob:')) {
                const name = new URL(url, location.href).pathname.split('/').pop() || '';
                return this.stripExt(name);
            }
        } catch {}

        return '';
    }

    // 去除文件名扩展名（无扩展名时原样返回）
    private stripExt(name: string): string {
        const i = name.lastIndexOf('.');
        return i > 0 ? name.substring(0, i) : name;
    }

    /**
     * 根据扩展名选择解析器
     */
    private parseSubtitle(content: string, ext: string): SubtitleEntry[] {
        if (ext === 'vtt' || ext === 'srt') return this.parseSrtVtt(content);
        if (ext === 'lrc') return this.parseLrc(content);
        return [];
    }

    /**
     * 解析 SRT 或 VTT 格式（VTT 的头部会被自动忽略）
     */
    private parseSrtVtt(content: string): SubtitleEntry[] {
        const lines = content.split(/\r?\n/);
        const entries: SubtitleEntry[] = [];
        // 时间行正则： 00:00:00,000 --> 00:00:03,000
        const timeRe = /(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/;
        let i = 0;

        while (i < lines.length) {
            // 跳过空行与非时间行
            const timeMatch = lines[i].match(timeRe);
            if (!timeMatch) { i++; continue; }

            const start = this.parseTime(timeMatch[1]);
            const end = this.parseTime(timeMatch[2]);

            // 收集文本行（直到空行或下一个时间行）
            const textLines: string[] = [];
            i++;
            while (i < lines.length) {
                const line = lines[i].trim();
                if (!line || line.match(timeRe)) break;
                textLines.push(line);
                i++;
            }

            if (textLines.length > 0) {
                entries.push({ start, end, text: textLines.join(' ') });
            }
        }
        return entries;
    }

    /**
     * 解析 LRC 格式（[mm:ss.cc] 歌词）
     */
    private parseLrc(content: string): SubtitleEntry[] {
        const entries: SubtitleEntry[] = [];
        // 匹配 [mm:ss.cc] 或 [mm:ss.ff]
        for (const line of content.split(/\r?\n/)) {
            const m = line.match(/\[(\d{2}):(\d{2})\.(\d{2})\]/);
            if (!m) continue;
            // 移除所有时间标签，获取纯文本
            const text = line.replace(/\[.*?\]/g, '').trim();
            if (text) {
                entries.push({
                    start: +m[1] * 60 + +m[2] + +m[3] / 100,
                    text,
                });
            }
        }
        return entries;
    }

    /**
     * 将时间字符串（如 "00:01:23,456"）转换为秒数（浮点数）
     */
    private parseTime(timeStr: string): number {
        // 统一将逗号替换为点
        const parts = timeStr.replace(',', '.').split(':');
        if (parts.length !== 3) return 0;
        const [h, m] = parts;
        const [s, ms] = parts[2].split('.');
        const millis = ms ? parseInt(ms.padEnd(3, '0').substring(0, 3)) : 0;
        return parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + millis / 1000;
    }

    /**
     * 渲染歌词列表（仅音频）
     */
    private renderLyrics() {
        this.container.empty();
        this.lyricLines = this.entries.map(e =>
            this.container.createDiv({ cls: "tsp-lyric-line", text: e.text })
        );
    }

    /**
     * 根据当前播放时间更新字幕或歌词显示
     */
    private updateSubtitle() {
        const currentTime = this.media.currentTime;
        let bestIndex = -1;
        // 从后向前查找最后一个 start <= currentTime 且 (end 未定义或 currentTime < end) 的条目
        for (let i = this.entries.length - 1; i >= 0; i--) {
            const entry = this.entries[i];
            if (entry.start <= currentTime && (entry.end === undefined || currentTime < entry.end)) {
                bestIndex = i;
                break;
            }
        }

        if (this.isAudio) {
            this.setActiveLyric(bestIndex);
        } else if (this.textElement) {
            this.textElement.textContent = bestIndex >= 0 ? this.entries[bestIndex].text : '';
        }
    }

    /**
     * 高亮当前活动歌词行并滚动到可视区域
     */
    private setActiveLyric(index: number) {
        if (index === this.activeIndex) return;
        const prev = this.lyricLines[this.activeIndex];
        if (prev) prev.removeClass("active");
        this.activeIndex = index;
        const cur = this.lyricLines[index];
        if (cur) {
            cur.addClass("active");
            this.scrollLyricIntoView(cur);
        }
    }

    /**
     * 将歌词行滚动到容器中央
     */
    private scrollLyricIntoView(el: HTMLElement) {
        const top = el.offsetTop - this.container.clientHeight / 2 + el.clientHeight / 2;
        this.container.scrollTop = Math.max(0, top);
    }

    /**
     * 清理资源（移除事件监听和DOM元素）
     */
    destroy() {
        this.media.removeEventListener('timeupdate', this.updateBound);
        (this.area ?? this.container).remove();
    }
}