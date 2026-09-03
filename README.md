# extendiendoservicios-app

Plataforma de gestión de **Extendiendo Servicios** — `app.extendiendoservicios.com`.

Hoy publica una portada provisional ("Plataforma en construcción"). Este repo es el
lugar donde va a vivir la aplicación.

## Despliegue
GitHub Pages, rama `main`, carpeta raíz `/`.
El dominio personalizado lo fija el archivo [`CNAME`](CNAME) — no lo borres.

## Archivos
| Archivo | Para qué sirve |
|---|---|
| `index.html` | La portada provisional. Autocontenida: CSS inline y el isotipo como SVG embebido. |
| `404.html` | Copia de la portada. En una SPA con rutas de cliente, este archivo es además el fallback de routing. |
| `favicon.svg` | Isotipo en SVG. |
| `CNAME` | Dominio personalizado de GitHub Pages. |
| `.nojekyll` | Desactiva Jekyll (necesario si el build genera carpetas con `_`). |

## DNS (Cloudflare)
| Tipo | Nombre | Contenido | Proxy |
|---|---|---|---|
| CNAME | `app` | `extendiendoservicios.github.io` | DNS only |

> El proxy de Cloudflare (nube naranja) debe quedar **desactivado**: bloquea la emisión
> del certificado de GitHub Pages.

## Cuando llegue la app
Si el front se compila (Vite, etc.), el flujo habitual es publicar `dist/` con una
GitHub Action y mover `CNAME`, `.nojekyll` y `favicon.svg` a la carpeta `public/`
para que el build los copie a la salida.
