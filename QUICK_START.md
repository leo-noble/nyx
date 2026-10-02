# Nyx Player — Quick Start

## 30-Second Setup

```bash
# 1. Serve the directory (required for ES modules)
python3 -m http.server 8000

# 2. Open the demo
open http://localhost:8000/index.html
```

That's it. The player loads with Big Buck Bunny (Creative Commons video).

## 60-Second Integration

Create `demo.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>My Video</title>
  <link rel="stylesheet" href="nyx-player.css">
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #06070a;
      padding: 40px;
    }
    #player { width: min(900px, 100%); }
  </style>
</head>
<body>
  <div id="player"></div>

  <script type="module">
    import { NyxPlayer } from './nyx-player.js';

    const player = new NyxPlayer('#player', {
      videoId: 'dQw4w9WgXcQ',  // Replace with your YouTube video ID
      volume: 80,
      loop: false
    });

    // Expose to console for debugging
    window.player = player;
  </script>
</body>
</html>
```

## Test Pages

```bash
# Main demo (real YouTube video)
http://localhost:8000/index.html

# Visual fixture (mock player, design QA)
http://localhost:8000/test/visual.html

# State machine tests (automated assertions)
http://localhost:8000/test/state-machine.html

# Responsive layout test
http://localhost:8000/responsive-test.html
```

## Console API

With `window.player` exposed:

```javascript
player.play()
player.pause()
player.seekTo(60)              // Jump to 1:00
player.setVolume(50)           // 50%
player.toggleMute()
player.setRate(1.5)            // 1.5x speed
player.toggleFullscreen()
player.yt.getPlayerState()     // Raw YouTube API access
```

## Keyboard Controls

- **Space** / **K** — Play/Pause
- **F** — Fullscreen
- **M** — Mute
- **←** **→** — Seek ±5 seconds
- **↑** **↓** — Volume
- **Double-click** — Fullscreen

## Common Options

```javascript
new NyxPlayer('#container', {
  videoId: 'VIDEO_ID',     // Required
  autoplay: true,          // Start playing immediately
  loop: true,              // Loop the video
  volume: 80,              // Initial volume (0-100)
  muted: false,            // Start muted
  start: 30,               // Start at 30 seconds
  idleDelay: 2500,         // Milliseconds before hiding controls
  seekStep: 10,            // Arrow key seek amount (seconds)
  volumeStep: 10,          // Arrow key volume increment
  nocookie: true,          // Use youtube-nocookie.com
});
```

## Verify It Works

1. Open `http://localhost:8000/test/state-machine.html`
2. Check the browser console
3. Look for `window.__NYX_RESULTS__`
4. Should show: `{ total: 30+, failed: [] }`

All tests passing = implementation is working correctly.

## Troubleshooting

**Player doesn't load:**
- Serving via `http://`? (`file://` won't work)
- Check browser console for errors
- YouTube video embeddable? (some videos block embedding)

**Video doesn't play:**
- Network access to YouTube?
- Video ID correct?
- Browser console errors?

**Controls don't respond:**
- Player focused? (click it first)
- Check console for JavaScript errors

**YouTube title/logo visible:**
- Shouldn't happen if frame-advance masking works
- Check network throttling (Slow 3G simulates worst case)
- Verify `_confirmFrames()` is executing

## Next Steps

Read `README.md` for full documentation:
- Complete API reference
- Architecture explanation
- Frame-advance masking details
- Production deployment guide
- Browser compatibility
