// Estado de los avisos y correo de prueba. Solo para personal autorizado.
// GET  → { correo: bool, dispositivos: n, recientes: [...] }
// POST → envía un correo de prueba al correo de la empresa

const { supabaseAdmin, bearer } = require('./_lib');
const { emailEnabled, sendEmail, layout, gmailUser } = require('./_notify');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const db = supabaseAdmin();
  if (!db) return res.status(503).json({ error: 'No disponible' });
  const email = await db.userEmail(bearer(req));
  if (!(await db.isStaff(email))) return res.status(403).json({ error: 'No autorizado' });

  try {
    if (req.method === 'POST') {
      if (!emailEnabled()) return res.status(400).json({ error: 'El correo todavía no está conectado (falta la contraseña de aplicación de Gmail en Vercel).' });
      const ok = await sendEmail(gmailUser(), 'Prueba de avisos — Chreed Corporation', layout('¡Los avisos por correo funcionan!', '<p style="margin:0">Este es un correo de prueba enviado desde el Panel Chreed. Los recordatorios a tus clientes saldrán con este mismo formato.</p>', { url: 'https://chreed-corporation.vercel.app/panel/', label: 'Abrir Panel Chreed' }), 'Correo de prueba de Chreed Corporation.');
      return ok ? res.status(200).json({ ok: true, enviadoA: gmailUser() }) : res.status(502).json({ error: 'Gmail rechazó el envío. Revisa la contraseña de aplicación.' });
    }
    const subs = await db.get('push_subs?select=endpoint');
    const recientes = await db.get('notif_log?select=clave,canales,enviado_at,invoices(numero,clients(negocio))&order=enviado_at.desc&limit=15');
    return res.status(200).json({
      correo: emailEnabled(), dispositivos: subs.length,
      recientes: recientes.map(r => ({ clave: r.clave, canales: r.canales, fecha: r.enviado_at, numero: r.invoices && r.invoices.numero, negocio: r.invoices && r.invoices.clients && r.invoices.clients.negocio }))
    });
  } catch (e) { return res.status(500).json({ error: 'Error inesperado' }); }
};
