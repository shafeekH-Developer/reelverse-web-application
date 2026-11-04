import { useCallback, useEffect, useRef, useState } from "react";

// =====================================================
// REELVERSE VIDEO PLAYER (custom controls)
// =====================================================
//
// Replaces the plain browser controls with a Netflix / YouTube style player:
// big play button, seek bar with buffered + hover preview time, volume,
// speed + quality settings, skip 10s, picture-in-picture, fullscreen,
// keyboard shortcuts and auto-hiding controls.
//
// Props: { video }  (same as before - uses video.video_url)
//
// Quality sources, in this order:
//   1. a list of ready-made versions on the video object
//      (video.renditions / video.qualities / video.quality_urls)
//   2. Cloudinary URL transformations (older videos)
// If neither exists, the quality button is simply hidden.

const STANDARD_QUALITIES = [360, 480, 720, 1080, 1440, 2160];
const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const HIDE_DELAY = 2600;


// ---------- Cloudinary helpers (unchanged logic) ----------

function buildQualityUrl(originalUrl, side, size) {
  const marker = "/upload/";
  const index = originalUrl.indexOf(marker);

  if (index === -1) {
    return originalUrl;
  }

  const transformation = `c_limit,${side}_${size},q_auto,vc_h264`;

  const withTransformation =
    originalUrl.slice(0, index + marker.length) +
    transformation +
    "/" +
    originalUrl.slice(index + marker.length);

  return withTransformation.replace(/\.[a-zA-Z0-9]+(\?.*)?$/, ".mp4$1");
}

function isCloudinaryVideo(url) {
  return (
    typeof url === "string" &&
    url.includes("res.cloudinary.com") &&
    url.includes("/video/upload/")
  );
}

function qualityLabel(size) {
  return size === 2160 ? "2160p (4K)" : `${size}p`;
}


// ---------- Ready-made renditions (R2 etc.) ----------
// Accepts an array of { height | quality | label, url } or an
// object like { "720": "https://...", "480": "https://..." }.

function readRenditions(video) {
  const raw =
    video.renditions || video.qualities || video.quality_urls || null;

  if (!raw) {
    return [];
  }

  let list = [];

  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === "object") {
    list = Object.keys(raw).map((key) => ({
      height: key,
      url: raw[key],
    }));
  }

  return list
    .map((item) => {
      if (typeof item === "string") {
        return null;
      }

      const url = item.url || item.video_url || item.src;
      const number = parseInt(
        item.height || item.quality || item.size || item.label,
        10
      );

      if (!url || !number) {
        return null;
      }

      return { size: number, url };
    })
    .filter(Boolean)
    .sort((a, b) => a.size - b.size);
}


