# Despliegue

Fuente: `03_Plan_Maestro_Tecnico.md` secciones 3.6 (dominios y cabeceras), 3.7
(CI/CD) y 16 (Deployment) del Plan Maestro (`Docs/Plan_Maestro/`, fuera de
este repo); ADR-013, ADR-014, ADR-015, ADR-016, ADR-017, ADR-018, ADR-020,
ADR-021. Este archivo se actualiza en el mismo PR que cambie algo de lo que
describe (primera versión: INFRA-015, INFRA-016, INFRA-017, INFRA-021,
INFRA-022, F3; ampliado en P03.4: INFRA-012, INFRA-018, INFRA-020,
`public/_headers`).

## 1. Los cinco workflows

`.github/workflows/` tiene los cinco workflows de `03` sección 3.7.

| Workflow                | Dispara                                 | Qué hace                                                                              | Estado                                                                           |
| ----------------------- | --------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `ci.yml`                | Pull Request a `develop` o `main`       | Instala, lintea, tipa, formatea, testea, construye y corre e2e (chromium)             | Activo desde P03.3                                                               |
| `deploy-staging.yml`    | Push a `develop`                        | Migra `App_dev`, construye con variables de staging, publica en Pages, smoke test     | Escrito y validado, detrás del interruptor (sección 3)                           |
| `deploy-production.yml` | Push a `main`                           | Volcado a R2, migra `App`, construye con variables de producción, publica, smoke test | Escrito y validado, detrás del interruptor y del `environment` (secciones 3 y 4) |
| `backup.yml`            | Cron diario 03:00 Argentina (06:00 UTC) | `pg_dump` cifrado de `App` a R2, retención 30 diarios / 12 mensuales (ADR-015)        | Escrito y validado, detrás del interruptor (secciones 3 y 6)                     |
| `keepalive.yml`         | Cron semanal (lunes 12:00 UTC)          | Consulta trivial a `App_dev` para evitar la pausa por inactividad (ADR-014)           | Activo desde P03.2 (INFRA-019)                                                   |

Ninguno de los workflows que publican o corren contra recursos remotos hizo
nada remoto todavía (ver sección 11): "escrito y validado" significa
lint/typecheck/build/YAML verificados localmente, no ejecutado en GitHub.

## 2. `ci.yml` (INFRA-015)

Un solo job, nombrado **`CI`** (así aparece en la pestaña Checks de un Pull
Request) para que el orquestador lo marque más adelante como verificación
obligatoria en la protección de ramas de `develop` y `main` (P03.6, fuera de
este encargo — ver sección 11).

Pasos, en orden: instalar dependencias (`pnpm install --frozen-lockfile`),
`pnpm lint`, `pnpm typecheck`, `pnpm format:check`, `pnpm test` (Vitest),
`pnpm build`, y por último Playwright con **solo el proyecto `chromium`**
contra el propio build local (`pnpm preview`, que `playwright.config.ts`
levanta solo). Los navegadores de Playwright se instalan en el runner en
cada corrida (`playwright install --with-deps chromium`): no están
cacheados ni preinstalados.

**Condicionados, no eliminados:** `db:types --check` (genera
`src/lib/database.types.ts` desde `App_dev` y falla si difiere de lo
commiteado, DB-021) y `pnpm db:test` (pgTAP, DB-022) están escritos en el
workflow pero se saltean mientras no exista al menos un archivo `.sql` en
`supabase/migrations/` o en `supabase/tests/` respectivamente (hoy ninguna
de las dos carpetas tiene uno: son placeholders con solo un `README.md`).
Un paso previo (`Detectar si ya hay migraciones o tests de base`) revisa
ambas carpetas y expone el resultado; los pasos reales (y sus explicaciones
alternativas, que sí corren y dejan un mensaje en el log) usan ese
resultado en su `if:`. No hace falta tocar `ci.yml` cuando F4 agregue el
primer archivo: se activan solos.

## 3. Interruptores de despliegue (INFRA-016, INFRA-017, INFRA-018)

