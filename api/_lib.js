// Utilidades compartidas de los servicios (el guion bajo evita que Vercel la publique como servicio).

const SITE = 'https://chreed-corporation.vercel.app';
const ONVO_API = 'https://api.onvopay.com';

function env(...names) {
  for (const n of names) if (process.env[n]) return process.env[n];
  return '';
}

function supabaseAdmin() {
  const url = env('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, '');
  const key = env('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY');
  if (!url || !key) return null;
  const headers = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  return {
    url, key, headers,
    async get(path) { const r = await fetch(url + '/rest/v1/' + path, { headers }); if (!r.ok) throw new Error('db ' + r.status); return r.json(); },
    async patch(path, body) { const r = await fetch(url + '/rest/v1/' + path, { method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error('db ' + r.status); return r.json(); },
    async insertIgnore(table, row) {
      const r = await fetch(url + '/rest/v1/' + table + '?on_conflict=id', { method: 'POST', headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify(row) });
      if (!r.ok) throw new Error('db ' + r.status);
      return r.json();
    },
    async userEmail(token) {
      if (!token) return '';
      const r = await fetch(url + '/auth/v1/user', { headers: { apikey: key, Authorization: 'Bearer ' + token } });
      if (!r.ok) return '';
      const u = await r.json();
      return String(u.email || '').toLowerCase();
    }
  };
}

function onvo() {
  const key = env('ONVO_SECRET_KEY');
  if (!key) return null;
  const headers = { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  return {
    mode: key.includes('_live_') ? 'live' : 'test',
    async post(path, body) { const r = await fetch(ONVO_API + path, { method: 'POST', headers, body: JSON.stringify(body) }); return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) }; },
    async get(path) { const r = await fetch(ONVO_API + path, { headers }); return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) }; }
  };
}

// Fecha de hoy en Costa Rica (AAAA-MM-DD)
function todayCR() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function bearer(req) { return String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''); }

module.exports = { SITE, env, supabaseAdmin, onvo, todayCR, bearer };
