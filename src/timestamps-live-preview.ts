import { App, setIcon } from "obsidian";
import {
    EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet,
    WidgetType, MatchDecorator,
} from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { TimestampManager } from "./timestamps";

class TimestampWidget extends WidgetType {
    constructor(
        private timeStr: string,
        private totalSeconds: number,
        private manager: TimestampManager
    ) {
        super();
    }

    eq(other: TimestampWidget): boolean {
        return this.timeStr === other.timeStr
            && this.totalSeconds === other.totalSeconds;
    }

    toDOM(_view: EditorView): HTMLElement {
        const btn = createSpan({ cls: "tsp-timestamp" });
        btn.setAttribute("data-seconds", String(this.totalSeconds));
        btn.setAttribute("role", "button");
        btn.setAttribute("aria-label", `Play from ${this.timeStr}`);

        const icon = createSpan({ cls: "tsp-play-icon" });
        setIcon(icon, "play");
        btn.appendChild(icon);
        btn.appendChild(createSpan({ cls: "tsp-time", text: this.timeStr }));

        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.manager.togglePlay(btn, this.totalSeconds);
        });

        return btn;
    }

    ignoreEvent(): boolean {
        return true;
    }
}

export function createLivePreviewTimestampExtension(app: App, manager: TimestampManager) {
    const matcher = new MatchDecorator({
        regexp: /(?:(?:(\d{1,3}):)?(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?)/g,
        decorate: (add, from, to, match, view) => {
            const cursor = view.state.selection.main;

            // 关键改动：光标所在整行回退为源码
            const line = view.state.doc.lineAt(from);
            if (cursor.from <= line.to && cursor.to >= line.from) return;

            const timeStr = match[0];
            const totalSeconds = manager.parseTimeString(timeStr);
            add(from, to, Decoration.replace({
                widget: new TimestampWidget(timeStr, totalSeconds, manager),
                inclusive: false,
            }));
        },
    });

    const cursorLine = (view: EditorView): number =>
        view.state.doc.lineAt(view.state.selection.main.head).number;

    return Prec.high(ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;
            private lastCursorLine: number;

            constructor(view: EditorView) {
                this.decorations = matcher.createDeco(view);
                this.lastCursorLine = cursorLine(view);
            }

            update(update: ViewUpdate) {
                const newCursorLine = cursorLine(update.view);

                if (
                    update.docChanged ||
                    update.viewportChanged ||
                    newCursorLine !== this.lastCursorLine
                ) {
                    this.decorations = matcher.createDeco(update.view);
                    this.lastCursorLine = newCursorLine;
                }
            }
        },
        { decorations: (v) => v.decorations }
    ));
}