`deploy-staging.yml`, `deploy-production.yml` y `backup.yml` dependen de
secretos que todavía no se cargaron (P03.5) y, los dos primeros, de la
protección de ramas y el `environment` de producción (P03.6). Para que
fusionar en `develop` hoy no falle por falta de secretos ni publique nada
antes de tiempo, cada workflow entero queda apagado detrás de una
**variable de repositorio** de GitHub (`vars`, no `secrets`: no es
información sensible, así se puede leer en el `if:` del job sin gastar un
secreto):

- `STAGING_DEPLOY_ENABLED` para `deploy-staging.yml`.
- `PRODUCTION_DEPLOY_ENABLED` para `deploy-production.yml`.
- `BACKUP_ENABLED` para `backup.yml`.

El job entero (`if: vars.STAGING_DEPLOY_ENABLED == 'true'`, etc.) no corre si
la variable no existe o vale cualquier cosa distinta de la cadena exacta
`"true"` — un push a `develop`/`main`, o el disparo diario del cron, sigue
activando el workflow, pero el run queda marcado como "skipped", sin gastar
minutos de runner ni intentar nada.

El proyecto de Cloudflare Pages `extendiendoservicios-app` y el bucket R2
`es-backups` **ya existen** (INFRA-012, INFRA-020, P03.4 — sección 7), así
que lo único que falta para poder activar los tres interruptores es que Mike
cargue los secretos (P03.5, sección 10) y, para producción, que exista el
`environment` con su revisor (sección 4).

**Acción para Mike, cuando corresponda activarlos** (P03.6, después de P03.5):

```bash
gh variable set STAGING_DEPLOY_ENABLED --body true --repo extendiendoservicios/extendiendoservicios-app
gh variable set PRODUCTION_DEPLOY_ENABLED --body true --repo extendiendoservicios/extendiendoservicios-app
gh variable set BACKUP_ENABLED --body true --repo extendiendoservicios/extendiendoservicios-app
```

Para volver a apagar uno sin borrar el workflow: `gh variable set ... --body false`, o borrar
la variable con `gh variable delete`.

## 4. Aprobación manual de producción

`deploy-production.yml` corre bajo `environment: production` (declarado en
el YAML, como pide INFRA-017). Esa referencia no crea nada por sí sola: para
que efectivamente bloquee el job hasta que alguien lo apruebe, el
environment "production" tiene que existir en GitHub con una regla de
**revisores obligatorios** (Mike) configurada — eso es una acción remota en
la configuración del repositorio, fuera de este encargo (crear
environments no es infraestructura de archivos). Hasta que exista, un push
a `main` con `PRODUCTION_DEPLOY_ENABLED=true` correría sin pedir
aprobación, así que **no conviene activar el interruptor de producción
antes de crear el environment con su regla de revisor**.

`backup.yml` corre diariamente por cron y **no** usa `environment:
production` (correr bajo ese environment exigiría que Mike apruebe a mano
cada corrida diaria del respaldo, lo que rompería la automatización) — sus
secretos son de repositorio, no de `environment` (sección 10).

**Acción para Mike:** Settings → Environments → New environment →
`production` → Required reviewers → agregar a Mike → Save protection
rules.

## 5. Migraciones, Edge Function y el volcado previo a producción

Igual que en `ci.yml`, `supabase db push` y `supabase functions deploy
admin-users` están escritos en ambos workflows de despliegue pero
condicionados a que ya existan migraciones (F4) o la función (F7) — hoy
ninguna de las dos existe, así que ambos pasos se saltean con un mensaje
explicativo en el log, en cada uno de los dos workflows.

`deploy-production.yml` además exige, **antes** de tocar `App`, un volcado a
R2 (ADR-015: nunca migrar producción sin un respaldo fresco). Ese paso
invoca `scripts/backup-to-r2.sh` (sección 6): si hay migraciones que aplicar
y el script no existe o perdió el bit ejecutable, **el workflow falla ahí a
propósito** en vez de seguir con `db push` sin respaldo — no es un paso
"opcional" como los de arriba, que se saltean en silencio mientras no haya
nada que migrar todavía.

## 6. Respaldos a R2 y restauración (INFRA-018, INFRA-020, ADR-015)

### 6.1 `scripts/backup-to-r2.sh`

Lo reutilizan dos workflows: `backup.yml` (cron diario) y el paso "Volcado
previo de `App` a R2" de `deploy-production.yml` (sección 5). Qué hace, en
orden:

