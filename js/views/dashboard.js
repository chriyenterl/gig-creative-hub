import { html } from '../lib.js';
import { useStore, openAsset, talentById, getState } from '../store.js';
import { fmtNum, timeAgo, hrefFor, TALENT_STATUS, EVERGREEN, linkState } from '../util.js';
import { Icon, PageHead, MediaThumb, useSignedUrls, StatusPill, Empty } from '../ui.js';

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

function greeting(user) {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const who = getState().team_members.find((m) => m.email.toLowerCase() === (user?.email || '').toLowerCase())?.name;
  return who && !/demo/i.test(who) ? `${part}, ${who.split(' ')[0]}` : part;
}

function Stat({ label, value, sub, href, hero, tone, icon, n }) {
  return html`<a class=${'stat stat-' + n + (hero ? ' stat-hero' : '') + (tone ? ' stat-' + tone : '')} href=${href}>
    <span class="stat-top"><span class="stat-label">${label}</span><span class="stat-icon"><${Icon} name=${icon} size=${18} /></span></span>
    <span class="stat-value">${fmtNum(value)}</span>
    ${sub && html`<span class="stat-sub">${sub}</span>`}
  </a>`;
}

// One row of a "used vs not used" meter.
function UsageMeter({ label, used, total, href }) {
  const unused = total - used;
  return html`<a class="meter-row" href=${href}
      data-tip=${`${label}: ${used} used · ${unused} not used yet (${pct(used, total)}% used)`}>
    <span class="meter-label">${label}</span>
    <span class="meter"><span class="meter-fill" style=${{ width: pct(used, total) + '%' }}></span></span>
    <span class="meter-nums"><b>${fmtNum(used)}</b> used · <b>${fmtNum(unused)}</b> not used yet</span>
  </a>`;
}

