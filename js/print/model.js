// Print Hub rules shared by the screens and the demo backend (no UI code here).
import { fmtDate } from '../util.js';

export const PRINT_NAME = 'Print Hub';

export const ORDER_STATUS = {
  new:       { label: 'New',       tone: 'info', icon: 'inbox', hint: 'Just came in — not started yet' },
  pending:   { label: 'Pending',   tone: 'warn', icon: 'clock', hint: 'Being worked on' },
  completed: { label: 'Completed', tone: 'good', icon: 'check', hint: 'Done and delivered / collected' },
};
export const STATUS_ORDER = ['new', 'pending', 'completed'];

export const QUESTION_TYPES = [
  { id: 'text',     label: 'Short answer' },
  { id: 'textarea', label: 'Paragraph' },
  { id: 'number',   label: 'Number' },
  { id: 'email',    label: 'Email' },
  { id: 'phone',    label: 'Phone' },
  { id: 'date',     label: 'Date' },
  { id: 'select',   label: 'Dropdown (pick one)' },
  { id: 'radio',    label: 'Buttons (pick one)' },
  { id: 'checkbox', label: 'Checkboxes (pick any)' },
  { id: 'file',     label: 'File upload' },
  { id: 'voice_text', label: 'Text or voice note (up to 5 min)' },
];
export const hasOptions = (type) => ['select', 'radio', 'checkbox'].includes(type);

// "Show as" — lets a question fill a column in the order list.
export const QUESTION_ROLES = [
  { id: '',         label: '—' },
  { id: 'name',     label: 'Customer name' },
  { id: 'company',  label: 'Company' },
  { id: 'phone',    label: 'Phone' },
  { id: 'email',    label: 'Email' },
  { id: 'item',     label: 'What they ordered' },
  { id: 'quantity', label: 'Quantity' },
  { id: 'deadline', label: 'Due date' },
];

// Default order form (editable in "Order form"). `showIf` = only show when another answer matches.
const NOT_STICKER_OR_BANNER = { q: 'q_item', op: 'not_in', values: ['Stickers / labels', 'Banner / bunting'] };
export const DEFAULT_QUESTIONS = [
  { id: 'q_name', label: 'Your name', type: 'text', required: true, role: 'name' },
  { id: 'q_company', label: 'Company / brand', type: 'text', role: 'company' },
  { id: 'q_phone', label: 'Phone / WhatsApp', type: 'phone', required: true, role: 'phone' },
  { id: 'q_item', label: 'What do you need printed?', type: 'select', required: true, role: 'item',
    options: ['Flyers', 'Posters', 'Banner / bunting', 'Business cards', 'Stickers / labels', 'Brochures', 'Packaging', 'Other'] },
  { id: 'q_qty', label: 'Quantity', type: 'number', required: true, role: 'quantity' },
  { id: 'q_size', label: 'Size', type: 'text', required: true, help: 'e.g. A4, A5, 10cm × 15cm, 2m × 1m' },
  { id: 'q_paper', label: 'Paper type', type: 'radio', options: ['Hard card paper', 'Normal paper', 'Not sure'], help: 'Not sure? Choose “Not sure” and we’ll advise.' },
  { id: 'q_lamination', label: 'Do you need lamination?', type: 'radio', required: true, options: ['Yes', 'No'],
    help: 'A protective glossy or matte coating.', showIf: NOT_STICKER_OR_BANNER },
  { id: 'q_design', label: 'Do you have a design ready?', type: 'radio', required: true, options: ['Yes', 'No'] },
  { id: 'q_design_file', label: 'Upload your design', type: 'file', required: true, help: 'PDF, AI, PSD, PNG or JPG',
    showIf: { q: 'q_design', op: 'in', values: ['Yes'] } },
  { id: 'q_design_brief', label: 'Tell us what design you want', type: 'voice_text', required: true,
    help: 'Type it below, or record a voice note (up to 5 minutes).', showIf: { q: 'q_design', op: 'in', values: ['No'] } },
  { id: 'q_due', label: 'When do you need it?', type: 'date', required: true, role: 'deadline' },
  { id: 'q_notes', label: 'Anything else we should know?', type: 'textarea' },
];

// Is this question shown, given the answers so far? (Hidden while the question it depends on is unanswered.)
export function isVisible(q, answers, questions, seen = new Set()) {
  const c = q.showIf;
  if (!c || !c.q || seen.has(q.id)) return true;
  seen.add(q.id);
  const parent = questions.find((x) => x.id === c.q);
  if (!parent) return true;
  if (!isVisible(parent, answers, questions, seen)) return false;
  const v = answers[c.q];
  const vals = Array.isArray(v) ? v : v == null || v === '' ? [] : [String(v)];
  if (!vals.length) return false;
  const hit = vals.some((x) => (c.values || []).includes(x));
  return c.op === 'not_in' ? !hit : hit;
}

export const newQuestionId = () => 'q_' + Math.random().toString(36).slice(2, 9);

