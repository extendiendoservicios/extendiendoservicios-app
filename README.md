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
| `index.html` | La portada provisional. Fondo oscuro, CSS inline, sin fuentes externas ni dependencias. |
| `404.html` | Copia de la portada. En una SPA con rutas de cliente, este archivo es además el fallback de routing. |
| `logo.png` | Logo blanco sobre transparencia, 800 px, paleta de 32 colores (17 KB). |
| `favicon.png` | Isotipo en el teal de marca, 128 px — legible en pestañas claras y oscuras. |
| `CNAME` | Dominio personalizado de GitHub Pages. |
| `.nojekyll` | Desactiva Jekyll (necesario si el build genera carpetas con `_`). |

## Sobre el logo

La portada usa el logo en blanco sobre transparencia, por eso el fondo es oscuro.
Los originales están fuera del repo, en `Images/` del proyecto: hay también una
versión negra sin fondo (`ExtendiendoServicios_logo_sinfondo.png`) si alguna vez
se quiere una portada clara.

## DNS (Cloudflare)
| Tipo | Nombre | Contenido | Proxy |
|---|---|---|---|
| CNAME | `app` | `extendiendoservicios.github.io` | DNS only |

> El proxy de Cloudflare (nube naranja) debe quedar **desactivado**: bloquea la emisión
> del certificado de GitHub Pages.

## Cuando llegue la app
Si el front se compila (Vite, etc.), el flujo habitual es publicar `dist/` con una
GitHub Action y mover `CNAME`, `.nojekyll`, `logo.png` y `favicon.png` a la carpeta `public/`
para que el build los copie a la salida.
