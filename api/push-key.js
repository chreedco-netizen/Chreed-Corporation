// Entrega la clave pública para activar notificaciones en el celular (es pública por diseño).
const { supabaseAdmin } = require('./_lib');
const { getVapid } = require('./_notify');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const db = supabaseAdmin();
  if (!db) return res.status(503).json({ error: 'No disponible' });
  try { const k = await getVapid(db); return res.status(200).json({ publicKey: k.publicKey }); }
  catch (e) { return res.status(500).json({ error: 'No disponible' }); }
};
