# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y este proyecto sigue [Versionado Semántico](https://semver.org/lang/es/) (ADR-020).

## [Sin publicar]

Entornos remotos y Auth (F3 · INFRA-010, INFRA-011, INFRA-019, INFRA-023), CI/CD, Sentry y robots de staging (F3 · INFRA-015 a INFRA-017, INFRA-021, INFRA-022), base del design system (F5 · DS-001, DS-002, DS-017) y acciones, entradas, selectores, tarjetas y `StatusBadge` (F5 · DS-003 a DS-007).

### Agregado

- Acciones (DS-003): `Button` restyleado (`variant`: `primary`/`ghost`/
  `dark`/`destructive`/`link`; `size`: `sm`/`md`/`mobile`; ícono a la
  izquierda; estado `loading` con spinner, deshabilita y lo informa a
  lectores de pantalla), `IconButton` (34×34) y `Fab` ("Fichar", 46 px,
  elevado -14 px sobre la tabbar).
- Entrada (DS-004): `Input`/`Textarea` restyleados (ícono, `error`,
  variante `mobile`), `Select` restyleado, `Combobox` con búsqueda (sobre
  `command` + `popover`), `Switch`/`Checkbox`/`RadioGroup` restyleados y
  `ToggleRow` (fila de toggle con título y ayuda).
- Selección y fecha/hora (DS-005): `SegmentedControl` (con variante móvil y
  opción crítica en rojo, patrón ARIA `radiogroup`/`radio` con teclado),
  `OptionCard`, `Stepper`, `WeekdayPicker` (`0` = domingo), `TimeInput` y
  `DatePicker`/`MonthPicker` en español con la semana desde el lunes.
- Presentación (DS-006): `Card` restyleado (`CardHeader`, variantes
  `flush` y `hero`), `KpiCard` (`accent`/`ok`/`warn`/`crit`), `EmptyState`
  y `ProgressBar` (`ok`/`warn`).
- Estados (DS-007): `StatusBadge` y el mapa único de estados en
  `src/components/status/` (`07` sección 3 completa, con los derivados
  `uncovered`/`upcoming`/`no_record`/`early_leave` y el sufijo "· n min"),
  más el helper de filas de tabla `crit`/`warn`.
- `/dev/design` (adelanto parcial de DS-016): vidriera de los componentes
  de este paquete con sus variantes y estados, solo en desarrollo
  (`import.meta.env.DEV`, no queda en el build de producción).
- Tests de Testing Library para `Button` (loading), `StatusBadge` (mapeo
  completo y sufijo de minutos), `SegmentedControl` (teclado y ARIA),
  `Stepper` (límites) y `WeekdayPicker` (valor y orden).
- `afterEach(cleanup)` en `src/test/setup.ts`: sin `test.globals` en
  Vitest, `@testing-library/react` no encontraba un `afterEach` global del
  que colgar su limpieza automática entre tests, y el DOM de cada
  `render()` se acumulaba dentro del mismo archivo. No afectaba a los
  tests existentes (uno por archivo) pero rompía cualquier suite con más
  de un `it()`, como las de este paquete.
- Corrección de un bug heredado de DS-002: los componentes shadcn
  (`checkbox`, `switch`, `radio-group`) usaban clases `data-checked:`
  asumiendo un atributo booleano que Radix nunca agrega (la versión
  instalada usa `data-state="checked"`), así que el estado marcado nunca
  se veía. Se corrigió a `data-[state=checked]:` en los tres, más
  `OptionCard`.
- Tokens nuevos en `tokens.css`: `--r-xs` (radio de `Checkbox`),
  `--primary-200`, `--sh-hero` y `--ring-soft` (ver `docs/design-system.md`
  para el detalle de cada uno).

- `.github/workflows/ci.yml`: un solo job (`CI`, nombre estable para la
  futura protección de ramas) en cada Pull Request a `develop` o `main` con
  `pnpm install --frozen-lockfile`, lint, typecheck, `format:check`, test,
  build y Playwright (solo `chromium`, contra el build local; navegadores
  instalados en el runner en cada corrida). Los pasos de `db:types --check`
  y pgTAP quedan escritos pero condicionados a que exista al menos una
  migración o un test de base (`supabase/migrations/`, `supabase/tests/`):
  se saltean con un mensaje explícito mientras F4 no los agregue (INFRA-015).
