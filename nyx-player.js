/**
 * Nyx Player — a zero-branding YouTube embed engine with a custom control surface.
 *
 * Two problems this module exists to solve properly:
 *
 * 1. Picture fidelity. The iframe is laid out at its real pixel box. There is no
 *    scale-down/scale-up transform pair anywhere in the stack, so the decoded
 *    video is rasterised 1:1 instead of being resampled twice.
 *
 * 2. Pre-roll leakage. YouTube paints its own title bar, avatar and pause glyph
 *    during the handful of frames before playback settles. A fixed timer cannot
 *    cover that reliably: too short and the branding flashes on a slow link, too
 *    long and every play feels laggy. Instead an opaque curtain is held up and
 *    released only when the player reports PLAYING *and* the playhead is
 *    observably advancing — i.e. real frames are on screen. See _confirmFrames.
 */

const YT_API_SRC = 'https://www.youtube.com/iframe_api';

/** Shared across every instance — the IFrame API is a singleton. */
let ytApiPromise = null;

function loadYouTubeAPI() {
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise((resolve, reject) => {
    if (window.YT && typeof window.YT.Player === 'function') {
      resolve(window.YT);
      return;
    }

    // The API only ever calls one global hook; chain any existing owner.
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previous === 'function') previous();
      resolve(window.YT);
    };

    const existing = document.querySelector(`script[src="${YT_API_SRC}"]`);
    if (existing) return;

    const script = document.createElement('script');
    script.src = YT_API_SRC;
    script.async = true;
    script.onerror = () => reject(new Error('Nyx: could not load the YouTube IFrame API.'));
    document.head.appendChild(script);
  });

  return ytApiPromise;
}

/* -------------------------------------------------------------------------- */
/* Icons                                                                       */
/* -------------------------------------------------------------------------- */

const svg = (paths, cls = '') =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

