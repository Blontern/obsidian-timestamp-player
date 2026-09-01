# Obsidian Timestamp Player

[![GitHub release](https://img.shields.io/github/v/release/blontern/obsidian-timestamp-player)](https://github.com/blontern/obsidian-timestamp-player/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

An Obsidian plugin that embeds audio/video players in your notes with timestamp links for instant seeking — supports multiple media regions, auto-follow highlighting, sticky media, subtitles and lyrics.

[中文文档](https://github.com/blontern/obsidian-timestamp-player/blob/master/README_CN.md)

## Demo

Given a document like this:

```markdown
![[meeting-recording.ogg]]

Alice 00:27
So the main idea is to build a platform that connects...

Bob 01:02
Right, and we should probably start with the MVP first.
```

In reading view, each timestamp becomes a clickable `▶ 00:27` button. Click to play from that position; click again to pause.

![Preview](https://raw.githubusercontent.com/blontern/obsidian-timestamp-player/master/assets/preview-cn.png)

## Features

- **Speaker line timestamps** — `SpeakerName MM:SS` at the start of a line becomes a clickable play button
- **Inline timestamps** — `MM:SS` anywhere in text is also clickable
- **Audio and video** — supports embedded audio (mp3, ogg, wav, etc.) and video (mp4, mov, etc.)
- **Play / pause toggle** — click `▶` to play, click `⏸` to pause, click again to resume
- **Playback follow-along** — the current timestamp auto-highlights and progresses as the media plays
- **Multiple media files** — each media controls only the timestamps in its own section, without conflicts
- **Auto-detection** — the plugin only activates on documents that contain embedded media

### Custom Player

Embedded audio/video is replaced with a custom player interface:

- Progress bar shows the current time (`hh:mm:ss`) on hover; click or drag to seek
- Volume control and mute toggle
- The settings menu supports:
  - Copy current timestamp
  - Adjust playback speed (0.5x – 2.0x)
  - Fullscreen, picture-in-picture (video)
  - Subtitle / lyrics toggle
  - Rewind / fast-forward 5 seconds, frame / keyframe stepping (video)

#### Keyboard shortcuts (when the player is focused)

| Key | Action |
|-----|--------|
| `←` / `→` | Rewind / fast-forward 5 seconds |
| `Shift + ←` / `Shift + →` | Previous / next keyframe (video) |
| `d` / `f` | Step back / forward one frame (video) |
| `c` | Toggle subtitles / lyrics |

### Sticky Media

The media area automatically "sticks" to the top of the viewport while scrolling, so you can follow the transcription and playback at the same time:

- Works in both **Reading view** and **Live Preview**
- Automatically switches the sticky media between regions while scrolling, correctly binding the timestamps below it

### Subtitles & Lyrics

Automatically loads subtitle/lyrics files with the same name as the media:

- Supports `.vtt`, `.srt`, `.lrc` formats
- **Video**: shows a single-line subtitle at the bottom
- **Audio**: displays a **scrolling lyrics list** — the current line highlights and auto-scrolls to the center; works together with the cover

### Audio Cover & Scrolling Lyrics

- Automatically loads an image with the same name as the audio as the cover (supports png, jpg, jpeg, gif, webp, svg, bmp, avif, etc.)
- Shows a default music icon when no matching image is found
- Lyrics scroll in sync with playback, with the current line highlighted

## Timestamp Format

The plugin recognizes the following patterns:

### Speaker lines

Timestamp at the end of a line, preceded by a speaker name:

```
SpeakerName MM:SS
Transcript content on the next line...
```

### Inline timestamps

Timestamp appearing anywhere within text:

```
As mentioned at 03:15, the proposal was approved.
```

### PotPlayer-style (with milliseconds)

Supports the `[hh:]mm:ss[.SSS]` format (e.g., `00:27.500`), so you can paste millisecond-precision timestamps copied from PotPlayer and similar software.

> **Note:** The document must contain at least one embedded media file (`![[file.mp3]]`, `![[file.mp4]]`, `![[file.ogg]]`, `![[file.wav]]`, etc.) for the plugin to activate. Supported formats: mp3, wav, ogg, webm, m4a, flac, 3gp (audio), mp4, mov, avi, mkv, mpeg (video).

## Multiple Media Files

When a document contains more than one media file, the plugin automatically partitions the document into sections. Each media file controls the timestamps that appear **below it**, up until the next media file (or the end of the document).

```markdown
![[interview-part1.mp3]]

Alice 00:27
First part of the conversation...

Bob 01:02
Still part one...

![[interview-part2.mp3]]

Alice 00:15
This is the second recording...

Bob 00:45
Also in part two...
```

| Timestamp | Media file |
|-----------|------------|
| `00:27`, `01:02` | interview-part1.mp3 |
| `00:15`, `00:45` | interview-part2.mp3 |

Sections are fully independent — timestamps can overlap across sections (e.g., both can have `00:00`) without conflict. When switching between sections, the previous media is automatically paused.

## Installation

### Community plugins (recommended)

Search for **Timestamp Player** in Settings → Community plugins, or install directly from [the plugin page](https://community.obsidian.md/plugins/timestamp-player).

### Manual

1. Download `main.js`, `styles.css`, `manifest.json` from the [latest release](https://github.com/blontern/obsidian-timestamp-player/releases)
2. Create `.obsidian/plugins/timestamp-player/` in your vault
3. Copy the three files into it
4. Enable in Settings → Community plugins

## Requirements

- Obsidian 1.0.0+
- Reading view and Live Preview (sticky media works in both modes)

## License

MIT — [blontern](https://github.com/blontern)