1. Verifica que estén las seis variables de entorno que necesita (abajo);
   si falta alguna, falla enseguida con un mensaje que dice cuál, sin
   imprimir ningún valor.
2. Se asegura de tener un **cliente de PostgreSQL 17** (`scripts/lib/dependencias-ci.sh`,
   función `asegurar_pg17`): los proyectos de Supabase corren Postgres 17.6
   y un `pg_dump`/`pg_restore` más viejo no puede volcar ni restaurar ese
   formato. Ubuntu (el runner de GitHub) no siempre trae la versión 17 por
   defecto; si no la encuentra en el `PATH` la instala desde el repositorio
   oficial de PostgreSQL (PGDG), nunca desde un paquete de terceros.
3. `pg_dump --format=custom --no-owner --no-privileges` de `App`
   (`SUPABASE_DB_URL_PROD`, Session pooler) a un archivo temporal.
4. Cifra ese archivo con `gpg --symmetric --cipher-algo AES256` usando
   `BACKUP_PASSPHRASE`, y borra el volcado sin cifrar del disco. **El
   volcado sin cifrar nunca se sube**: solo existe unos segundos en un
   directorio temporal que un `trap` borra al salir, pase lo que pase.
5. Sube el archivo cifrado a R2 por su API S3 (`aws s3 cp`, con
   `asegurar_aws_cli` instalando la AWS CLI si hace falta), con el nombre y
   el prefijo de retención que corresponda.

Variables de entorno (ninguna se imprime en ningún momento):
`SUPABASE_DB_URL_PROD`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_BUCKET`, `CLOUDFLARE_ACCOUNT_ID`, `BACKUP_PASSPHRASE`.

**Nombre y prefijo de retención:** `diarios/App_<fecha_hora_argentina>.dump.gpg`
todos los días salvo el 1º de cada mes, que va a
`mensuales/App_<fecha_hora_argentina>.dump.gpg`. La **retención la aplica el
propio bucket `es-backups`** con sus reglas de ciclo de vida (INFRA-020, ya
creadas): `retencion-diaria` expira los objetos de `diarios/` a los 30 días,
`retencion-mensual` expira los de `mensuales/` a los 370 días (~12 meses).
El script no borra nada.

### 6.2 `backup.yml`

Cron diario `0 6 * * *` (06:00 UTC = 03:00 Argentina, UTC-3 todo el año, sin
horario de verano — ADR-019) más `workflow_dispatch` para correrlo a mano.
Detrás de `vars.BACKUP_ENABLED == 'true'` (sección 3). Si el volcado, el
cifrado o la subida fallan, el job falla sin reintento: eso es lo que
dispara el correo de alerta de GitHub Actions a quien tenga notificaciones
activadas para el repositorio (mismo criterio que `keepalive.yml`). Alertas
más elaboradas (uso de Supabase, resumen de fallos) son INFRA-024, un
encargo aparte (P03.7).

### 6.3 Restauración (`scripts/restore-from-r2.sh`)

**Prueba de restauración documentada (ADR-015, TEST-024):** este script deja
el procedimiento listo y probado en sus partes no destructivas (validación
de argumentos, variables de entorno, ciclo de cifrado/descifrado). La
restauración real sobre `App_dev` con un volcado de verdad es un encargo
aparte (P03.7 según `11_Desglose_de_Tareas.md`: "respaldo en R2 y
restauración de prueba en `App_dev`") — acá no se ejecutó contra ningún
proyecto remoto.

**Solo `App_dev`.** El script no lee `SUPABASE_DB_URL_PROD` en ningún lado:
estructuralmente no puede apuntar a `App` (producción) ni por accidente ni
por una variable mal cargada. Restaurar producción es un procedimiento
manual y excepcional aparte, para `docs/runbook-produccion.md` (F20,
todavía no existe).

**Es destructivo:** corre `pg_restore --clean --if-exists`, que borra y
recrea todo lo que ya exista en `App_dev` antes de restaurar el contenido
del volcado. Por eso exige una confirmación explícita además de bajar y
descifrar el archivo.

Uso:

```bash
# 1. Listar los respaldos disponibles en el bucket (más recientes primero)
R2_ACCESS_KEY_ID=<...> R2_SECRET_ACCESS_KEY=<...> R2_BUCKET=es-backups \
  CLOUDFLARE_ACCOUNT_ID=<...> \
  scripts/restore-from-r2.sh --listar