// ---------- Small helpers ----------

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }

  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  return `${m}:${String(s).padStart(2, "0")}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}


// ---------- Icons ----------

const iconProps = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "currentColor",
  "aria-hidden": "true",
};

const PlayIcon = () => (
  <svg {...iconProps}><path d="M8 5v14l11-7z" /></svg>
);
const PauseIcon = () => (
  <svg {...iconProps}><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>
);
const ReplayIcon = () => (
  <svg {...iconProps}>
    <path d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z" />
  </svg>
);
const Back10Icon = () => (
  <svg {...iconProps}>
    <path d="M12.5 3a9 9 0 1 1-8.2 5.3l1.8.8A7 7 0 1 0 12.5 5v4l-5-4.5 5-4.5z" transform="translate(0 2) scale(.92)" />
    <text x="12" y="16.2" textAnchor="middle" fontSize="7" fontWeight="700" fill="currentColor">10</text>
  </svg>
);
const Fwd10Icon = () => (
  <svg {...iconProps}>
    <path d="M11.5 3a9 9 0 1 0 8.2 5.3l-1.8.8A7 7 0 1 1 11.5 5v4l5-4.5-5-4.5z" transform="translate(0 2) scale(.92)" />
    <text x="12" y="16.2" textAnchor="middle" fontSize="7" fontWeight="700" fill="currentColor">10</text>
  </svg>
);
const VolumeIcon = ({ level }) => (
  <svg {...iconProps}>
    {level === 0 ? (
      <path d="M16.5 12 19 9.5 17.5 8 15 10.5 12.5 8 11 9.5 13.5 12 11 14.5 12.5 16 15 13.5 17.5 16 19 14.5zM3 9v6h4l5 5V4L7 9z" />
    ) : level < 0.5 ? (
      <path d="M3 9v6h4l5 5V4L7 9zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4z" />
    ) : (
      <path d="M3 9v6h4l5 5V4L7 9zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z" />
    )}
  </svg>
);
const SettingsIcon = () => (
  <svg {...iconProps}>
    <path d="M19.4 13a7.7 7.7 0 0 0 0-2l2.1-1.6-2-3.4-2.5 1a7.4 7.4 0 0 0-1.7-1L15 3.3h-4l-.4 2.7a7.4 7.4 0 0 0-1.7 1l-2.5-1-2 3.4L6.6 11a7.7 7.7 0 0 0 0 2l-2.1 1.6 2 3.4 2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.7h4l.4-2.7a7.4 7.4 0 0 0 1.7-1l2.5 1 2-3.4zM13 15.5A3.5 3.5 0 1 1 13 8.5a3.5 3.5 0 0 1 0 7z" />
  </svg>
);
const PipIcon = () => (
  <svg {...iconProps}>
    <path d="M19 7h-8v6h8zm4-4H1v18h22zm-2 16H3V5h18z" />
  </svg>
);
const FullscreenIcon = ({ active }) => (
  <svg {...iconProps}>
    {active ? (
      <path d="M5 16h3v3h2v-5H5zm3-8H5v2h5V5H8zm6 11h2v-3h3v-2h-5zm2-11V5h-2v5h5V8z" />
    ) : (
      <path d="M7 14H5v5h5v-2H7zm-2-4h2V7h3V5H5zm12 7h-3v2h5v-5h-2zM14 5v2h3v3h2V5z" />
    )}
  </svg>
);


// ---------- Styles (scoped with the rvp- prefix) ----------

const PLAYER_CSS = `
.rvp {
  --rvp-accent: var(--rv-accent, #7c3aed);
  --rvp-accent-hot: var(--rv-accent-hot, #8b5cf6);
  position: relative;
  background: #000;
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
  font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #fff;
  outline: none;
  border-radius: inherit;
}
.rvp video {
  display: block;
  width: 100%;
  max-height: 70vh;
  background: #000;
}
.rvp.rvp-full { border-radius: 0; }
.rvp.rvp-full video { max-height: 100vh; height: 100vh; }
.rvp.rvp-idle { cursor: none; }

.rvp-shade-top, .rvp-shade-bottom {
  position: absolute; left: 0; right: 0; pointer-events: none;
  opacity: 0; transition: opacity .25s ease;
}
.rvp-shade-top { top: 0; height: 90px; background: linear-gradient(to bottom, rgba(0,0,0,.72), transparent); }
.rvp-shade-bottom { bottom: 0; height: 150px; background: linear-gradient(to top, rgba(0,0,0,.85), transparent); }
.rvp.rvp-show .rvp-shade-top, .rvp.rvp-show .rvp-shade-bottom { opacity: 1; }

.rvp-title {
  position: absolute; top: 12px; left: 16px; right: 16px; z-index: 3;
  font-size: 15px; font-weight: 600; letter-spacing: .2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  text-shadow: 0 1px 6px rgba(0,0,0,.7);
  opacity: 0; transition: opacity .25s ease; pointer-events: none;
}
.rvp.rvp-show .rvp-title { opacity: 1; }

.rvp-center {
  position: absolute; top: 50%; left: 50%; z-index: 2;
  transform: translate(-50%, -50%);
  width: 76px; height: 76px; border-radius: 50%;
  border: 0; cursor: pointer; color: #fff;
  background: color-mix(in srgb, var(--rvp-accent) 88%, transparent);
  box-shadow: 0 8px 34px rgba(124,58,237,.55), 0 0 0 0 rgba(139,92,246,.5);
  display: flex; align-items: center; justify-content: center;
  transition: transform .18s ease, opacity .2s ease, background .2s ease;
  animation: rvp-pulse 2.4s ease-out infinite;
}
.rvp-center svg { width: 38px; height: 38px; margin-left: 3px; }
.rvp-center:hover { transform: translate(-50%, -50%) scale(1.08); background: var(--rvp-accent-hot); }
.rvp-center.rvp-hidden { opacity: 0; pointer-events: none; animation: none; }
@keyframes rvp-pulse {
  0% { box-shadow: 0 8px 34px rgba(124,58,237,.55), 0 0 0 0 rgba(139,92,246,.45); }
  70%, 100% { box-shadow: 0 8px 34px rgba(124,58,237,.55), 0 0 0 22px rgba(139,92,246,0); }
}

.rvp-spinner {
  position: absolute; top: 50%; left: 50%; z-index: 2;
  width: 54px; height: 54px; margin: -27px 0 0 -27px;
  border-radius: 50%; pointer-events: none;
  border: 4px solid rgba(255,255,255,.22); border-top-color: var(--rvp-accent-hot);
  animation: rvp-spin .8s linear infinite;
}
@keyframes rvp-spin { to { transform: rotate(360deg); } }

.rvp-flash {
  position: absolute; top: 50%; z-index: 2; pointer-events: none;
  transform: translateY(-50%);
  min-width: 64px; padding: 12px 16px; border-radius: 40px;
  background: rgba(0,0,0,.6); font-size: 14px; font-weight: 700; text-align: center;
  animation: rvp-flash .7s ease forwards;
}
.rvp-flash.rvp-left { left: 12%; }
.rvp-flash.rvp-right { right: 12%; }
.rvp-flash.rvp-mid { left: 50%; margin-left: -40px; }
@keyframes rvp-flash {
  0% { opacity: 0; transform: translateY(-50%) scale(.85); }
  20% { opacity: 1; transform: translateY(-50%) scale(1); }
  100% { opacity: 0; transform: translateY(-50%) scale(1.08); }
}

.rvp-bar {
  position: absolute; left: 0; right: 0; bottom: 0; z-index: 4;
  padding: 0 14px 8px;
  opacity: 0; transform: translateY(6px);
  transition: opacity .25s ease, transform .25s ease;
  pointer-events: none;
}
.rvp.rvp-show .rvp-bar { opacity: 1; transform: none; pointer-events: auto; }

.rvp-seek {
  position: relative; height: 18px; cursor: pointer; touch-action: none;
  display: flex; align-items: center;
}
.rvp-track {
  position: relative; width: 100%; height: 4px; border-radius: 4px;
  background: rgba(255,255,255,.25);
  transition: height .12s ease;
}
.rvp-seek:hover .rvp-track, .rvp-seek.rvp-drag .rvp-track { height: 7px; }
.rvp-buffer, .rvp-played, .rvp-hover {
  position: absolute; left: 0; top: 0; bottom: 0; border-radius: 4px;
}
.rvp-buffer { background: rgba(255,255,255,.35); }
.rvp-hover { background: rgba(255,255,255,.22); }
.rvp-played { background: linear-gradient(90deg, var(--rvp-accent), var(--rvp-accent-hot)); }
.rvp-thumb {
  position: absolute; top: 50%; width: 15px; height: 15px; margin: -7.5px 0 0 -7.5px;
  border-radius: 50%; background: #fff;
  box-shadow: 0 0 0 3px rgba(139,92,246,.55), 0 2px 8px rgba(0,0,0,.5);
  transform: scale(0); transition: transform .12s ease;
}
.rvp-seek:hover .rvp-thumb, .rvp-seek.rvp-drag .rvp-thumb { transform: scale(1); }
.rvp-tip {
  position: absolute; bottom: 20px; transform: translateX(-50%);
  padding: 4px 8px; border-radius: 6px; font-size: 12px; font-weight: 600;
  background: rgba(15,12,25,.95); border: 1px solid rgba(139,92,246,.45);
  pointer-events: none; white-space: nowrap;
}

.rvp-row { display: flex; align-items: center; gap: 2px; }
.rvp-spacer { flex: 1; }
.rvp-btn {
  width: 40px; height: 40px; border: 0; border-radius: 8px;
  background: transparent; color: #fff; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  opacity: .92; transition: background .15s ease, transform .15s ease, opacity .15s;
}
.rvp-btn:hover { background: rgba(255,255,255,.14); opacity: 1; }
.rvp-btn:active { transform: scale(.92); }
.rvp-btn:focus-visible { box-shadow: 0 0 0 2px var(--rvp-accent-hot); }

.rvp-vol { display: flex; align-items: center; }
.rvp-vol-slider {
  width: 0; opacity: 0; overflow: hidden;
  transition: width .2s ease, opacity .2s ease, margin .2s ease;
  height: 18px; display: flex; align-items: center; cursor: pointer;
}
.rvp-vol:hover .rvp-vol-slider, .rvp-vol-slider.rvp-drag { width: 72px; opacity: 1; margin: 0 8px 0 2px; }
.rvp-vol-track { position: relative; width: 100%; height: 4px; border-radius: 4px; background: rgba(255,255,255,.3); }
.rvp-vol-fill { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 4px; background: #fff; }
.rvp-vol-knob { position: absolute; top: 50%; width: 12px; height: 12px; margin: -6px 0 0 -6px; border-radius: 50%; background: #fff; }

.rvp-time { font-size: 13px; font-weight: 500; padding: 0 10px; white-space: nowrap; font-variant-numeric: tabular-nums; opacity: .95; }

.rvp-menu {
  position: absolute; right: 14px; bottom: 58px; z-index: 6;
  min-width: 190px; max-height: 60%; overflow-y: auto;
  padding: 6px; border-radius: 12px;
  background: rgba(16,13,28,.96); border: 1px solid rgba(139,92,246,.35);
  box-shadow: 0 16px 44px rgba(0,0,0,.6);
  animation: rvp-pop .14s ease;
  backdrop-filter: blur(10px);
}
@keyframes rvp-pop { from { opacity: 0; transform: translateY(6px) scale(.97); } to { opacity: 1; transform: none; } }
.rvp-menu-title {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px 10px; font-size: 12px; font-weight: 700;
  letter-spacing: .6px; text-transform: uppercase; color: #c4b5fd;
}
.rvp-menu-title button { background: none; border: 0; color: #fff; cursor: pointer; font-size: 16px; padding: 0 4px; }
.rvp-item {
  display: flex; align-items: center; justify-content: space-between; gap: 18px;
  width: 100%; padding: 9px 12px; border: 0; border-radius: 8px;
  background: transparent; color: #fff; font-size: 13.5px; cursor: pointer; text-align: left;
}
.rvp-item:hover { background: rgba(139,92,246,.22); }
.rvp-item.rvp-active { color: #c4b5fd; font-weight: 700; }
.rvp-item .rvp-val { color: #a8a3b8; font-size: 12.5px; }
.rvp-item.rvp-active::after { content: "\\2713"; color: var(--rvp-accent-hot); }
.rvp-item.rvp-nav::after { content: "\\203A"; font-size: 18px; color: #a8a3b8; }

.rvp-notice {
  position: absolute; left: 14px; bottom: 74px; z-index: 5; max-width: 80%;
  padding: 8px 12px; border-radius: 8px; font-size: 12.5px;
  background: rgba(0,0,0,.82); border: 1px solid rgba(139,92,246,.4);
}

@media (max-width: 640px) {
  .rvp-bar { padding: 0 8px 4px; }
  .rvp-btn { width: 36px; height: 36px; }
  .rvp-btn svg { width: 21px; height: 21px; }
  .rvp-time { padding: 0 4px; font-size: 12px; }
  .rvp-vol-slider, .rvp-vol:hover .rvp-vol-slider { display: none; }
  .rvp-skip, .rvp-pip { display: none; }
  .rvp-center { width: 62px; height: 62px; }
  .rvp-menu { right: 8px; bottom: 50px; }
}
@media (prefers-reduced-motion: reduce) {
  .rvp-center { animation: none; }
  .rvp *, .rvp *::before, .rvp *::after { transition: none !important; }
}
`;


export default function VideoPlayer({ video }) {
  const wrapperRef = useRef(null);
  const videoRef = useRef(null);
  const seekRef = useRef(null);
  const volRef = useRef(null);
  const resumeRef = useRef(null);
  const sourceKnownRef = useRef(false);
  const hideTimerRef = useRef(null);
  const flashIdRef = useRef(0);
  const draggingRef = useRef(false);

  const originalUrl = video.video_url;
  const renditions = readRenditions(video);
  const canUseCloudinary = isCloudinaryVideo(originalUrl);

  const [sourceInfo, setSourceInfo] = useState(null);
  const [selectedQuality, setSelectedQuality] = useState(null); // null = original

  const [speed, setSpeed] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [seekDrag, setSeekDrag] = useState(false);
  const [volDrag, setVolDrag] = useState(false);
  const [hoverPct, setHoverPct] = useState(null);
  const [menu, setMenu] = useState(null); // null | "main" | "speed" | "quality"
  const [flash, setFlash] = useState(null);
  const [notice, setNotice] = useState("");


  // ==========================
  // Quality list
  // ==========================

  const qualityOptions = [];

  if (renditions.length > 0) {
    renditions.forEach((item) => {
      qualityOptions.push({ size: item.size, url: item.url, original: false });
    });
    if (sourceInfo) {
      const top = renditions[renditions.length - 1].size;
      if (sourceInfo.short > top) {
        qualityOptions.push({
          size: sourceInfo.short,
          url: originalUrl,
          original: true,
        });
      }
    }
  } else if (canUseCloudinary && sourceInfo) {
    STANDARD_QUALITIES.forEach((size) => {
      if (size < sourceInfo.short) {
        qualityOptions.push({ size, original: false });
      }
    });
    qualityOptions.push({ size: sourceInfo.short, original: true });
  }

  const canChangeQuality = qualityOptions.length > 1;

  const currentSize =
    selectedQuality === null
      ? sourceInfo?.short ||
        (renditions.length ? renditions[renditions.length - 1].size : null)
      : selectedQuality;

  let currentSrc = originalUrl;

  if (selectedQuality !== null) {
    const picked = qualityOptions.find((o) => o.size === selectedQuality);

    if (picked && picked.url) {
      currentSrc = picked.url;
    } else if (canUseCloudinary && sourceInfo) {
      currentSrc = buildQualityUrl(originalUrl, sourceInfo.side, selectedQuality);
    }
  }


  // ==========================
  // Controls visibility
  // ==========================

  const wake = useCallback(() => {
    setShowControls(true);
    clearTimeout(hideTimerRef.current);

    hideTimerRef.current = setTimeout(() => {
      const el = videoRef.current;
      if (el && !el.paused && !draggingRef.current) {
        setShowControls(false);
        setMenu(null);
      }
    }, HIDE_DELAY);
  }, []);

  useEffect(() => () => clearTimeout(hideTimerRef.current), []);

  useEffect(() => {
    if (!playing) {
      clearTimeout(hideTimerRef.current);
      setShowControls(true);
    } else {
      wake();
    }
  }, [playing, wake]);


  // ==========================
  // Actions
  // ==========================

  function showFlash(text, side) {
    flashIdRef.current += 1;
    setFlash({ id: flashIdRef.current, text, side });
  }

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;

    if (el.paused || el.ended) {
      const p = el.play();
      if (p && p.catch) p.catch(() => {});
    } else {
      el.pause();
    }
  }, []);

  const seekBy = useCallback((delta) => {
    const el = videoRef.current;
    if (!el || !Number.isFinite(el.duration)) return;

    el.currentTime = clamp(el.currentTime + delta, 0, el.duration);
    setCurrent(el.currentTime);
    showFlash(delta > 0 ? "+10s" : "-10s", delta > 0 ? "right" : "left");
  }, []);

  const changeVolume = useCallback((value) => {
    const el = videoRef.current;
    if (!el) return;

    const v = clamp(value, 0, 1);
    el.volume = v;
    el.muted = v === 0;
    setVolume(v);
    setMuted(v === 0);
  }, []);

  const toggleMute = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;

    if (el.muted || el.volume === 0) {
      el.muted = false;
      if (el.volume === 0) el.volume = 0.6;
      setVolume(el.volume);
      setMuted(false);
    } else {
      el.muted = true;
      setMuted(true);
    }
  }, []);

  const toggleFullscreen = useCallback(() => {
    const node = wrapperRef.current;
    if (!node) return;

    if (document.fullscreenElement) {
      document.exitFullscreen && document.exitFullscreen();
    } else if (node.requestFullscreen) {
      node.requestFullscreen().catch(() => {});
    } else if (videoRef.current && videoRef.current.webkitEnterFullscreen) {
      videoRef.current.webkitEnterFullscreen();
    }
  }, []);

  const togglePip = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;

    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
    } else if (el.requestPictureInPicture) {
      el.requestPictureInPicture().catch(() => {});
    }
  }, []);

  function changeSpeed(value) {
    if (videoRef.current) videoRef.current.playbackRate = value;
    setSpeed(value);
    setMenu(null);
    showFlash(`${value}x`, "mid");
  }

  function changeQuality(option) {
    const el = videoRef.current;

    if (el) {
      resumeRef.current = { time: el.currentTime, playing: !el.paused };
    }

    setNotice("");
    setWaiting(true);
    setSelectedQuality(option.original ? null : option.size);
    setMenu(null);
  }


  // ==========================
  // Video events
  // ==========================

  const handleLoadedMetadata = useCallback(
    (event) => {
      const el = event.currentTarget;

      setDuration(el.duration || 0);

      if (!sourceKnownRef.current) {
        sourceKnownRef.current = true;
        const width = el.videoWidth;
        const height = el.videoHeight;

        if (width && height) {
          setSourceInfo({
            side: height > width ? "w" : "h",
            short: Math.min(width, height),
          });
        }
      }

      el.playbackRate = speed;

      if (resumeRef.current) {
        const { time, playing: wasPlaying } = resumeRef.current;
        resumeRef.current = null;
        el.currentTime = time;

        if (wasPlaying) {
          const p = el.play();
          if (p && p.catch) p.catch(() => {});
        }
      }
    },
    [speed]
  );

  function updateBuffered() {
    const el = videoRef.current;
    if (!el || !el.duration) return;

    let end = 0;
    for (let i = 0; i < el.buffered.length; i += 1) {
      if (el.buffered.start(i) <= el.currentTime + 0.5) {
        end = Math.max(end, el.buffered.end(i));
      }
    }
    setBuffered(end);
  }

  function handleTimeUpdate(event) {
    if (!draggingRef.current) {
      setCurrent(event.currentTarget.currentTime);
    }
    updateBuffered();
  }

  function handleError() {
    if (selectedQuality !== null) {
      setSelectedQuality(null);
      setNotice(
        "That quality is not ready yet. Switched back to the original. Please try again in a moment."
      );
    } else {
      setWaiting(false);
      setNotice("This video could not be played.");
    }
  }

  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(t);
  }, [notice]);


  // ==========================
  // Seek bar + volume (pointer drag)
  // ==========================

  function pctFromEvent(event, node) {
    const rect = node.getBoundingClientRect();
    return clamp((event.clientX - rect.left) / (rect.width || 1), 0, 1);
  }

  function handleSeekDown(event) {
    const node = seekRef.current;
    const el = videoRef.current;
    if (!node || !el || !duration) return;

    draggingRef.current = true;
    setSeekDrag(true);
    node.setPointerCapture && node.setPointerCapture(event.pointerId);

    const pct = pctFromEvent(event, node);
    setCurrent(pct * duration);
    setHoverPct(pct);
  }

  function handleSeekMove(event) {
    const node = seekRef.current;
    if (!node) return;

    const pct = pctFromEvent(event, node);
    setHoverPct(pct);

    if (draggingRef.current && duration) {
      setCurrent(pct * duration);
    }
  }

  function handleSeekUp(event) {
    const node = seekRef.current;
    const el = videoRef.current;

    if (!draggingRef.current || !node || !el) return;

    const pct = pctFromEvent(event, node);
    draggingRef.current = false;
    setSeekDrag(false);

    el.currentTime = pct * duration;
    setCurrent(pct * duration);
    setEnded(false);
    wake();
  }

  function handleVolDown(event) {
    const node = volRef.current;
    if (!node) return;

    setVolDrag(true);
    node.setPointerCapture && node.setPointerCapture(event.pointerId);
    changeVolume(pctFromEvent(event, node));
  }

  function handleVolMove(event) {
    if (!volDrag || !volRef.current) return;
    changeVolume(pctFromEvent(event, volRef.current));
  }

  function handleVolUp() {
    setVolDrag(false);
  }


  // ==========================
  // Keyboard shortcuts (when the player is focused / hovered)
  // ==========================

  function handleKeyDown(event) {
    const tag = (event.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;

    const key = event.key;
    let handled = true;

    if (key === " " || key === "k" || key === "K") {
      if (tag === "button" && key === " ") {
        // let the focused button handle space itself
        handled = false;
      } else {
        togglePlay();
      }
    } else if (key === "ArrowRight" || key === "l" || key === "L") {
      seekBy(key === "ArrowRight" ? 5 : 10);
    } else if (key === "ArrowLeft" || key === "j" || key === "J") {
      seekBy(key === "ArrowLeft" ? -5 : -10);
    } else if (key === "ArrowUp") {
      changeVolume((videoRef.current?.volume ?? volume) + 0.05);
    } else if (key === "ArrowDown") {
      changeVolume((videoRef.current?.volume ?? volume) - 0.05);
    } else if (key === "m" || key === "M") {
      toggleMute();
    } else if (key === "f" || key === "F") {
      toggleFullscreen();
    } else if (key === "Escape") {
      if (menu) setMenu(null);
      else handled = false;
    } else if (key === ">" || key === "<") {
      const i = SPEED_OPTIONS.indexOf(speed);
      const next = clamp(i + (key === ">" ? 1 : -1), 0, SPEED_OPTIONS.length - 1);
      changeSpeed(SPEED_OPTIONS[next]);
    } else if (/^[0-9]$/.test(key) && videoRef.current && duration) {
      videoRef.current.currentTime = (duration * Number(key)) / 10;
    } else {
      handled = false;
    }

    if (handled) {
      event.preventDefault();
      event.stopPropagation();
      wake();
    }
  }


  // ==========================
  // Fullscreen + outside click
  // ==========================

  useEffect(() => {
    function onFs() {
      setFullscreen(document.fullscreenElement === wrapperRef.current);
    }
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(() => {
    if (!menu) return undefined;

    function onDown(event) {
      const node = wrapperRef.current;
      if (!node) return;
      if (event.target.closest && event.target.closest(".rvp-menu, .rvp-settings-btn")) {
        return;
      }
      setMenu(null);
    }

    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [menu]);

  // Move keyboard focus to the player so shortcuts work right away.
  useEffect(() => {
    if (wrapperRef.current) wrapperRef.current.focus({ preventScroll: true });
  }, []);


  // ==========================
  // Click handling on the picture
  // ==========================

  const lastTapRef = useRef({ time: 0, x: 0 });

  function handleSurfaceClick(event) {
    if (menu) {
      setMenu(null);
      return;
    }

    const now = Date.now();
    const rect = wrapperRef.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const last = lastTapRef.current;

    // double click / double tap: left = back 10s, right = forward 10s, middle = fullscreen
    if (now - last.time < 280) {
      lastTapRef.current = { time: 0, x: 0 };

      if (x < 0.33) seekBy(-10);
      else if (x > 0.67) seekBy(10);
      else toggleFullscreen();

      return;
    }

    lastTapRef.current = { time: now, x };

    setTimeout(() => {
      if (lastTapRef.current.time === now) {
        togglePlay();
      }
    }, 260);
  }


  // ==========================
  // Render
  // ==========================

  const playedPct = duration ? (current / duration) * 100 : 0;
  const bufferedPct = duration ? (buffered / duration) * 100 : 0;
  const volumeLevel = muted ? 0 : volume;
  const title = video.title || "";

  const rootClass = [
    "rvp",
    showControls || !playing || menu ? "rvp-show" : "rvp-idle",
    fullscreen ? "rvp-full" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={wrapperRef}
      className={rootClass}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseMove={wake}
      onTouchStart={wake}
      onMouseLeave={() => {
        if (playing && !menu) setShowControls(false);
      }}
    >
      <style>{PLAYER_CSS}</style>

      <video
        ref={videoRef}
        src={currentSrc}
        autoPlay
        playsInline
        preload="auto"
        onClick={handleSurfaceClick}
        onLoadedMetadata={handleLoadedMetadata}
        onDurationChange={(e) => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={handleTimeUpdate}
        onProgress={updateBuffered}
        onPlay={() => {
          setPlaying(true);
          setEnded(false);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setEnded(true);
          setPlaying(false);
        }}
        onWaiting={() => setWaiting(true)}
        onCanPlay={() => setWaiting(false)}
        onPlaying={() => setWaiting(false)}
        onVolumeChange={(e) => {
          setVolume(e.currentTarget.volume);
          setMuted(e.currentTarget.muted);
        }}
        onRateChange={(e) => setSpeed(e.currentTarget.playbackRate)}
        onError={handleError}
      />

      <div className="rvp-shade-top" />
      <div className="rvp-shade-bottom" />

      {title && <div className="rvp-title">{title}</div>}

      {waiting && !ended && <div className="rvp-spinner" />}

      {flash && (
        <div
          key={flash.id}
          className={`rvp-flash rvp-${flash.side}`}
        >
          {flash.text}
        </div>
      )}

      <button
        type="button"
        aria-label={ended ? "Replay" : "Play"}
        className={`rvp-center ${(!playing && !waiting) || ended ? "" : "rvp-hidden"}`}
        onClick={togglePlay}
      >
        {ended ? <ReplayIcon /> : <PlayIcon />}
      </button>

      {notice && <div className="rvp-notice">{notice}</div>}

      {menu && (
        <div className="rvp-menu" role="menu">
          {menu === "main" && (
            <>
              <button
                type="button"
                className="rvp-item rvp-nav"
                onClick={() => setMenu("speed")}
              >
                <span>Playback speed</span>
                <span className="rvp-val">
                  {speed === 1 ? "Normal" : `${speed}x`}
                </span>
              </button>
              {canChangeQuality && (
                <button
                  type="button"
                  className="rvp-item rvp-nav"
                  onClick={() => setMenu("quality")}
                >
                  <span>Quality</span>
                  <span className="rvp-val">
                    {currentSize ? qualityLabel(currentSize) : "Auto"}
                  </span>
                </button>
              )}
            </>
          )}

          {menu === "speed" && (
            <>
              <div className="rvp-menu-title">
                <button type="button" onClick={() => setMenu("main")}>
                  ‹
                </button>
                Speed
              </div>
              {SPEED_OPTIONS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`rvp-item ${value === speed ? "rvp-active" : ""}`}
                  onClick={() => changeSpeed(value)}
                >
                  <span>{value === 1 ? "1x (Normal)" : `${value}x`}</span>
                </button>
              ))}
            </>
          )}

          {menu === "quality" && (
            <>
              <div className="rvp-menu-title">
                <button type="button" onClick={() => setMenu("main")}>
                  ‹
                </button>
                Quality
              </div>
              {[...qualityOptions].reverse().map((option) => (
                <button
                  key={option.size}
                  type="button"
                  className={`rvp-item ${option.size === currentSize ? "rvp-active" : ""}`}
                  onClick={() => changeQuality(option)}
                >
                  <span>
                    {qualityLabel(option.size)}
                    {option.original ? " (Original)" : ""}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}

      <div className="rvp-bar">

        <div
          ref={seekRef}
          className={`rvp-seek ${seekDrag ? "rvp-drag" : ""}`}
          onPointerDown={handleSeekDown}
          onPointerMove={handleSeekMove}
          onPointerUp={handleSeekUp}
          onPointerCancel={handleSeekUp}
          onPointerLeave={() => {
            if (!draggingRef.current) setHoverPct(null);
          }}
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(current)}
        >
          <div className="rvp-track">
            <div className="rvp-buffer" style={{ width: `${bufferedPct}%` }} />
            {hoverPct !== null && (
              <div className="rvp-hover" style={{ width: `${hoverPct * 100}%` }} />
            )}
            <div className="rvp-played" style={{ width: `${playedPct}%` }} />
            <div className="rvp-thumb" style={{ left: `${playedPct}%` }} />
          </div>
          {hoverPct !== null && duration > 0 && (
            <div className="rvp-tip" style={{ left: `${hoverPct * 100}%` }}>
              {formatTime(hoverPct * duration)}
            </div>
          )}
        </div>

        <div className="rvp-row">

          <button
            type="button"
            className="rvp-btn"
            title={playing ? "Pause (k)" : "Play (k)"}
            onClick={togglePlay}
          >
            {ended ? <ReplayIcon /> : playing ? <PauseIcon /> : <PlayIcon />}
          </button>

          <button
            type="button"
            className="rvp-btn rvp-skip"
            title="Back 10 seconds (j)"
            onClick={() => seekBy(-10)}
          >
            <Back10Icon />
          </button>

          <button
            type="button"
            className="rvp-btn rvp-skip"
            title="Forward 10 seconds (l)"
            onClick={() => seekBy(10)}
          >
            <Fwd10Icon />
          </button>

          <div className="rvp-vol">
            <button
              type="button"
              className="rvp-btn"
              title={muted ? "Unmute (m)" : "Mute (m)"}
              onClick={toggleMute}
            >
              <VolumeIcon level={volumeLevel} />
            </button>
            <div
              ref={volRef}
              className={`rvp-vol-slider ${volDrag ? "rvp-drag" : ""}`}
              onPointerDown={handleVolDown}
              onPointerMove={handleVolMove}
              onPointerUp={handleVolUp}
              onPointerCancel={handleVolUp}
              role="slider"
              aria-label="Volume"
            >
              <div className="rvp-vol-track">
                <div className="rvp-vol-fill" style={{ width: `${volumeLevel * 100}%` }} />
                <div className="rvp-vol-knob" style={{ left: `${volumeLevel * 100}%` }} />
              </div>
            </div>
          </div>

          <div className="rvp-time">
            {formatTime(current)} / {formatTime(duration)}
          </div>

          <div className="rvp-spacer" />

          <button
            type="button"
            className="rvp-btn rvp-settings-btn"
            title="Settings (speed, quality)"
            onClick={() => setMenu(menu ? null : "main")}
          >
            <SettingsIcon />
          </button>

          {typeof document !== "undefined" &&
            document.pictureInPictureEnabled && (
              <button
                type="button"
                className="rvp-btn rvp-pip"
                title="Picture in picture"
                onClick={togglePip}
              >
                <PipIcon />
              </button>
            )}

          <button
            type="button"
            className="rvp-btn"
            title={fullscreen ? "Exit fullscreen (f)" : "Fullscreen (f)"}
            onClick={toggleFullscreen}
          >
            <FullscreenIcon active={fullscreen} />
          </button>

        </div>
      </div>

    </div>
  );
}
