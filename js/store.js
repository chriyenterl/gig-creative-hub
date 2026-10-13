// App-wide data store: loads every table once after login, then keeps the
// local copy in sync with each change so screens update instantly.
import { useState, useEffect } from './lib.js';

export let api = null;
export function setApi(backend) { api = backend; }

const TABLES = {
  assets:       { order: ['created_at', false] },
  talents:      { order: ['created_at', false] },
  seasons:      { order: ['sort_order', true] },
  upload_links: { order: ['created_at', false] },
  team_members: { order: ['created_at', true] },
};

let state = {
  loaded: false,
  user: null,
  openAssetId: null,
  assets: [], talents: [], seasons: [], upload_links: [], team_members: [],
};
const listeners = new Set();

export const getState = () => state;
const bySeasonOrder = (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name);
export function setState(patch) {
  if (patch.seasons) patch = { ...patch, seasons: [...patch.seasons].sort(bySeasonOrder) };
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
}

export function useStore() {
  const [s, set] = useState(state);
  useEffect(() => {
    listeners.add(set);
    set(state);
    return () => listeners.delete(set);
  }, []);
  return s;
}

export async function loadAll() {
  const names = Object.keys(TABLES);
  if (api.loadAll) {
    const all = await api.loadAll();
    const sort = (rows, [col, asc]) => [...(rows || [])].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (asc ? 1 : -1));
    setState({ ...Object.fromEntries(names.map((t) => [t, sort(all[t], TABLES[t].order)])), backendLinks: all.links || null, loaded: true });
    return;
  }
  const results = await Promise.all(names.map((t) => api.list(t, TABLES[t])));
  setState({ ...Object.fromEntries(names.map((t, i) => [t, results[i]])), loaded: true });
}
export async function reload(table) {
  setState({ [table]: await api.list(table, TABLES[table]) });
}

// ── Mutations: write to the backend, then patch local state ──────────────
export async function insertRow(table, row) {
  const r = await api.insert(table, row);
  setState({ [table]: table === 'seasons' || table === 'team_members' ? [...state[table], r] : [r, ...state[table]] });
  return r;
}
export async function insertRows(table, rows) {
  if (!rows.length) return [];
  const created = await api.insertMany(table, rows);
  setState({ [table]: [...created, ...state[table]] });
  return created;
}
export async function updateRow(table, id, patch) {
  const r = await api.update(table, id, patch);
  setState({ [table]: state[table].map((x) => (x.id === id ? r : x)) });
  return r;
}
export async function updateRows(table, ids, patch) {
  const rows = await api.updateMany(table, ids, patch);
  const byId = new Map(rows.map((r) => [r.id, r]));
  setState({ [table]: state[table].map((x) => byId.get(x.id) ?? x) });
}
export async function deleteRow(table, id) {
  await api.remove(table, id);
  setState({ [table]: state[table].filter((x) => x.id !== id) });
}

// Deleting a talent/season/link clears references on other rows (done by the DB); mirror that locally.
export async function deleteAndUnlink(table, id) {
  await deleteRow(table, id);
  const col = { seasons: 'season_id', talents: 'talent_id', upload_links: 'upload_link_id' }[table];
  if (!col) return;
  const clear = (rows) => rows.map((r) => (r[col] === id ? { ...r, [col]: null } : r));
  setState({ assets: clear(state.assets), upload_links: clear(state.upload_links) });
}

export async function deleteAssets(assets) {
  await api.removeFiles(assets.map((a) => a.storage_path));
  await api.removeMany('assets', assets.map((a) => a.id));
  const gone = new Set(assets.map((a) => a.id));
  setState({ assets: state.assets.filter((a) => !gone.has(a.id)) });
}

// After logging/removing usage the DB recalculates counts — fetch the fresh asset row.
export async function refreshAsset(id) {
  const [row] = await api.list('assets', { eq: { id } });
  if (row) setState({ assets: state.assets.map((a) => (a.id === id ? row : a)) });
}

export const openAsset = (id) => setState({ openAssetId: id });
export const closeAsset = () => setState({ openAssetId: null });

// ── Lookups ───────────────────────────────────────────────────────────────
export const seasonById = (id) => state.seasons.find((s) => s.id === id);
export const talentById = (id) => state.talents.find((t) => t.id === id);