# 2. Restaurar uno elegido (pide confirmación interactiva además del
#    segundo argumento si la terminal es interactiva)
SUPABASE_DB_URL_DEV=<...> R2_ACCESS_KEY_ID=<...> R2_SECRET_ACCESS_KEY=<...> \
  R2_BUCKET=es-backups CLOUDFLARE_ACCOUNT_ID=<...> BACKUP_PASSPHRASE=<...> \
  scripts/restore-from-r2.sh diarios/App_20260101_030000.dump.gpg restaurar-app-dev
```

Las variables son las mismas que documenta `docs/environments.md` sección 4
para `SUPABASE_DB_URL_DEV`, `R2_*` y `BACKUP_PASSPHRASE`: se pegan a mano en
la sesión de quien restaura (nunca en un archivo ni en un commit).

**`BACKUP_PASSPHRASE` es indispensable y no se puede recuperar:** sin la
frase exacta que se usó para cifrar un volcado, ese volcado queda
inservible para siempre (cifrado simétrico, sin puerta trasera). Por eso
`docs/environments.md` sección 4 insiste en guardarla también fuera de
GitHub.

## 7. Cloudflare Pages y R2 (INFRA-012, INFRA-020, ADR-013, ADR-015)

Creados con `wrangler` en la cuenta de Cloudflare `extserviciosapp@gmail.com`
(P03.4; verificado antes con `wrangler whoami`, `03` sección 3.2):

- **Pages** `extendiendoservicios-app` (`wrangler pages project
create extendiendoservicios-app --production-branch=main`): sin proyecto
  de Git conectado a propósito (el build lo hace GitHub Actions, sección 9
  de este documento explica por qué), sin dominios personalizados todavía
  (INFRA-013, `dev.`/`app.` vía Cloudflare DNS, pendiente) y sin ningún
  despliegue hecho — `wrangler pages deploy` recién publica algo cuando
  `deploy-staging.yml`/`deploy-production.yml` corran de verdad (sección 3).
- **R2** `es-backups` (`wrangler r2 bucket create es-backups`, clase
  Standard): sin acceso público (`r2 bucket dev-url get` confirma que el
  acceso `r2.dev` está deshabilitado) y sin dominios personalizados. Reglas
  de ciclo de vida ya creadas: `Default Multipart Abort Rule` (aborta cargas
  multiparte incompletas a los 7 días), `retencion-diaria` (expira
  `diarios/` a los 30 días) y `retencion-mensual` (expira `mensuales/` a los
  370 días) — sección 6.1.

Ninguno de los dos recibió todavía un token de API: los crea Mike con
permisos mínimos en P03.5 (`docs/environments.md` sección 4).

## 8. Rollback (`03` sección 16)

|               | Staging                                                                                                                                                                                        | Producción                                                                                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend      | Re-desplegar la versión anterior en Cloudflare Pages (cada despliegue queda como una entrada separada en el panel de Pages; `wrangler pages deployment list` / el botón "Rollback" del panel). | Igual que en staging.                                                                                                                                                            |
| Base de datos | Migración correctiva nueva (nunca se edita una migración ya aplicada, `03` sección 3.5).                                                                                                       | Igual, más — solo si una migración dañó datos — restaurar el volcado más reciente de R2 a `App`. Procedimiento detallado: `docs/runbook-produccion.md` (F20, todavía no existe). |

Restaurar un volcado de R2 sobre `App` (producción) es destructivo y no está
automatizado por diseño: es una acción manual y excepcional de Mike, nunca
un paso de un workflow ni de `scripts/restore-from-r2.sh` (que, a
diferencia de esto, solo apunta a `App_dev` — sección 6.3).

## 9. Sentry (INFRA-021)

- Organización `extendiendo-servicios`, proyecto `extendiendoservicios-app`,
  región de datos **Unión Europea**. La región importa para dos cosas
  distintas:
  - El **DSN** (`VITE_SENTRY_DSN`) que usa el SDK del navegador para mandar
    errores ya apunta al host de ingesta correcto de la región (algo como
    `https://<clave>@o<org>.ingest.de.sentry.io/<proyecto>`); Mike lo copia
    tal cual del panel de Sentry, no hace falta construirlo a mano.
  - La **API** que usan la CLI y los plugins de build (para crear
    releases y subir source maps) es distinta por región: `sentry.io` es la
    de EE. UU. (el valor por omisión de `@sentry/vite-plugin`); la de la
    Unión Europea es **`de.sentry.io`**. `vite.config.ts` fija
    `url: 'https://de.sentry.io/'` explícitamente en la configuración del
    plugin — verificado contra la documentación de Sentry sobre
    almacenamiento de datos por región, y confirmado en la práctica: un
    build local con un token inválido contra ese host devolvió un 401 real
    de la API (no un error de DNS ni de timeout), confirmando que el host
    es correcto y está accesible.
