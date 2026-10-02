# `tests/lighthouse`

Medición con Lighthouse de la plataforma publicada en staging (RESP-010, P17.4, F17). No es un test
que pase o falle en el CI: es un script que se corre a mano y deja informes. Fuera del CI porque
necesita las cuatro variables de `.env.local` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `SEED_DEV_PASSWORD`) para crear y borrar cuentas descartables.

## Qué mide

| Pantalla           | Cuenta                            | Sesión |
| ------------------ | --------------------------------- | ------ |
| COM-01 `/ingresar` | —                                 | no     |
| ADM-02 `/admin`    | dueño de la semilla (solo se lee) | sí     |
| EMP-03 `/app`      | empleado descartable `E2E-P174`   | sí     |
| SUP-02 `/sup`      | supervisor descartable `E2E-P174` | sí     |

Cada pantalla en modo **celular** (preset por defecto de Lighthouse: emulación móvil y 4G lenta
simulada) y **escritorio** (`desktop-config`). Categorías: rendimiento, accesibilidad (criterio:
**90 o más**), buenas prácticas y SEO (de referencia).

Las pantallas con sesión se miden así: Playwright abre Chromium con un perfil propio, inicia sesión
**por la interfaz** (la sesión queda en `localStorage`), borra el service worker, `Cache Storage` y la
caché HTTP, y Lighthouse se conecta a ese mismo navegador por el puerto de depuración con
`disableStorageReset` (para no perder la sesión). La caché HTTP se vacía antes de cada corrida para
que las repeticiones también sean «en frío».

## Instalabilidad (reemplaza a la categoría PWA)

Lighthouse 12 en adelante ya no tiene la categoría PWA. `instalabilidad.ts` comprueba a mano, con el
navegador real y sin sesión: service worker registrado, activado y **controlando** la página tras
recargar; manifest enlazado, con `name`, `short_name`, `display`, `start_url` (responde 200),
`theme_color` y `background_color`; íconos 192, 512 y maskable (existen y miden lo que declaran, leído
del PNG); `<meta name="theme-color">`, `apple-touch-icon`, viewport; contexto seguro y la lista de
errores que informa el propio Chrome (`Page.getInstallabilityErrors`). Si algún punto falla, el
script termina con código 1.

## Cómo correrlo

Desde `app/`:

```bash
pnpm test:lighthouse                                       # todo, una corrida por pantalla y modo
pnpm test:lighthouse --corridas=3                          # tres corridas (el resumen usa la mediana)
pnpm test:lighthouse --solo=login,sup --modos=mobile       # un subconjunto
pnpm test:lighthouse --sin-instalabilidad                  # omite la comprobación de instalabilidad
pnpm test:lighthouse --base=http://localhost:4173          # contra `pnpm preview` (la sesión necesita el mismo backend)
```

Solo acepta `dev.extendiendoservicios.com` (staging, backend `App_dev`) o `localhost`; producción nunca.
Corre en primer plano: todo con tres corridas lleva unos 25 minutos; con una, unos 8.

## Salida

`test-results/lighthouse/` (carpeta ignorada por git, **se vacía en cada corrida**): un `.html` y un
`.json` por pantalla, modo y corrida (`adm-mobile-1.html`), `resumen.md`, `resumen.json` e
`instalabilidad.json`. El resumen incluye la lista de auditorías de accesibilidad que no pasan, con el
selector del elemento.

## Limpieza

Al terminar, el script borra los datos `E2E-P174` (cliente, sede, turno, asignación, supervisión). Las
cuentas de Auth del empleado y del supervisor **no se pueden borrar** (quedan referenciadas por
`security_events` y la auditoría: «Database error deleting user»): se banean y se marcan como
inactivas, y la salida lo informa. Es el mismo comportamiento de las demás suites de backend real.

## Cosas a tener en cuenta

- Las primeras corridas de una pantalla con sesión suelen dar menos rendimiento que las siguientes
  (el borde de Cloudflare y el JIT del navegador todavía están fríos): por eso `--corridas=3` y la
  mediana. El tablero (ADM-02) varía más que el resto porque hace consultas al abrir.
- SEO en staging baja a propósito: `is-crawlable` falla porque staging se publica con `noindex`
  (INFRA-022).
- `valid-source-maps` falla porque los `.map` se suben a Sentry y se borran del `dist/` (INFRA-021).
