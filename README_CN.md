# Obsidian Timestamp Player

[![GitHub release](https://img.shields.io/github/v/release/blontern/obsidian-timestamp-player)](https://github.com/blontern/obsidian-timestamp-player/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

一款 Obsidian 插件，让你在笔记中嵌入音频/视频播放器，通过时间戳链接快速跳转到指定时间点，支持多媒体区域、自动跟随高亮、媒体吸顶、字幕与歌词等特性。

[English](https://github.com/blontern/obsidian-timestamp-player/blob/master/README.md)

## 演示

假设有如下文档：

```markdown
![[会议录音.ogg]]

张三 00:27
所以核心思路是先搭一个平台...

李四 01:02
对，我们应该先从 MVP 开始。
```

在阅读视图下，每个时间戳变成可点击的 `▶ 00:27` 按钮。点击从该位置播放，再次点击暂停。

![预览](https://raw.githubusercontent.com/blontern/obsidian-timestamp-player/master/assets/preview-cn.png)

## 功能

- **说话人时间戳** — 行首 `说话人 MM:SS` 转为可点击的播放按钮
- **正文时间戳** — 正文中的 `MM:SS` 同样可点击
- **音频与视频** — 支持嵌入音频（mp3、ogg、wav 等）与视频（mp4、mov 等）
- **播放/暂停切换** — 点击 `▶` 播放，点击 `⏸` 暂停，再点恢复播放
- **播放跟踪** — 播放过程中，当前时间戳自动高亮，随播放进度依次往下移动
- **多媒体支持** — 每个媒体文件仅控制其所属区段的时间戳，互不冲突
- **自动检测** — 仅在文档包含嵌入媒体时插件才生效

### 自定义播放器

嵌入的音频/视频会替换为自定义播放器界面：

- 进度条悬停显示当前时间（`hh:mm:ss`），可点击/拖拽跳转
- 音量控制与静音切换
- 设置菜单支持：
  - 复制当前时间戳
  - 调整播放速度（0.5x – 2.0x）
  - 全屏、画中画（视频）
  - 字幕/歌词开关
  - 快退/快进 5 秒、逐帧/关键帧跳转（视频）

#### 键盘快捷键（焦点在播放器上时）

| 按键 | 功能 |
|------|------|
| `←` / `→` | 快退 / 快进 5 秒 |
| `Shift + ←` / `Shift + →` | 上一 / 下一关键帧（视频） |
| `d` / `f` | 逐帧后退 / 前进（视频） |
| `c` | 切换字幕 / 歌词开关 |

### 媒体吸顶（Sticky Media）

滚动时媒体区域自动"吸顶"，固定在视口顶部，方便边看转录边跟随播放：

- 支持**阅读视图**与**实时预览（Live Preview）**两种模式
- 多区域滚动时自动切换当前吸顶的媒体，并正确绑定其下方时间戳

### 字幕与歌词

自动加载与媒体同名的字幕/歌词文件：

- 支持 `.vtt`、`.srt`、`.lrc` 格式
- **视频**：底部显示单行字幕
- **音频**：以**滚动歌词列表**展示，当前播放行高亮并自动滚动至中央；可配合**封面**一起使用

### 音频封面与滚动歌词

- 自动加载与音频同名的图片作为封面（支持 png、jpg、jpeg、gif、webp、svg、bmp、avif 等）
- 无匹配图片时显示默认音乐图标
- 歌词按时间同步滚动，当前行高亮显示

## 时间戳格式

插件识别两种模式：

### 说话人行

时间戳在行末，前面是说话人名称：

```
说话人 MM:SS
下一行是转录内容...
```

### 正文时间戳

时间戳出现在文本任意位置：

```
在 03:15.005 提到的方案已经通过了。
```

支持 `[hh:]mm:ss[.SSS]` 格式，即小时和毫秒格式选填，可直接粘贴 PotPlayer 等软件复制的带毫秒时间戳。

> **注意：** 文档中必须包含至少一个嵌入的媒体文件，插件才会生效。

支持音频格式：mp3、wav、ogg、webm、m4a、flac、3gp
支持视频格式：mp4、mov、avi、mkv、mpeg。

## 多个媒体文件

当文档包含多个媒体文件时，插件会自动将文档分区。每个媒体文件控制其**下方**的时间戳，直到遇到下一个媒体文件（或文档末尾）为止。

```markdown
![[访谈录音-上半场.mp3]]

张三 00:27
上半场的对话内容...

李四 01:02
还是上半场...

![[访谈录音-下半场.mp3]]

张三 00:15
这是下半场的录音...

李四 00:45
也是下半场...
```

| 时间戳 | 对应媒体 |
|--------|----------|
| `00:27`、`01:02` | 访谈录音-上半场.mp3 |
| `00:15`、`00:45` | 访谈录音-下半场.mp3 |

各区段完全独立——不同区段的时间戳可以重叠（例如都有 `00:00`）不会冲突。切换区段时，前一个媒体会自动暂停。

## 安装

> [!tip]
> 原仓库插件与本仓库存在较大差异，请留意下载

### 社区插件市场安装

在 设置 → 第三方插件 中搜索 **Timestamp Player**，或直接访问[插件页面](https://community.obsidian.md/plugins/timestamp-player)安装。

### 手动安装（推荐）

1. 从 [最新 release](https://github.com/blontern/obsidian-timestamp-player/releases) 下载 `main.js`、`styles.css`、`manifest.json`
2. 在 vault 中创建 `.obsidian/plugins/timestamp-player/` 文件夹
3. 将三个文件复制进去
4. 在 设置 → 第三方插件 中启用

## 环境要求

- Obsidian 1.0.0+
- 阅读视图（部分功能，如「媒体吸顶」也支持实时预览模式）

## 许可

MIT — [blontern](https://github.com/blontern)
