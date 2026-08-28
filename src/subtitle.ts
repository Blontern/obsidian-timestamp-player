import { App, TFile } from "obsidian";

interface SubtitleEntry {
    start: number;
    end?: number;
    text: string;
}

export class SubtitleManager {
    private container: HTMLElement;
    private textElement: HTMLElement;
    private entries: SubtitleEntry[] = [];
    private updateBound: () => void;
    private enabled: boolean = true;

    constructor(
        private media: HTMLMediaElement,
        parent: HTMLElement,
        private app: App
    ) {
        // 创建字幕容器（绝对定位，覆盖在媒体上）
        this.container = document.createElement('div');
        this.container.className = 'tsp-subtitle-container';
        this.textElement = document.createElement('div');
        this.textElement.className = 'tsp-subtitle-text';
        this.container.appendChild(this.textElement);
        parent.appendChild(this.container);

        // 绑定 timeupdate 事件
        this.updateBound = this.updateSubtitle.bind(this);
        this.media.addEventListener('timeupdate', this.updateBound);

        // 异步加载字幕
        this.loadSubtitles().catch(console.error);
    }

    // 设置启用状态
    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        this.container.style.display = enabled ? '' : 'none';
    }

    // 获取启用状态
    isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * 根据当前媒体查找同名字幕文件（.vtt, .srt, .lrc）并加载
     */
    private async loadSubtitles() {
        const baseName = this.getBaseName();
        if (!baseName) return;

        const files = this.app.vault.getFiles();
        const candidates = files.filter(f => {
            const ext = f.extension.toLowerCase();
            return ['vtt', 'srt', 'lrc'].includes(ext) && f.name.startsWith(baseName + '.');
        });

        if (candidates.length === 0) return;

        // 简单选择第一个（可按需优化：优先同目录）
        const chosen = candidates[0];
        const content = await this.app.vault.read(chosen);
        this.entries = this.parseSubtitle(content, chosen.extension);
        // 立即更新一次
        this.updateSubtitle();
    }

    /**
     * 从媒体元素或嵌入元素中提取基础文件名（不含扩展名）
     */
    private getBaseName(): string {
        // 1. 从最近的 .internal-embed 获取 data-src（Obsidian 内部链接属性）
        const embed = this.media.closest('.internal-embed');
        if (embed) {
            const src = embed.getAttribute('src') || '';
            const parts = src.split('/');
            const file = parts[parts.length - 1];
            const extIndex = file.lastIndexOf('.');
            if (extIndex > 0) return file.substring(0, extIndex);
            return file;
        }

        // 2. 从 media.src 解析
        try {
            const src = this.media.src;
            if (src && !src.startsWith('blob:')) {
                const url = new URL(src, location.href);
                const pathname = url.pathname;
                const filename = pathname.split('/').pop() || '';
                const extIndex = filename.lastIndexOf('.');
                if (extIndex > 0) return filename.substring(0, extIndex);
                return filename;
            }
        } catch {}

        return '';
    }

    /**
     * 根据扩展名选择解析器
     */
    private parseSubtitle(content: string, ext: string): SubtitleEntry[] {
        if (ext === 'vtt' || ext === 'srt') {
            return this.parseSrtVtt(content);
        } else if (ext === 'lrc') {
            return this.parseLrc(content);
        }
        return [];
    }

    /**
     * 解析 SRT 或 VTT 格式（VTT 的头部会被自动忽略）
     */
    private parseSrtVtt(content: string): SubtitleEntry[] {
        const lines = content.split(/\r?\n/);
        const entries: SubtitleEntry[] = [];
        let i = 0;

        while (i < lines.length) {
            // 跳过空行
            if (lines[i].trim() === '') { i++; continue; }

            // 尝试匹配时间行： 00:00:00,000 --> 00:00:03,000
            const timeMatch = lines[i].match(
                /(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/
            );
            if (timeMatch) {
                const start = this.parseTime(timeMatch[1]);
                const end = this.parseTime(timeMatch[2]);
                i++;

                // 收集文本行（直到空行或下一个时间行）
                const textLines: string[] = [];
                while (i < lines.length) {
                    const line = lines[i];
                    if (line.trim() === '') break;
                    // 防止将下一个时间行误认为文本
                    if (line.match(/\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/)) break;
                    textLines.push(line.trim());
                    i++;
                }

                if (textLines.length > 0) {
                    entries.push({
                        start,
                        end,
                        text: textLines.join(' ')
                    });
                }
                // i 可能停在空行，下次循环会跳过
            } else {
                i++;
            }
        }
        return entries;
    }

    /**
     * 解析 LRC 格式（[mm:ss.cc] 歌词）
     */
    private parseLrc(content: string): SubtitleEntry[] {
        const lines = content.split(/\r?\n/);
        const entries: SubtitleEntry[] = [];
        // 匹配 [mm:ss.cc] 或 [mm:ss.ff]
        const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2})\]/;

        for (const line of lines) {
            const match = line.match(timeRegex);
            if (match) {
                const minutes = parseInt(match[1]);
                const seconds = parseInt(match[2]);
                const centiseconds = parseInt(match[3]);
                const start = minutes * 60 + seconds + centiseconds / 100;

                // 移除所有时间标签，获取纯文本
                const text = line.replace(/\[.*?\]/g, '').trim();
                if (text) {
                    entries.push({ start, text });
                }
            }
        }
        return entries;
    }

    /**
     * 将时间字符串（如 "00:01:23,456"）转换为秒数（浮点数）
     */
    private parseTime(timeStr: string): number {
        // 统一将逗号替换为点
        const normalized = timeStr.replace(',', '.');
        const parts = normalized.split(':');
        if (parts.length === 3) {
            const hours = parseInt(parts[0]);
            const minutes = parseInt(parts[1]);
            const secParts = parts[2].split('.');
            const seconds = parseInt(secParts[0]);
            const millis = secParts.length > 1
                ? parseInt(secParts[1].padEnd(3, '0').substring(0, 3))
                : 0;
            return hours * 3600 + minutes * 60 + seconds + millis / 1000;
        }
        return 0;
    }

    /**
     * 根据当前播放时间更新字幕显示
     */
    private updateSubtitle() {
        const currentTime = this.media.currentTime;
        let best: SubtitleEntry | null = null;

        // 从后向前查找最后一个 start <= currentTime 且 (end 未定义或 currentTime < end) 的条目
        for (let i = this.entries.length - 1; i >= 0; i--) {
            const entry = this.entries[i];
            if (entry.start <= currentTime) {
                if (entry.end === undefined || currentTime < entry.end) {
                    best = entry;
                    break;
                }
            }
        }

        this.textElement.textContent = best ? best.text : '';
    }

    /**
     * 清理资源（移除事件监听和DOM元素）
     */
    destroy() {
        this.media.removeEventListener('timeupdate', this.updateBound);
        this.container.remove();
    }
}