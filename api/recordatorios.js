// Revisión diaria automática (Vercel Cron, 8:00 a. m. de Costa Rica):
// - "por vencer" 3 días antes; "vencida" al día siguiente y luego cada 7 días;
// - "pago recibido" para pagos registrados en los últimos 3 días;
// - resumen diario para Chreed (solo si hay algo pendiente).
// Cada aviso se envía una sola vez (notif_log), así que ejecutarla de más no repite mensajes.

const { env, supabaseAdmin, todayCR } = require('./_lib');
const { notifyInvoice, sendEmail, layout, gmailUser, money, fdate, esc, emailEnabled } = require('./_notify');

const DIAS_PREVIO = 3;
const REPETIR_VENCIDA_CADA = 7;

const dayDiff = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400000);
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const secret = env('CRON_SECRET');
  if (secret && req.headers.authorization !== 'Bearer ' + secret) return res.status(401).json({ error: 'No autorizado' });
  const db = supabaseAdmin();
  if (!db) return res.status(503).json({ error: 'Sin conexión a la base de datos' });

  const today = todayCR();
  const sel = 'id,numero,concepto,monto,emision,vencimiento,pagada,fecha_pago,medio,clients(negocio,contacto,correo,activo)';
  const stats = { previo: 0, vencida: 0, pagada: 0, resumen: false };

  try {
    const pendientes = await db.get('invoices?select=' + sel + '&pagada=eq.false');
    const pagadas = await db.get('invoices?select=' + sel + '&pagada=eq.true&fecha_pago=gte.' + addDays(today, -3));

    for (const inv of pendientes) {
      const c = inv.clients || {};
      const d = dayDiff(inv.vencimiento, today);
      if (d === DIAS_PREVIO) { if (await notifyInvoice(db, inv, c, 'previo', 'previo', { dias: DIAS_PREVIO })) stats.previo++; }
      else if (d < 0) {
        const atraso = -d;
        if (atraso === 1 || (atraso > 1 && (atraso - 1) % REPETIR_VENCIDA_CADA === 0)) {
          if (await notifyInvoice(db, inv, c, 'vencida', 'vencida-' + atraso)) stats.vencida++;
        }
      }
    }
    for (const inv of pagadas) { if (await notifyInvoice(db, inv, inv.clients || {}, 'pagada', 'pagada')) stats.pagada++; }

    // Resumen diario para Chreed (una vez por día)
    const vencidas = pendientes.filter(i => dayDiff(i.vencimiento, today) < 0).sort((a, b) => a.vencimiento.localeCompare(b.vencimiento));
    const porVencer = pendientes.filter(i => { const d = dayDiff(i.vencimiento, today); return d >= 0 && d <= DIAS_PREVIO; });
    const pagosAyer = pagadas.filter(i => i.fecha_pago >= addDays(today, -1));
    if (emailEnabled() && (vencidas.length || porVencer.length || pagosAyer.length)) {
      const claim = await db.insertIgnore('app_config', { clave: 'resumen-' + today, valor: 'enviado' }, 'clave');
      if (claim.length) {
        const fila = (i, extra) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #EBE3E9">${esc((i.clients || {}).negocio || '—')}<br><span style="color:#5A4F57;font-size:12px">#${i.numero} · ${esc(i.concepto)}</span></td><td style="padding:6px 8px;border-bottom:1px solid #EBE3E9;text-align:right;white-space:nowrap"><b>${money(i.monto)}</b><br><span style="color:#5A4F57;font-size:12px">${extra}</span></td></tr>`;
        const tabla = (titulo, filas, color) => filas.length ? `<h2 style="font-size:15px;color:${color};margin:18px 0 6px">${titulo}</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">${filas.join('')}</table>` : '';
        const total = a => money(a.reduce((s, i) => s + Number(i.monto), 0));
        const html = `<p style="margin:0">Resumen de facturación del ${fdate(today)}.</p>`
          + tabla(`Vencidas (${vencidas.length} · ${total(vencidas)})`, vencidas.map(i => fila(i, `vencida hace ${-dayDiff(i.vencimiento, today)} días`)), '#B91C1C')
          + tabla(`Vencen en los próximos ${DIAS_PREVIO} días (${porVencer.length} · ${total(porVencer)})`, porVencer.map(i => fila(i, 'vence ' + fdate(i.vencimiento))), '#B45309')
          + tabla(`Pagos registrados ayer y hoy (${pagosAyer.length} · ${total(pagosAyer)})`, pagosAyer.map(i => fila(i, (i.medio || '') + ' · ' + fdate(i.fecha_pago))), '#15803D');
        stats.resumen = await sendEmail(gmailUser(), `Resumen Chreed: ${vencidas.length} vencidas, ${porVencer.length} por vencer`, layout('Resumen diario de facturación', html, { url: 'https://chreed-corporation.vercel.app/panel/', label: 'Abrir Panel Chreed' }), `Vencidas: ${vencidas.length}. Por vencer: ${porVencer.length}. Pagos: ${pagosAyer.length}.`);
        if (!stats.resumen) await db.del('app_config?clave=eq.resumen-' + today);
      }
    }
    return res.status(200).json({ ok: true, fecha: today, ...stats });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Error en la revisión diaria' });
  }
};