- `.github/workflows/deploy-staging.yml` (push a `develop`) y
  `.github/workflows/deploy-production.yml` (push a `main`, con el
  environment `production` y revisor Mike): `db push` y `functions deploy`
  de `admin-users` condicionados igual que en CI; build con las variables
  del entorno correspondiente; despliegue a Cloudflare Pages con
  `pnpm exec wrangler pages deploy`; smoke test de Playwright contra la URL
  publicada. Producción exige además un volcado previo de `App` a R2
  (ADR-015) que falla a propósito si `scripts/backup-to-r2.sh` no existe
  todavía (pendiente de P03.4), y no crea la etiqueta de versión (la crea
  el orquestador). Ninguno de los dos hace nada remoto todavía: ambos
  workflows completos quedan detrás de las variables de repositorio
  `STAGING_DEPLOY_ENABLED`/`PRODUCTION_DEPLOY_ENABLED` (INFRA-016,
  INFRA-017).
- `@sentry/react` inicializado en `src/lib/sentry.ts`, llamado desde
  `main.tsx`: no hace nada sin `VITE_SENTRY_DSN` (test en
  `src/lib/sentry.test.ts`); con DSN, `environment` = `VITE_APP_ENV`,
  `release` = la versión de `package.json`, `sendDefaultPii: false`, sin
  Session Replay ni tracing. `vite.config.ts` agrega `@sentry/vite-plugin`
  solo si hay `SENTRY_AUTH_TOKEN`: sube los source maps a la región UE de
  Sentry (`url: 'https://de.sentry.io/'`, organización
  `extendiendo-servicios`) y los borra de `dist/` en el mismo paso del
  build (`sourcemaps.filesToDeleteAfterUpload`, verificado incluso cuando
  la subida falla); una falla al subir no bloquea el build
  (`errorHandler`). Sin el token, no se generan `.map` en absoluto
  (INFRA-021).
- `public/robots.txt` con `Disallow: /` en los tres entornos: la
  aplicación es una herramienta interna con login, no un sitio público
  (recomendación justificada en el reporte del encargo, no una decisión
  cerrada). `deploy-staging.yml` además agrega la cabecera
  `X-Robots-Tag: noindex` generando `dist/_headers` en el propio build
  (INFRA-022).
- `packageManager` fijado en `package.json` (`pnpm@12.4.2`) para que
  `corepack enable` resuelva la misma versión de pnpm en cualquier
  máquina y en los tres workflows nuevos, sin repetirla a mano.
- `docs/deployment.md` (primera versión, DOC-003): los cinco workflows,
  qué dispara cada uno, los interruptores de despliegue, la aprobación
  manual de producción, el rollback (`03` sección 16) y los secretos que
  usa cada workflow.
- `docs/environments.md`: nota sobre `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY` y `VITE_SENTRY_DSN` como secretos de GitHub
  (no solo variables de Pages), porque el build lo hace GitHub Actions y
  no el build integrado de Cloudflare Pages.

- `App_dev` vinculado (`supabase link --project-ref anesttvrnpsaaaxaquce`);
  `supabase/config.toml` con `project_id` significativo y `major_version = 17`
  verificado contra los proyectos remotos (INFRA-010).
- Configuración de Auth versionada en `supabase/config.toml`: sin registro
  público, contraseña mínima de 8 caracteres, JWT de 1 hora, sesión
  persistente sin expiración por tiempo ni por inactividad, `site_url` y
  URLs de redirección de `App_dev`, y un bloque `[remotes.produccion.auth]`
  con los valores de `App` listo para cuando Mike decida aplicarlo
  (INFRA-011). Aplicado hoy solo en `App_dev` con `supabase config push`.
- `.github/workflows/keepalive.yml`: consulta semanal (`select 1`, más
  `workflow_dispatch`) a `App_dev` por el Session pooler, para evitar la
  pausa por inactividad del plan sin cargo (INFRA-019).
- `docs/environments.md`: entornos, cuentas con sus refs de proyecto, tabla
  de variables y secretos, cómo vincula cada desarrollador y los comandos
  preparados para que Mike cargue los secretos de GitHub (INFRA-023).
