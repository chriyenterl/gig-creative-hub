// ─────────────────────────────────────────────────────────────────────────────
//  GIG Creative Hub settings — this is the only file you need to edit.
//
//  Leave everything empty to run in DEMO MODE (sample data, saved only in your
//  own browser). To go live, fill in ONE of the options below.
// ─────────────────────────────────────────────────────────────────────────────

export const CONFIG = {
  BRAND_NAME: 'GIG Creative Hub',

  // Name shown on the print ordering pages (customer form + staff app).
  PRINT_NAME: 'GIG Print Hub',

  // Country code added to local phone numbers (e.g. 012-345 6789 → +60 12-345 6789) for WhatsApp links.
  WHATSAPP_COUNTRY_CODE: '60',

  // Optional: link to your logo image (e.g. 'assets/logo.png'). Leave '' to show initials.
  LOGO_URL: '',

  // ── Cloudflare (recommended): R2 for files + D1 for data ─────────────────────
  // Paste your Worker's address, e.g. 'https://gig-hub-api.yourname.workers.dev'. See README.md.
  CLOUDFLARE_API_URL: 'https://gig-hub-api.gigcreatives.workers.dev',

  // ── Alternative (free): Google Drive + Google Sheets ───────────────────────
  // Paste the Apps Script web app URL (ends in /exec). See README.md.
  GOOGLE_SCRIPT_URL: '',

  // ── Alternative: Supabase ────────────────────────────────────────────────────
  // Project Settings → API → "Project URL" and the "anon" / "publishable" key.
  // (The anon/publishable key is safe to put here. NEVER paste the "service_role" / "secret" key.)
  SUPABASE_URL: '',
  SUPABASE_KEY: '',
  BUCKET: 'media',
};
