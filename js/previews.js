// Fast previews: small copies of library photos, made in the browser and saved next to the originals.
//   thumb_path   — about 560 px on the short side, for the grid and lists
//   preview_path — up to 1600 px, for the details view (photos only)
// A video gets a thumb from its cover photo, or else from a frame near the start.
// Originals are never changed; Download always gives the original file.
import { api, getState, setState, updateRow, refreshStorage } from './store.js';
import { uid, safeName, stripExt } from './util.js';

const THUMB = { short: 560, maxLong: 1100, quality: 0.78 };
const PREVIEW = { long: 1600, quality: 0.82 };

// Only the Cloudflare setup stores previews (the Google version uses Drive's own thumbnails).
export const previewsOn = () => !!api?.previews;

// Which items still need a preview (and from what).
export function previewNeed(a) {
  if (!a) return null;
  if (a.cover_path) return a.thumb_path ? null : 'cover';
  if (a.external_url || !a.storage_path) return null;
  if (a.media_type === 'image') return a.thumb_path && a.preview_path ? null : 'image';
  if (a.media_type === 'video') return a.thumb_path ? null : 'video';
  return null;
}

async function decode(blob) {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch { /* try the <img> way */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}

const sizeOf = (src) => [src.naturalWidth || src.videoWidth || src.width, src.naturalHeight || src.videoHeight || src.height];

// Scales down in halves for a sharp result (one big jump looks jagged in some browsers), then saves a JPEG.
function shrink(src, w, h, quality) {
  let [cw, ch] = sizeOf(src);
  let cur = src;
  while (cw / 2 >= w * 1.2 && ch / 2 >= h * 1.2) {
    cw = Math.round(cw / 2); ch = Math.round(ch / 2);
    const c = Object.assign(document.createElement('canvas'), { width: cw, height: ch });
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(cur, 0, 0, cw, ch);
    cur = c;
  }
  const out = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const x = out.getContext('2d');
  x.fillStyle = '#fff'; // transparent PNGs get a white background in the JPEG
  x.fillRect(0, 0, w, h);
  x.imageSmoothingQuality = 'high';
  x.drawImage(cur, 0, 0, w, h);
  return new Promise((resolve, reject) => out.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make a preview.'))), 'image/jpeg', quality));
}

function thumbSize([w, h]) {
  const s = Math.min(1, THUMB.short / Math.min(w, h), THUMB.maxLong / Math.max(w, h));
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
}
function previewSize([w, h]) {
  const s = Math.min(1, PREVIEW.long / Math.max(w, h));
  return [Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s))];
}

// Photo (File/Blob) → { thumb, preview } JPEG blobs. withPreview: false makes only the thumb.
export async function imagePreviews(blob, { withPreview = true } = {}) {
  const img = await decode(blob);
  const size = sizeOf(img);
  if (!size[0] || !size[1]) throw new Error('Could not read this photo.');
  const thumb = await shrink(img, ...thumbSize(size), THUMB.quality);
  const preview = withPreview ? await shrink(img, ...previewSize(size), PREVIEW.quality) : null;
  img.close?.();
  return { thumb, preview };
}

// Video (File, or its web address) → a JPEG of a frame near the start.
export function videoFrame(src) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    const url = typeof src === 'string' ? src : URL.createObjectURL(src);
    let done = false;
    const finish = (err, val) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      v.removeAttribute('src'); v.load();
      if (typeof src !== 'string') URL.revokeObjectURL(url);
      err ? reject(err) : resolve(val);
    };
    const timer = setTimeout(() => finish(new Error("This video took too long to open — this browser may not play it.")), 45000);
    v.crossOrigin = 'anonymous';
    v.muted = true; v.playsInline = true; v.preload = 'auto';
    v.onerror = () => finish(new Error("This browser can't play this video, so no preview was made."));
    v.onloadedmetadata = () => { v.currentTime = Math.min(1, (v.duration || 2) * 0.1); };
    v.onseeked = async () => {
      try { finish(null, await shrink(v, ...thumbSize(sizeOf(v)), THUMB.quality)); } catch (e) { finish(e); }
    };
    v.src = url;
  });
}

const asFile = (blob, name) => new File([blob], name, { type: 'image/jpeg' });

// Makes and uploads the small copies for one item. `source` is the local File when there is one
// (a fresh upload); otherwise the original is downloaded once. Resolves to { thumb_path, preview_path }.
// upload: { category: 'previews' } for the team, { linkToken } for a creator's upload page.
export async function makePreviews(asset, { source, cover, upload = { category: 'previews' } } = {}) {
  const need = previewNeed(asset);
  if (!need) return {};
  const base = safeName(stripExt(asset.file_name || asset.title || 'item')).slice(0, 60) || 'item';
  const fetchBlob = async (key) => {
    const url = (await api.signedUrls([key]))[key];
    if (!url) throw new Error('File not found.');
    const res = await fetch(url);
    if (!res.ok) throw new Error('Could not download the file.');
    return res.blob();
  };
  let thumb, preview = null;
  if (need === 'cover') ({ thumb } = await imagePreviews(cover || await fetchBlob(asset.cover_path), { withPreview: false }));
  else if (need === 'image') ({ thumb, preview } = await imagePreviews(source || await fetchBlob(asset.storage_path)));
  else thumb = await videoFrame(source || (await api.signedUrls([asset.storage_path]))[asset.storage_path]);

  const saved = [];
  try {
    const put = async (blob, kind) => {
      const name = `${base}-${kind}.jpg`;
      const key = await api.uploadFile(`previews/${uid()}-${name}`, asFile(blob, name), upload);
      saved.push(key);
      return key;
    };
    return { thumb_path: await put(thumb, 'small'), preview_path: preview ? await put(preview, 'medium') : asset.preview_path || null };
  } catch (e) {
    if (saved.length) api.removeFiles(saved).catch(() => {});
    throw e;
  }
}

