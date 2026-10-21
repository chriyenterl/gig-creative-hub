// "Make fast previews": a one-time run for items uploaded before previews existed (new uploads get them
// automatically). Shown at the top of the Library while items still need one, and in Settings.
import { html, useState } from '../lib.js';
import { useStore } from '../store.js';
import { Icon, Progress } from '../ui.js';
import { previewsOn, previewTodo, startPreviewJob, stopPreviewJob } from '../previews.js';

const minutes = (ms) => (ms < 90e3 ? 'about a minute' : `about ${Math.round(ms / 60e3)} min`);

export function FastPreviews({ inSettings = false }) {
  const { assets, previewJob: job } = useStore();
  const [hidden, setHidden] = useState(false);
  if (!previewsOn()) return null;
  const todo = previewTodo(assets).length;
  const running = job?.running;
  if (!running && !todo && !(job && !hidden)) {
    return inSettings ? html`<p class="muted small fp-ok"><${Icon} name="check" size=${14} />Every photo and video has a fast preview.</p>` : null;
  }
  if (!running && !todo && job) { // finished
    return html`<div class="fp-box fp-done">
      <${Icon} name="check" size=${18} />
      <div><b>Fast previews done — ${job.made} made.</b>
        ${job.failed > 0 && html`<span class="muted small">${job.failed} couldn't be made (for example a video this browser can't play). They still open — just the slower way.</span>`}</div>
      ${!inSettings && html`<button class="icon-btn" aria-label="Close" onClick=${() => setHidden(true)}><${Icon} name="x" size=${16} /></button>`}
    </div>`;
  }
  if (running) {
    const left = job.done >= 6 ? ((Date.now() - job.started) / job.done) * (job.total - job.done) : null;
    return html`<div class="fp-box">
      <div class="fp-text"><b>Making fast previews… ${job.done} of ${job.total}</b>
        <span class="muted small">Keep this page open (you can use the app meanwhile)${left ? ` · ${minutes(left)} left` : ''}.</span>
        <${Progress} value=${job.total ? job.done / job.total : 0} /></div>
      <button class="btn btn-sm" onClick=${stopPreviewJob}><${Icon} name="stop" size=${14} />Stop</button>
    </div>`;
  }
  return html`<div class="fp-box">
    <span class="fp-icon"><${Icon} name="image" size=${18} /></span>
    <div class="fp-text"><b>${todo} item${todo === 1 ? '' : 's'} load slowly — make fast previews</b>
      <span class="muted small">Saves a small copy of each photo (originals and downloads stay full quality). Best on a computer with good wifi —
        about ${Math.max(1, Math.round(todo * 3 / 60))} min. You can stop and continue later.</span>
      ${job?.error && html`<span class="error-text small">${job.error}</span>`}</div>
    <button class="btn btn-primary" onClick=${startPreviewJob}><${Icon} name="play" size=${14} />${job ? 'Continue' : 'Make fast previews'}</button>
  </div>`;
}