const ICON = {
  play: svg('<path d="M7 4.5v15l12-7.5-12-7.5Z" fill="currentColor" stroke="none"/>', 'nyx-g-play'),
  pause: svg('<path d="M8.5 4.5v15M15.5 4.5v15"/>', 'nyx-g-pause'),
  playSolid: svg('<path d="M7 4.5v15l12-7.5-12-7.5Z" fill="currentColor" stroke="none"/>'),
  volHigh: svg(
    '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" fill="currentColor" stroke="none"/>' +
      '<path d="M15.8 9a4 4 0 0 1 0 6M18.4 6.4a7.6 7.6 0 0 1 0 11.2"/>',
    'nyx-i-high'
  ),
  volLow: svg(
    '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" fill="currentColor" stroke="none"/>' +
      '<path d="M15.8 9a4 4 0 0 1 0 6"/>',
    'nyx-i-low'
  ),
  volMute: svg(
    '<path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" fill="currentColor" stroke="none"/>' +
      '<path d="M16.5 9.8l4.5 4.4M21 9.8l-4.5 4.4"/>',
    'nyx-i-mute'
  ),
  fsEnter: svg('<path d="M8.5 3.5H3.5v5M15.5 3.5h5v5M20.5 15.5v5h-5M3.5 15.5v5h5"/>', 'nyx-i-fsenter'),
  fsExit: svg('<path d="M3.5 8.5h5v-5M20.5 8.5h-5v-5M15.5 20.5v-5h5M8.5 20.5v-5h-5"/>', 'nyx-i-fsexit'),
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;

const isVideoId = (value) => typeof value === 'string' && VIDEO_ID_RE.test(value);

function youtubeHostKind(hostname) {
  const host = String(hostname || '')
    .toLowerCase()
    .replace(/^www\./, '');
  if (host === 'youtu.be') return 'short';
  if (
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'music.youtube.com' ||
    host === 'youtube-nocookie.com'
  ) {
    return 'full';
  }
  return null;
}

function parseYouTubeUrl(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (isVideoId(trimmed)) return { videoId: trimmed, start: 0 };

  const raw =
    /^https?:\/\//i.test(trimmed) || trimmed.startsWith('//')
      ? trimmed.replace(/^\/\//, 'https://')
      : `https://${trimmed}`;

  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const kind = youtubeHostKind(url.hostname);
  if (!kind) return null;

  let videoId = null;
  if (kind === 'short') {
    videoId = url.pathname.split('/').filter(Boolean)[0] || null;
  } else if (url.pathname === '/watch' || url.pathname === '/watch/') {
    videoId = url.searchParams.get('v');
  } else {
    const match = url.pathname.match(/^\/(?:embed|v|shorts|live|e)\/([a-zA-Z0-9_-]{11})/);
    videoId = match ? match[1] : null;
  }

  if (!isVideoId(videoId)) return null;
  return { videoId, start: parseYouTubeStart(url) };
}

function parseYouTubeStart(url) {
  const raw = url.searchParams.get('t') || url.searchParams.get('start') || '';
  if (!raw) return 0;
  if (/^\d+$/.test(raw)) return Number(raw);
  const match = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!match) return 0;
  return (Number(match[1]) || 0) * 3600 + (Number(match[2]) || 0) * 60 + (Number(match[3]) || 0);
}

/**
 * Extract a YouTube video ID from a URL, short link, Shorts path, or bare ID.
 * @param {string} input
 * @returns {string|null}
 */
function extractVideoId(input) {
  return parseYouTubeUrl(input)?.videoId ?? null;
}

/** MM:SS, widening to H:MM:SS only when the duration actually needs it. */
function formatTime(seconds) {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Fraction 0..1 of a pointer's x position across an element. */
function ratioFromPointer(event, element) {
  const box = element.getBoundingClientRect();
  if (box.width === 0) return 0;
  return clamp((event.clientX - box.left) / box.width, 0, 1);
}

const RATES = [0.5, 1, 1.25, 1.5, 2];

const DEFAULTS = {
  videoId: '',
  url: '',              // Alternative: accept full YouTube URL
  /** Paste-bar above the 16:9 stage. On by default when no video is given. */
  urlBar: null,
  autoplay: false,
  loop: false,
  muted: false,
  volume: 100,
  start: 0,
  /** Route through youtube-nocookie.com. */
  nocookie: false,
  /** Inactivity before the dock and cursor retreat, in ms. */
  idleDelay: 2500,
  seekStep: 5,
  volumeStep: 5,
  /** A jump larger than this (seconds) re-raises the curtain. */
  maskSeekThreshold: 1.5,
  /** Playhead advance (seconds) that counts as "frames are really on screen". */
  frameAdvance: 0.04,
  /**
   * Absolute ceiling on how long the curtain may stay up waiting for frame
   * confirmation. This is a failsafe against a wedged player, NOT the reveal
   * mechanism — the reveal is always driven by observed playback.
   */
  confirmTimeout: 4000,
};

/* -------------------------------------------------------------------------- */
/* NyxPlayer                                                                   */
/* -------------------------------------------------------------------------- */

export class NyxPlayer {
  /**
   * @param {HTMLElement|string} mount element or selector to render into
   * @param {Partial<typeof DEFAULTS>} options
   */
  constructor(mount, options = {}) {
    const host = typeof mount === 'string' ? document.querySelector(mount) : mount;
    if (!host) throw new Error('Nyx: mount element not found.');

    this.host = host;
    this.opts = { ...DEFAULTS, ...options };

    if (this.opts.url && !this.opts.videoId) {
      const parsed = parseYouTubeUrl(this.opts.url);
      if (!parsed) throw new Error('Nyx: invalid YouTube URL.');
      this.opts.videoId = parsed.videoId;
      if (!this.opts.start) this.opts.start = parsed.start;
    }

    if (this.opts.urlBar == null) {
      this.opts.urlBar = !this.opts.videoId;
    }

    /** @type {any} YT.Player instance, once ready. */
    this.yt = null;
    this.ready = false;
    this.destroyed = false;

    this.duration = 0;
    this.rate = 1;
    this.hasPlayed = false;
    this.dragging = false;
    this.volumeDragging = false;
    this.pendingSeek = null;

    this._masked = true;
    this._idle = true;
    this._busy = false;
    this._confirmRaf = 0;
    this._confirmActive = false;
    this._tickRaf = 0;
    this._idleTimer = 0;
    this._listeners = [];
    this._booting = false;

    this._buildDOM();
    this._bindControls();
    this._bindLoader();
    this._bindGestures();
    this._bindKeyboard();
    this._bindFullscreen();

    if (this.opts.videoId) {
      this._boot();
    } else {
      this.root.classList.add('is-empty', 'is-masked', 'is-idle');
      loadYouTubeAPI().catch(() => {});
    }
  }

  /* ---------------------------------------------------------------- markup */

  _buildDOM() {
    const root = document.createElement('div');
    root.className = 'nyx is-masked is-idle';
    if (this.opts.urlBar) root.classList.add('has-loader');
    root.tabIndex = 0;
    root.setAttribute('role', 'region');
    root.setAttribute('aria-label', 'Video player');

    const loader = this.opts.urlBar
      ? `
      <form class="nyx-loader" action="">
        <div class="nyx-loader-row">
          <input class="nyx-url" type="text" name="url" autocomplete="off" spellcheck="false"
                 placeholder="Paste a YouTube link" aria-label="YouTube URL" />
          <button class="nyx-load" type="submit">Load Video</button>
        </div>
        <p class="nyx-loader-error" hidden></p>
      </form>`
      : '';

    root.innerHTML = `
      ${loader}
      <div class="nyx-stage">
        <div class="nyx-frame"><div class="nyx-slot"></div></div>

        <div class="nyx-cover">
          <div class="nyx-spinner"></div>
          <p class="nyx-empty-copy">Paste a YouTube link to begin</p>
        </div>

        <div class="nyx-shield" aria-hidden="true">
          <div class="nyx-shield-top"></div>
          <div class="nyx-shield-br"></div>
        </div>

        <button class="nyx-bigplay" type="button" aria-label="Play">${ICON.playSolid}</button>

        <div class="nyx-gestures"></div>
        <div class="nyx-scrim"></div>

        <div class="nyx-dock">
          <div class="nyx-row">
            <div class="nyx-scrub" role="slider" tabindex="0"
                 aria-label="Seek" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0">
              <div class="nyx-scrub-rail">
                <div class="nyx-scrub-buffer"></div>
                <div class="nyx-scrub-fill"></div>
              </div>
              <div class="nyx-scrub-thumb"></div>
              <div class="nyx-tip">00:00</div>
            </div>
          </div>

          <div class="nyx-row">
            <button class="nyx-btn nyx-play" type="button" aria-label="Play">
              <span class="nyx-morph">${ICON.play}${ICON.pause}</span>
            </button>

            <div class="nyx-time"><b class="nyx-cur">00:00</b> / <span class="nyx-dur">00:00</span></div>

            <div class="nyx-spacer"></div>

            <div class="nyx-rate">
              <button class="nyx-btn nyx-rate-btn" type="button"
                      aria-label="Playback speed" aria-haspopup="true" aria-expanded="false">1x</button>
              <div class="nyx-rate-menu" role="menu">
                ${RATES.map(
                  (r) =>
                    `<button class="nyx-rate-item" type="button" role="menuitemradio" ` +
                    `data-rate="${r}" aria-checked="${r === 1}">${r === 1 ? '1x' : `${r}x`}</button>`
                ).join('')}
              </div>
            </div>

            <div class="nyx-volume">
              <div class="nyx-vol-slider" role="slider" tabindex="0"
                   aria-label="Volume" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100">
                <div class="nyx-vol-rail">
                  <div class="nyx-vol-fill"></div>
                  <div class="nyx-vol-thumb"></div>
                </div>
              </div>
              <button class="nyx-btn nyx-mute" type="button" aria-label="Mute">
                <span class="nyx-vol-ico" data-level="high">${ICON.volHigh}${ICON.volLow}${ICON.volMute}</span>
              </button>
            </div>

            <button class="nyx-btn nyx-fs" type="button" aria-label="Fullscreen">
              <span class="nyx-fs-ico">${ICON.fsEnter}${ICON.fsExit}</span>
            </button>
          </div>
        </div>

        <div class="nyx-error"><span></span></div>
      </div>
      <div class="nyx-sr" aria-live="polite"></div>
    `;

    this.host.appendChild(root);
    this.root = root;

    const q = (sel) => root.querySelector(sel);
    this.el = {
      loader: q('.nyx-loader'),
      url: q('.nyx-url'),
      loadBtn: q('.nyx-load'),
      loaderError: q('.nyx-loader-error'),
      stage: q('.nyx-stage'),
      slot: q('.nyx-slot'),
      frame: q('.nyx-frame'),
      cover: q('.nyx-cover'),
      bigPlay: q('.nyx-bigplay'),
      gestures: q('.nyx-gestures'),
      dock: q('.nyx-dock'),
      play: q('.nyx-play'),
      cur: q('.nyx-cur'),
      dur: q('.nyx-dur'),
      scrub: q('.nyx-scrub'),
      rail: q('.nyx-scrub-rail'),
      buffer: q('.nyx-scrub-buffer'),
      fill: q('.nyx-scrub-fill'),
      thumb: q('.nyx-scrub-thumb'),
      tip: q('.nyx-tip'),
      rate: q('.nyx-rate'),
      rateBtn: q('.nyx-rate-btn'),
      rateMenu: q('.nyx-rate-menu'),
      volume: q('.nyx-volume'),
      volSlider: q('.nyx-vol-slider'),
      volRail: q('.nyx-vol-rail'),
      volFill: q('.nyx-vol-fill'),
      volThumb: q('.nyx-vol-thumb'),
      mute: q('.nyx-mute'),
      fs: q('.nyx-fs'),
      error: q('.nyx-error span'),
      live: q('.nyx-sr'),
    };
  }

  /** Tracked listener binding so destroy() can unwind everything. */
  _on(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this._listeners.push([target, type, handler, options]);
  }

  /* ------------------------------------------------------------ API set-up */

  async _boot() {
    if (this._booting || this.yt || !this.opts.videoId) return;
    this._booting = true;

    let YT;
    try {
      YT = await loadYouTubeAPI();
    } catch (err) {
      this._booting = false;
      this._fail('The YouTube player could not be loaded.');
      return;
    }
    if (this.destroyed) return;

    const playerVars = {
      // Branding and chrome suppression - maximum YouTube UI hiding
      controls: 0,
      modestbranding: 1,
      rel: 0,
      iv_load_policy: 3,
      cc_load_policy: 0,
      disablekb: 1,
      fs: 0,
      playsinline: 1,
      enablejsapi: 1,
      autoplay: this.opts.autoplay ? 1 : 0,
      start: this.opts.start || 0,
      // Additional parameters to hide ALL YouTube UI
      showinfo: 0,
      color: 'white',
      // Hide the player controls completely
      widget_referrer: 1,
      // Hide annotations and related videos
      iv_load_policy: 3,
      // No keyboard controls
      disablekb: 1,
    };

    // origin is rejected for file:// (location.origin is the string "null").
    if (location.origin && location.origin !== 'null') {
      playerVars.origin = location.origin;
    }

    const config = {
      videoId: this.opts.videoId,
      width: '100%',
      height: '100%',
      playerVars,
      events: {
        onReady: (e) => this._onReady(e),
        onStateChange: (e) => this._onStateChange(e),
        onPlaybackRateChange: (e) => this._onRateChange(e),
        onError: (e) => this._onError(e),
      },
    };

    if (this.opts.nocookie) config.host = 'https://www.youtube-nocookie.com';

    try {
      this.yt = new YT.Player(this.el.slot, config);
    } catch {
      this._booting = false;
      this._fail('The YouTube player could not be created.');
      return;
    }
    this._booting = false;
  }

  _onReady() {
    if (this.destroyed) return;
    this.ready = true;

    const iframe = this.yt.getIframe?.();
    if (iframe) {
      iframe.setAttribute('tabindex', '-1');
      iframe.setAttribute('title', 'Video content');
      // Belt and braces: the stylesheet also does this, but an inline rule
      // guarantees it even if the CSS file is missing.
      iframe.style.pointerEvents = 'none';
    }

    this.duration = this.yt.getDuration() || 0;
    this.el.dur.textContent = formatTime(this.duration);
    this.el.scrub.setAttribute('aria-valuemax', String(Math.floor(this.duration)));

    if (this.opts.muted) {
      this.yt.mute();
    } else {
      this.yt.unMute();
      this.yt.setVolume(clamp(this.opts.volume, 0, 100));
    }
    this._renderVolume();
    this._render();
  }

  /* -------------------------------------------------------- state machine */

  _onStateChange(event) {
    if (this.destroyed || !window.YT) return;
    const S = window.YT.PlayerState;

    switch (event.data) {
      case S.PLAYING:
        this.hasPlayed = true;
        this.root.classList.add('is-playing');
        this.root.classList.remove('is-paused', 'is-empty');
        this._setIdleCover(false);
        this._startTicker();
        // The curtain drops only once frames are provably on screen.
        if (this._masked) this._confirmFrames();
        this._armIdleTimer();
        break;

      case S.PAUSED:
        this.root.classList.remove('is-playing');
        this.root.classList.add('is-paused');
        this._setBusy(false);
        this._stopTicker();
        this._revealUI();
        // Don't raise mask on pause - let the video be visible
        break;

      case S.BUFFERING:
        // Only surface the spinner while the curtain is up. Mid-playback
        // stalls must not start flashing a curtain on and off.
        this._setBusy(this._masked);
        break;

      case S.ENDED:
        this.root.classList.remove('is-playing', 'is-paused');
        this._stopTicker();
        if (this.opts.loop) {
          this.yt.seekTo(0, true);
          this.yt.playVideo();
        } else {
          this._revealUI();
          this._render();
        }
        break;

      case S.CUED:
        this._setBusy(false);
        break;

      default:
        break;
    }

    this._syncPlayLabels();
  }

  _onRateChange(event) {
    this.rate = event.data || 1;
    this._renderRate();
  }

  _onError(event) {
    const code = event?.data;
    let message = 'This video is unavailable or cannot be embedded.';

    // YouTube error codes
    switch (code) {
      case 2:
        message = 'Invalid video ID.';
        break;
      case 5:
        message = 'HTML5 player error.';
        break;
      case 100:
        message = 'This video is unavailable or has been removed.';
        break;
      case 101:
      case 150:
        message = 'This video cannot be embedded.';
        break;
    }

    this._fail(message);
  }

  _fail(message) {
    this.root.classList.add('is-error');
    this.root.classList.remove('is-masked', 'is-idle', 'is-busy');
    this._masked = false;
    if (this.el.error) this.el.error.textContent = message;
    this._stopTicker();
  }

  /* ----------------------------------------------------- curtain mechanics */

  _setMask(on) {
    if (this._masked === on) return;
    this._masked = on;
    this.root.classList.toggle('is-masked', on);

    // Any mask transition ends the current confirmation episode. Raising the
    // curtain therefore allows the next PLAYING to take a fresh baseline.
    cancelAnimationFrame(this._confirmRaf);
    this._confirmActive = false;

    if (!on) this._setBusy(false);
  }

  _setBusy(on) {
    if (this._busy === on) return;
    this._busy = on;
    this.root.classList.toggle('is-busy', on);
  }

  _setIdleCover(on) {
    if (this._idle === on) return;
    this._idle = on;
    this.root.classList.toggle('is-idle', on);
  }

  /**
   * Hold the curtain until the playhead demonstrably moves.
   *
   * getCurrentTime() advancing past its value at the PLAYING event is the only
   * signal available from a cross-origin embed that actually correlates with
   * "pixels are being presented". Polling it per animation frame means the
   * reveal tracks real network and decode conditions instead of guessing at
   * them, which is precisely what a hardcoded delay cannot do.
   */
  _confirmFrames() {
    // YouTube emits PLAYING again after every buffering stall. Re-arming the
    // baseline on each one would keep moving the goalposts and could strand
    // the curtain permanently on a stuttering connection, so one episode of
    // masking gets exactly one baseline.
    if (this._confirmActive) return;
    this._confirmActive = true;

    cancelAnimationFrame(this._confirmRaf);

    const baseline = this.yt?.getCurrentTime?.() ?? 0;

    // The failsafe budget is spent in *visible* time only. A backgrounded tab
    // throttles rAF and presents nothing, so charging it for that wait would
    // drop the curtain on frames the user never actually saw.
    let budget = this.opts.confirmTimeout;
    let last = performance.now();
    this._setBusy(true);

    const release = () => {
      this._setMask(false); // also clears _confirmActive
    };

    const step = () => {
      if (this.destroyed || !this.yt) {
        this._confirmActive = false;
        return;
      }

      const now = performance.now();
      if (!document.hidden) budget -= now - last;
      last = now;

      // A drag makes currentTime jump around; confirmation resumes on release.
      if (this.dragging) {
        this._confirmRaf = requestAnimationFrame(step);
        return;
      }

      const playing =
        this.yt.getPlayerState?.() === window.YT?.PlayerState?.PLAYING;

      if (playing && this.yt.getCurrentTime() > baseline + this.opts.frameAdvance) {
        release();
        return;
      }

      if (budget <= 0) {
        // Failsafe only: never leave a working video behind a curtain.
        release();
        return;
      }

      this._confirmRaf = requestAnimationFrame(step);
    };

    this._confirmRaf = requestAnimationFrame(step);
  }

  /* ----------------------------------------------------------- public API */

  play() {
    if (!this.ready) return;
    this.yt.playVideo();
  }

  pause() {
    if (!this.ready) return;
    this.yt.pauseVideo();
  }

  toggle() {
    if (!this.ready) return;
    const S = window.YT.PlayerState;
    const state = this.yt.getPlayerState();
    if (state === S.PLAYING || state === S.BUFFERING) this.pause();
    else this.play();
  }

  /**
   * @param {number} time seconds
   * @param {boolean} precise pass false for scrub-drag preview seeks
   */
  seekTo(time, precise = true) {
    if (!this.ready) return;
    const target = clamp(time, 0, this.duration || Number.MAX_SAFE_INTEGER);
    const delta = Math.abs(target - this.yt.getCurrentTime());
    const playing = this.yt.getPlayerState() === window.YT.PlayerState.PLAYING;

    this.yt.seekTo(target, precise);

    // Re-mask only for real jumps, and only while playing — a masked pause has
    // no advancing playhead to lift the curtain again.
    if (precise && playing && delta > this.opts.maskSeekThreshold) {
      this._setMask(true);
      this._confirmFrames();
    }

    this._render();
  }

  seekBy(offset) {
    if (!this.ready) return;
    this.seekTo(this.yt.getCurrentTime() + offset, true);
  }

  setVolume(value) {
    if (!this.ready) return;
    const v = clamp(Math.round(value), 0, 100);
    this.yt.setVolume(v);
    if (v > 0 && this.yt.isMuted()) this.yt.unMute();
    if (v === 0 && !this.yt.isMuted()) this.yt.mute();
    this._renderVolume();
  }

  toggleMute() {
    if (!this.ready) return;
    if (this.yt.isMuted()) {
      this.yt.unMute();
      if (this.yt.getVolume() === 0) this.yt.setVolume(this.opts.volume || 50);
    } else {
      this.yt.mute();
    }
    this._renderVolume();
  }

  setRate(rate) {
    if (!this.ready) return;
    this.rate = rate;
    this.yt.setPlaybackRate(rate);
    this._renderRate();
  }

  /**
   * Load a new video dynamically without destroying the player.
   * @param {string} urlOrId YouTube URL or video ID
   * @returns {boolean} whether a load was started
   */
  loadVideo(urlOrId) {
    if (this.destroyed) return false;

    const parsed = parseYouTubeUrl(urlOrId);
    if (!parsed) {
      this._setLoaderError('That doesn’t look like a YouTube link.');
      if (!this.el.loader) this._fail('Invalid YouTube URL or video ID.');
      return false;
    }

    this._setLoaderError('');
    this.root.classList.remove('is-error', 'is-playing', 'is-paused', 'is-empty');
    this.opts.videoId = parsed.videoId;
    this.opts.start = parsed.start || 0;
    this.opts.autoplay = true;
    this.duration = 0;
    this.hasPlayed = false;
    this._setMask(true);
    this._setBusy(true);
    this._setIdleCover(true);

    if (!this.yt) {
      this._boot();
      this._render();
      return true;
    }

    this.yt.loadVideoById({
      videoId: parsed.videoId,
      startSeconds: this.opts.start,
    });

    this._render();
    return true;
  }

  _setLoaderError(message) {
    const node = this.el.loaderError;
    if (!node) return;
    if (!message) {
      node.hidden = true;
      node.textContent = '';
      this.el.loader?.classList.remove('is-invalid');
      this.el.url?.removeAttribute('aria-invalid');
      return;
    }
    node.hidden = false;
    node.textContent = message;
    this.el.loader?.classList.add('is-invalid');
    this.el.url?.setAttribute('aria-invalid', 'true');
  }

  _bindLoader() {
    if (!this.el.loader) return;

    this._on(this.el.loader, 'submit', (e) => {
      e.preventDefault();
      const value = this.el.url?.value || '';
      if (!value.trim()) {
        this._setLoaderError('Paste a YouTube link first.');
        return;
      }
      const ok = this.loadVideo(value);
      if (ok) this.root.focus({ preventScroll: true });
    });

    this._on(this.el.url, 'input', () => {
      if (this.el.loader.classList.contains('is-invalid')) this._setLoaderError('');
    });
  }

  toggleFullscreen() {
    const fsElement =
      document.fullscreenElement || document.webkitFullscreenElement || null;

    if (fsElement) {
      const exit = document.exitFullscreen?.() ?? document.webkitExitFullscreen?.();
      // Rejections here are routine (user gesture expiry) and must not surface
      // as unhandled rejections.
      Promise.resolve(exit).catch(() => {});
      return;
    }

    const request =
      this.root.requestFullscreen?.({ navigationUI: 'hide' }) ??
      this.root.webkitRequestFullscreen?.();
    Promise.resolve(request).catch(() => {
      this._announce('Fullscreen was blocked by the browser.');
    });
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;

    cancelAnimationFrame(this._confirmRaf);
    cancelAnimationFrame(this._tickRaf);
    clearTimeout(this._idleTimer);

    for (const [target, type, handler, options] of this._listeners) {
      target.removeEventListener(type, handler, options);
    }
    this._listeners = [];

    try {
      this.yt?.destroy?.();
    } catch {
      /* the API throws if the iframe is already detached */
    }
    this.yt = null;
    this.root?.remove();
  }

  /* -------------------------------------------------------------- controls */

  _bindControls() {
    const { el } = this;

    this._on(el.play, 'click', () => this.toggle());
    this._on(el.bigPlay, 'click', () => this.play());
    this._on(el.mute, 'click', () => this.toggleMute());
    this._on(el.fs, 'click', () => this.toggleFullscreen());

    /* Rate popover ------------------------------------------------------- */
    this._on(el.rateBtn, 'click', (e) => {
      e.stopPropagation();
      this._toggleRateMenu(!el.rate.classList.contains('is-open'));
    });

    for (const item of el.rateMenu.querySelectorAll('.nyx-rate-item')) {
      this._on(item, 'click', () => {
        this.setRate(parseFloat(item.dataset.rate));
        this._toggleRateMenu(false);
        el.rateBtn.focus();
      });
    }

    this._on(document, 'click', (e) => {
      if (!el.rate.contains(e.target)) this._toggleRateMenu(false);
    });

    /* Scrub bar ---------------------------------------------------------- */
    const scrubTime = (e) => ratioFromPointer(e, el.rail) * (this.duration || 0);

    this._on(el.scrub, 'pointerdown', (e) => {
      if (!this.ready || !this.duration) return;
      this.dragging = true;
      el.scrub.classList.add('is-dragging');
      el.scrub.setPointerCapture(e.pointerId);
      this.pendingSeek = scrubTime(e);
      // Lightweight preview seek: allowSeekAhead=false avoids hammering the
      // network with a request per pointer sample.
      this.yt.seekTo(this.pendingSeek, false);
      this._render();
    });

    this._on(el.scrub, 'pointermove', (e) => {
      if (!this.duration) return;
      const hoverTime = scrubTime(e);
      this._renderTip(hoverTime, ratioFromPointer(e, el.rail));

      if (!this.dragging) return;
      this.pendingSeek = hoverTime;
      this.yt.seekTo(hoverTime, false);
      this._render();
    });

    const endScrub = (e) => {
      if (!this.dragging) return;
      this.dragging = false;
      el.scrub.classList.remove('is-dragging');
      try {
        el.scrub.releasePointerCapture(e.pointerId);
      } catch {
        /* capture may already be gone */
      }
      if (this.pendingSeek != null) {
        // Commit the real seek; this is the one that may re-raise the curtain.
        this.seekTo(this.pendingSeek, true);
        this.pendingSeek = null;
      }
      this._armIdleTimer();
    };

    this._on(el.scrub, 'pointerup', endScrub);
    this._on(el.scrub, 'pointercancel', endScrub);

    this._on(el.scrub, 'keydown', (e) => {
      const step = e.shiftKey ? 10 : this.opts.seekStep;
      let handled = true;
      if (e.key === 'ArrowRight') this.seekBy(step);
      else if (e.key === 'ArrowLeft') this.seekBy(-step);
      else if (e.key === 'Home') this.seekTo(0);
      else if (e.key === 'End') this.seekTo(this.duration);
      else handled = false;

      if (handled) {
        e.preventDefault();
        e.stopPropagation(); // don't double-fire the root handler
      }
    });

    /* Volume slider ------------------------------------------------------ */
    const volFromPointer = (e) => ratioFromPointer(e, el.volRail) * 100;

    this._on(el.volSlider, 'pointerdown', (e) => {
      if (!this.ready) return;
      this.volumeDragging = true;
      el.volSlider.classList.add('is-dragging');
      el.volSlider.setPointerCapture(e.pointerId);
      this.setVolume(volFromPointer(e));
    });

    this._on(el.volSlider, 'pointermove', (e) => {
      if (!this.volumeDragging) return;
      this.setVolume(volFromPointer(e));
    });

    const endVolume = (e) => {
      if (!this.volumeDragging) return;
      this.volumeDragging = false;
      el.volSlider.classList.remove('is-dragging');
      try {
        el.volSlider.releasePointerCapture(e.pointerId);
      } catch {
        /* capture may already be gone */
      }
    };

    this._on(el.volSlider, 'pointerup', endVolume);
    this._on(el.volSlider, 'pointercancel', endVolume);

    this._on(el.volSlider, 'keydown', (e) => {
      if (!this.ready) return;
      let handled = true;
      const current = this.yt.isMuted() ? 0 : this.yt.getVolume();
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') this.setVolume(current + this.opts.volumeStep);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') this.setVolume(current - this.opts.volumeStep);
      else handled = false;

      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    });
  }

  _toggleRateMenu(open) {
    this.el.rate.classList.toggle('is-open', open);
    this.el.rateBtn.setAttribute('aria-expanded', String(open));
    if (open) this._revealUI();
    else this._armIdleTimer();
  }

  /* -------------------------------------------------------------- gestures */

  _bindGestures() {
    const { el } = this;

    this._on(el.gestures, 'pointerdown', () => this.root.focus({ preventScroll: true }));
    this._on(el.gestures, 'click', () => this.toggle());
    this._on(el.gestures, 'dblclick', () => this.toggleFullscreen());
    this._on(el.bigPlay, 'pointerdown', () => this.root.focus({ preventScroll: true }));

    // Any movement over the player wakes the UI.
    this._on(this.root, 'pointermove', () => this._revealUI());
    this._on(this.root, 'pointerleave', () => {
      if (this.root.classList.contains('is-playing')) this._hideUI();
    });
    // Hovering the dock itself must never let it fade out underneath the cursor.
    this._on(el.dock, 'pointerenter', () => {
      clearTimeout(this._idleTimer);
      this._revealUI();
    });
    this._on(el.dock, 'pointerleave', () => this._armIdleTimer());
  }

  _revealUI() {
    this.root.classList.remove('is-ui-hidden');
    this._armIdleTimer();
  }

  _hideUI() {
    // Never hide while paused, mid-gesture, or with the speed popover open.
    if (!this.root.classList.contains('is-playing')) return;
    if (this.dragging || this.volumeDragging) return;
    if (this.el.rate.classList.contains('is-open')) return;

    const active = document.activeElement;
    if (active && active !== this.root && this.root.contains(active)) {
      // Only *keyboard* focus pins the dock open. A clicked button keeps DOM
      // focus afterwards, and honouring that would mean the dock never
      // auto-hides again for the rest of the session.
      let keyboardFocused = true;
      try {
        keyboardFocused = active.matches(':focus-visible');
      } catch {
        /* older engines: fall back to keeping the dock open */
      }
      if (keyboardFocused) return;
    }

    this.root.classList.add('is-ui-hidden');
  }

  _armIdleTimer() {
    clearTimeout(this._idleTimer);
    this._idleTimer = setTimeout(() => this._hideUI(), this.opts.idleDelay);
  }

  /* -------------------------------------------------------------- keyboard */

  _bindKeyboard() {
    this._on(this.root, 'keydown', (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;

      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      // Let the focused slider own its own arrow keys.
      const target = e.target;
      if (target !== this.root && target.getAttribute?.('role') === 'slider') return;

      let handled = true;
      switch (e.key) {
        case ' ':
        case 'Spacebar':
        case 'k':
        case 'K':
          this.toggle();
          break;
        case 'f':
        case 'F':
          this.toggleFullscreen();
          break;
        case 'm':
        case 'M':
          this.toggleMute();
          break;
        case 'ArrowLeft':
          this.seekBy(-this.opts.seekStep);
          break;
        case 'ArrowRight':
          this.seekBy(this.opts.seekStep);
          break;
        case 'ArrowUp':
          this.setVolume((this.yt?.isMuted() ? 0 : this.yt?.getVolume() ?? 0) + this.opts.volumeStep);
          break;
        case 'ArrowDown':
          this.setVolume((this.yt?.isMuted() ? 0 : this.yt?.getVolume() ?? 0) - this.opts.volumeStep);
          break;
        default:
          handled = false;
      }

      if (handled) {
        // Stops Space/arrows from scrolling the host page.
        e.preventDefault();
        this._revealUI();
      }
    });

    // Enter/Space on a focused button shouldn't also trigger the root handler.
    this._on(this.el.dock, 'keydown', (e) => {
      if ((e.key === ' ' || e.key === 'Enter') && e.target.tagName === 'BUTTON') {
        e.stopPropagation();
      }
    });
  }

  /* ------------------------------------------------------------ fullscreen */

  _bindFullscreen() {
    const sync = () => {
      const active =
        (document.fullscreenElement || document.webkitFullscreenElement) === this.root;
      this.root.classList.toggle('is-fullscreen', active);
      this.el.fs.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Fullscreen');
      this._revealUI();
    };
    this._on(document, 'fullscreenchange', sync);
    this._on(document, 'webkitfullscreenchange', sync);
  }

  /* --------------------------------------------------------------- render */

  _startTicker() {
    cancelAnimationFrame(this._tickRaf);
    const loop = () => {
      if (this.destroyed) return;
      this._render();
      this._tickRaf = requestAnimationFrame(loop);
    };
    this._tickRaf = requestAnimationFrame(loop);
  }

  _stopTicker() {
    cancelAnimationFrame(this._tickRaf);
    this._tickRaf = 0;
    this._render();
  }

  _render() {
    if (!this.ready || this.destroyed || !this.yt) return;

    if (!this.duration) {
      this.duration = this.yt.getDuration() || 0;
      if (this.duration) {
        this.el.dur.textContent = formatTime(this.duration);
        this.el.scrub.setAttribute('aria-valuemax', String(Math.floor(this.duration)));
      }
    }

    const current = this.dragging && this.pendingSeek != null
      ? this.pendingSeek
      : this.yt.getCurrentTime() || 0;

    const pct = this.duration ? clamp((current / this.duration) * 100, 0, 100) : 0;
    this.el.fill.style.width = `${pct}%`;
    this.el.thumb.style.left = `${pct}%`;
    this.el.cur.textContent = formatTime(current);

    const buffered = (this.yt.getVideoLoadedFraction?.() || 0) * 100;
    this.el.buffer.style.width = `${clamp(buffered, 0, 100)}%`;

    this.el.scrub.setAttribute('aria-valuenow', String(Math.floor(current)));
    this.el.scrub.setAttribute('aria-valuetext', `${formatTime(current)} of ${formatTime(this.duration)}`);
  }

  _renderTip(time, ratio) {
    const tip = this.el.tip;
    tip.textContent = formatTime(time);

    // Clamp to the rail so the bubble never hangs past the player edge at
    // either extreme (which would otherwise overflow the dock horizontally).
    const railWidth = this.el.rail.clientWidth || 0;
    const half = (tip.offsetWidth || 0) / 2;
    const x = clamp(ratio * railWidth, half, Math.max(half, railWidth - half));
    tip.style.left = `${x}px`;
  }

  _renderVolume() {
    if (!this.ready) return;
    const muted = this.yt.isMuted();
    const volume = muted ? 0 : this.yt.getVolume();

    this.el.volFill.style.width = `${volume}%`;
    this.el.volThumb.style.left = `${volume}%`;
    this.el.volSlider.setAttribute('aria-valuenow', String(Math.round(volume)));

    const level = muted || volume === 0 ? 'mute' : volume < 50 ? 'low' : 'high';
    this.el.volSlider.parentElement.querySelector('.nyx-vol-ico').dataset.level = level;
    this.el.mute.setAttribute('aria-label', level === 'mute' ? 'Unmute' : 'Mute');
  }

  _renderRate() {
    this.el.rateBtn.textContent = this.rate === 1 ? '1x' : `${this.rate}x`;
    for (const item of this.el.rateMenu.querySelectorAll('.nyx-rate-item')) {
      item.setAttribute('aria-checked', String(parseFloat(item.dataset.rate) === this.rate));
    }
  }

  _syncPlayLabels() {
    const playing = this.root.classList.contains('is-playing');
    this.el.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }

  _announce(message) {
    if (this.el.live) this.el.live.textContent = message;
  }
}

export { extractVideoId };
export default NyxPlayer;
