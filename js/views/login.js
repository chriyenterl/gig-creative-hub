import { html, useState, useEffect } from '../lib.js';
import { api } from '../store.js';
import { CONFIG } from '../../config.js';
import { Icon, Tabs, PasscodeInput, toastError } from '../ui.js';

export function Brand({ small }) {
  const words = CONFIG.BRAND_NAME.trim().split(/\s+/);
  const initials = /^[A-Z0-9]{2,3}$/.test(words[0]) ? words[0] : words.map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return html`<span class=${'brand' + (small ? ' brand-sm' : '')}>
    ${CONFIG.LOGO_URL ? html`<img src=${CONFIG.LOGO_URL} alt="" />` : html`<span class="brand-mark">${initials}</span>`}
    <span class="brand-name">${CONFIG.BRAND_NAME}</span>
  </span>`;
}

// Paste a team link (an installed iPhone app doesn't share Safari's memory, so it needs the link once).
function PasteTeamLink() {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  if (!api.auth.signInWithLink) return null;
  const go = async () => {
    const m = /#k=([A-Za-z0-9_-]{16,})/.exec(v.trim());
    if (!m) return toastError(new Error('That doesn\'t look like a team link. Copy the whole link you were sent.'));
    if (/\/print\//.test(v)) return location.replace('print/index.html#k=' + m[1]);
    setBusy(true);
    try { await api.auth.signInWithLink(m[1]); } catch (e) {
      if (e.code === 'PRINT_ONLY') return location.replace('print/index.html#k=' + m[1]);
      toastError(e); setBusy(false);
    }
  };
  return html`<div class="paste-link">
    <p class="muted small">Have a team link? Paste it here:</p>
    <div class="inline-form">
      <input value=${v} placeholder="https://…#k=…" aria-label="Team link" onInput=${(e) => setV(e.target.value)} />
      <button type="button" class="btn" disabled=${busy || !v.trim()} onClick=${go}>Open</button>
    </div>
  </div>`;
}

export function Login({ linkError }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [firstRun, setFirstRun] = useState(false);
  const teamSignIn = !!api.auth.signInWithPasscode;
  const [mode, setMode] = useState(teamSignIn ? 'team' : 'owner'); // the team: name + passcode · owners: email + password
  const [teamName, setTeamName] = useState('');
  const [code, setCode] = useState('');
  useEffect(() => { api.auth.needsSetup?.().then((first) => { setFirstRun(first); if (first) setMode('owner'); }).catch(() => {}); }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (mode === 'team' && !firstRun) {
      if (!teamName.trim() || code.length !== 6) return toastError(new Error('Type your name and your 6-digit passcode.'));
      setBusy(true);
      try { await api.auth.signInWithPasscode(teamName.trim(), code); } catch (err) { toastError(err); setBusy(false); setCode(''); }
      return;
    }
    if (firstRun && password.length < 8) return toastError(new Error('Choose a password of at least 8 characters.'));
    setBusy(true);
    try {
      if (firstRun) await api.auth.createAdmin(email.trim(), name.trim(), password);
      else await api.auth.signIn(email.trim(), password);
    } catch (err) { toastError(err); setBusy(false); }
  };
  const magic = async () => {
    if (!email.trim()) return toastError(new Error('Type your email first.'));
    setBusy(true);
    try { await api.auth.magicLink(email.trim()); setSent(true); } catch (err) { toastError(err); }
    setBusy(false);
  };

  return html`<div class="auth-page">
    <form class="auth-card card" onSubmit=${submit}>
      <${Brand} />
      <div>
        <h1>${firstRun ? 'Welcome! Create your admin account' : 'Welcome back'}</h1>
        <p class="muted">${firstRun ? 'This is the first sign-in, so this account becomes the owner. You can add teammates later in Settings.' : 'Sign in to your team workspace.'}</p>
      </div>
      ${linkError && html`<p class="storage-banner full"><${Icon} name="alert" size=${16} /><span>${linkError}</span></p>`}
      ${teamSignIn && !firstRun && html`<div class="auth-tabs"><${Tabs} items=${[{ id: 'team', label: 'Team' }, { id: 'owner', label: 'Owner' }]} value=${mode} onChange=${setMode} /></div>`}
      ${mode === 'team' && !firstRun ? html`
        <label class="field"><span class="field-label">Your name</span>
          <input autocomplete="username" value=${teamName} onInput=${(e) => setTeamName(e.target.value)} autofocus /></label>
        <${PasscodeInput} label="Passcode" value=${code} onInput=${setCode} autocomplete="current-password" />
        <button class="btn btn-primary btn-block btn-lg" disabled=${busy || code.length !== 6 || !teamName.trim()}>${busy ? 'One moment…' : 'Sign in'}</button>
        <p class="muted small center">New here? Ask the owner for the join link. Forgot your passcode? The owner can give you a new one.</p>
        <${PasteTeamLink} />`
      : sent ? html`<p class="notice"><${Icon} name="mail" size=${16} /> Check your inbox — we sent a sign-in link to <b>${email}</b>.</p>` : html`
        ${firstRun && html`<label class="field"><span class="field-label">Your name</span>
          <input autocomplete="name" value=${name} onInput=${(e) => setName(e.target.value)} /></label>`}
        <label class="field"><span class="field-label">Email</span>
          <input type="email" autocomplete="email" required value=${email} onInput=${(e) => setEmail(e.target.value)} autofocus /></label>
        <label class="field"><span class="field-label">${firstRun ? 'Choose a password' : 'Password'}</span>
          <input type="password" autocomplete=${firstRun ? 'new-password' : 'current-password'} value=${password} onInput=${(e) => setPassword(e.target.value)} /></label>
        <button class="btn btn-primary btn-block btn-lg" disabled=${busy || !password}>${busy ? 'One moment…' : firstRun ? 'Create account' : 'Sign in'}</button>
        ${api.auth.magicLink && !firstRun && html`<button type="button" class="btn btn-ghost btn-block" disabled=${busy} onClick=${magic}>Email me a sign-in link instead</button>`}`}
      <p class="muted small center">Team access only. Creators: please use the private upload link you were sent.</p>
    </form>
  </div>`;
}

export function NotTeam({ email }) {
  const sql = `insert into public.team_members (email) values ('${String(email).replace(/'/g, "''")}');`;
  return html`<div class="auth-page">
    <div class="auth-card card">
      <${Brand} />
      <h1>No access yet</h1>
      <p>You're signed in as <b>${email}</b>, but this email isn't on the team list.</p>
      <p class="muted small">Ask a team member to add you in <b>Settings → Team members</b>. If you're setting this up for the first time,${' '}
        run this in the Supabase SQL Editor:</p>
      <pre class="code">${sql}</pre>
      <button class="btn btn-block" onClick=${async () => { await api.auth.signOut(); location.reload(); }}>Sign out</button>
    </div>
  </div>`;
}
