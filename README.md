# Sitio web de Chreed Corporation

Sitio publicado: https://chreed-corporation.vercel.app

Esta carpeta es la **única copia oficial** del sitio. Cada cambio que se sube a GitHub
(rama `main`) se publica solo en Vercel en unos segundos.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html` | Página principal |
| `terminos.html`, `privacidad.html` | Términos del servicio y Política de privacidad |
| `styles.css` | Estilos de `index.html` (generados con Tailwind CSS) |
| `legal.css` | Estilos de las páginas legales |
| `img/` | Logotipos, foto de portada e íconos |
| `robots.txt`, `sitemap.xml` | Información para Google y otros buscadores |

## Ver el sitio en tu computadora

```powershell
powershell -ExecutionPolicy Bypass -File "C:\Users\Dell\Desktop\CHREED CO\Proyectos\CHREED CORPORATION WEB\serve.ps1" -Root "C:\Users\Dell\Desktop\CHREED CO\Chreed-Corporation" -Port 8081
```

Luego abre http://localhost:8081

## Publicar cambios

```powershell
git add -A
git commit -m "Describe el cambio"
git push
```

## Notas importantes

- **Formularios:** el cotizador y el formulario de contacto envían al correo de la empresa
  mediante Web3Forms. La clave de acceso está en `index.html` (`FORM_ACCESS_KEY`).
- **Estilos:** `styles.css` solo contiene las clases que usa `index.html` hoy. Si se agregan
  clases de Tailwind nuevas en el HTML, hay que regenerar `styles.css`.
- **Dominio propio:** al conectarlo en Vercel, reemplazar `https://chreed-corporation.vercel.app`
  en `index.html`, `terminos.html`, `privacidad.html`, `robots.txt` y `sitemap.xml`.
- **WhatsApp:** cuando exista número, cambiar el enlace del botón flotante (al final de
  `index.html`) por `https://wa.me/506XXXXXXXX`.
- **Mi cuenta:** la sección está oculta (`id="mi-cuenta"`) hasta tener un sistema de cuentas real.

## Panel de gestión (privado)

- Dirección: https://chreed-corporation.vercel.app/panel/ (no aparece en el menú ni en Google).
- Base de datos: Supabase (proyecto `chreed-panel`, creado desde Vercel → Storage).
- Acceso: solo los correos de la tabla `staff` en Supabase. Para dar acceso a alguien nuevo:
  1. Supabase → SQL Editor: `insert into public.staff (email, nombre) values ('correo', 'Nombre');`
  2. Supabase → Authentication → Users → Add user → Send invitation.
- La seguridad está en la base de datos (Row Level Security): sin un correo autorizado no se puede leer ni modificar nada.

## Portal del cliente "Mi cuenta" (privado por cliente)

- Dirección: https://chreed-corporation.vercel.app/cuenta/ (enlazada desde el menú "Mi cuenta").
- Cada cliente ve solo sus datos mediante la función `portal_get()` de Supabase (nunca las notas internas).
- Acceso: en el panel, ficha del cliente → "Invitar al portal". Genera un enlace personal (vence en 1 hora)
  mediante `api/portal-invite.js`, que usa las variables `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` de Vercel.
- El cliente debe tener un correo en su ficha; ese correo es su usuario.

## Pagos en línea (ONVO) — Fase B

- Botón "Pagar" en Mi cuenta → `api/pagar.js` crea la sesión de pago en ONVO con el monto de la base de datos.
- ONVO avisa a `api/onvo-webhook.js` (firma `X-Onvo-Signature` verificada); el servidor reconfirma con ONVO
  y marca la factura como pagada (medio "Tarjeta" o "SINPE Móvil").
- Variables en Vercel (las pega el dueño de la cuenta): `ONVO_SECRET_KEY` y `ONVO_WEBHOOK_SECRET`.
  Sin ellas, el botón "Pagar" no aparece.
- Webhook en ONVO: `https://chreed-corporation.vercel.app/api/onvo-webhook`
  con los eventos `checkout_session.succeeded` y `payment_intent.succeeded`.
