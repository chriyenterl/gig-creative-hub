// Picks the backend based on config.js: Cloudflare (R2 + D1), Google (Drive + Sheets), Supabase, or the in-browser demo.
import { CONFIG } from '../config.js';

export const MODE = CONFIG.CLOUDFLARE_API_URL ? 'cloudflare' : CONFIG.GOOGLE_SCRIPT_URL ? 'google'
  : CONFIG.SUPABASE_URL && CONFIG.SUPABASE_KEY ? 'supabase' : 'demo';
export const DEMO = MODE === 'demo';

export async function loadBackend({ portal = false } = {}) {
  if (MODE === 'cloudflare') return (await import('./backend-cloudflare.js')).createCloudflareBackend(CONFIG, { portal });
  if (MODE === 'google') return (await import('./backend-google.js')).createGoogleBackend(CONFIG, { portal });
  if (MODE === 'supabase') return (await import('./backend-supabase.js')).createSupabaseBackend(CONFIG, { portal });
  return (await import('./backend-demo.js')).createDemoBackend();
}
