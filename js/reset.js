// Forgot passcode (reset.html): type your email to get a one-time link, then (reset.html#<link code>)
// choose a new 6-digit passcode — no need to ask the owner.
import { html, render, useState, useEffect } from './lib.js';
import { loadBackend } from './api.js';
import { CONFIG } from '../config.js';
import { Icon, ToastHost, PasscodeInput, toastError } from './ui.js';
import { Brand } from './views/login.js';

const api = await loadBackend({ portal: true });
const resetToken = decodeURIComponent(location.hash.replace(/^#/, '')).trim();

function AskForLink() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return toastError(new Error('Type the email you joined with.'));
    setBusy(true);
    try { await api.auth.requestPasscodeReset(email.trim()); setSent(true); } catch (err) { toastError(err); }
    setBusy(false);
  };
  if (sent) return html`<div class="auth-card card"><${Brand} />
    <div class="join-done"><${Icon} name="mail" size=${26} /></div>
    <h1>Check your email</h1>
    <p>If <b>${email.trim()}</b> belongs to someone on the team, a link to choose a new passcode is on its way. It works for 30 minutes.</p>
    <p class="muted small">Nothing after a few minutes? Check your spam folder, or ask the owner to give you a new passcode.</p>
    <a class="btn btn-block" href="index.html">Back to sign-in</a></div>`;
  return html`<form class="auth-card card" onSubmit=${submit}><${Brand} />
    <div><h1>Forgot your passcode?</h1>
      <p class="muted">Type the email you joined with and we'll send you a link to choose a new one.</p></div>
    <label class="field"><span class="field-label">Your email</span>
      <input type="email" autocomplete="email" value=${email} onInput=${(e) => setEmail(e.target.value)} autofocus /></label>
    <button class="btn btn-primary btn-block btn-lg" disabled=${busy}>${busy ? 'One moment…' : 'Send me a link'}</button>
    <a class="btn btn-ghost btn-block" href="index.html">Back to sign-in</a>
  </form>`;
}

function ChooseNew() {
  const [code, setCode] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (code.length !== 6) return toastError(new Error('Choose a passcode of exactly 6 digits.'));
    if (code !== again) return toastError(new Error("The two passcodes don't match — type it again."));
    setBusy(true);
    try {
      const user = await api.auth.resetPasscode(resetToken, code);
      history.replaceState(null, '', location.pathname); // the link only works once
      location.replace(user?.posOnly ? 'pos/index.html' : user?.hub === false ? 'print/index.html' : 'index.html');
    } catch (err) { toastError(err); setBusy(false); }
  };
  return html`<form class="auth-card card" onSubmit=${submit}><${Brand} />
    <div><h1>Choose a new passcode</h1><p class="muted">Pick 6 digits you'll remember. You'll be signed in straight away.</p></div>
    <${PasscodeInput} label="New 6-digit passcode" value=${code} onInput=${setCode} autofocus />
    <${PasscodeInput} label="Type it again" value=${again} onInput=${setAgain} />
    <button class="btn btn-primary btn-block btn-lg" disabled=${busy}>${busy ? 'One moment…' : 'Save and sign in'}</button>
  </form>`;
}

function Reset() {
  useEffect(() => { document.title = `Reset passcode · ${CONFIG.BRAND_NAME}`; }, []);
  const body = !api.auth?.requestPasscodeReset
    ? html`<div class="auth-card card"><${Brand} /><h1>Ask the owner</h1><p class="muted">Please ask the owner to give you a new passcode.</p></div>`
    : resetToken ? html`<${ChooseNew} />` : html`<${AskForLink} />`;
  return html`<div class="auth-page">${body}</div><${ToastHost} />`;
}

render(html`<${Reset} />`, document.getElementById('app'));
