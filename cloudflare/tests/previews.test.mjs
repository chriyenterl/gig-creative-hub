// Fast previews: the small copies of library photos (thumb_path / preview_path) are checked when saved,
// and are deleted together with their item. See run.sh.
const BASE = process.argv[2] || 'http://127.0.0.1:8787';
let pass = 0, failN = 0;
const ok = (c, label, extra) => { if (c) { pass++; console.log('  ✓', label); } else { failN++; console.log('  ✗', label, extra !== undefined ? JSON.stringify(extra).slice(0, 300) : ''); } };
const api = async (action, args = {}) => (await fetch(BASE + '/api', { method: 'POST', body: JSON.stringify({ action, ...args }) })).json();
const data = async (action, args) => { const j = await api(action, args); if (!j.ok) throw new Error(action + ': ' + j.error); return j.data; };
const bytes = (n) => new Uint8Array(n).map((_, i) => (i * 31) % 251);
async function upload(start, args, body, type, name) {
  const { uploadUrl } = await data(start, { ...args, name, mimeType: type, size: body.length });
  const r = await (await fetch(uploadUrl, { method: 'PUT', body })).json();
  if (!r.ok) throw new Error('upload: ' + r.error);
  return r.data.fileId;
}
const exists = async (key) => (await fetch(`${BASE}/f/${key.split('/').map(encodeURIComponent).join('/')}`, { method: 'HEAD' })).status === 200;

await data('setupAdmin', { email: 'owner@example.test', name: 'Owner', password: 'preview-test-pass' });
const T = (await data('login', { email: 'owner@example.test', password: 'preview-test-pass' })).token;

console.log('Team uploads with fast previews');
const orig = await upload('startUpload', { token: T, category: 'final' }, bytes(300 * 1024), 'image/jpeg', 'IMG_0001.JPG');
const small = await upload('startUpload', { token: T, category: 'previews' }, bytes(20 * 1024), 'image/jpeg', 'IMG_0001-small.jpg');
const medium = await upload('startUpload', { token: T, category: 'previews' }, bytes(60 * 1024), 'image/jpeg', 'IMG_0001-medium.jpg');
ok(small.startsWith('previews/') && medium.startsWith('previews/'), 'small copies are kept in their own previews/ folder', small);
const notImage = await upload('startUpload', { token: T, category: 'previews' }, bytes(1024), 'application/pdf', 'x.pdf');
let j = await api('insert', { token: T, table: 'assets', row: { title: 'x', storage_path: orig, media_type: 'image', thumb_path: notImage } });
ok(j.ok === false && /preview/.test(j.error), 'a preview must be a photo', j.error);
j = await api('insert', { token: T, table: 'assets', row: { title: 'x', storage_path: orig, media_type: 'image', thumb_path: 'previews/nope/missing.jpg' } });
ok(j.ok === false, 'a preview must really be uploaded');
j = await api('insert', { token: T, table: 'assets', row: { title: 'x', storage_path: orig, media_type: 'image', thumb_path: orig } });
ok(j.ok === false, "the original can't be used as its own preview (wrong folder)");
const a1 = await data('insert', { token: T, table: 'assets', row: { title: 'Raya 1', storage_path: orig, media_type: 'image', size_bytes: 300 * 1024, thumb_path: small, preview_path: medium } });
ok(a1.thumb_path === small && a1.preview_path === medium, 'saved with its small and medium copies');

console.log('Adding previews to an older item');
const orig2 = await upload('startUpload', { token: T, category: 'raw' }, bytes(200 * 1024), 'image/jpeg', 'IMG_0002.JPG');
const a2 = await data('insert', { token: T, table: 'assets', row: { title: 'Raya 2', storage_path: orig2, media_type: 'image' } });
ok(a2.thumb_path === null, 'an older item has no preview yet');
const s2 = await upload('startUpload', { token: T, category: 'previews' }, bytes(15 * 1024), 'image/jpeg', 'IMG_0002-small.jpg');
const m2 = await upload('startUpload', { token: T, category: 'previews' }, bytes(40 * 1024), 'image/jpeg', 'IMG_0002-medium.jpg');
ok((await api('update', { token: T, table: 'assets', id: a2.id, patch: { thumb_path: notImage } })).ok === false, 'update: a preview must be a photo');
const u2 = await data('update', { token: T, table: 'assets', id: a2.id, patch: { thumb_path: s2, preview_path: m2 } });
ok(u2.thumb_path === s2 && u2.preview_path === m2 && u2.storage_path === orig2, 'previews added; the original is untouched');

console.log('Deleting');
const before = (await data('storage', { token: T })).used;
await data('removeFiles', { token: T, ids: [orig] }); // what the app does first: the original (and cover)
await data('remove', { token: T, table: 'assets', id: a1.id });
ok(!(await exists(orig)) && !(await exists(small)) && !(await exists(medium)), 'deleting an item deletes its original AND its small copies');
ok((await data('storage', { token: T })).used <= before - (300 + 20 + 60) * 1024, 'and the space is freed');
await data('removeMany', { token: T, table: 'assets', ids: [a2.id] }); // even if the app forgot the previews, the server removes them
ok(!(await exists(s2)) && !(await exists(m2)) && (await exists(orig2)), 'the server always removes the small copies with their item');
await data('removeFiles', { token: T, ids: [orig2, notImage] });

console.log('Creator upload links');
const link = await data('insert', { token: T, table: 'upload_links', row: { label: 'Aisha', is_active: true } });
const ck = await upload('linkStartUpload', { linkToken: link.token }, bytes(100 * 1024), 'image/jpeg', 'photo.jpg');
const cs = await upload('linkStartUpload', { linkToken: link.token }, bytes(10 * 1024), 'image/jpeg', 'photo-small.jpg');
const cm = await upload('linkStartUpload', { linkToken: link.token }, bytes(30 * 1024), 'image/jpeg', 'photo-medium.jpg');
ok((await api('linkSubmit', { linkToken: link.token, fileId: ck, thumbId: s2 })).ok === false, "a creator can't use a preview from outside their folder");
const subId = await data('linkSubmit', { linkToken: link.token, fileId: ck, title: 'Photo', thumbId: cs, previewId: cm });
const sub = (await data('list', { token: T, table: 'assets', eq: { id: subId } }))[0];
ok(sub.thumb_path === cs && sub.preview_path === cm, "creator's photo arrives with its small copies");
await data('removeFiles', { token: T, ids: [sub.storage_path, sub.thumb_path, sub.preview_path] }); // the app's delete
await data('remove', { token: T, table: 'assets', id: subId });
ok(!(await exists(ck)) && !(await exists(cs)) && !(await exists(cm)), "deleting it removes the creator's original and copies");

console.log(`\n${pass} passed, ${failN} failed`);
process.exit(failN ? 1 : 0);
