# Despliegue

Fuente: `03_Plan_Maestro_Tecnico.md` secciones 3.7 (CI/CD) y 16 (Deployment)
del Plan Maestro (`Docs/Plan_Maestro/`, fuera de este repo); ADR-013,
ADR-014, ADR-015, ADR-018, ADR-020, ADR-021. Este archivo se actualiza en el
mismo PR que cambie algo de lo que describe (primera versión: INFRA-015,
INFRA-016, INFRA-017, INFRA-021, INFRA-022, F3).

## 1. Los cinco workflows

`.github/workflows/` tiene o va a tener cinco workflows (`03` sección 3.7).
Los tres primeros existen desde este encargo; `backup.yml` lo entrega P03.4
junto con el bucket R2 y el script de respaldo.

| Workflow                | Dispara                                 | Qué hace                                                                              | Estado                                                                         |
| ----------------------- | --------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `ci.yml`                | Pull Request a `develop` o `main`       | Instala, lintea, tipa, formatea, testea, construye y corre e2e (chromium)             | Activo desde este encargo                                                      |
| `deploy-staging.yml`    | Push a `develop`                        | Migra `App_dev`, construye con variables de staging, publica en Pages, smoke test     | Escrito y validado, detrás del interruptor (sección 3)                         |
| `deploy-production.yml` | Push a `main`                           | Volcado a R2, migra `App`, construye con variables de producción, publica, smoke test | Escrito y validado, detrás del interruptor y del `environment` (sección 3 y 4) |
| `backup.yml`            | Cron diario 03:00 Argentina (06:00 UTC) | `pg_dump` cifrado de `App` a R2, retención 30 diarios / 12 mensuales (ADR-015)        | Pendiente de P03.4 (INFRA-018, INFRA-020)                                      |
| `keepalive.yml`         | Cron semanal (lunes 12:00 UTC)          | Consulta trivial a `App_dev` para evitar la pausa por inactividad (ADR-014)           | Activo desde P03.2 (INFRA-019)                                                 |

## 2. `ci.yml` (INFRA-015)

Un solo job, nombrado **`CI`** (así aparece en la pestaña Checks de un Pull
Request) para que el orquestador lo marque más adelante como verificación
obligatoria en la protección de ramas de `develop` y `main` (P03.6, fuera de
este encargo — ver sección 6).

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

## 3. Interruptores de despliegue (INFRA-016, INFRA-017)

`deploy-staging.yml` y `deploy-production.yml` dependen de recursos que
todavía no existen (proyecto de Cloudflare Pages, bucket R2, secretos —
P03.4) y de la protección de ramas y el `environment` de producción (P03.6).
Para que fusionar en `develop` hoy no falle por falta de secretos ni publique
nada antes de tiempo, cada workflow entero queda apagado detrás de una
**variable de repositorio** de GitHub (`vars`, no `secrets`: no es
información sensible, así se puede leer en el `if:` del job sin gastar un
secreto):

- `STAGING_DEPLOY_ENABLED` para `deploy-staging.yml`.
- `PRODUCTION_DEPLOY_ENABLED` para `deploy-production.yml`.

El job entero (`if: vars.STAGING_DEPLOY_ENABLED == 'true'` /
`if: vars.PRODUCTION_DEPLOY_ENABLED == 'true'`) no corre si la variable no
existe o vale cualquier cosa distinta de la cadena exacta `"true"` — un push
a `develop` o a `main` sigue disparando el workflow, pero el run queda
marcado como "skipped", sin gastar minutos de runner ni intentar nada.

**Acción para Mike, cuando corresponda activarlos** (P03.6, después de que
P03.4 cree el proyecto de Pages, el bucket R2 y se carguen los secretos de
la sección 5):

```bash
gh variable set STAGING_DEPLOY_ENABLED --body true --repo extendiendoservicios/extendiendoservicios-app
gh variable set PRODUCTION_DEPLOY_ENABLED --body true --repo extendiendoservicios/extendiendoservicios-app
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
invoca `scripts/backup-to-r2.sh`, que todavía no existe: lo entrega P03.4
junto con `backup.yml`, el bucket R2 y sus credenciales (INFRA-018,
INFRA-020). A diferencia de los pasos de arriba, este **si hay migraciones
que aplicar y el script no existe, el workflow falla ahí a propósito** en
vez de seguir con `db push` sin respaldo — no es un paso "opcional" como los
de db push/functions deploy, que se saltean en silencio mientras no haya
nada que migrar todavía.

## 6. Rollback (`03` sección 16)

|               | Staging                                                                                                                                                                                        | Producción                                                                                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend      | Re-desplegar la versión anterior en Cloudflare Pages (cada despliegue queda como una entrada separada en el panel de Pages; `wrangler pages deployment list` / el botón "Rollback" del panel). | Igual que en staging.                                                                                                                                                            |
| Base de datos | Migración correctiva nueva (nunca se edita una migración ya aplicada, `03` sección 3.5).                                                                                                       | Igual, más — solo si una migración dañó datos — restaurar el volcado más reciente de R2 a `App`. Procedimiento detallado: `docs/runbook-produccion.md` (F20, todavía no existe). |

Restaurar un volcado de R2 es destructivo y no está automatizado por
diseño: es una acción manual de Mike siguiendo el runbook de producción,
nunca un paso de un workflow.

## 7. Sentry (INFRA-021)

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
- **Pendiente para el paquete de `_headers` (P03.4):** la `Content-Security-Policy`
  de `public/_headers` (`03` sección 3.6) tiene que agregar el host de
  ingesta EU de Sentry a `connect-src` (algo como
  `https://*.ingest.de.sentry.io`, a ajustar con el DSN real que entregue
  el panel) — si no, el navegador bloquea las llamadas del SDK y los
  errores no llegan a Sentry en ningún entorno.