- `src/lib/sentry.ts` inicializa el SDK (`@sentry/react`) **solo si existe
  `VITE_SENTRY_DSN`**; sin esa variable (todo build local, y cualquier build
  en CI antes de que Mike cargue el secreto) no se ejecuta ni una llamada
  de red. Test: `src/lib/sentry.test.ts`.
- `environment` = `VITE_APP_ENV`, `release` = `VITE_APP_VERSION` (la misma
  versión de `package.json`, ADR-020). `sendDefaultPii: false` explícito
  (`03` sección 15: nunca se manda información personal identificable
  además de la del propio error). Sin Session Replay ni tracing de
  rendimiento: no se agregan las integraciones `browserTracingIntegration`
  ni `replayIntegration`, y no se declara `tracesSampleRate` — el plan pide
  solo captura de errores.
- **Source maps**: `vite.config.ts` agrega `sentryVitePlugin` (de
  `@sentry/vite-plugin`) **solo si hay `SENTRY_AUTH_TOKEN`** en el entorno
  del build (secreto de CI, nunca en local). Sin el token, `build.sourcemap`
  también queda en `false`: no se generan `.map` en absoluto, así que no hay
  nada que pueda terminar publicado sin querer. Con el token, el plugin:
  1. Genera los `.map` (`build.sourcemap: true`).
  2. Los sube a Sentry junto con la release (`release.name` = versión de
     `package.json`, la misma que ve el SDK en runtime).
  3. Los borra de `dist/` en el mismo paso del build
     (`sourcemaps.filesToDeleteAfterUpload: ['dist/**/*.map']`) — verificado
     en local: incluso forzando una subida que falla (token inválido,
     org inexistente, 401 de Sentry), el plugin igual borra el `.map` local
     antes de terminar el build. Además, `errorHandler` atrapa cualquier
     error de la subida y solo lo advierte por consola (`console.warn`) sin
     hacer fallar el build: una falla de Sentry (red, token vencido, límite
     de cuota) no tiene que bloquear un despliegue.
  4. Como respaldo — por si en algún escenario el paso anterior no llegara
     a correr — `deploy-staging.yml` y `deploy-production.yml` tienen
     además un paso propio `find dist -name '*.map' -delete` justo antes de
     publicar en Pages. Es idempotente: si ya no hay ningún `.map`, no hace
     nada.
- El host de ingesta EU de Sentry ya está en el `connect-src` de
  `public/_headers` (`https://*.ingest.de.sentry.io`, sección 10.2): sin
  esto el navegador bloquea las llamadas del SDK y los errores no llegan a
  Sentry en ningún entorno. El comodín cubre cualquier `o<org>` sin conocer
  todavía el número exacto de organización (Sentry no está creado aún,
  P03.5); si el DSN real usa un host distinto de `*.ingest.de.sentry.io` va
  a haber que ajustar esta línea cuando Mike lo cree.

## 10. `public/_headers` (INFRA-018), `robots.txt` y `noindex` (INFRA-022)

### 10.1 `robots.txt`

`public/robots.txt` bloquea todo (`Disallow: /`) y es **el mismo archivo en
los tres entornos** (local, staging, producción): la aplicación es una
herramienta interna con login (administración, empleados, supervisores), no
un sitio público — el sitio público de la empresa vive aparte
(`extendiendoservicios.com`, repositorio `extendiendoservicios-web`) y ese sí
se indexa normalmente. No hay contenido en `app.`/`dev.` que aporte valor de
búsqueda, y sí hay una razón para no exponer la estructura de rutas de una
herramienta interna a un buscador.

