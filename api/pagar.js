// Crea el pago en línea de una factura del cliente que tiene la sesión iniciada.
// GET  → { activo: true|false }  (¿están habilitados los pagos en línea?)
// POST { numero } → { url }      (página de pago segura de ONVO)
// El monto sale SIEMPRE de la base de datos; el navegador no puede cambiarlo.

const { SITE, supabaseAdmin, onvo, bearer } = require('./_lib');

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const db = supabaseAdmin();
  const pay = onvo();
  const activo = !!(db && pay);

  if (req.method === 'GET') return res.status(200).json({ activo, modo: pay ? pay.mode : null });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  if (!activo) return res.status(503).json({ error: 'Los pagos en línea todavía no están disponibles.' });

  try {
    // 1) Cliente con sesión iniciada
    const email = await db.userEmail(bearer(req));
    if (!email) return res.status(401).json({ error: 'Tu sesión venció. Vuelve a iniciar sesión.' });

    // 2) Factura: debe ser de ese cliente y estar pendiente
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const numero = parseInt(body.numero, 10);
    if (!Number.isInteger(numero) || numero <= 0) return res.status(400).json({ error: 'Factura no válida.' });
    const rows = await db.get('invoices?select=id,numero,concepto,monto,pagada,clients(negocio,contacto,correo,telefono)&numero=eq.' + numero);
    const inv = rows[0];
    if (!inv || !inv.clients || String(inv.clients.correo || '').toLowerCase() !== email) return res.status(404).json({ error: 'Factura no encontrada.' });
    if (inv.pagada) return res.status(409).json({ error: 'Esta factura ya está pagada.' });

    const cents = Math.round(Number(inv.monto) * 100);
    if (!(cents >= 50)) return res.status(400).json({ error: 'El monto de la factura no es válido para pago en línea.' });

    // 3) Sesión de pago en ONVO (tarjeta y SINPE Móvil; si SINPE no está disponible, solo tarjeta)
    const base = {
      lineItems: [{ quantity: 1, unitAmount: cents, currency: 'USD', description: ('Factura #' + inv.numero + ' — ' + inv.concepto).slice(0, 250) }],
      customerEmail: email,
      customerName: inv.clients.contacto || inv.clients.negocio,
      redirectUrl: SITE + '/cuenta/?pago=ok&f=' + inv.numero,
      cancelUrl: SITE + '/cuenta/?pago=cancelado&f=' + inv.numero,
      metadata: { invoiceId: inv.id, numero: String(inv.numero) }
    };
    let out = await pay.post('/v1/checkout/sessions/one-time-link', { ...base, paymentMethodTypes: ['card', 'mobile_number'] });
    if (!out.ok && out.status >= 400 && out.status < 500) out = await pay.post('/v1/checkout/sessions/one-time-link', { ...base, paymentMethodTypes: ['card'] });
    if (!out.ok || !out.data.url) return res.status(502).json({ error: 'No pudimos abrir la página de pago. Intenta de nuevo en unos minutos.' });

    await db.patch('invoices?id=eq.' + inv.id, { onvo_checkout_id: out.data.id || null });
    return res.status(200).json({ url: out.data.url });
  } catch (e) {
    return res.status(500).json({ error: 'Error inesperado. Intenta de nuevo.' });
  }
};
