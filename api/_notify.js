// Envío de avisos: correo (Gmail de la empresa) y notificaciones al celular (Web Push).
// Cada aviso se registra en notif_log para no enviarlo dos veces.

const { SITE, env } = require('./_lib');

const FROM_NAME = 'Chreed Corporation';
const PLAN_MENSUAL = { Esencial: 80, Negocio: 100, Corporativo: 150 };
const money = n => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(n));
const fdate = s => s ? new Date(s + 'T12:00:00Z').toLocaleDateString('es-CR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ===== Correo =====
function gmailUser() { return env('GMAIL_USER') || 'chreedco@gmail.com'; }
function emailEnabled() { return !!env('GMAIL_APP_PASSWORD'); }
let transporter = null;
function getTransporter() {
  if (!emailEnabled()) return null;
  if (!transporter) {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: gmailUser(), pass: env('GMAIL_APP_PASSWORD').replace(/\s+/g, '') } });
  }
  return transporter;
}
async function sendEmail(to, subject, html, text) {
  const t = getTransporter();
  if (!t || !to) return false;
  try { await t.sendMail({ from: `"${FROM_NAME}" <${gmailUser()}>`, to, subject, html, text }); return true; }
  catch (e) { console.error('correo', e && e.message); return false; }
}

function layout(title, bodyHtml, cta) {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#FAF7F9;font-family:Arial,Helvetica,sans-serif;color:#1F1A1E">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF7F9;padding:24px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #EBE3E9">
    <tr><td style="background:#4A033D;padding:18px 24px"><img src="${SITE}/img/logo-horizontal.png" alt="Chreed Co." height="30" style="display:block;height:30px"></td></tr>
    <tr><td style="padding:24px">
      <h1 style="margin:0 0 12px;font-size:20px;color:#4A033D">${esc(title)}</h1>
      ${bodyHtml}
      ${cta ? `<p style="margin:22px 0 4px"><a href="${cta.url}" style="background:#E8B04B;color:#1F1A1E;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px;display:inline-block">${esc(cta.label)}</a></p>` : ''}
    </td></tr>
    <tr><td style="padding:14px 24px;background:#F6F1F5;font-size:12px;color:#5A4F57">Chreed Corporation · <a href="mailto:${gmailUser()}" style="color:#4A033D">${gmailUser()}</a><br>Recibes este aviso porque eres cliente de Chreed Corporation.</td></tr>
  </table></td></tr></table></body></html>`;
}

// ===== Notificaciones al celular =====
async function getVapid(db) {
  const read = async () => {
    const rows = await db.get('app_config?select=clave,valor&clave=in.(vapid_public,vapid_private)');
    const m = Object.fromEntries(rows.map(r => [r.clave, r.valor]));
    return m.vapid_public && m.vapid_private ? { publicKey: m.vapid_public, privateKey: m.vapid_private } : null;
  };
  let k = await read();
  if (!k) {
    const keys = require('web-push').generateVAPIDKeys();
    await db.insertIgnore('app_config', { clave: 'vapid_public', valor: keys.publicKey }, 'clave');
    await db.insertIgnore('app_config', { clave: 'vapid_private', valor: keys.privateKey }, 'clave');
    k = await read();
  }
  return k;
}
async function sendPush(db, email, payload) {
  const subs = await db.get('push_subs?select=endpoint,p256dh,auth&email=eq.' + encodeURIComponent(String(email || '').toLowerCase()));
  if (!subs.length) return 0;
  const webpush = require('web-push');
  const k = await getVapid(db);
  webpush.setVapidDetails('mailto:' + gmailUser(), k.publicKey, k.privateKey);
  let ok = 0;
  for (const s of subs) {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 86400 }); ok++; }
    catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) { try { await db.del('push_subs?endpoint=eq.' + encodeURIComponent(s.endpoint)); } catch (_) {} } }
  }
  return ok;
}

// ===== Mensajes =====
function message(tipo, inv, client, extra) {
  const nombre = (client.contacto || '').trim().split(/\s+/)[0];
  const hola = `<p style="margin:0 0 12px">Hola${nombre ? ' ' + esc(nombre) : ''},</p>`;
  const detalle = `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background:#F6F1F5;border-radius:8px;margin:8px 0"><tr><td style="padding:12px 14px;font-size:14px">
    <b>${esc(inv.concepto)}</b><br>Factura #${inv.numero} · ${esc(client.negocio)}<br>Monto: <b>${money(inv.monto)}</b>${inv.vencimiento ? ' · Vence: ' + fdate(inv.vencimiento) : ''}</td></tr></table>`;
  const cta = { url: SITE + '/cuenta/', label: tipo === 'pagada' ? 'Ver mi cuenta' : 'Ver y pagar mi factura' };
  if (tipo === 'previo') return {
    subject: `Tu factura #${inv.numero} vence en ${extra.dias} días`,
    title: 'Recordatorio de pago',
    html: hola + `<p style="margin:0 0 8px">Te recordamos que tu factura vence en <b>${extra.dias} días</b>, el ${fdate(inv.vencimiento)}.</p>` + detalle,
    push: { title: 'Factura por vencer', body: `Tu factura #${inv.numero} (${money(inv.monto)}) vence en ${extra.dias} días.` }, cta };
  if (tipo === 'vencida') return {
    subject: `Tu factura #${inv.numero} está vencida`,
    title: 'Factura vencida',
    html: hola + `<p style="margin:0 0 8px">Tu factura venció el ${fdate(inv.vencimiento)} y todavía aparece pendiente. Para evitar interrupciones en tu servicio, te pedimos realizar el pago lo antes posible. Si ya pagaste, ignora este mensaje o escríbenos.</p>` + detalle,
    push: { title: 'Factura vencida', body: `Tu factura #${inv.numero} (${money(inv.monto)}) está vencida. Toca para pagar.` }, cta };
  return {
    subject: `Pago recibido: factura #${inv.numero}`,
    title: '¡Pago recibido! Gracias',
    html: hola + `<p style="margin:0 0 8px">Registramos el pago de tu factura${inv.fecha_pago ? ' el ' + fdate(inv.fecha_pago) : ''}${inv.medio ? ' (' + esc(inv.medio) + ')' : ''}. ¡Gracias por tu confianza!</p>` + detalle.replace(/ · Vence: [^<]*/, ''),
    push: { title: 'Pago recibido ✅', body: `Recibimos el pago de tu factura #${inv.numero} (${money(inv.monto)}). ¡Gracias!` }, cta };
}

