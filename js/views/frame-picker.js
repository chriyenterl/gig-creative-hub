// "From video": play or slide through a video and use the moment on screen as its cover photo.
import { html, useState, useEffect, useRef } from '../lib.js';
import { Icon, Modal, toastError } from '../ui.js';
import { frameToFile } from '../previews.js';

const clock = (s) => { s = Math.max(0, s || 0); return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`; };

// src: the video's web address, or a File that hasn't been uploaded yet.
export function FramePicker({ src, name, onPick, onClose }) {
  const ref = useRef();
  const [url, setUrl] = useState(typeof src === 'string' ? src : null);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (typeof src === 'string') return setUrl(src);
    const u = URL.createObjectURL(src);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [src]);

  const seek = (t) => { const v = ref.current; if (!v || !duration) return; v.pause(); v.currentTime = Math.min(Math.max(0, t), duration - 0.05); };
  const use = async () => {
    setBusy(true);
    try { ref.current.pause(); onPick(await frameToFile(ref.current, name)); onClose(); } catch (e) { toastError(e); setBusy(false); }
  };

  return html`<${Modal} title="Choose a cover from the video" size="lg" onClose=${() => !busy && onClose()} footer=${html`
      <span class="muted small">Play, or slide to the moment you want, then press <b>Use this frame</b>.</span>
      <span class="spacer"></span>
      <button class="btn" disabled=${busy} onClick=${onClose}>Cancel</button>
      <button class="btn btn-primary" disabled=${!ready || busy || !!error} onClick=${use}><${Icon} name="check" size=${16} />${busy ? 'Saving…' : 'Use this frame'}</button>`}>
    ${error ? html`<p class="error-text">${error}</p>` : html`<div class="frame-pick">
      ${url && html`<video ref=${ref} src=${url} crossorigin="anonymous" controls playsinline muted preload="auto"
        onLoadedMetadata=${(e) => { setDuration(e.target.duration || 0); e.target.currentTime = Math.min(1, (e.target.duration || 2) * 0.1); }}
        onLoadedData=${() => setReady(true)} onSeeked=${(e) => setTime(e.target.currentTime)} onTimeUpdate=${(e) => setTime(e.target.currentTime)}
        onError=${() => setError("This browser can't play this video, so a frame can't be taken here. Try Safari or Chrome on a computer, or choose a photo instead.")}></video>`}
      <div class="frame-controls">
        <button type="button" class="btn btn-sm" disabled=${!ready} onClick=${() => seek(time - 1)} aria-label="Back 1 second">−1s</button>
        <button type="button" class="btn btn-sm" disabled=${!ready} onClick=${() => seek(time - 0.1)} aria-label="Back a little">−0.1s</button>
        <input type="range" min="0" max=${duration || 0} step="0.05" value=${time} disabled=${!ready} aria-label="Moment in the video"
          onInput=${(e) => seek(Number(e.target.value))} />
        <button type="button" class="btn btn-sm" disabled=${!ready} onClick=${() => seek(time + 0.1)} aria-label="Forward a little">+0.1s</button>
        <button type="button" class="btn btn-sm" disabled=${!ready} onClick=${() => seek(time + 1)} aria-label="Forward 1 second">+1s</button>
        <span class="muted small frame-time">${clock(time)} / ${clock(duration)}</span>
      </div>
    </div>`}
  <//>`;
}
