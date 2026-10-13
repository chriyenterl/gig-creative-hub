// Private upload links: one per person. The holder can ONLY upload — nothing else.
import { html, useState, useEffect } from '../lib.js';
import { useStore, insertRow, updateRow, deleteAndUnlink, talentById, seasonById } from '../store.js';
import { go, hrefFor, newToken, uploadUrlFor, copyText, linkState, timeAgo, fmtDate } from '../util.js';
import { Icon, PageHead, Modal, Field, Pill, Empty, SeasonSelect, TalentSelect, confirmDialog, toast, toastError } from '../ui.js';

export function LinkForm({ link, defaults = {}, onClose }) {
  const [d, setD] = useState({
    label: link?.label ?? defaults.label ?? '',
    talent_id: link?.talent_id ?? defaults.talent_id ?? '',
    season_id: link?.season_id ?? defaults.season_id ?? '',
    instructions: link?.instructions ?? '',
    expires: link?.expires_at ? link.expires_at.slice(0, 10) : '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k) => (v) => setD((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));

  const pickTalent = (id) => {
    const t = talentById(id);
    setD((x) => ({ ...x, talent_id: id, label: x.label || t?.name || '' }));
  };
  const save = async () => {
    if (!d.label.trim()) return toast('Say who this link is for.', 'error');
    setBusy(true);
    const row = {
      label: d.label.trim(), talent_id: d.talent_id || null, season_id: d.season_id || null,
      instructions: d.instructions.trim() || null,
      expires_at: d.expires ? new Date(d.expires + 'T23:59:59').toISOString() : null,
    };
    try {
      if (link) {
        await updateRow('upload_links', link.id, row);
        toast('Link updated.');
      } else {
        const created = await insertRow('upload_links', { ...row, token: newToken(), is_active: true });
        await copyText(uploadUrlFor(created.token));
        toast('Link created and copied — paste it to the person.');
      }
      onClose();
    } catch (e) { toastError(e); setBusy(false); }
  };

  return html`<${Modal} title=${link ? 'Edit upload link' : 'New private upload link'} onClose=${onClose}
    footer=${html`<button class="btn" onClick=${onClose}>Cancel</button>
      <button class="btn btn-primary" disabled=${busy} onClick=${save}>${link ? 'Save' : 'Create & copy link'}</button>`}>
    <div class="form-grid">
      <${Field} label="Talent (optional)" hint="Their uploads will be linked to their profile"><${TalentSelect} value=${d.talent_id} onChange=${pickTalent} /><//>
      <${Field} label="Who is this link for? *"><input value=${d.label} onInput=${set('label')} placeholder="e.g. Maya Lee — Christmas campaign" /><//>
      <${Field} label="Season for their uploads" hint="Uploads are filed under this season automatically"><${SeasonSelect} value=${d.season_id} onChange=${set('season_id')} /><//>
      <${Field} label="Expires on (optional)" hint="Leave empty to keep it open until you disable it">
        <input type="date" value=${d.expires} onInput=${set('expires')} />
      <//>
      <${Field} label="Message shown on their upload page" wide>
        <textarea rows="4" value=${d.instructions} onInput=${set('instructions')}
          placeholder="e.g. Please upload the final cut in 9:16, plus 3 still photos. Deadline: 12 Dec."></textarea>
      <//>
    </div>
  <//>`;
}

function LinkRow({ link, onEdit }) {
  const st = linkState(link);
  const talent = talentById(link.talent_id);
  const season = seasonById(link.season_id);
  const url = uploadUrlFor(link.token);

  const copy = async () => { await copyText(url); toast('Link copied.'); };
  const toggle = async () => {
    try {
      await updateRow('upload_links', link.id, { is_active: !link.is_active });
      toast(link.is_active ? 'Link disabled — it no longer works.' : 'Link enabled again.');
    } catch (e) { toastError(e); }
  };
  const regenerate = async () => {
    const ok = await confirmDialog({
      title: 'Change this link?',
      message: 'A new link address is created and the old one stops working immediately. You\'ll need to send the new link to the person.',
      confirmLabel: 'Change link',
    });
    if (!ok) return;
    try {
      const r = await updateRow('upload_links', link.id, { token: newToken() });
      await copyText(uploadUrlFor(r.token));
      toast('New link copied. The old one no longer works.');
    } catch (e) { toastError(e); }
  };
  const remove = async () => {
    const ok = await confirmDialog({
      title: 'Delete this link?',
      message: 'The link stops working. Files already uploaded through it stay in the library.',
      confirmLabel: 'Delete link', danger: true,
    });
    if (!ok) return;
    try { await deleteAndUnlink('upload_links', link.id); toast('Link deleted.'); } catch (e) { toastError(e); }
  };

  return html`<div class=${'link-card card' + (st.id !== 'active' ? ' inactive' : '')}>
    <div class="link-main">
      <div class="link-title">
        <b>${link.label}</b>
        <${Pill} tone=${st.tone}>${st.label}<//>
      </div>
      <div class="muted small link-meta">
        ${talent && html`<a class="link" href=${hrefFor('talents/' + talent.id)}>${talent.name}</a>`}
        ${season && html`<span>Files go to: ${season.name}</span>`}
        <span>${link.upload_count} ${link.upload_count === 1 ? 'upload' : 'uploads'}${link.last_upload_at ? `, last ${timeAgo(link.last_upload_at)}` : ''}</span>
        ${link.expires_at && html`<span>Expires ${fmtDate(link.expires_at)}</span>`}
        <span>Created ${fmtDate(link.created_at)}</span>
      </div>
      <div class="url-box">
        <code>${st.id === 'active' ? url : url.replace(/#.*/, '#' + '•'.repeat(12))}</code>
        <button class="btn btn-sm" onClick=${copy} disabled=${st.id !== 'active'}><${Icon} name="copy" size=${14} />Copy</button>
        <a class="btn btn-sm btn-ghost" href=${url} target="_blank" rel="noopener" data-tip="Open the page the person sees"><${Icon} name="external" size=${14} />Preview</a>
      </div>
    </div>
    <div class="link-actions">
      <button class="btn btn-sm" onClick=${toggle}><${Icon} name=${link.is_active ? 'pause' : 'power'} size=${14} />${link.is_active ? 'Disable' : 'Enable'}</button>
      <button class="btn btn-sm" onClick=${regenerate}><${Icon} name="refresh" size=${14} />Change link</button>
      <button class="btn btn-sm" onClick=${onEdit}><${Icon} name="edit" size=${14} />Edit</button>
      <button class="btn btn-sm btn-ghost-danger" onClick=${remove}><${Icon} name="trash" size=${14} />Delete</button>
    </div>
  </div>`;
}

export function Links({ query }) {
  const { upload_links } = useStore();
  const [editing, setEditing] = useState(query.new ? 'new' : null);
  useEffect(() => { if (query.new) go('links', {}, { replace: true }); }, []);
  const active = upload_links.filter((l) => linkState(l).id === 'active');
  const inactive = upload_links.filter((l) => linkState(l).id !== 'active');

  return html`
    <${PageHead} title="Upload links" sub="Send each creator their own private link. They can only upload files — they can't see or open anything else.">
      <button class="btn btn-primary" onClick=${() => setEditing('new')}><${Icon} name="plus" size=${16} />New upload link</button>
    <//>
    <div class="info-box">
      <${Icon} name="alert" size=${18} />
      <div>Anyone with an active link can upload through it, so send it only to that person.${' '}
        <b>Disable</b> pauses a link, <b>Change link</b> gives it a new address (the old one stops working), and <b>Delete</b> removes it for good.${' '}
        Uploaded files always stay in the library.</div>
    </div>
    ${upload_links.length === 0 && html`<${Empty} icon="link" title="No upload links yet">Create one for each influencer or photographer you work with.<//>`}
    ${active.length > 0 && html`<h2 class="list-head">Active <span class="muted">(${active.length})</span></h2>
      <div class="link-list">${active.map((l) => html`<${LinkRow} key=${l.id} link=${l} onEdit=${() => setEditing(l)} />`)}</div>`}
    ${inactive.length > 0 && html`<h2 class="list-head">Disabled or expired <span class="muted">(${inactive.length})</span></h2>
      <div class="link-list">${inactive.map((l) => html`<${LinkRow} key=${l.id} link=${l} onEdit=${() => setEditing(l)} />`)}</div>`}
    ${editing && html`<${LinkForm} link=${editing === 'new' ? null : editing} onClose=${() => setEditing(null)} />`}`;
}