Esto es una **recomendación, no una decisión cerrada** (el plan solo dice
"robots por entorno" para producción, sin más detalle) — si en algún momento
la aplicación suma alguna página realmente pública, este archivo tiene que
dejar de bloquear esa ruta puntual.

### 10.2 `public/_headers`

Un único bloque `/*` (aplica a todo el sitio, en los tres entornos) con las
cabeceras de `03` sección 3.6:

| Cabecera                    | Valor                                                                                                                                     | Motivo                                                                                                                                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains`                                                                                                     | Fuerza HTTPS dos años, incluidas subdominios de `app.`/`dev.`. Sin `preload`: es una decisión más grande (alta a una lista fija del navegador, difícil de revertir) que queda abierta para Mike si la quiere más adelante. |
| `X-Content-Type-Options`    | `nosniff`                                                                                                                                 | Evita que el navegador adivine el tipo de contenido.                                                                                                                                                                       |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`                                                                                                         | Pedido explícito de `03` sección 3.6.                                                                                                                                                                                      |
| `X-Frame-Options`           | `DENY`                                                                                                                                    | Protección contra framing, redundante a propósito con `frame-ancestors 'none'` de la CSP (defensa en profundidad, navegadores viejos).                                                                                     |
| `Permissions-Policy`        | `geolocation=(self), camera=(), microphone=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), midi=(), sync-xhr=()` | Solo geolocalización propia (ADR-009, fichada con posición); el resto de las funciones sensibles reconocidas, en cero.                                                                                                     |
| `Content-Security-Policy`   | ver 10.3                                                                                                                                  | —                                                                                                                                                                                                                          |

### 10.3 `Content-Security-Policy`

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
font-src 'self';
img-src 'self' data: https://anesttvrnpsaaaxaquce.supabase.co https://fysuppdadwvabrjpnnoh.supabase.co https://tile.openstreetmap.org https://*.tile.openstreetmap.org;
connect-src 'self' https://anesttvrnpsaaaxaquce.supabase.co https://fysuppdadwvabrjpnnoh.supabase.co https://*.ingest.de.sentry.io https://nominatim.openstreetmap.org;
base-uri 'self';
form-action 'self';
frame-ancestors 'none';
object-src 'none'
```

(en el archivo real va todo en una sola línea, formato que exige `_headers`).

- **`connect-src`**: los dos proyectos de Supabase por su host único
  (`<ref>.supabase.co` sirve REST, Auth y Storage bajo el mismo origen —
  `anesttvrnpsaaaxaquce` es `App_dev`, `fysuppdadwvabrjpnnoh` es `App`,
  `docs/environments.md` sección 2); la ingesta de Sentry región UE
  (sección 9); Nominatim (`nominatim.openstreetmap.org`, ADR-017, para el
  buscador de direcciones del `MapPicker`, todavía no implementado). Sin
  `wss://`: el plan usa polling, no Supabase Realtime (ADR-012), así que no
  hace falta abrir WebSockets.
- **`img-src`**: `'self'` (logo e íconos propios de `public/`), `data:`
  (por si algún componente necesita un placeholder inline, hoy ninguno lo
  usa), los dos hosts de Supabase (Storage: buckets `avatars` y `branding`
  de ADR-016) y los tiles de OpenStreetMap — se listan las dos formas
  (`tile.openstreetmap.org` y `*.tile.openstreetmap.org`) porque Leaflet
  puede pedirlos con o sin el esquema de subdominios `a/b/c` según la
  configuración final del mapa (ADR-017, todavía sin implementar).
