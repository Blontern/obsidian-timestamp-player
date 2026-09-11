import { Plugin, MarkdownPostProcessorContext, TFile } from "obsidian";
import { StickyMediaManager } from "./sticky-media";
import { TimestampManager } from "./timestamps";
import { createLivePreviewTimestampExtension } from "./timestamps-live-preview";

const MEDIA_EMBED_RE = /!\[\[.+?\.(mp3|webm|wav|m4a|ogg|3gp|flac|mp4|mov|avi|mkv|mpeg)\]\]/i;

export default class TimestampPlayerPlugin extends Plugin {
    private stickyManager: StickyMediaManager;
    private timestampManager: TimestampManager;
    private mediaObserver: MutationObserver | null = null;

    onload() {
        this.stickyManager = new StickyMediaManager(this.app);
        this.stickyManager.initialize();
        this.timestampManager = new TimestampManager(this.app, this.stickyManager);

        // 阅读模式 / 嵌入块的常规路径
        this.registerMarkdownPostProcessor(
            async (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
                if (!(await this.hasMediaEmbed(ctx))) return;
                this.timestampManager.processTimestamps(el);
                this.timestampManager.rewriteMediaElements(el);
                this.stickyManager.setupForElement(el);
            }
        );

        // 实时预览的时间戳渲染
        this.registerEditorExtension(
            createLivePreviewTimestampExtension(this.app, this.timestampManager)
        );

        this.registerEvent(
            this.app.workspace.on("layout-change", () => this.stickyManager.scan())
        );

        // 兜底：监听动态插入的媒体元素（覆盖实时预览路径）
        this.setupMediaObserver();
    }

    onunload() {
        this.timestampManager.clearPlaybackState();
        this.stickyManager.destroy();
        this.mediaObserver?.disconnect();
        this.mediaObserver = null;
    }

    private setupMediaObserver() {
        const root = this.app.workspace.containerEl;

        this.mediaObserver = new MutationObserver((mutations) => {
            const added: HTMLMediaElement[] = [];

            for (const m of mutations) {
                for (const node of Array.from(m.addedNodes)) {
                    if (!(node instanceof HTMLElement)) continue;

                    if (node.matches("audio, video")) {
                        added.push(node as HTMLMediaElement);
                    } else {
                        const nested = node.querySelectorAll<HTMLMediaElement>("audio, video");
                        for (const media of Array.from(nested)) added.push(media);
                    }
                }
            }

            if (added.length === 0) return;

            for (const media of added) {
                // 只处理位于 Markdown 视图内的媒体
                if (!media.closest(".markdown-preview-view, .cm-scroller")) continue;
                // 已被包装过的会因属性检查跳过
                this.timestampManager.wrapMediaElement(media);
                this.stickyManager.setupForElement(media);
            }
        });

        this.mediaObserver.observe(root, { childList: true, subtree: true });
    }

    private async hasMediaEmbed(ctx: MarkdownPostProcessorContext): Promise<boolean> {
        const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
        if (!(file instanceof TFile)) return false;
        const content = await this.app.vault.cachedRead(file);
        return MEDIA_EMBED_RE.test(content);
    }
}