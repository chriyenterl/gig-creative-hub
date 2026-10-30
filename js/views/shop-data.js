// Webstore data for the Hub's Webstore pages (orders, products, store settings): loaded once, kept in sync.
import { useState, useEffect } from '../lib.js';
import { api, setState } from '../store.js';
import { imagePreviews } from '../previews.js';
import { stripExt } from '../util.js';

let S = { loaded: false, error: null, settings: null, products: [], orders: [], owner: false, urls: {} };
const subs = new Set();
const emit = () => subs.forEach((f) => f(S));

export const shopState = () => S;
export function setShop(patch) {
  S = { ...S, ...patch };
  emit();
  if (patch.orders) setState({ shopNew: S.orders.filter((o) => o.status === 'new').length });
  if (patch.products || patch.settings) loadUrls();
}
export function useShop() {
  const [s, set] = useState(S);
  useEffect(() => { subs.add(set); set(S); return () => subs.delete(set); }, []);
  return s;
}

export async function loadShop() {
  const d = await api.shop.admin();
  setShop({ ...d, loaded: true, error: null });
  return d;
}

// Photo addresses (the demo keeps them in this browser, so they're looked up rather than built).
async function loadUrls() {
  const st = S.settings;
  const keys = [...S.products.map((p) => p.image_path), st?.logo_path, st?.cover_path, st?.payments?.duitnow?.qr_path].filter((k) => k && !S.urls[k]);
  if (!keys.length) return;
  const got = await api.shop.fileUrls(keys).catch(() => ({}));
  S = { ...S, urls: { ...S.urls, ...got } };
  emit();
}
export async function fileUrl(key) { return key ? (await api.shop.fileUrls([key]))[key] || null : null; }

export const replaceOrder = (o) => setShop({ orders: S.orders.map((x) => (x.id === o.id ? o : x)) });
export const replaceProduct = (p) => setShop({ products: S.products.some((x) => x.id === p.id) ? S.products.map((x) => (x.id === p.id ? p : x)) : [...S.products, p] });

// The customer storefront's address (the shop/ folder next to the Hub).
export const storeUrl = () => new URL('shop/', location.href.split('#')[0]).href;

// Big photos are made smaller before upload (up to 1600 px) so the store loads quickly on phones.
// Small files (e.g. a PNG logo with a see-through background) go up as they are.
export async function uploadShopPhoto(file, onProgress) {
  let up = file;
  if (file.size > 600e3 || !/^image\/(jpeg|png|webp)$/.test(file.type)) {
    try {
      const { preview } = await imagePreviews(file);
      up = new File([preview], stripExt(file.name) + '.jpg', { type: 'image/jpeg' });
    } catch { /* the browser can't read it — send the original */ }
  }
  return api.shop.uploadImage(up, { onProgress });
}
