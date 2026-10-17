// Links & access (owners): let the team in from the Creative Hub — shared admin links (no sign-up)
// or their own name + passcode through the join link. Same section as in the Print Hub.
import { html, useState, useEffect } from '../lib.js';
import { api, setState } from '../store.js';
import { Icon, PageHead } from '../ui.js';
import { TeamAccess } from '../team-access.js';

const waitingCount = (staff) => (staff || []).filter((s) => s.status === 'pending').length;

export function Access() {
  const [data, setData] = useState(undefined);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!api.print) return setError('Links & access needs the Cloudflare or Google setup.');
    api.print.me(null).then((me) => {
      if (me.role !== 'master') return setError('Only owners can manage access.');
      setData({ adminLinks: me.adminLinks || null, staff: me.staff || [], settings: me.settings || null, hubLinks: !!me.hubLinks });
    }).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { if (data) setState({ teamWaiting: waitingCount(data.staff) }); }, [data?.staff]);
  const onChange = (patch) => setData((d) => ({ ...d, ...patch }));

  return html`
    <${PageHead} title="Links & access" sub="Let your team in — with a shared admin link (no sign-up), or their own name + passcode through the join link.">
      <a class="btn" href="print/index.html#/access"><${Icon} name="printer" size=${16} />Print Hub links</a>
    <//>
    ${error ? html`<section class="card"><p class="muted">${error}</p></section>`
      : !data ? html`<div class="loading"><div class="spinner"></div></div>`
      : html`<${TeamAccess} printKey=${null} data=${data} onChange=${onChange} />
        <section class="card">
          <header class="card-head"><h2>Customer & master links</h2></header>
          <p class="muted small">The customer order link, your master link, customer messages, the bot and the new-order alert devices are in the Print Hub.</p>
          <div class="page-actions"><a class="btn" href="print/index.html#/access"><${Icon} name="external" size=${16} />Open Print Hub → Links & access</a></div>
        </section>`}`;
}
