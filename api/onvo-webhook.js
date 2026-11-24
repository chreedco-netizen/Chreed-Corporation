// Recibe los avisos de ONVO y marca la factura como pagada.
// Seguridad: 1) verifica la firma X-Onvo-Signature (HMAC-SHA256 con el secreto whsec_),
// 2) rechaza avisos viejos (> 5 min), 3) consulta de nuevo a ONVO que el pago esté realmente pagado,
// 4) compara el monto con la factura, 5) ignora avisos repetidos.

const crypto = require('crypto');
const { env, supabaseAdmin, onvo, todayCR } = require('./_lib');
const { notifyInvoice } = require('./_notify');

function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function validSignature(header, raw, secret) {
  if (!header || !secret) return false;
  const parts = String(header).split(',').map(s => s.trim());
  const t = (parts.find(p => p.startsWith('t=')) || '').slice(2);
  const sigs = parts.filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = crypto.createHmac('sha256', secret).update(t + '.').update(raw).digest('hex');
  return sigs.some(s => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s, 'hex'), Buffer.from(expected, 'hex')));
}

const MEDIOS = { card: 'Tarjeta', mobile_number: 'SINPE Móvil' };

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).end();
  const db = supabaseAdmin();
  const pay = onvo();
  const secret = env('ONVO_WEBHOOK_SECRET');
  if (!db || !pay || !secret) return res.status(503).end();

  let raw = await readRaw(req);
  if (!raw.length && req.rawBody) raw = Buffer.from(req.rawBody);
  if (!validSignature(req.headers['x-onvo-signature'], raw, secret)) return res.status(401).json({ error: 'firma no válida' });

  let event;
  try { event = JSON.parse(raw.toString('utf8')); } catch (e) { return res.status(400).end(); }
  const type = event.type;
  const obj = (event.data && event.data.object) || {};

  try {
    if (event.mode && event.mode !== pay.mode) return res.status(200).json({ ok: true, ignorado: 'modo distinto' });
    if (type !== 'checkout_session.succeeded' && type !== 'payment_intent.succeeded') return res.status(200).json({ ok: true, ignorado: type });

    // Evitar procesar dos veces el mismo aviso
    const nuevo = await db.insertIgnore('pago_eventos', { id: String(event.id), tipo: type });
    if (!nuevo.length) return res.status(200).json({ ok: true, repetido: true });

    // Confirmar con ONVO (no confiar solo en el aviso) y ubicar la factura
    let paymentIntentId = null, cents = null, invoiceId = null, checkoutId = null;
    if (type === 'checkout_session.succeeded') {
      const s = await pay.get('/v1/checkout/sessions/' + encodeURIComponent(obj.id));
      if (!s.ok || s.data.paymentStatus !== 'paid') return res.status(200).json({ ok: true, ignorado: 'sesión no pagada' });
      checkoutId = s.data.id;
      paymentIntentId = s.data.paymentIntentId || null;
      cents = s.data.amountTotal != null ? s.data.amountTotal : s.data.amountSubTotal;
      invoiceId = s.data.metadata && s.data.metadata.invoiceId;
    } else {
      const p = await pay.get('/v1/payment-intents/' + encodeURIComponent(obj.id));
      if (!p.ok || p.data.status !== 'succeeded') return res.status(200).json({ ok: true, ignorado: 'pago no confirmado' });
      paymentIntentId = p.data.id;
      cents = p.data.amount;
      invoiceId = p.data.metadata && p.data.metadata.invoiceId;
    }

    let rows = [];
    if (invoiceId && /^[0-9a-f-]{36}$/i.test(invoiceId)) rows = await db.get('invoices?select=id,monto,pagada&id=eq.' + invoiceId);
    if (!rows.length && checkoutId) rows = await db.get('invoices?select=id,monto,pagada&onvo_checkout_id=eq.' + encodeURIComponent(checkoutId));
    if (!rows.length && paymentIntentId) rows = await db.get('invoices?select=id,monto,pagada&onvo_payment_intent_id=eq.' + encodeURIComponent(paymentIntentId));
    const inv = rows[0];
    if (!inv) return res.status(200).json({ ok: true, ignorado: 'factura no encontrada' });
    if (inv.pagada) return res.status(200).json({ ok: true, yaPagada: true });
    if (cents != null && Number(cents) !== Math.round(Number(inv.monto) * 100)) return res.status(200).json({ ok: true, ignorado: 'monto distinto' });

    // Medio de pago (tarjeta o SINPE Móvil)
    let medio = 'ONVO';
    if (paymentIntentId) {
      const p = await pay.get('/v1/payment-intents/' + encodeURIComponent(paymentIntentId));
      const pmId = p.ok && (p.data.paymentMethodId || (p.data.paymentMethod && p.data.paymentMethod.id));
      if (pmId) {
        const m = await pay.get('/v1/payment-methods/' + encodeURIComponent(pmId));
        if (m.ok && MEDIOS[m.data.type]) medio = MEDIOS[m.data.type];
      }
    }

    const updated = await db.patch('invoices?id=eq.' + inv.id + '&pagada=eq.false', { pagada: true, fecha_pago: todayCR(), medio, onvo_payment_intent_id: paymentIntentId });

    // Aviso inmediato de "pago recibido" (si falla, la revisión diaria lo envía después)
    if (updated.length) {
      try {
        const full = await db.get('invoices?select=id,numero,concepto,monto,vencimiento,fecha_pago,medio,clients(negocio,contacto,correo)&id=eq.' + inv.id);
        if (full[0]) await notifyInvoice(db, full[0], full[0].clients || {}, 'pagada', 'pagada');
      } catch (e) { console.error('aviso de pago', e && e.message); }
    }
    return res.status(200).json({ ok: true, pagada: true });
  } catch (e) {
    // Error temporal: responder 500 para que ONVO reintente (el registro del aviso se libera)
    try { await fetch(db.url + '/rest/v1/pago_eventos?id=eq.' + encodeURIComponent(String(event.id)), { method: 'DELETE', headers: db.headers }); } catch (_) {}
    return res.status(500).end();
  }
};
