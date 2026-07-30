export class StickyMediaController {
	constructor(
		private readonly media: HTMLMediaElement,
		private readonly scrollEl: HTMLElement,
		private readonly hostEl: HTMLElement,
	) {}

	attach(): void {}

	refresh(): void {}

	destroy(): void {}
}