// Envía un aviso una sola vez por factura y clave. Devuelve los canales usados ('' si no se envió).
async function notifyInvoice(db, inv, client, tipo, clave, extra) {
  const correo = String(client.correo || '').trim().toLowerCase();
  if (!correo) return '';
  const claim = await db.insertIgnore('notif_log', { invoice_id: inv.id, clave }, 'invoice_id,clave');
  if (!claim.length) return '';
  const m = message(tipo, inv, client, extra || {});
  const canales = [];
  if (await sendEmail(correo, m.subject, layout(m.title, m.html, m.cta), m.push.body + '\n\n' + SITE + '/cuenta/')) canales.push('correo');
  try { if (await sendPush(db, correo, { ...m.push, url: SITE + '/cuenta/' })) canales.push('celular'); } catch (e) { console.error('push', e && e.message); }
  if (!canales.length) { await db.del('notif_log?invoice_id=eq.' + inv.id + '&clave=eq.' + encodeURIComponent(clave)); return ''; }
  await db.patch('notif_log?invoice_id=eq.' + inv.id + '&clave=eq.' + encodeURIComponent(clave), { canales: canales.join(',') });
  return canales.join(',');
}

module.exports = { emailEnabled, gmailUser, sendEmail, layout, getVapid, sendPush, notifyInvoice, money, fdate, esc, PLAN_MENSUAL };