## 8. `robots.txt` y `noindex` (INFRA-022)

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

Staging además suma la cabecera `X-Robots-Tag: noindex` (server-side,
redundante a propósito con el `robots.txt`, tal como lo pide el backlog):
`deploy-staging.yml` la genera escribiendo `dist/_headers` con esa única
regla, en un paso posterior al build. Producción no la lleva (robots.txt
alcanza como base; si Mike quiere agregarla también ahí, es un cambio de
una línea en `deploy-production.yml` calcado del de staging).

**Nota para el paquete de `_headers` (P03.4):** hoy `public/_headers` no
existe todavía (P03.4 lo crea con CSP, HSTS, etc.). El `dist/_headers` de
staging se genera en el propio workflow, no en `public/`, así que no choca
con nada. Pero apenas P03.4 agregue `public/_headers` como archivo del
repo, `deploy-staging.yml` va a tener que **combinar** la línea de
`X-Robots-Tag: noindex` con ese archivo en lugar de sobrescribirlo (por
ejemplo, `cat public/_headers >> dist/_headers` antes de agregar la regla
de staging, o directamente moviendo esa lógica a `public/_headers` con
alguna variante por entorno). Dejar esto en la lista de ese paquete.

## 9. Secretos y variables por workflow

Nombres completos, de dónde salen y para qué exactamente en `docs/environments.md`
sección 4. Resumen de qué usa cada workflow:

| Workflow                | Secretos / variables                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`                | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF_DEV`, `SUPABASE_DB_URL_DEV` — los tres solo se leen en los pasos condicionados de `db:types`/pgTAP (hoy no se ejecutan).                                                                                                                                                                                                                     |
| `deploy-staging.yml`    | `vars.STAGING_DEPLOY_ENABLED`; `SUPABASE_DB_URL_DEV`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF_DEV`; `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (secretos del `environment: staging`); `VITE_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`; `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.                                                                                                     |
| `deploy-production.yml` | `vars.PRODUCTION_DEPLOY_ENABLED`; `SUPABASE_DB_URL_PROD`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF_PROD`; `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_BUCKET`/`BACKUP_PASSPHRASE` (volcado previo); `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` (secretos del `environment: production`); `VITE_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`; `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`. |
| `backup.yml` (P03.4)    | `SUPABASE_DB_URL_PROD`, `R2_*`, `BACKUP_PASSPHRASE`.                                                                                                                                                                                                                                                                                                                                        |
| `keepalive.yml`         | `SUPABASE_DB_URL_DEV`.                                                                                                                                                                                                                                                                                                                                                                      |

**Nota sobre `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` / `VITE_SENTRY_DSN`:**
`docs/environments.md` (P03.2) las documentó como "variable de Pages por
rama", asumiendo que Cloudflare Pages construía el sitio a partir del
repositorio conectado por Git. Este encargo (INFRA-016/017) resolvió el
despliegue distinto: **el build lo hace GitHub Actions** (`pnpm build`) y
`wrangler pages deploy` solo sube el `dist/` ya construido — Cloudflare no
ejecuta ningún build propio. Por eso estas variables también tienen que
existir como **secretos de GitHub**, no solo como variables del panel de
Pages: `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` difieren entre
`App_dev` y `App`, así que se cargan como secretos de cada
`environment` (`staging` / `production`) con el mismo nombre en los dos,
en vez de dos pares de secretos con sufijo `_DEV`/`_PROD`. `VITE_SENTRY_DSN`
es el mismo proyecto de Sentry en ambos entornos (el plan usa un solo
proyecto, diferenciado por `environment` dentro de Sentry), así que alcanza
con un secreto de repositorio, sin scoping por `environment`. Queda
anotado también en `docs/environments.md`.

## 10. Qué falta para que esto corra de verdad

Todo lo de arriba está escrito, validado localmente (build, lint,
typecheck, test) y con la sintaxis de los tres workflows nuevos verificada
contra el esquema de GitHub Actions, pero **nada se ejecutó en GitHub**
(este encargo no autoriza acciones remotas). Antes de que
`deploy-staging.yml`/`deploy-production.yml` puedan hacer algo real, faltan
paquetes posteriores:

- P03.4: proyecto de Cloudflare Pages `extendiendoservicios-app`, bucket R2
  `es-backups`, `scripts/backup-to-r2.sh`, `backup.yml`, `public/_headers`
  (y combinarlo con el `noindex` de staging, sección 8), DNS.
- Mike, con los secretos de `docs/environments.md` sección 4 ya generados:
  cargar los secretos de repositorio y de cada `environment`.
- P03.6: crear el `environment` `production` con revisor obligatorio
  (sección 4), configurar la protección de ramas usando `CI` como
  verificación obligatoria (sección 2), y recién ahí activar los dos
  interruptores (sección 3).
