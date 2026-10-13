import { html, useState } from '../lib.js';
import { useStore, api, insertRow, deleteRow } from '../store.js';
import { DEMO, MODE } from '../api.js';
import { CONFIG } from '../../config.js';
import { fmtBytes } from '../util.js';
import { Icon, PageHead, confirmDialog, toast, toastError } from '../ui.js';

function Team() {
  const { team_members, user } = useStore();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const withPasswords = MODE === 'cloudflare' || MODE === 'google'; // these backends manage passwords themselves
  const add = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return toast('Enter a valid email.', 'error');
    if (withPasswords && password.length < 8) return toast('Give them a password of at least 8 characters.', 'error');
    try {
      await insertRow('team_members', { email: email.trim().toLowerCase(), name: name.trim() || null, ...(withPasswords ? { password } : {}) });
      setEmail(''); setName(''); setPassword('');
      toast(withPasswords ? 'Added. Send them the website link, their email and this password.' : 'Added. Now create their login in Supabase (see below).');
    } catch (e) { toastError(e); }
  };
  const remove = async (m) => {
    if (!(await confirmDialog({ title: 'Remove team member?', message: `${m.email} will lose access to the team app.`, confirmLabel: 'Remove', danger: true }))) return;
    try { await deleteRow('team_members', m.id); toast('Removed.'); } catch (e) { toastError(e); }
  };
  const resetPassword = async (m) => {
    const pw = prompt(`New password for ${m.email} (at least 8 characters):`);
    if (pw == null) return;
    if (pw.length < 8) return toast('Use at least 8 characters.', 'error');
    try { await api.update('team_members', m.id, { password: pw }); toast('Password changed. They\'ll need to sign in again.'); } catch (e) { toastError(e); }
  };
  const me = user?.email?.toLowerCase();
  return html`<section class="card">
    <header class="card-head"><h2>Team members</h2><span class="muted">People who can open this app</span></header>
    <ul class="plain-list">
      ${team_members.map((m) => html`<li key=${m.id}>
        <span><span class="avatar">${(m.name || m.email).slice(0, 1).toUpperCase()}</span>
          <b>${m.name || m.email}</b>${m.name && html`<span class="muted small"> · ${m.email}</span>`}
          ${m.email.toLowerCase() === me && html`<span class="muted small"> (you)</span>`}</span>
        <span class="row-tools">
          ${withPasswords && m.email.toLowerCase() !== me && html`<button class="btn btn-sm btn-ghost" onClick=${() => resetPassword(m)}>Reset password</button>`}
          ${m.email.toLowerCase() !== me && html`<button class="icon-btn" aria-label="Remove" data-tip="Remove access" onClick=${() => remove(m)}><${Icon} name="trash" size=${15} /></button>`}
        </span>
      </li>`)}
    </ul>
    <div class="inline-form">
      <input type="email" placeholder="colleague@company.com" value=${email} onInput=${(e) => setEmail(e.target.value)} />
      <input placeholder="Name (optional)" value=${name} onInput=${(e) => setName(e.target.value)} />
      ${withPasswords && html`<input type="text" placeholder="Temporary password" value=${password} onInput=${(e) => setPassword(e.target.value)} autocomplete="off" />`}
      <button class="btn btn-primary" onClick=${add}><${Icon} name="plus" size=${16} />Add</button>
    </div>
    ${withPasswords
      ? html`<p class="muted small">Give them the website link, their email and the temporary password. They can change it in Settings → My account.</p>`
      : MODE === 'supabase' && html`<p class="muted small">After adding someone here, create their login in Supabase: <b>Authentication → Users → Add user</b>${' '}
      (tick “Auto confirm”), or use <b>Invite user</b> so they set their own password by email.</p>`}
  </section>`;
}

function Account() {
  const { user } = useStore();
  const [pw, setPw] = useState('');
  const change = async () => {
    if (pw.length < 8) return toast('Use at least 8 characters.', 'error');
    try { await api.auth.changePassword(pw); setPw(''); toast('Password changed.'); } catch (e) { toastError(e); }
  };
  return html`<section class="card">
    <header class="card-head"><h2>My account</h2></header>
    <p>Signed in as <b>${user?.email}</b></p>
    ${!DEMO && html`<div class="inline-form">
      <input type="password" placeholder="New password" value=${pw} onInput=${(e) => setPw(e.target.value)} autocomplete="new-password" />
      <button class="btn" onClick=${change}>Change password</button>
    </div>`}
    <button class="btn" onClick=${async () => { await api.auth.signOut(); location.reload(); }}><${Icon} name="logout" size=${16} />Sign out</button>
  </section>`;
}

function About() {
  const { assets, backendLinks } = useStore();
  const total = assets.reduce((n, a) => n + (a.size_bytes || 0), 0);
  const reset = async () => {
    if (!(await confirmDialog({ title: 'Reset demo data?', message: 'All demo changes and uploads in this browser are wiped and the sample data comes back.', confirmLabel: 'Reset', danger: true }))) return;
    await api.resetDemo();
    location.reload();
  };
  const modeText = { demo: 'Demo — data is saved only in this browser', cloudflare: 'Live — Cloudflare (R2 files + D1 data)', google: 'Live — Google Drive + Google Sheets', supabase: 'Live — Supabase' }[MODE];
  return html`<section class="card">
    <header class="card-head"><h2>System</h2></header>
    <dl class="facts">
      <dt>Mode</dt><dd>${modeText}</dd>
      ${MODE === 'supabase' && html`<dt>Project</dt><dd class="break">${CONFIG.SUPABASE_URL}</dd>`}
      ${MODE === 'cloudflare' && html`<dt>Server</dt><dd class="break">${CONFIG.CLOUDFLARE_API_URL}</dd>`}
      <dt>Files stored</dt><dd>${assets.length} items · ${fmtBytes(total)}</dd>
    </dl>
    ${backendLinks && html`<div class="page-actions">
      <a class="btn" href=${backendLinks.sheet} target="_blank" rel="noopener"><${Icon} name="grid" size=${16} />Open the data sheet</a>
      <a class="btn" href=${backendLinks.folder} target="_blank" rel="noopener"><${Icon} name="external" size=${16} />Open files in Drive</a>
    </div>`}
    ${DEMO && html`<p class="muted small">To go live, follow “Going live on Cloudflare” in README.md, then paste your Worker's address into <code>config.js</code>.</p>
      <button class="btn btn-ghost-danger" onClick=${reset}><${Icon} name="refresh" size=${16} />Reset demo data</button>`}
  </section>`;
}

export function Settings() {
  return html`
    <${PageHead} title="Settings" />
    <div class="settings-grid">
      <${Team} />
      <div class="stack"><${Account} /><${About} /></div>
    </div>`;
}
