// Import talents from a CSV file (e.g. a Notion database export → "Markdown & CSV").
import { html, useState, useMemo } from '../lib.js';
import { useStore, insertRows } from '../store.js';
import {
  TALENT_STATUS, parseCSV, parseTags, parseFollowers, normalizePlatforms, normalizeLanguages, splitList, joinList,
  handleFromUrl, platformFromUrl, fmtNum, talentStatus,
} from '../util.js';
import { Icon, Modal, Dropzone, Field, toast, toastError } from '../ui.js';

const FIELDS = [
  ['', "Don't import"],
  ['name', 'Name'], ['handle', 'Handle'], ['profile_url', 'Profile link'], ['platform', 'Platforms'],
  ['followers', 'Followers'], ['engagement_rate', 'Engagement rate'], ['tier', 'Tier'], ['talent_type', 'Type'],
  ['languages', 'Languages'], ['brand', 'Brand'], ['niche', 'Niche / content'], ['location', 'Location'],
  ['email', 'Email'], ['phone', 'Phone / WhatsApp'], ['rate', 'Rate'], ['notes', 'Notes'], ['tags', 'Tags'],
  ['status', 'Status'], ['contacted', 'Contacted? (yes/no → status)'],
];

// Guess what each column is from its header (and, for ambiguous ones, its values).
const GUESSES = [
  [/^(name|talent|creator|influencer|kol|full ?name|talent name)$/i, 'name'],
  [/e-?mail/i, 'email'],
  [/phone|whats ?app|mobile|tel\b|contact (no|number)/i, 'phone'],
  [/handle|user ?name/i, 'handle'],
  [/profile|link|url/i, 'profile_url'],
  [/platform|channel/i, 'platform'],
  [/follower|audience|subscriber/i, 'followers'],
  [/engagement|^er$/i, 'engagement_rate'],
  [/tier|size/i, 'tier'],
  [/^type$|talent type|creator type/i, 'talent_type'],
  [/lang/i, 'languages'],
  [/brand|client|campaign/i, 'brand'],
  [/niche|categor|vertical|content/i, 'niche'],
  [/location|city|region|country|state|area/i, 'location'],
  [/rate|price|fee|cost/i, 'rate'],
  [/note|comment|remark|description|about/i, 'notes'],
  [/tag|label/i, 'tags'],
  [/status|stage|pipeline/i, 'status'],
  [/contact/i, 'contacted'],
];
function guessField(header, values) {
  const hit = GUESSES.find(([re]) => re.test(header.trim()));
  let field = hit ? hit[1] : '';
  const sample = values.filter(Boolean).slice(0, 10);
  if (field === 'contacted' && sample.length) {
    if (sample.every((v) => /@.+\./.test(v))) field = 'email';
    else if (sample.every((v) => /\d{7,}/.test(v.replace(/\D/g, '')))) field = 'phone';
  }
  return field;
}

function guessStatus(v) {
  const s = v.toLowerCase();
  if (/declin|reject|not proceed|no go|drop|cancel/.test(s)) return 'declined';
  if (/deliver|done|complete|posted|published/.test(s)) return 'delivered';
  if (/production|progress|shoot|working|ongoing/.test(s)) return 'in_production';
  if (/approv|go ahead|confirm/.test(s)) return 'approved';
  if (/await|pending|review|waiting/.test(s)) return 'awaiting';
  if (/contact|reached|dm|messag|emailed/.test(s)) return 'contacted';
  if (/prospect|scout|lead|new|idea|shortlist/.test(s)) return 'prospect';
  return null;
}

function toTalent(src, mapping, defaultStatus) {
  const t = { tags: [], languages: [], status: defaultStatus };
  const notes = [];
  for (const [col, field] of Object.entries(mapping)) {
    const v = String(src[col] ?? '').trim();
    if (!field || !v) continue;
    if (field === 'followers') t.followers = parseFollowers(v);
    else if (field === 'engagement_rate') t.engagement_rate = parseFloat(v.replace('%', '')) || null;
    else if (field === 'platform') t.platform = joinList([...normalizePlatforms(t.platform), ...normalizePlatforms(v)]);
    else if (field === 'languages') t.languages = [...new Set([...t.languages, ...normalizeLanguages(v)])];
    else if (field === 'tags') t.tags = [...new Set([...t.tags, ...parseTags(splitList(v).join(','))])];
    else if (field === 'status') t.status = guessStatus(v) || t.status;
    else if (field === 'contacted') { if (/^(yes|y|true|✓|✔|checked|1|done|contacted)$/i.test(v) && t.status === defaultStatus) t.status = 'contacted'; }
    else if (field === 'notes') notes.push(v);
    else if (field === 'rate') t.rate = t.rate ? `${t.rate} · ${v}` : v;
    else t[field] = v;
  }
  if (notes.length) t.notes = notes.join('\n');
  if (t.profile_url && !t.handle) t.handle = handleFromUrl(t.profile_url);
  if (t.profile_url && !t.platform) t.platform = platformFromUrl(t.profile_url);
  if (t.handle && !t.handle.startsWith('@') && !/\s/.test(t.handle)) t.handle = '@' + t.handle;
  return t;
}