- **`style-src 'self' 'unsafe-inline'`**: **probado**, no supuesto. Con
  `style-src 'self'` a secas (sin `'unsafe-inline'`), sonner (el `Toaster`
  de `src/components/ui/sonner.tsx`, dependencia real del proyecto) inyecta
  su hoja de estilos con `document.createElement('style')` +
  `appendChild(document.createTextNode(...))`: el navegador la bloquea y lo
  reporta como violación de `style-src-elem` (verificado con Playwright
  contra un build real servido con `wrangler pages dev`, ver "Cómo lo
  verifiqué" del reporte del encargo). El posicionamiento dinámico de
  Radix/Floating UI (`Popover`, `Select`, `Tooltip`, etc. — todos via
  `@radix-ui/react-popper`), en cambio, **no** necesitó `'unsafe-inline'`:
  asigna sus estilos de posición vía CSSOM (`style.setProperty(...)` y el
  `style` de React, que React aplica propiedad por propiedad, no como
  `setAttribute('style', ...)` ni `.cssText`), algo que los navegadores
  actuales no tratan como "estilo en línea" a los efectos de la CSP. Con
  `'unsafe-inline'` agregado, cero violaciones para ambos casos.
- **`script-src 'self'`**: sin `'unsafe-inline'` ni `'unsafe-eval'` — nada
  en el proyecto necesita scripts inline ni `eval` (Vite compila todo a
  módulos con `<script type="module" src="...">`).
- **`default-src 'self'`**: sirve de resguardo para cualquier directiva de
  "fetch" no listada arriba (por ejemplo `manifest-src`/`worker-src` del
  manifest/service worker de la PWA, F17 — todavía no existen); como todo
  lo que sirve la app hoy es de origen propio, no bloquea nada.
- **`frame-ancestors 'none'` / `object-src 'none'` / `base-uri 'self'` /
  `form-action 'self'`**: variantes de defensa en profundidad estándar,
  seguras porque la app no necesita ser embebida en un `<iframe>` ajeno, no
  usa plugins/`<object>`, y no tiene ninguna razón para que se inyecte un
  `<base>` ni un formulario que apunte a otro origen.

### 10.4 `X-Robots-Tag: noindex` en staging, sin pisar el resto

`deploy-staging.yml` agrega una línea más **dentro del mismo bloque `/*`**
de `dist/_headers` (que ya trae el build, porque Vite copia `public/` tal
cual): `sed -i '/^\/\*$/a\  X-Robots-Tag: noindex' dist/_headers`. Se eligió
insertar en el mismo bloque, no agregar un segundo bloque `/*` aparte,
porque aunque Cloudflare Pages documenta que combina cabeceras de reglas
distintas que matchean el mismo path ("an incoming request which matches
multiple rules' URL patterns will inherit all rules' headers"), esa
combinación entre bloques no se pudo verificar en local: `wrangler pages
dev` (versión instalada, 4.99.0) mostró un comportamiento inconsistente al
combinar dos bloques `/*` separados (algunas cabeceras del primer bloque no
aparecían en la respuesta), mientras que insertar la línea dentro de un
único bloque sí se verificó funcionando de punta a punta. Producción no
lleva esta cabecera (`robots.txt` alcanza como base ahí).

### 10.5 Verificar `_headers` en local con `wrangler pages dev`

Dos detalles de esta versión de `wrangler` (4.99.0) que no son evidentes:

- Hace falta pasar `--compatibility-date` explícito y no más nuevo que el
  que soporta el binario instalado (por ejemplo
  `--compatibility-date=2026-06-16`): sin el flag, `wrangler` usa la fecha
  de hoy por defecto y el runtime local (`workerd`) puede rechazarla si es
  más nueva que la que soporta esa versión del paquete, con un error
  "requires compatibility date ... but the newest date supported by this
  server binary is ...".
- En Windows, `wrangler pages dev` corre bajo `workerd.exe` como proceso
  hijo separado del que reporta la terminal: matar el proceso de la
  terminal (`kill $!`/Ctrl+C) no siempre lo termina. Si un puerto queda
  "pegado" o las cabeceras de una corrida anterior parecen no actualizarse
  después de reconstruir, conviene revisar `tasklist | findstr workerd` y
  `netstat -ano | findstr <puerto>` y terminar esos procesos con
  `taskkill //F //IM workerd.exe //T` antes de reintentar.

## 11. Secretos y variables por workflow

Nombres completos, de dónde salen y para qué exactamente en `docs/environments.md`
sección 4. Resumen de qué usa cada workflow:

| Workflow                | Secretos / variables                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`                | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF_DEV`, `SUPABASE_DB_URL_DEV` — los tres solo se leen en los pasos condicionados de `db:types`/pgTAP (hoy no se ejecutan).                                                                                                                                                                                                                                                          |
| `deploy-staging.yml`    | `vars.STAGING_DEPLOY_ENABLED`; `SUPABASE_DB_URL_DEV`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF_DEV`; `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (secretos del `environment: staging`); `VITE_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`; `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.                                                                                                                                          |
| `deploy-production.yml` | `vars.PRODUCTION_DEPLOY_ENABLED`; `SUPABASE_DB_URL_PROD`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF_PROD`; `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET`/`CLOUDFLARE_ACCOUNT_ID`/`BACKUP_PASSPHRASE` (volcado previo, sección 6.1); `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (secretos del `environment: production`); `VITE_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`; `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. |
| `backup.yml`            | `vars.BACKUP_ENABLED`; `SUPABASE_DB_URL_PROD`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `CLOUDFLARE_ACCOUNT_ID`, `BACKUP_PASSPHRASE` — todos secretos de **repositorio**, no de `environment` (sección 4): un cron diario no puede depender de una aprobación manual.                                                                                                                                            |
| `keepalive.yml`         | `SUPABASE_DB_URL_DEV`.                                                                                                                                                                                                                                                                                                                                                                                                           |

**Nota sobre `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` / `VITE_SENTRY_DSN`:**
`docs/environments.md` (P03.2) las documentó como "variable de Pages por
rama", asumiendo que Cloudflare Pages construía el sitio a partir del
repositorio conectado por Git. Este encargo (INFRA-016/017) resolvió el
despliegue distinto: **el build lo hace GitHub Actions** (`pnpm build`) y
`wrangler pages deploy` solo sube el `dist/` ya construido — Cloudflare no
ejecuta ningún build propio (confirmado también en P03.4: el proyecto de
Pages se creó sin conectar ningún repositorio de Git). Por eso estas
variables también tienen que existir como **secretos de GitHub**, no solo
como variables del panel de Pages: `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`
difieren entre `App_dev` y `App`, así que se cargan como secretos de cada
`environment` (`staging` / `production`) con el mismo nombre en los dos,
en vez de dos pares de secretos con sufijo `_DEV`/`_PROD`. `VITE_SENTRY_DSN`
es el mismo proyecto de Sentry en ambos entornos (el plan usa un solo
proyecto, diferenciado por `environment` dentro de Sentry), así que alcanza
con un secreto de repositorio, sin scoping por `environment`. Queda
anotado también en `docs/environments.md`.

## 12. Qué falta para que esto corra de verdad

Todo lo de arriba está escrito, validado localmente (build, lint,
typecheck, test) y con la sintaxis de los cinco workflows verificada contra
el esquema de GitHub Actions, pero **nada se ejecutó contra un proyecto
remoto salvo la creación de Pages y R2** (P03.4, sección 7 — el único
alcance remoto que este encargo autorizó). Antes de que
`deploy-staging.yml`/`deploy-production.yml`/`backup.yml` puedan hacer algo
real, falta:

- P03.5 (Mike): crear los tokens con permisos mínimos (Cloudflare, R2,
  Sentry) y cargar todos los secretos de GitHub y de cada `environment`
  (`docs/environments.md` sección 4), incluida `BACKUP_PASSPHRASE` guardada
  también fuera de GitHub (sección 6.3).
- P03.6 (infra-devops + Orq, con OK explícito de Mike): primer despliegue a
  Pages y verificación en `*.pages.dev`, alta de `dev.`, cambio del CNAME de
  `app.` y desactivación de GitHub Pages (INFRA-013, INFRA-014 — sin corte,
  `app.extendiendoservicios.com` sigue sirviendo GitHub Pages hasta que se
  verifique el nuevo destino); crear el `environment` `production` con
  revisor obligatorio (sección 4); configurar la protección de ramas usando
  `CI` como verificación obligatoria (sección 2); y recién ahí activar los
  tres interruptores (sección 3).
- P03.7 (infra-devops): INFRA-024 (alertas de uso de Supabase y de fallos de
  workflows) y las pruebas de cierre de F3 — incluida la restauración real
  de un respaldo en `App_dev` con `scripts/restore-from-r2.sh` (sección 6.3).