export function Dashboard() {
  const { assets, seasons, talents, upload_links } = useStore();
  const live = assets.filter((a) => a.status !== 'rejected');
  const pending = assets.filter((a) => a.status === 'pending');
  const changes = assets.filter((a) => a.status === 'changes');
  const ready = assets.filter((a) => a.status === 'approved' && !a.use_count);
  const used = live.filter((a) => a.use_count > 0);
  const count = (arr, type) => arr.filter((a) => a.media_type === type).length;

  // Usage by type
  const types = [
    { label: 'Photos', match: (a) => a.media_type === 'image', type: 'image' },
    { label: 'Videos', match: (a) => a.media_type === 'video', type: 'video' },
    { label: 'Other files', match: (a) => !['image', 'video'].includes(a.media_type), type: 'other' },
  ].map((t) => {
    const rows = live.filter(t.match);
    return { ...t, total: rows.length, used: rows.filter((a) => a.use_count > 0).length };
  }).filter((t) => t.total > 0);

  // By season (+ Evergreen)
  const seasonRows = [...seasons, { ...EVERGREEN, id: null }].map((s) => {
    const rows = live.filter((a) => (a.season_id ?? null) === s.id);
    return { ...s, total: rows.length, used: rows.filter((a) => a.use_count > 0).length };
  });
  const maxSeason = Math.max(1, ...seasonRows.map((r) => r.total));

  // Talent pipeline
  const pipeline = TALENT_STATUS.map((s) => ({ ...s, n: talents.filter((t) => t.status === s.id).length }));
  const maxPipe = Math.max(1, ...pipeline.map((p) => p.n));

  // Review queue preview
  const queue = [...pending, ...changes].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 5);
  const urls = useSignedUrls(queue.map((a) => a.storage_path));
  const activeLinks = upload_links.filter((l) => linkState(l).id === 'active').length;

  return html`
    <${PageHead} title=${greeting(getState().user)} sub=${`${new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })} · here's everything at a glance.`}>
      <a class="btn" href=${hrefFor('links', { new: 1 })}><${Icon} name="link" size=${16} />New upload link</a>
      <a class="btn btn-primary" href=${hrefFor('library')}><${Icon} name="image" size=${16} />Open library</a>
    <//>

    <div class="stats">
      <${Stat} n="1" icon="image" hero label="Total content" value=${assets.length} href=${hrefFor('library')}
        sub=${`${fmtNum(count(assets, 'image'))} photos · ${fmtNum(count(assets, 'video'))} videos`} />
      <${Stat} n="2" icon="clock" label="Waiting for your approval" value=${pending.length} href=${hrefFor('review')} tone=${pending.length ? 'warn' : ''}
        sub=${changes.length ? `+ ${changes.length} with changes requested` : 'Creator uploads land here'} />
      <${Stat} n="3" icon="star" label="Approved & not used yet" value=${ready.length} href=${hrefFor('library', { status: 'approved', usage: 'unused' })}
        sub="Ready to pick up and post" />
      <${Stat} n="4" icon="check" label="Already used" value=${used.length} href=${hrefFor('library', { usage: 'used' })}
        sub=${`${pct(used.length, live.length)}% of all usable content`} />
    </div>

    <div class="dash-grid">
      <section class="card">
        <header class="card-head"><h2>Used vs not used</h2><span class="muted">Excludes rejected items</span></header>
        ${types.length ? html`
          <div class="meters">
            ${types.map((t) => html`<${UsageMeter} label=${t.label} used=${t.used} total=${t.total}
                href=${hrefFor('library', { type: t.type === 'other' ? '' : t.type, usage: 'unused' })} />`)}
            <${UsageMeter} label="All content" used=${used.length} total=${live.length} href=${hrefFor('library', { usage: 'unused' })} />
          </div>` : html`<${Empty} icon="image" title="No content yet">Upload something in the Library to get started.<//>`}
      </section>

      <section class="card">
        <header class="card-head"><h2>Needs review</h2><a class="link" href=${hrefFor('review')}>Open review queue →</a></header>
        ${queue.length ? html`<ul class="mini-list">
          ${queue.map((a) => html`<li key=${a.id}>
            <button class="mini-item" onClick=${() => openAsset(a.id)}>
              <${MediaThumb} asset=${a} url=${urls[a.storage_path]} />
              <span class="mini-text">
                <span class="mini-title">${a.title}</span>
                <span class="muted small">${talentById(a.talent_id)?.name || a.uploaded_by || 'Team'} · ${timeAgo(a.created_at)}</span>
              </span>
              <${StatusPill} status=${a.status} />
            </button></li>`)}
        </ul>` : html`<${Empty} icon="check" title="All caught up">Nothing is waiting for approval.<//>`}
      </section>

      <section class="card card-wide">
        <header class="card-head">
          <h2>Content by season</h2>
          <div class="legend">
            <span><i class="swatch swatch-used"></i>Used</span>
            <span><i class="swatch swatch-unused"></i>Not used yet</span>
          </div>
        </header>
        <div class="bars">
          ${seasonRows.map((r) => html`<a class="bar-row" key=${r.id ?? 'none'} href=${hrefFor('library', { season: r.id ?? 'none' })}
              data-tip=${`${r.name}: ${r.total} items — ${r.used} used, ${r.total - r.used} not used yet`}>
            <span class="bar-label"><span class="dot" style=${{ background: r.color }}></span>${r.name}</span>
            <span class="bar-track">
              <span class="bar" style=${{ width: `calc((100% - 34px) * ${r.total / maxSeason})` }}>
                ${r.used > 0 && html`<span class="seg seg-used" style=${{ flexGrow: r.used }}></span>`}
                ${r.total - r.used > 0 && html`<span class="seg seg-unused" style=${{ flexGrow: r.total - r.used }}></span>`}
              </span>
              <span class="bar-value">${r.total}</span>
            </span>
          </a>`)}
        </div>
      </section>

      <section class="card">
        <header class="card-head"><h2>Talent pipeline</h2><a class="link" href=${hrefFor('talents')}>All talents →</a></header>
        <div class="bars bars-compact">
          ${pipeline.map((p) => html`<a class="bar-row" key=${p.id} href=${hrefFor('talents', { status: p.id })}
              data-tip=${`${p.label}: ${p.n} ${p.n === 1 ? 'talent' : 'talents'}`}>
            <span class="bar-label">${p.label}</span>
            <span class="bar-track">
              <span class="bar" style=${{ width: `calc((100% - 34px) * ${p.n / maxPipe})` }}>${p.n > 0 && html`<span class="seg seg-used" style=${{ flexGrow: 1 }}></span>`}</span>
              <span class="bar-value">${p.n}</span>
            </span>
          </a>`)}
        </div>
      </section>

      <section class="card">
        <header class="card-head"><h2>Upload links</h2><a class="link" href=${hrefFor('links')}>Manage →</a></header>
        <div class="link-summary">
          <div><span class="big-num">${activeLinks}</span><span class="muted">active private links</span></div>
          <div><span class="big-num">${fmtNum(upload_links.reduce((n, l) => n + (l.upload_count || 0), 0))}</span><span class="muted">files received through links</span></div>
        </div>
        <a class="btn btn-block" href=${hrefFor('links', { new: 1 })}><${Icon} name="plus" size=${16} />Create a new upload link</a>
      </section>
    </div>`;
}
