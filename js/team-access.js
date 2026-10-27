// Team access — shared by the Creative Hub and the Print Hub (Links & access): the two shared admin links,
// the join link, people waiting for approval, and the team list.
// <TeamAccess printKey data onChange />: printKey = the Print Hub link in use (null = a signed-in owner);
// data = { adminLinks, staff, settings, hubLinks } from api.print.me(); onChange(patch) gets the new values.
import { html } from './lib.js';
import { api } from './store.js';
import { copyText, timeAgo } from './util.js';
import { Icon, Pill, confirmDialog, toast, toastError } from './ui.js';

const SITE = new URL('../', import.meta.url).href; // the website's own folder
const links = {
  printHub: (key) => SITE + 'print/index.html#k=' + key,
  creativeHub: (key) => SITE + 'index.html#k=' + key,
  join: (key) => SITE + 'join.html#' + key,
};
const ACCESS = { print: 'Print Hub only', both: 'Print Hub + Creative Hub' };
const personLink = (s) => (s.hub ? links.creativeHub(s.key) : links.printHub(s.key));

export function LinkCard({ title, hint, url, active, canDisable, onToggle, onChange, warn }) {
  return html`<section class=${'card access-card' + (active === false ? ' inactive' : '')}>
    <header class="card-head"><h2>${title}</h2>${active !== undefined && html`<${Pill} tone=${active ? 'good' : 'neutral'}>${active ? 'Active' : 'Disabled'}<//>`}</header>
    <p class="muted small">${hint}</p>
    ${warn && html`<p class="small warn-text"><${Icon} name="alert" size=${14} /> ${warn}</p>`}
    <div class="url-box">
      <code>${active === false ? url.replace(/(#k?=?)[^#]*$/, '$1' + '•'.repeat(12)) : url}</code>
      <button class="btn btn-sm" disabled=${active === false} onClick=${async () => { await copyText(url); toast('Link copied.'); }}><${Icon} name="copy" size=${14} />Copy</button>
    </div>
    <div class="page-actions">
      ${canDisable && html`<button class="btn btn-sm" onClick=${onToggle}><${Icon} name=${active ? 'pause' : 'power'} size=${14} />${active ? 'Disable' : 'Enable'}</button>`}
      <button class="btn btn-sm" onClick=${onChange}><${Icon} name="refresh" size=${14} />Change link</button>
    </div>
  </section>`;
}

export function TeamAccess({ printKey = null, data, onChange }) {
  const { adminLinks, staff = [], settings, hubLinks } = data || {};
  const fail = (e) => { toastError(e); return null; };
  const run = async (fn, msg) => { // actions that return the new team list
    try { const list = await fn(); onChange({ staff: list }); if (msg) toast(msg); return list; } catch (e) { return fail(e); }
  };
  const runSettings = async (fn, msg) => {
    try { onChange({ settings: await fn() }); toast(msg); } catch (e) { fail(e); }
  };
  const refreshAll = async (fn, msg) => { // admin links: reload them afterwards
    try { await fn(); const me = await api.print.me(printKey); onChange({ adminLinks: me.adminLinks, staff: me.staff || staff }); toast(msg); } catch (e) { fail(e); }
  };

  // ── Shared admin links (no sign-up) ──
  const adminCard = (link, title, url, hint) => link && html`<${LinkCard} title=${title} url=${url} active=${link.active} canDisable hint=${hint}
    onToggle=${() => refreshAll(() => api.print.staffUpdate(printKey, link.id, { active: !link.active }), link.active ? `${title} turned off — anyone using it is signed out.` : `${title} is on again.`)}
    onChange=${async () => {
      if (!(await confirmDialog({ title: `Change the ${title.toLowerCase()}?`, message: 'A new link is made and the old one stops working straight away (anyone using it is signed out). Share the new one.', confirmLabel: 'Change link' }))) return;
      refreshAll(() => api.print.staffRegenerate(printKey, link.id), 'New link made — the old one no longer works.');
    }} />`;

  // ── Join link + team ──
  const joinUrl = settings?.joinKey ? links.join(settings.joinKey) : '';
  const pending = staff.filter((s) => s.status === 'pending');
  const members = staff.filter((s) => s.status !== 'pending');
  const changeJoin = async () => {
    if (!(await confirmDialog({ title: 'Change the join link?', message: 'A new join link is made and the old one stops working. People already on the team are not affected.', confirmLabel: 'Change link' }))) return;
    runSettings(() => api.print.regenerate(printKey, 'join'), 'New join link — the old one no longer works.');
  };
  const toggleJoin = () => runSettings(() => api.print.setActive(printKey, 'join', !settings.joinActive),
    settings.joinActive ? 'Join link turned off — nobody new can ask to join.' : 'Join link is on again.');
  const approve = (s, hub) => run(() => api.print.staffApprove(printKey, s.id, hub),
    `${s.name} is in (${hub ? ACCESS.both : ACCESS.print}) — they can sign in with their name and passcode now.`);
  const decline = async (s) => {
    if (!(await confirmDialog({ title: `Decline ${s.name}?`, message: 'Their request is removed. They can ask again with the join link.', confirmLabel: 'Decline', danger: true }))) return;
    run(() => api.print.staffDelete(printKey, s.id), `${s.name}'s request was declined.`);
  };
  const reset = async (s) => {
    if (!(await confirmDialog({ title: `New passcode for ${s.name}?`, message: `${s.name} is signed out on every device and gets a new 6-digit passcode, which you'll see next — pass it on to them.`, confirmLabel: 'Make new passcode' }))) return;
    try {
      const r = await api.print.staffResetPasscode(printKey, s.id);
      onChange({ staff: r.staff });
      await confirmDialog({ alert: true, title: `${s.name}'s new passcode`, confirmLabel: 'Done',
        message: html`<span class="code-reveal">${r.passcode}</span>Tell ${s.name} this passcode. They sign in with their name and it, and can change it in Settings.` });
    } catch (e) { fail(e); }
  };
  const toggle = (s) => run(() => api.print.staffUpdate(printKey, s.id, { active: !s.active }),
    s.active ? `${s.name} can't get in any more (signed out everywhere).` : `${s.name} can get in again.`);
  const changeAccess = async (s) => {
    const msg = s.hub
      ? { title: `Make ${s.name} Print Hub only?`, message: 'They lose access to the Creative Hub straight away.', confirmLabel: 'Print Hub only' }
      : { title: `Give ${s.name} the Creative Hub too?`, message: 'Next time they sign in they get the Creative Hub (library, review, talents…) with the Print Hub in its menu.', confirmLabel: 'Give access' };
    if (!(await confirmDialog(msg))) return;
    const list = await run(() => api.print.staffUpdate(printKey, s.id, { hub: !s.hub }));
    const fresh = list?.find((x) => x.id === s.id);
    if (fresh) toast(`${s.name} now has ${fresh.hub ? ACCESS.both : ACCESS.print}.`);
  };
  const rename = (s) => {
    const n = prompt('Name (they sign in with this):', s.name);
    if (n != null && n.trim() && n.trim() !== s.name) run(() => api.print.staffUpdate(printKey, s.id, { name: n.trim() }), `Renamed — they now sign in as “${n.trim()}”.`);
  };
  const remove = async (s) => {
    if (!(await confirmDialog({ title: `Remove ${s.name} from the team?`, message: "They're signed out on every device straight away and can't get back in (they could ask to join again with the join link, which you'd have to approve). Their name stays in the history of orders they worked on.", confirmLabel: 'Remove', danger: true }))) return;
    run(() => api.print.staffDelete(printKey, s.id), `${s.name} was removed.`);
  };
  const copyLink = async (s) => { await copyText(personLink(s)); toast(`${s.name}'s sign-in link copied — it signs them in without a passcode.`); };

  return html`
    <section class="card staff-card" id="team">
      <header class="card-head"><h2>Team</h2><${Pill} tone="neutral">${members.length} ${members.length === 1 ? 'person' : 'people'}<//></header>
      ${settings?.joinKey ? html`<div class="join-box">
        <p class="muted small"><b>Join link</b> — share it in your team group. New people open it, type their name and choose a 6-digit passcode,
          then you approve them below. After that they sign in anywhere with their name + passcode — no email needed.</p>
        <div class="url-box">
          <code>${settings.joinActive ? joinUrl : joinUrl.replace(/#.*$/, '#' + '•'.repeat(12))}</code>
          <button class="btn btn-sm" disabled=${!settings.joinActive} onClick=${async () => { await copyText(joinUrl); toast('Join link copied.'); }}><${Icon} name="copy" size=${14} />Copy</button>
        </div>
        <div class="page-actions">
          <${Pill} tone=${settings.joinActive ? 'good' : 'neutral'}>${settings.joinActive ? 'On' : 'Off'}<//>
          <button class="btn btn-sm" onClick=${toggleJoin}><${Icon} name=${settings.joinActive ? 'pause' : 'power'} size=${14} />${settings.joinActive ? 'Turn off' : 'Turn on'}</button>
          <button class="btn btn-sm" onClick=${changeJoin}><${Icon} name="refresh" size=${14} />Change link</button>
        </div>
      </div>` : html`<p class="muted small">Give each person their own link (no passcode). Joining with a passcode needs the Cloudflare setup.</p>`}

      ${pending.length > 0 && html`<h3 class="subhead">Waiting for approval (${pending.length})</h3>
        <ul class="staff-list pending-list">${pending.map((s) => html`<li key=${s.id}>
          <div class="staff-top"><b>${s.name}</b>${s.email && html`<span class="muted small">${s.email}</span>`}<span class="muted small staff-used">asked ${timeAgo(s.requested_at || s.created_at)}</span></div>
          <div class="page-actions">
            <button class="btn btn-sm btn-primary" onClick=${() => approve(s, false)}><${Icon} name="check" size=${14} />Approve — ${ACCESS.print}</button>
            ${hubLinks && html`<button class="btn btn-sm btn-primary" onClick=${() => approve(s, true)}><${Icon} name="check" size=${14} />Approve — ${ACCESS.both}</button>`}
            <button class="btn btn-sm btn-ghost-danger" onClick=${() => decline(s)}>Decline</button>
          </div>
        </li>`)}</ul>`}

      ${members.length > 0 && html`<h3 class="subhead">On the team</h3>
        <ul class="staff-list">${members.map((s) => html`<li key=${s.id} class=${s.active ? '' : 'inactive'}>
          <div class="staff-top">
            <b>${s.name}</b><${Pill} tone=${s.active ? 'good' : 'neutral'}>${s.active ? 'Active' : 'Off'}<//>
            <${Pill} tone=${s.hub ? 'info' : 'neutral'}>${s.hub ? ACCESS.both : ACCESS.print}<//>
            <span class="muted small staff-used">${s.passcode ? 'Passcode' : 'Link only'} · ${s.last_used_at ? 'last in ' + timeAgo(s.last_used_at) : 'not signed in yet'}</span>
            ${s.email && html`<span class="muted small staff-email">${s.email}</span>`}
          </div>
          <div class="page-actions">
            <button class="btn btn-sm" onClick=${() => toggle(s)}><${Icon} name=${s.active ? 'pause' : 'power'} size=${14} />${s.active ? 'Turn off' : 'Turn on'}</button>
            ${hubLinks && html`<button class="btn btn-sm" onClick=${() => changeAccess(s)}><${Icon} name="key" size=${14} />${s.hub ? 'Make Print Hub only' : 'Add Creative Hub'}</button>`}
            ${s.passcode && html`<button class="btn btn-sm" onClick=${() => reset(s)}><${Icon} name="refresh" size=${14} />Reset passcode</button>`}
            <button class="btn btn-sm btn-ghost" disabled=${!s.active} onClick=${() => copyLink(s)}><${Icon} name="link" size=${14} />Copy sign-in link</button>
            <button class="btn btn-sm btn-ghost" onClick=${() => rename(s)}><${Icon} name="edit" size=${14} />Rename</button>
            <button class="btn btn-sm btn-ghost-danger" onClick=${() => remove(s)}><${Icon} name="trash" size=${14} />Remove</button>
          </div>
        </li>`)}</ul>`}
      ${!members.length && !pending.length && html`<p class="muted small">Nobody yet — share the join link with your team.</p>`}
    </section>
    ${adminLinks && (adminLinks.print || adminLinks.hub) && html`<h3 class="subhead admin-links-head">Admin links — being switched off</h3>
    <p class="muted small">Shared links that don't need a passcode. Once everyone has joined with the join link above, these will be removed and anyone still using them is signed out.</p>
    <div class="access-grid access-grid-2">
      ${adminCard(adminLinks.print, 'Print Hub admin link', links.printHub(adminLinks.print?.key),
        'For your team — no sign-up. Opens the Print Hub: see orders, add orders, move them New → Pending → Completed, notes, job sheets. They can\'t change settings or delete orders.')}
      ${adminCard(adminLinks.hub, 'Creative Hub admin link', links.creativeHub(adminLinks.hub?.key),
        'For your team — no sign-up. Opens the Creative Hub (library, uploads, review, talents…) with the Print Hub in its menu. Only owners can manage the team or settings.')}
    </div>`}`;
}
