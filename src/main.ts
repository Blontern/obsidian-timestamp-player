import { Plugin, MarkdownPostProcessorContext, TFile } from "obsidian";
import { StickyMediaManager } from "./sticky-media";
import { TimestampManager } from "./timestamps";
import { createLivePreviewTimestampExtension } from "./timestamps-live-preview";

const MEDIA_EMBED_RE = /!\[\[.+?\.(mp3|webm|wav|m4a|ogg|3gp|flac|mp4|mov|avi|mkv|mpeg)\]\]/i;

export default class TimestampPlayerPlugin extends Plugin {
    private stickyManager: StickyMediaManager;
    private timestampManager: TimestampManager;

    onload() {
        this.stickyManager = new StickyMediaManager(this.app);
        this.stickyManager.initialize();
        this.timestampManager = new TimestampManager(this.app, this.stickyManager);

        this.registerMarkdownPostProcessor(
            async (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
                if (!(await this.hasMediaEmbed(ctx))) return;
                this.timestampManager.processTimestamps(el);
                this.timestampManager.rewriteMediaElements(el);
                this.stickyManager.setupForElement(el);
            }
        );

        this.registerEditorExtension(
            createLivePreviewTimestampExtension(this.app, this.timestampManager)
        );

        this.registerEvent(
            this.app.workspace.on("layout-change", () => this.stickyManager.scan())
        );
    }

    onunload() {
        this.timestampManager.clearPlaybackState();
        this.stickyManager.destroy();
    }

    private async hasMediaEmbed(ctx: MarkdownPostProcessorContext): Promise<boolean> {
        const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
        if (!(file instanceof TFile)) return false;
        const content = await this.app.vault.cachedRead(file);
        return MEDIA_EMBED_RE.test(content);
    }
}