// The frame a <video> is showing right now, as a cover photo file (up to 1600 px).
export async function frameToFile(video, name = 'cover') {
  const [w, h] = sizeOf(video);
  if (!w || !h) throw new Error("The video hasn't loaded yet — wait a moment and try again.");
  let blob;
  try { blob = await shrink(video, ...previewSize([w, h]), PREVIEW.quality); } catch (e) {
    throw new Error("Couldn't take a picture from this video here. Try another browser, or choose a photo instead.");
  }
  const base = safeName(stripExt(name)).slice(0, 60) || 'video';
  return asFile(blob, `${base}-frame.jpg`);
}

// A photo already in the library, as a cover photo for a video. It's a separate copy (up to 1600 px, made from the
// photo's medium copy when it has one), so deleting the video never touches the photo and the other way round.
export async function coverFromLibrary(photo) {
  const key = photo.preview_path || photo.storage_path;
  const url = (await api.signedUrls([key]))[key];
  if (!url) throw new Error('That photo is no longer in the library.');
  const res = await fetch(url);
  if (!res.ok) throw new Error('Could not load that photo. Please try again.');
  const { preview } = await imagePreviews(await res.blob());
  const base = safeName(stripExt(photo.file_name || photo.title || 'photo')).slice(0, 60) || 'photo';
  return asFile(preview, `${base}-cover.jpg`);
}

// For a fresh upload: never lets a preview problem stop the upload itself.
export async function previewsForUpload(file, kind, { cover, upload } = {}) {
  if (!previewsOn() || !['image', 'video'].includes(kind)) return {};
  try {
    return await makePreviews({ media_type: kind, storage_path: 'new', cover_path: cover ? 'new' : null, file_name: file.name },
      { source: file, cover, upload });
  } catch { return {}; }
}

// ── Making previews for what's already in the library (one run, from Library or Settings) ──
// Runs in this browser: each original is downloaded once, shrunk, and the small copies saved.
// Keeps going while you move around the app; "Stop" finishes the ones in progress and stops.
let job = null;
const busyMsg = /storage is full|not enough space/i;

export function previewTodo(assets) {
  const failed = new Set(getState().previewFailed || []);
  return assets.filter((a) => previewNeed(a) && !failed.has(a.id));
}

export async function startPreviewJob() {
  if (job || !previewsOn()) return;
  job = { stop: false };
  const failed = new Set(getState().previewFailed || []);
  const queue = previewTodo(getState().assets).map((a) => a.id);
  const total = queue.length, started = Date.now();
  let done = 0, made = 0, error = null;
  const show = (running = true) => setState({ previewJob: { total, done, made, failed: failed.size, running, error, started } });
  show();
  const keepAwake = await navigator.wakeLock?.request('screen').catch(() => null); // so the computer doesn't sleep mid-way
  const one = async () => {
    while (!job.stop && queue.length) {
      const id = queue.shift();
      const a = getState().assets.find((x) => x.id === id);
      if (a && previewNeed(a)) {
        try {
          const small = await makePreviews(a);
          try { await updateRow('assets', a.id, small); } catch (e) {
            api.removeFiles([small.thumb_path, small.preview_path].filter((k) => k && k !== a.preview_path)).catch(() => {});
            throw e;
          }
          // An earlier copy that was replaced (e.g. a photo that only had its small one) is removed.
          const replaced = [a.thumb_path, a.preview_path].filter((k) => k && k !== small.thumb_path && k !== small.preview_path);
          if (replaced.length) api.removeFiles(replaced).catch(() => {});
          made++;
        } catch (e) {
          failed.add(a.id);
          if (busyMsg.test(e.message || '')) { error = e.message; job.stop = true; }
        }
      }
      done++;
      show();
    }
  };
  // Phones get one at a time (big photos need a lot of memory); computers do three at once.
  const lanes = matchMedia('(pointer: coarse)').matches ? 1 : 3;
  await Promise.all(Array.from({ length: lanes }, one));
  keepAwake?.release?.().catch(() => {});
  job = null;
  setState({ previewFailed: [...failed] });
  show(false);
  refreshStorage();
}
export const stopPreviewJob = () => { if (job) job.stop = true; };
export const previewJobRunning = () => !!job;
addEventListener('beforeunload', (e) => { if (job) { e.preventDefault(); e.returnValue = ''; } });