export function answerText(a) {
  if (a.type === 'voice_text') {
    const parts = [a.value?.text, a.value?.files?.length ? 'Voice note attached' : ''].filter(Boolean);
    return parts.length ? parts.join(' · ') : '—';
  }
  if (a.value == null || a.value === '' || (Array.isArray(a.value) && !a.value.length)) return '—';
  if (a.type === 'file') return a.value.map((f) => f.name).join(', ');
  if (a.type === 'date') return fmtDate(a.value);
  return Array.isArray(a.value) ? a.value.join(', ') : String(a.value);
}

export function isOverdue(order) {
  if (!order.due_date || order.status === 'completed') return false;
  const due = new Date(order.due_date.length === 10 ? order.due_date + 'T23:59:59' : order.due_date);
  return !isNaN(due) && due < new Date();
}

export function dueLabel(order) {
  if (!order.due_date) return '—';
  return fmtDate(order.due_date);
}

// ── Messages sent through your bot ─────────────────────────────────────────
export const DEFAULT_READY_MESSAGE = 'Hi {name}! Your print order {order_no} ({item}) is completed and ready for pickup. Thank you!';
export const DEFAULT_NEW_MESSAGE = "Hi {name}! We've received your print order {order_no} ({item} × {quantity}). We'll message you when it's ready.";
export const MESSAGE_TAGS = ['{name}', '{full_name}', '{order_no}', '{item}', '{quantity}', '{company}', '{due}'];

export function fillMessage(template, o) {
  const name = o.customer_name ? String(o.customer_name).split(' ')[0] : 'there';
  return String(template || '')
    .replace(/\{name\}/g, name).replace(/\{full_name\}/g, o.customer_name || '')
    .replace(/\{order_no\}/g, o.order_no || '').replace(/\{item\}/g, o.summary || 'your order')
    .replace(/\{quantity\}/g, o.quantity || '').replace(/\{company\}/g, o.company || '')
    .replace(/\{due\}/g, o.due_date ? fmtDate(o.due_date) : '');
}

// Short alert for the in-house team (email subject, bot "team_message", desktop notification).
export function teamMessage(kind, o) {
  const who = [o.customer_name || 'a customer', o.company ? `(${o.company})` : ''].filter(Boolean).join(' ');
  const what = [o.summary, o.quantity ? `× ${o.quantity}` : ''].filter(Boolean).join(' ');
  return kind === 'completed'
    ? `Order ${o.order_no} for ${who} is completed and ready for pickup.`
    : `New print order ${o.order_no} from ${who}${what ? `: ${what}` : ''}${o.due_date ? `, due ${fmtDate(o.due_date)}` : ''}.`;
}

// Exactly what the bot link receives (JSON, POST). kind: 'created' (new order) or 'completed'.
export function notifyPayload(kind, o, message, test = false) {
  const done = kind === 'completed';
  return {
    event: done ? 'order.completed' : 'order.created', test, order_no: o.order_no, status: done ? 'completed' : 'new',
    [done ? 'completed_at' : 'created_at']: new Date().toISOString(),
    message: fillMessage(message, o),
    team_message: teamMessage(kind, o),
    customer: { name: o.customer_name || null, company: o.company || null, phone: o.phone || null, email: o.email || null },
    order: {
      item: o.summary || null, quantity: o.quantity || null, due_date: o.due_date || null,
      files: (o.answers || []).filter((a) => !a.hidden && a.value).flatMap((a) => (a.type === 'file' ? a.value : a.type === 'voice_text' ? a.value.files || [] : [])
        .map((f) => ({ name: f.name, url: f.url || null, voice_note: a.type === 'voice_text' }))),
      answers: (o.answers || []).filter((a) => !a.hidden).map((a) => ({
        question: a.label,
        answer: a.type === 'file' && a.value ? a.value.map((f) => f.name).join(', ')
          : a.type === 'voice_text' ? answerText(a)
          : Array.isArray(a.value) ? a.value.join(', ') : a.value,
      })),
    },
  };
}

// WhatsApp chat link with the message already typed (staff just press Send).
export function waNumber(phone, countryCode = '60') {
  const raw = String(phone || '').trim();
  let d = raw.replace(/\D/g, '');
  if (!d) return '';
  if (raw.startsWith('+')) return d;
  if (d.startsWith('00')) return d.slice(2);
  if (d.startsWith('0')) return countryCode + d.slice(1);
  return d.startsWith(countryCode) ? d : countryCode + d;
}
export function waLink(phone, text, countryCode) {
  const n = waNumber(phone, countryCode);
  return n ? `https://wa.me/${n}${text ? '?text=' + encodeURIComponent(text) : ''}` : null;
}

export const SAMPLE_ORDER = { order_no: 'P-1024', customer_name: 'Nurul Aina', company: 'Kedai Kopi Aina', phone: '+60123456789',
  email: 'aina@example.com', summary: 'Flyers', quantity: '1000', due_date: new Date(Date.now() + 5 * 86400e3).toISOString().slice(0, 10), answers: [] };