const urlKey = (u) => String(u || '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
const nameKey = (n) => String(n || '').trim().toLowerCase();

export function TalentImport({ onClose }) {
  const { talents } = useStore();
  const [file, setFile] = useState(null);           // { name, header, rows }
  const [mapping, setMapping] = useState({});        // CSV column → field
  const [defaultStatus, setDefaultStatus] = useState('prospect');
  const [busy, setBusy] = useState(false);

  const load = async (files) => {
    const f = files.find((x) => /\.csv$/i.test(x.name)) || files[0];
    if (!f) return;
    try {
      const parsed = parseCSV(await f.text());
      if (!parsed.header.length || !parsed.rows.length) return toast('That file looks empty. Export the Notion database as “Markdown & CSV”.', 'error');
      const m = {};
      const used = new Set();
      for (const h of parsed.header) {
        const g = guessField(h, parsed.rows.map((r) => r[h]));
        m[h] = g && (!used.has(g) || ['notes', 'rate', 'platform', 'tags', 'languages'].includes(g)) ? g : '';
        if (g) used.add(g);
      }
      setMapping(m);
      setFile({ name: f.name, ...parsed });
    } catch (e) { toastError(e); }
  };

  const existing = useMemo(() => ({
    urls: new Set(talents.map((t) => urlKey(t.profile_url)).filter(Boolean)),
    names: new Set(talents.map((t) => nameKey(t.name))),
  }), [talents]);

  const prepared = useMemo(() => {
    if (!file) return [];
    return file.rows.map((r) => {
      const t = toTalent(r, mapping, defaultStatus);
      const dup = (t.profile_url && existing.urls.has(urlKey(t.profile_url))) || existing.names.has(nameKey(t.name));
      return { t, dup, missingName: !t.name };
    });
  }, [file, mapping, defaultStatus, existing]);
  const toAdd = prepared.filter((p) => !p.dup && !p.missingName);
  const nameMapped = Object.values(mapping).includes('name');

  const run = async () => {
    setBusy(true);
    try {
      await insertRows('talents', toAdd.map((p) => p.t));
      toast(`Imported ${toAdd.length} talent${toAdd.length === 1 ? '' : 's'}.`);
      onClose();
    } catch (e) { toastError(e); setBusy(false); }
  };

  return html`<${Modal} title="Import talents" size="xl" onClose=${() => !busy && onClose()}
    footer=${file && html`
      <span class="muted small">${toAdd.length} to add${prepared.length - toAdd.length ? ` · ${prepared.length - toAdd.length} skipped` : ''}</span>
      <span class="spacer"></span>
      <button class="btn" disabled=${busy} onClick=${() => setFile(null)}>Choose another file</button>
      <button class="btn btn-primary" disabled=${busy || !toAdd.length || !nameMapped} onClick=${run}>
        <${Icon} name="check" size=${16} />${busy ? 'Importing…' : `Import ${toAdd.length} talent${toAdd.length === 1 ? '' : 's'}`}
      </button>`}>
    ${!file ? html`
      <div class="import-help">
        <p><b>From Notion:</b> open your talent database → <b>•••</b> (top right) → <b>Export</b> → format <b>Markdown & CSV</b> → Export.
          Unzip the download, then drop the <code>.csv</code> file below. (If there are two, either one works.)</p>
        <p class="muted small">Any CSV works too — e.g. from Google Sheets (File → Download → CSV) or Excel.</p>
      </div>
      <${Dropzone} onFiles=${load} multiple=${false} accept=".csv,text/csv">
        <${Icon} name="upload" size=${28} />
        <b>Drop your CSV file here or click to choose</b>
        <span class="muted small">Nothing is saved until you press Import</span>
      <//>`
    : html`
      <p class="muted small"><b>${file.name}</b> · ${file.rows.length} rows. We matched the columns below — change any that look wrong.</p>
      <div class="map-grid">
        ${file.header.map((h) => html`<div class="map-row" key=${h}>
          <div class="map-col"><b>${h}</b><span class="muted small">${file.rows.map((r) => r[h]).find(Boolean)?.slice(0, 48) || '(empty)'}</span></div>
          <span class="map-arrow" aria-hidden="true">→</span>
          <select value=${mapping[h] || ''} onChange=${(e) => setMapping({ ...mapping, [h]: e.target.value })} aria-label=${`Field for ${h}`}>
            ${FIELDS.map(([id, label]) => html`<option value=${id}>${label}</option>`)}
          </select>
        </div>`)}
      </div>
      <div class="form-row">
        <${Field} label="Status for imported talents" hint="A “Contacted? yes” or Status column overrides this">
          <select value=${defaultStatus} onChange=${(e) => setDefaultStatus(e.target.value)}>
            ${TALENT_STATUS.map((s) => html`<option value=${s.id}>${s.label}</option>`)}
          </select>
        <//>
      </div>
      ${!nameMapped && html`<p class="error-text small">Choose which column holds the talent's name.</p>`}
      <h3 class="list-head">Preview</h3>
      <div class="table-wrap"><table class="table table-compact">
        <thead><tr><th>Name</th><th>Handle</th><th>Platforms</th><th class="num">Followers</th><th>Tier</th><th>Language</th><th>Status</th><th></th></tr></thead>
        <tbody>${prepared.map((p, i) => html`<tr key=${i} class=${p.dup || p.missingName ? 'row-skip' : ''}>
          <td data-label="Name"><b>${p.t.name || '—'}</b></td>
          <td data-label="Handle">${p.t.handle || '—'}</td>
          <td data-label="Platforms">${p.t.platform || '—'}</td>
          <td data-label="Followers" class="num">${p.t.followers ? fmtNum(p.t.followers) : '—'}</td>
          <td data-label="Tier">${p.t.tier || '—'}</td>
          <td data-label="Language">${p.t.languages.join(', ') || '—'}</td>
          <td data-label="Status">${talentStatus(p.t.status).label}</td>
          <td data-label="">${p.dup ? html`<span class="pill pill-neutral">Already added — skip</span>` : p.missingName ? html`<span class="pill pill-bad">No name — skip</span>` : html`<span class="pill pill-good">New</span>`}</td>
        </tr>`)}</tbody>
      </table></div>`}
  <//>`;
}
