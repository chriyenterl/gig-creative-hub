import { html, useState } from '../lib.js';
import { useStore, api, insertRow, deleteRow, setState, getState } from '../store.js';
import { DEMO, MODE } from '../api.js';
import { CONFIG } from '../../config.js';
import { fmtBytes, fmtGB } from '../util.js';
import { Icon, PageHead, PasscodeInput, confirmDialog, toast, toastError } from '../ui.js';
import { FastPreviews } from './fast-previews.js';
import { previewsOn } from '../previews.js';

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
  if (user?.viaLink) return html`<section class="card">
    <header class="card-head"><h2>Team members</h2><span class="muted">People who sign in with a password</span></header>
    <ul class="plain-list">${team_members.map((m) => html`<li key=${m.id}><span><span class="avatar">${(m.name || m.email).slice(0, 1).toUpperCase()}</span>
      <b>${m.name || m.email}</b></span></li>`)}</ul>
    <p class="muted small">You're using a team link. Only owners (who sign in with a password) can add or remove people.</p>
  </section>`;
  return html`<section class="card">
    <header class="card-head"><h2>Owners</h2><span class="muted">Sign in with email + password · can manage everything</span></header>
    ${api.auth.signInWithPasscode && html`<p class="muted small">Your team doesn't need to be added here: they join with the join link and sign in with
      their name + passcode. Approve them in <a class="link" href="#/access">Links & access</a>.</p>`}
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
  const [code, setCode] = useState('');
  const [again, setAgain] = useState('');
  const [mail, setMail] = useState(user?.resetEmail || '');
  const change = async () => {
    if (pw.length < 8) return toast('Use at least 8 characters.', 'error');
    try { await api.auth.changePassword(pw); setPw(''); toast('Password changed.'); } catch (e) { toastError(e); }
  };
  const changeCode = async () => {
    if (code.length !== 6) return toast('Your passcode must be exactly 6 digits.', 'error');
    if (code !== again) return toast("The two passcodes don't match.", 'error');
    try { await api.auth.changePasscode(code); setCode(''); setAgain(''); toast('Passcode changed. Use the new one next time you sign in.'); } catch (e) { toastError(e); }
  };
  const saveMail = async () => {
    try { await api.auth.changeMyEmail(mail.trim()); setState({ user: { ...user, resetEmail: mail.trim().toLowerCase() } }); toast('Email saved — it\'s only used if you forget your passcode.'); } catch (e) { toastError(e); }
  };
  return html`<section class="card">
    <header class="card-head"><h2>My account</h2></header>
    <p>${user?.viaLink ? html`Signed in as <b>${user.name}</b> (team member)` : html`Signed in as <b>${user?.email}</b> (owner)`}</p>
    ${!DEMO && user?.viaLink && user.passcode && api.auth.changePasscode && html`<div class="form-grid">
      <${PasscodeInput} label="New 6-digit passcode" value=${code} onInput=${setCode} />
      <${PasscodeInput} label="Type it again" value=${again} onInput=${setAgain} />
    </div>
    <div class="page-actions"><button class="btn" disabled=${code.length !== 6} onClick=${changeCode}>Change passcode</button></div>`}
    ${!DEMO && user?.viaLink && api.auth.changeMyEmail && html`<p class="muted small">Email for “forgot passcode” links:</p>
    <div class="inline-form">
      <input type="email" value=${mail} placeholder="you@example.com" onInput=${(e) => setMail(e.target.value)} autocomplete="email" />
      <button class="btn" disabled=${!mail.trim() || mail.trim().toLowerCase() === (user.resetEmail || '')} onClick=${saveMail}>Save email</button>
    </div>`}
    ${!DEMO && !user?.viaLink && html`<div class="inline-form">
      <input type="password" placeholder="New password" value=${pw} onInput=${(e) => setPw(e.target.value)} autocomplete="new-password" />
      <button class="btn" onClick=${change}>Change password</button>
    </div>`}
    <button class="btn" onClick=${async () => { await api.auth.signOut(); location.reload(); }}><${Icon} name="logout" size=${16} />Sign out</button>
  </section>`;
}

// Uploads stop at the limit, so the storage bill never goes past it.
function Storage({ storage, readOnly }) {
  const [gb, setGb] = useState(String(storage.limit / 1e9));
  const [busy, setBusy] = useState(false);
  const ratio = storage.used / storage.limit;
  const tone = ratio >= 1 ? ' full' : ratio >= 0.8 ? ' warn' : '';
  const save = async () => {
    const n = Number(gb);
    if (!(n >= 1)) return toast('Enter a limit of at least 1 GB.', 'error');
    setBusy(true);
    try { setState({ storage: await api.setStorageLimit(n) }); toast('Storage limit saved.'); } catch (e) { toastError(e); }
    setBusy(false);
  };
  return html`<div class="storage-box">
    <div class="storage-head"><b>Storage</b><span><b>${fmtGB(storage.used)}</b> of ${fmtGB(storage.limit)} used</span></div>
    <div class=${'storage-bar' + tone} role="meter" aria-label="Storage used" aria-valuemin="0"
      aria-valuemax=${storage.limit} aria-valuenow=${Math.min(storage.used, storage.limit)}>
      <span style=${{ width: Math.min(100, ratio * 100) + '%' }}></span></div>
    <p class="muted small">New uploads stop when the limit is reached — for the team, creator links and print orders.${MODE === 'cloudflare'
      ? " Keep it at 10 GB and Cloudflare never charges you; above that it's about US$0.015 per GB a month." : ''}</p>
    ${!readOnly && html`<div class="inline-form">
      <label class="small" for="storage-limit">Limit (GB)</label>
      <input id="storage-limit" class="storage-input" type="number" min="1" step="1" value=${gb} onInput=${(e) => setGb(e.target.value)} />
      <button class="btn" disabled=${busy || Number(gb) * 1e9 === storage.limit} onClick=${save}>${busy ? 'Saving…' : 'Save limit'}</button>
    </div>`}
  </div>`;
}

function About() {
  const { assets, backendLinks, storage } = useStore();
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
    ${storage && html`<${Storage} storage=${storage} readOnly=${!!getState().user?.viaLink} />`}
    ${previewsOn() && html`<div class="storage-box"><div class="storage-head"><b>Fast previews</b></div><${FastPreviews} inSettings /></div>`}
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
