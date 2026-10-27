// Links & access (owners), split into Team / Customers / Master controls — the same pages as in the Print Hub.
import { html, useState, useEffect } from '../lib.js';
import { api, setState } from '../store.js';
import { PageHead } from '../ui.js';
import { TeamAccess } from '../team-access.js';
import { CustomerControls, MasterControls, ACCESS_PAGES } from '../print-controls.js';

const waitingCount = (staff) => (staff || []).filter((s) => s.status === 'pending').length;

export function Access({ sub }) {
  const [data, setData] = useState(undefined);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!api.print) return setError('Links & access needs the Cloudflare or Google setup.');
    api.print.me(null).then((me) => {
      if (me.role !== 'master') return setError('Only owners can manage access.');
      setData({ adminLinks: me.adminLinks || null, staff: me.staff || [], settings: me.settings || null, hubLinks: !!me.hubLinks,
                devices: me.devices || [], pushKey: me.pushKey || null });
    }).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { if (data) setState({ teamWaiting: waitingCount(data.staff) }); }, [data?.staff]);
  const onChange = (patch) => setData((d) => ({ ...d, ...patch }));
  const page = ACCESS_PAGES.find((x) => x.id === (sub || '')) || ACCESS_PAGES[0];

  return html`
    <${PageHead} title=${page.title} sub=${page.sub} />
    ${error ? html`<section class="card"><p class="muted">${error}</p></section>`
      : !data ? html`<div class="loading"><div class="spinner"></div></div>`
      : page.id === '' ? html`<${TeamAccess} printKey=${null} data=${data} onChange=${onChange} />`
      : page.id === 'customers' ? html`<${CustomerControls} printKey=${null} data=${data} onChange=${onChange} />`
      : html`<${MasterControls} printKey=${null} data=${data} onChange=${onChange} formHref="print/index.html#/form" />`}`;
}
