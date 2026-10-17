import { html, useState } from '../lib.js';
import { useStore, updateRow, openAsset, talentById } from '../store.js';
import { go, timeAgo, fmtBytes, CATEGORIES, MEDIA } from '../util.js';
import { Icon, PageHead, Tabs, MediaPreview, SeasonSelect, Field, Empty, toast, toastError, StatusPill, downloadAsset } from '../ui.js';

const DECISIONS = {
  approved: 'Approved — it\'s now in the library, ready to use.',
  changes: 'Marked as “changes requested”.',
  rejected: 'Rejected.',
};

function ReviewItem({ asset }) {
  const [note, setNote] = useState(asset.review_note || '');
  const [caption, setCaption] = useState(asset.caption || '');
  const saveCaption = () => {
    if (caption.trim() === (asset.caption || '')) return;
    updateRow('assets', asset.id, { caption: caption.trim() || null }).then(() => toast('Caption saved.')).catch(toastError);
  };
  const [season, setSeason] = useState(asset.season_id || '');
  const [category, setCategory] = useState(asset.category);
  const [busy, setBusy] = useState(false);
  const talent = talentById(asset.talent_id);

  const decide = async (status) => {
    setBusy(true);
    try {
      await updateRow('assets', asset.id, {
        status, category, season_id: season || null, caption: caption.trim() || null,
        review_note: note.trim() || null, reviewed_at: new Date().toISOString(),
      });
      toast(DECISIONS[status]);
    } catch (e) { toastError(e); setBusy(false); }
  };

  return html`<article class="review-item card">
    <div class="review-media"><${MediaPreview} asset=${asset} /></div>
    <div class="review-body">
      <div class="review-top">
        <div>
          <h3>${asset.title}</h3>
          <p class="muted small">From <b>${talent?.name || asset.uploaded_by || 'Team'}</b>${` · ${timeAgo(asset.created_at)} · ${MEDIA[asset.media_type]?.label} · ${fmtBytes(asset.size_bytes)}`}</p>
        </div>
        <${StatusPill} status=${asset.status} />
      </div>
      ${asset.description && html`<p class="creator-note"><span class="muted small">Note from creator</span>${asset.description}</p>`}
      <div class="form-row">
        <${Field} label="Season"><${SeasonSelect} value=${season} onChange=${setSeason} /><//>
        <${Field} label="File under">
          <select value=${category} onChange=${(e) => setCategory(e.target.value)}>
            ${CATEGORIES.map((c) => html`<option value=${c.id}>${c.label}</option>`)}
          </select>
        <//>
      </div>
      <${Field} label="Caption (optional)" hint="The text to post with it — saved when you click away">
        <textarea rows="3" value=${caption} placeholder="e.g. Unboxing our new holiday box 🎁 Link in bio!"
          onInput=${(e) => setCaption(e.target.value)} onBlur=${saveCaption}></textarea>
      <//>
      <${Field} label="Review note (team only)">
        <textarea rows="2" value=${note} placeholder="e.g. Logo needs to be visible in the first 3 seconds"
          onInput=${(e) => setNote(e.target.value)}></textarea>
      <//>
      <div class="review-actions">
        <button class="btn btn-good" disabled=${busy} onClick=${() => decide('approved')}><${Icon} name="check" size=${16} />Approve</button>
        <button class="btn" disabled=${busy} onClick=${() => decide('changes')}><${Icon} name="edit" size=${16} />Request changes</button>
        <button class="btn btn-ghost-danger" disabled=${busy} onClick=${() => decide('rejected')}><${Icon} name="x" size=${16} />Reject</button>
        <span class="spacer"></span>
        <button class="btn btn-ghost" onClick=${() => downloadAsset(asset)}><${Icon} name="download" size=${16} />Download</button>
        <button class="btn btn-ghost" onClick=${() => openAsset(asset.id)}>Details</button>
      </div>
    </div>
  </article>`;
}

export function Review({ query }) {
  const { assets } = useStore();
  const tab = query.tab || 'pending';
  const counts = (s) => assets.filter((a) => a.status === s).length;
  const items = assets.filter((a) => a.status === tab).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return html`
    <${PageHead} title="Review & approve"
      sub="New uploads from creators arrive here. Approve them to add them to the library, or ask for changes." />
    <${Tabs} value=${tab} onChange=${(t) => go('review', { tab: t }, { replace: true })} items=${[
      { id: 'pending', label: 'Awaiting review', count: counts('pending') },
      { id: 'changes', label: 'Changes requested', count: counts('changes') },
      { id: 'rejected', label: 'Rejected', count: counts('rejected') },
    ]} />
    <div class="review-list">
      ${items.length
        ? items.map((a) => html`<${ReviewItem} key=${a.id} asset=${a} />`)
        : html`<${Empty} icon="check" title=${tab === 'pending' ? 'All caught up' : 'Nothing here'}>
            ${tab === 'pending' ? 'No uploads are waiting for approval.' : 'No items with this status.'}<//>`}
    </div>`;
}