- `wrangler` como dependencia de desarrollo (`pnpm exec wrangler`), con los
  scripts de instalación de `esbuild` y `workerd` habilitados en
  `pnpm-workspace.yaml` (los únicos que necesita para funcionar).
- Tokens del design system en `src/styles/tokens.css` (color, foco, radios,
  sombras y contenedores de `07_Design_System.md` sección 1), mapeados a las
  variables que espera shadcn/ui y a la paleta de Tailwind CSS 4 (`@theme`,
  ADR-021), con breakpoints `sm` 480, `md` 768, `lg` 1024, `xl` 1280
  (DS-001).
- Tailwind CSS 4 con `@tailwindcss/vite`, y Inter self-hosted en
  `public/fonts/` (pesos 400/500/600/700, subset latin,
  `font-display: swap`, sin Google Fonts en runtime) (DS-001).
- shadcn/ui sobre Radix, con `components.json` y los componentes base
  (button, input, select, dialog, sheet, table, tabs, badge, alert, field
  —reemplazo de `form`—, calendar, popover, command, avatar, skeleton,
  sonner, tooltip, switch, checkbox, radio-group) en `src/components/ui/`,
  conectados a los tokens (DS-002).
- Utilidades de formato de fecha, hora y duración en español de Argentina,
  con zona fija `America/Argentina/Buenos_Aires` (`src/lib/format.ts`,
  ADR-019, DS-017).
- `docs/design-system.md` (DOC-005, en curso).

## [0.1.0] - 2026-09-18

Repositorio base: scaffold del proyecto, herramientas de calidad y documentación
inicial (F2 · INFRA-001 a INFRA-009, DOC-001, DOC-002).

### Agregado

- Proyecto Vite + React 19 + TypeScript 6.0 estricto + React Router 7 en modo
  SPA, con alias `@/` (INFRA-002).
- ESLint 9 (typescript-eslint, react-hooks, jsx-a11y), Prettier y EditorConfig
  (INFRA-003).
- Vitest + Testing Library + jsdom, con un test de humo (INFRA-004).
- Playwright con proyectos chromium, webkit y mobile a 390 px (INFRA-005).
- Husky + lint-staged: en cada commit corren ESLint (`--fix`) y Prettier sobre
  los archivos en stage, y `pnpm typecheck` sobre todo el proyecto
  (INFRA-006).
- `supabase init`, `.env.example` y los scripts `db:push`, `db:types`,
  `db:test` (INFRA-007).
- Estructura de carpetas de `03_Plan_Maestro_Tecnico.md` sección 3.4, con un
  `README.md` en cada carpeta clave (INFRA-008).
- Página "en construcción" en `src/pages/common/` como shell mínimo del
  frontend, reemplazando la portada estática anterior de GitHub Pages.
- Plantilla de Pull Request (`.github/PULL_REQUEST_TEMPLATE.md`) con las
  secciones qué, cómo probar, tarea del backlog y migraciones incluidas
  (INFRA-009).
- Este `CHANGELOG.md` (INFRA-009).
- `README.md` raíz reescrito: qué es la plataforma, estado actual, cómo
  instalar y correr el proyecto, scripts disponibles y flujo de ramas
  (DOC-001).
- `docs/architecture.md` con la arquitectura y el stack del Plan Maestro
  (sección 1 y 2), y copia de los ADR (`ADR-001` a `ADR-021`) en `docs/adr/`
  (DOC-002).
- `.gitattributes` que fija los finales de línea en LF (`text=auto eol=lf`),
  para que `pnpm format:check` no falle en Windows después de un `clone` o un
  `checkout` (INFRA-006).

### Corregido

- Se fijó `prettier` en `3.9.6` (en vez de `3.9.8`, publicada menos de un día
  antes) y se eliminó la excepción `minimumReleaseAgeExclude` que saltaba la
  protección de pnpm contra versiones recién publicadas.
- Se formateó todo el repositorio con Prettier (`README.md`,
  `src/pages/common/ConstructionPage.css`, `tests/e2e/construction-page.spec.ts`)
  y se agregaron los scripts `format` y `format:check`.

[0.1.0]: https://github.com/extendiendoservicios/extendiendoservicios-app/releases/tag/0.1.0
