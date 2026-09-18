# ADR-013 · Cloudflare Pages para la aplicación

Fecha: 17 de septiembre de 2026 · Estado: **Aceptado** · Origen: P-007, P-109, P-114, V3 punto 6

## Problema

`app.extendiendoservicios.com` hoy apunta a GitHub Pages con una portada. La V3 fija Cloudflare como dominio, certificado y alojamiento.

## Alternativas

1. Cloudflare Pages con despliegue desde GitHub Actions; `web` sigue en GitHub Pages.
2. Seguir en GitHub Pages para la app.
3. Cloudflare Workers Sites o Workers con assets.

## Decisión

Alternativa 1. Producción en la rama `main` → `app.extendiendoservicios.com`; staging en `develop` → `dev.extendiendoservicios.com` (nombre POR CONFIRMAR), público con `noindex` y banner.

## Motivo

Coherente con la V3; certificado automático; ramas de vista previa; sin costo dentro del plan; el proxy de Cloudflare deja de ser un problema (la restricción era de GitHub Pages).

## Consecuencias

- Migración sin corte: crear el proyecto Pages, verificar en `*.pages.dev`, cambiar el CNAME, luego desactivar GitHub Pages.
- Fallback SPA con `_redirects` (`/* /index.html 200`).
- Cabeceras de seguridad en `_headers` (CSP, HSTS, `X-Content-Type-Options`).
- La cuenta de Cloudflare a usar es la de `extserviciosapp@gmail.com`; verificar antes de crear recursos.
