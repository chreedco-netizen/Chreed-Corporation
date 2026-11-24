// Genera el enlace de acceso al portal para un cliente.
// Solo responde a una sesión del personal autorizado (tabla staff).
// La clave secreta de Supabase vive en las variables de entorno de Vercel y nunca llega al navegador.

const SITE = 'https://chreed-corporation.vercel.app';

function env(...names) {
  for (const n of names) if (process.env[n]) return process.env[n];
  return '';
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const URL = env('SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'STORAGE_SUPABASE_URL').replace(/\/$/, '');
  const KEY = env('SUPABASE_SERVICE_ROLE_KEY', 'STORAGE_SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'STORAGE_SUPABASE_SECRET_KEY');
  if (!URL || !KEY) return res.status(500).json({ error: 'El servidor no tiene configurada la conexión con la base de datos.' });

  const admin = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };

  try {
    // 1) ¿Quién hace la solicitud?
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Sesión requerida.' });
    const who = await fetch(URL + '/auth/v1/user', { headers: { apikey: KEY, Authorization: 'Bearer ' + token } });
    if (!who.ok) return res.status(401).json({ error: 'Sesión no válida. Vuelve a iniciar sesión.' });
    const user = await who.json();
    const email = String(user.email || '').toLowerCase();

    // 2) ¿Es personal autorizado?
    const st = await fetch(URL + '/rest/v1/staff?select=email&email=eq.' + encodeURIComponent(email), { headers: admin });
    const staff = st.ok ? await st.json() : [];
    if (!email || !staff.length) return res.status(403).json({ error: 'No autorizado.' });

    // 3) Cliente
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const id = String(body.clienteId || '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'Cliente no válido.' });
    const cr = await fetch(URL + '/rest/v1/clients?select=id,negocio,correo&id=eq.' + id, { headers: admin });
    const client = (cr.ok ? await cr.json() : [])[0];
    if (!client) return res.status(404).json({ error: 'Cliente no encontrado.' });
    const correo = String(client.correo || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) return res.status(400).json({ error: 'Agrega primero un correo válido al cliente (Editar datos).' });

    // 4) Enlace: invitación si es nuevo; enlace de acceso si ya tiene cuenta
    const redirect_to = SITE + '/cuenta/';
    const gen = async type => {
      const r = await fetch(URL + '/auth/v1/admin/generate_link', { method: 'POST', headers: admin, body: JSON.stringify({ type, email: correo, redirect_to }) });
      return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
    };
    let tipo = 'invitacion';
    let out = await gen('invite');
    if (!out.ok) { tipo = 'acceso'; out = await gen('magiclink'); }
    if (!out.ok) return res.status(502).json({ error: 'No se pudo generar el enlace: ' + (out.data.msg || out.data.message || out.data.error_description || out.status) });
    const link = out.data.action_link || (out.data.properties && out.data.properties.action_link);
    if (!link) return res.status(502).json({ error: 'No se recibió el enlace.' });

    // 5) Registrar la fecha de la invitación
    await fetch(URL + '/rest/v1/clients?id=eq.' + id, { method: 'PATCH', headers: { ...admin, Prefer: 'return=minimal' }, body: JSON.stringify({ portal_invitado_at: new Date().toISOString() }) });

    return res.status(200).json({ link, tipo, correo, negocio: client.negocio });
  } catch (e) {
    return res.status(500).json({ error: 'Error inesperado. Intenta de nuevo.' });
  }
};
