# Nyx Player

A production-grade custom YouTube player with zero branding, event-driven frame masking, and premium glassmorphic UI.

**Paste a YouTube URL → Nyx loads the video → only the custom Nyx player is visible.**

## Features

### YouTube URL Input
- Paste any YouTube URL (standard, short, embed, shorts)
- Automatic video ID extraction
- Dynamic video loading without page refresh
- Clean error handling for invalid URLs

### Zero YouTube Branding
- No visible YouTube logo, title card, or avatar
- No native YouTube controls or overlays
- No YouTube end-screen recommendations
- Completely custom player interface

### Event-Driven Masking
- Opaque cover curtain during loading/seeking
- Drops only when playhead demonstrably advances (not timer-based)
- Eliminates YouTube's pre-roll title/avatar flash
- Smooth transitions with no visual artifacts

### Premium Visual Design
- Deep obsidian dark theme
- Subtle glassmorphism with `backdrop-filter: blur(12px)`
- Restrained shadows and borders
- Polished micro-interactions

### Full-Featured Controls
- **Play/Pause** — button and big-play affordance
- **Seek** — scrub bar with hover preview and buffered indicator
- **Volume** — expandable slider with mute toggle
- **Playback Speed** — 0.5×, 1×, 1.25×, 1.5×, 2×
- **Fullscreen** — native Fullscreen API
- **Time Display** — elapsed / total with smart formatting

### Keyboard Controls
- `Space` / `K` — Play/Pause
- `F` — Toggle fullscreen
- `M` — Mute/Unmute
- `←` / `→` — Seek ±5 seconds
- `↑` / `↓` — Volume up/down

## Quick Start

### 30-Second Setup

```bash
python3 -m http.server 8000
open http://localhost:8000/demo.html
```

Paste any YouTube URL and hit Load Video.

### Integration

```html
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="nyx-player.css">
</head>
<body>
  <div id="player"></div>

  <script type="module">
    import { NyxPlayer } from './nyx-player.js';

    // Option 1: Pass a YouTube URL
    const player = new NyxPlayer('#player', {
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      volume: 80
    });

    // Option 2: Pass a video ID directly
    const player2 = new NyxPlayer('#player', {
      videoId: 'dQw4w9WgXcQ',
      volume: 80
    });
  </script>
</body>
</html>
```

## API

### Constructor

```javascript
new NyxPlayer(mount, options)
```

**Parameters:**
- `mount` — HTMLElement or CSS selector for the container
- `options` — Configuration object (see below)

### Options

```javascript
{
  url: '',               // YouTube URL (alternative to videoId)
  videoId: '',           // YouTube video ID (alternative to url)
  autoplay: false,       // Start playing immediately
  loop: false,           // Loop the video
  muted: false,          // Start muted
  volume: 100,           // Initial volume (0-100)
  start: 0,              // Start time in seconds
  nocookie: false,       // Use youtube-nocookie.com
  idleDelay: 2500,       // Inactivity timeout before hiding controls (ms)
  seekStep: 5,           // Keyboard seek increment (seconds)
  volumeStep: 5,         // Keyboard volume increment
  maskSeekThreshold: 1.5,// Seek distance that triggers re-masking (seconds)
  frameAdvance: 0.04,    // Playhead advance confirming frames are rendering
  confirmTimeout: 4000   // Failsafe ceiling for frame confirmation (ms)
}
```

### Methods

```javascript
player.play()              // Start playback
player.pause()             // Pause playback
player.toggle()            // Toggle play/pause
player.seekTo(time)        // Seek to time in seconds
player.seekBy(offset)      // Seek relative to current position
player.setVolume(value)    // Set volume (0-100)
player.toggleMute()        // Toggle mute state
player.setRate(rate)       // Set playback speed (0.5, 1, 1.25, 1.5, 2)
player.toggleFullscreen()  // Toggle fullscreen
player.loadVideo(urlOrId)  // Load a new video dynamically
player.destroy()           // Clean up and remove player
```

### Static Functions

```javascript
import { extractVideoId } from './nyx-player.js';

const videoId = extractVideoId('https://youtu.be/dQw4w9WgXcQ');
// Returns: 'dQw4w9WgXcQ'
```

## Supported YouTube URL Formats

- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`
- `https://www.youtube.com/embed/VIDEO_ID`
- `https://www.youtube.com/v/VIDEO_ID`
- `https://www.youtube.com/shorts/VIDEO_ID`
- URLs with query parameters (`&t=`, `&list=`, etc.)
- Bare 11-character video IDs

## Architecture

### Frame-Advance Masking

The core innovation is **event-driven frame confirmation** rather than hardcoded delays.

When the YouTube IFrame API fires `PLAYING`, Nyx captures a baseline timestamp and polls `getCurrentTime()` via `requestAnimationFrame`. The curtain drops only when the playhead has **provably advanced** past the baseline, meaning actual video frames are being presented.

This adapts to:
- Network conditions (slow/fast connections)
- Device performance (decode speed)
- Buffering stalls (YouTube re-fires PLAYING after each stall)

### Iframe Isolation

The YouTube iframe has `pointer-events: none` (CSS + inline). All interaction flows through Nyx's overlay layer (`.nyx-gestures`), preventing:
- Accidental YouTube hover UI
- Double-click native behavior
- Mouse events reaching the iframe

### End-State Handling

When a video ends (non-looping):
- Nyx keeps the idle curtain up
- Prevents YouTube's end-screen recommendations from showing
- User can replay via Nyx controls

### Error Handling

YouTube error codes are mapped to user-friendly messages:
- Code 2: Invalid video ID
- Code 5: HTML5 player error
- Code 100: Video unavailable or removed
- Code 101/150: Video cannot be embedded

## Testing

### Demo with URL Input

```bash
open http://localhost:8000/demo.html
```

### URL Extraction Tests

```bash
open http://localhost:8000/test/url-extraction.html
```

### State Machine Tests

```bash
open http://localhost:8000/test/state-machine.html
```

### Visual Design Fixture

```bash
open http://localhost:8000/test/visual.html
```

## Files

```
nyx/
├── nyx-player.js          # Player engine
├── nyx-player.css         # Premium UI
├── demo.html              # Demo with URL input
├── index.html             # Simple demo
├── test/
│   ├── url-extraction.html  # URL parsing tests
│   ├── state-machine.html   # 30+ automated tests
│   └── visual.html          # Design fixture
└── README.md
```

## Browser Support

- Chrome/Edge 88+
- Safari 15+
- Firefox 89+

Requires ES modules, `async`/`await`, and CSS `aspect-ratio`.

## License

MIT
