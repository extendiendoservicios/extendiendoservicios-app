# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y este proyecto sigue [Versionado Semántico](https://semver.org/lang/es/) (ADR-020).

## [Sin publicar]

Entornos remotos y Auth (F3 · INFRA-010, INFRA-011, INFRA-019, INFRA-023), CI/CD, Sentry y robots de staging (F3 · INFRA-015 a INFRA-017, INFRA-021, INFRA-022), Cloudflare Pages, R2, respaldos y cabeceras de seguridad (F3 · INFRA-012, INFRA-018, INFRA-020), base del design system (F5 · DS-001, DS-002, DS-017), acciones, entradas, selectores, tarjetas y `StatusBadge` (F5 · DS-003 a DS-007), tablas, avatares, avisos, diálogos, timeline y lista de tareas (F5 · DS-008 a DS-012), `AdminShell`, `MobileShell` y el router con `RequireRole` (F5 · DS-013 a DS-015), más el banner "Entorno de prueba" (INFRA-022), y el cierre de F5: marca de la sidebar e íconos PWA desde un PNG temporal, `vite-plugin-pwa` y `/dev/design` completo (F5 · DS-016, DS-018 a DS-020, RESP-001, DOC-005).

### Agregado

- Marca de la sidebar e íconos PWA (DS-018, PNG temporal — decisión de
  Mike del 19 sep 2026 de recortar el isotipo del PNG original en vez de
  esperar el vectorial IF-08; deuda **DS-020** registrada en
  `docs/design-system.md` para cuando llegue): `public/icons/` con los
  recortes que preparó el orquestador desde `Images/` (isotipo blanco a
  34 px con `@2x`/`@3x`, a resolución completa en blanco y negro, íconos
  PWA 192/512/512 maskable y `apple-touch-icon` 180, todos copiados tal
  cual, sin redibujar ni recolorear). Sidebar de `AdminShell`
  (`AdminSidebar`) reemplaza el lockup completo de P05.4 por el patrón de
  `07` sección 1.5/`Mockup/png/D01.png`: isotipo de 34 px + lockup de
  texto "EXTENDIENDO / SERVICIOS" (dos líneas, 12.5 px/700/mayúsculas/
  tracking 1.3 px) con una regla de 26×2 px debajo, colapsada a solo el
  isotipo, y sin nombres accesibles duplicados (`alt=""` en la imagen
  cuando el texto es visible, `alt="Extendiendo Servicios"` cuando no).
  `index.html`: `apple-touch-icon` al ícono de 180 y `theme-color` al teal
  de marca `#569EA4`, igual que el manifest (antes, `#0E1017` de la
  portada oscura).
  `public/logo.png`/`favicon.png` no se tocan (los sigue usando la
  portada, el 404 y el `og:image`).
- `vite-plugin-pwa` 1.3.0 (RESP-001, P-089): manifest (`name`/`short_name`/
  `description`/`lang: 'es-AR'`/`start_url`/`scope: '/'`/
  `display: 'standalone'` — "pantalla completa" sin la barra del
  navegador, no `fullscreen`, que ocultaría además la barra de estado del
  celular — `theme_color`/`background_color: '#569EA4'`, íconos 192/512
  `purpose: 'any'` + 512 `purpose: 'maskable'`), service worker
  (`strategies: 'generateSW'`) con precache exclusivo del build
  (`globPatterns` de JS/CSS/HTML/fuentes/íconos, sin `runtimeCaching`:
  ninguna llamada a Supabase, Nominatim ni OpenStreetMap se cachea) y
  `navigateFallback: '/index.html'` para la SPA.
  `registerType: 'prompt'` sin ninguna interfaz todavía (decisión del
  orquestador: el service worker nuevo queda esperando —
  `skipWaiting`/`clientsClaim` nunca se llaman solos, verificado en
  `dist/sw.js` — y se activa recién cuando se cierran todas las pestañas,
  para no interrumpir a un empleado fichando; el aviso "hay una versión
  nueva" es RESP-009, F17). `devOptions.enabled: false`: sin service
  worker en `pnpm dev`. Verificado que `/dev/*` no queda en el precache
  (`pnpm build` + `grep` sobre `dist/sw.js`), y con Playwright contra
  `pnpm preview` que el service worker se registra (`state: 'activating'`
  en la primera instalación) y el manifest se lee
  (`content-type: application/manifest+json`) sin errores de consola.
- `public/_headers` (INFRA-018, de infra-devops — este paquete solo
  agregó las reglas de caché, sin tocar el resto): dos bloques nuevos,
  `/sw.js` y `/manifest.webmanifest`, con `Cache-Control: no-cache` (sin
  hash de contenido en el nombre de archivo, a diferencia de
  `dist/assets/*`, así que sin esto un CDN o el navegador podrían
  quedarse con una copia vieja y una actualización del build no llegaría
  nunca a una app ya instalada). Verificado con `wrangler pages dev` que
  las dos rutas combinan este `Cache-Control` con las cabeceras de
  seguridad del bloque `/*` existente (CSP, HSTS, etc.), sin perder
  ninguna.
- `/dev/design` completo (DS-016): `DropdownMenu` ("más acciones" de una
  fila y menú de usuario de la sidebar), `Drawer`/`Sheet` (452 px a la
  derecha, cabecera/cuerpo con scroll/pie a ancho completo — hasta ahora
  solo se veía el `Sheet side="bottom"` del menú "Más"), `ActionBar`
  (ejemplo de M16 dentro del contenedor móvil de 390 px) y
  `StagingBanner` (con una réplica estática al lado, porque el componente
  real solo se ve con `VITE_APP_ENV=staging`). Inventario completo contra
  `07` sección 2 en el reporte del encargo.
- `docs/design-system.md` (DS-019/DOC-005): documento cerrado de F5 —
  secciones nuevas de marca (DS-018/DS-020) y PWA (RESP-001) con el
  detalle de cada decisión, inventario de `/dev/design` (DS-016) y ajuste
  de las notas de P05.4 que quedaban desactualizadas.

- Shells y router (DS-013 a DS-015, P05.4): `AdminShell`
  (`src/app/shells/AdminShell.tsx`) con sidebar teal de 236 px (las ocho
  secciones de P-121, colapsa a íconos de 60 px entre 1024 y 1279 px con
  `Tooltip`, tabbar inferior por debajo de 1024 con un menú "Más" en
  `Sheet` para el resto de las secciones), topbar con menú de usuario
  (`DropdownMenu`, agregado en este paquete) y punto de extensión para el
  buscador global (P09.0, sin ningún input real todavía); `MobileShell`
  (`src/app/shells/MobileShell.tsx`) para empleado y supervisor, con
  cabecera de saludo o navbar de subpágina según la ruta, tabbar propio de
  cada rol (con el `Fab` "Fichar" integrado en el de empleado) y
  `ActionBar` (`src/app/shells/ActionBar.tsx`) para las acciones al pie de
  una subpágina. Router (`src/app/router.tsx`, `src/app/routes/*`) con las
  51 rutas de `05_Pantallas_y_Navegacion.md` sección 5 como placeholders
  (título, `screenId` y "Pantalla en construcción."), un `RequireRole`
  (`src/features/auth/RequireRole.tsx`) por grupo (`/admin`, `/app`,
  `/sup`, y `/perfil` con el shell según el rol) sobre una sesión
  provisoria (`src/features/auth/session.ts`) que P06.2 reemplaza sin
  tocar rutas ni shells (ver `docs/design-system.md`), 404 con la marca
  (`src/pages/common/NotFoundPage.tsx`) y `AdminShell`/`MobileShell`
  detrás de `React.lazy` para que el celular no baje el código de
  administración (ni viceversa).
- `/dev/rol` (solo en desarrollo, mismo patrón que `/dev/design`): simula
  un rol (dueño, administrador, empleado, supervisor, o empleado y
  supervisor a la vez) para recorrer los shells antes de que exista
  AUTH-002; se guarda en `localStorage`
  (`src/features/auth/devRole.ts`). Ni la página ni la clave de
  `localStorage` quedan en `dist/` (verificado con `pnpm build` + `grep`
  sobre el bundle).
- `StagingBanner` (`src/components/StagingBanner.tsx`, INFRA-022): franja
  "Entorno de prueba…" (`role="status"`) cuando `VITE_APP_ENV=staging`,
  montada una sola vez en `RootLayout` (`router.tsx`) para que la vean
  todos los layouts, portada incluida, sin tocar cada uno por separado.
  Nunca en `production` ni en `local`.
- Tests de Testing Library para `RequireRole` (sin sesión, rol de otra
  vía, sin ningún rol, rol correcto, más de un rol a la vez), `AdminShell`
  (colapso de la sidebar y aparición del tabbar según el ancho, mismo
  criterio de `matchMedia` simulado que P05.3) y `StagingBanner` (los tres
  entornos). E2e nuevo
  (`tests/e2e/protected-route-redirect.spec.ts`): una ruta protegida sin
  sesión termina en `/ingresar` para `/admin`, `/app` y `/sup`.

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
- Proyecto de Cloudflare Pages `extendiendoservicios-app` (cuenta
  `extserviciosapp@gmail.com`, sin proyecto de Git conectado: el build lo
  hace GitHub Actions) y bucket R2 privado `es-backups` (clase Standard, sin
  acceso público, con las reglas de ciclo de vida `retencion-diaria` —30
  días, prefijo `diarios/`— y `retencion-mensual` —370 días, prefijo
  `mensuales/`—), creados con `wrangler` (INFRA-012, INFRA-020).
- `scripts/backup-to-r2.sh`: `pg_dump --format=custom` de `App` → cifrado
  simétrico con `gpg` (AES256, `BACKUP_PASSPHRASE`) → subida a R2 por su API
  S3, con el prefijo de retención (`diarios/`/`mensuales/`) según el día.
  Instala un cliente de PostgreSQL 17 desde el repositorio oficial (PGDG) si
  el runner no lo trae, porque los proyectos de Supabase corren Postgres
  17.6. El volcado sin cifrar nunca se sube ni queda en disco más que en un
  directorio temporal que se borra siempre (`trap`). Lo reutilizan
  `.github/workflows/backup.yml` (cron diario 03:00 Argentina, más
  `workflow_dispatch`, detrás del interruptor `BACKUP_ENABLED`) y el volcado
  previo obligatorio de `deploy-production.yml` antes de cualquier
  migración en producción (ADR-015), al que se le agregó el secreto
  `CLOUDFLARE_ACCOUNT_ID` que le faltaba para poder armar el endpoint de R2
  (INFRA-018).
- `scripts/restore-from-r2.sh`: baja un respaldo de R2, lo descifra y lo
  restaura con `pg_restore --clean --if-exists` **solo en `App_dev`** (nunca
  lee ninguna variable de producción); exige el argumento de confirmación
  `restaurar-app-dev` y, si la terminal es interactiva, una segunda
  confirmación escrita. Paso a paso y advertencias en `docs/deployment.md`;
  la restauración real sobre un proyecto remoto queda para P03.7 (TEST-024).
- `public/_headers`: `Strict-Transport-Security`, `X-Content-Type-Options`,
  `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy` (solo
  geolocalización propia, el resto de las funciones sensibles en cero) y
  `Content-Security-Policy` con `connect-src`/`img-src` acotados a los dos
  proyectos de Supabase, la ingesta de Sentry (región UE), Nominatim y los
  tiles de OpenStreetMap (`03` sección 3.6, ADR-016, ADR-017). `style-src
'self' 'unsafe-inline'`: comprobado con Playwright contra un build real
  que sonner (`Toaster`) necesita `'unsafe-inline'` para su hoja de estilos
  inyectada por `document.createElement('style')`, mientras que el
  posicionamiento de Radix/Floating UI no lo necesita (usa CSSOM, no el
  atributo `style`). `deploy-staging.yml` ahora inserta
  `X-Robots-Tag: noindex` dentro del mismo bloque `/*` de `dist/_headers` en
  vez de sobrescribirlo (INFRA-018, INFRA-022).
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
- `DataTable` sobre TanStack Table 8 (`src/components/DataTable.tsx`,
  DS-008): encabezado y celdas de `07` sección 2.3, variante `compact`,
  ordenamiento por columna, paginación por rango controlada desde afuera
  (`pagination`/`onPaginationChange`/`pageCount`/`rowCount`), filas
  `crit`/`warn` con el helper de `src/components/status`, estado de carga
  con `Skeleton` y estado vacío con `EmptyState`. Por debajo de 1024 px
  (`05` sección 7) se renderiza como una lista de `RowCard`, con
  `meta.card`/`meta.cardLabel` por columna definiendo qué muestra la
  tarjeta — ver `useMediaQuery` (`src/hooks/useMediaQuery.ts`), nuevo.
  `ui/table.tsx` restyleado (encabezado `#FAFBFC`, mayúsculas 10 px,
  celdas 12 px).
- `Avatar` (`src/components/Avatar.tsx`) de 28 px con foto o iniciales,
  sobre los seis colores fijos del mockup asignados por hash
  determinístico del id (DJB2), y `PersonCell` (nombre 600 + subtítulo
  11 px) (DS-009). `ui/avatar.tsx` restyleado a un único tamaño real
  (`default` 28 px / `compact` 26 px, en vez de los `default`/`sm`/`lg`
  genéricos de shadcn).
- `Alert` restyleado con las variantes `crit`/`warn`/`info` de `07`
  sección 2.3, colores exactos de `.a-crit`/`.a-warn`/`.a-info`
  (`ds.css`); `ConfirmDialog` (`src/components/ConfirmDialog.tsx`),
  diálogo de confirmación con motivo obligatorio (botón de confirmar
  deshabilitado mientras el motivo esté vacío, motivo devuelto recortado
  en `onConfirm`) — reutilizable para cancelar turno, quitar asignación y
  cerrar asignación (SHIFT-011) (DS-010).
- `Timeline` (puntos `pending`/`on`/`ok`/`crit`), `Tabs` restyleado
  (subrayado teal de 2 px, se simplifica a esa única variante — la
  variante "píldora" ya la cubre `SegmentedControl`), `Breadcrumb`
  restyleado (agregado con la CLI de shadcn), `Tooltip` restyleado (fondo
  `--dark`, 11 px, con los tres estados reales de Radix:
  `delayed-open`/`instant-open`/`closed`) (DS-011).
- `TaskList`/`TaskItem` (`src/components/TaskList.tsx`,
  `TaskItem.tsx`, DS-012): casilla de 22 px con los cuatro estados de
  `shift_tasks.status`, variante `done` atenuada, variante "next"
  resaltada (calculada por `TaskList`: la tarea `in_progress`, o si
  ninguna lo está, la primera `pending`), "no realizada" con motivo
  obligatorio (reutiliza `ConfirmDialog`), etiqueta "Opcional" cuando
  `is_required` es falso (P-059), modo solo lectura (sin acciones, sin
  callbacks), objetivo táctil de 44 px en la casilla sin cambiar su
  tamaño visual. No llama a ninguna API: solo avisa por callback.
- `/dev/design` completado con ejemplos realistas de la Base: una
  `DataTable` de "Servicios de hoy" con estados mezclados (incluida una
  fila `crit` — sin registro — y una `warn` — salida anticipada), una
  `TaskList` interactiva y otra solo lectura (checklist de M10), una
  `Timeline` de una asignación, los seis colores de `Avatar`, `Alert` con
  las tres variantes, disparadores de `Toast` y de `ConfirmDialog`, y
  `Tabs`/`Breadcrumb`/`Tooltip`/`Skeleton`. `<Toaster />` montado una sola
  vez en `main.tsx`.
- Tests de Testing Library para `DataTable` (ordenamiento, paginación por
  rango y el cambio a `RowCard` por debajo de 1024 px, simulando
  `window.matchMedia`), `Avatar` (hash estable, fallback a iniciales),
  `ConfirmDialog` (confirmar deshabilitado sin motivo, motivo devuelto
  recortado) y `TaskItem` ("no realizada" exige motivo, solo lectura no
  dispara callbacks, etiqueta "Opcional", atenuado con hora de
  finalización).

### Corregido

- Revisión de P05.4 (orquestador):
  - Con contenido más alto que la ventana, la cabecera y el tabbar de los
    dos shells se iban con el scroll. En el celular, el botón "Fichar"
    quedaba fuera de la pantalla hasta llegar al final. Ahora scrollea el
    documento: la topbar, la navbar de subpágina y los tabbar son
    `sticky`, y la sidebar es `sticky` con el alto de la ventana y scroll
    propio. `<main>` dejó de ser contenedor de scroll, así que `ActionBar`
    se ancla a la ventana; además ocupa todo el ancho (márgenes negativos
    sobre el `p-4` de `<main>`). El saludo de la raíz sí se va con el
    scroll.
  - `RequireRole`: con un rol que no corresponde a la vía, redirige a la
    vía propia (`homePathForRoles` en `session.ts`) y no a `/sin-acceso`,
    como pide `05` sección 5. `/sin-acceso` queda para quien no tiene
    ningún rol.
  - Sidebar: los `<li>` de cada sección estaban directo dentro de `<nav>`;
    ahora van en un `<ul>`, y cada `<nav>` lleva su nombre ("Operación",
    "Configuración") también expandida.
  - Los nombres de ejemplo del simulador de rol (`devRole.ts`) llegaban a
    `dist/`. Ahora quedan como código muerto en el build.
  - `index.html` declaraba `color-scheme: dark`, heredado de la portada
    provisoria, y `body` no tenía color propio: el texto sin clase salía
    blanco sobre el fondo claro de los shells. Ahora es `light` y `body`
    usa `--text` y `--bg`. La portada define sus propios colores y no
    cambia.
- `ui/button.tsx`: `<Button asChild>` (usado por primera vez en este
  paquete, en `/dev/rol`) rompía siempre con "Slot failed to slot onto its
  children" — `Slot.Root` (Radix) exige exactamente un elemento hijo, y el
  `return` de `Button` le pasaba tres nodos sueltos (ícono/spinner,
  `children`, texto de carga para lectores de pantalla). Se corrigió
  armando un único nodo: con `asChild` es directamente `children`; sin
  `asChild`, los tres de antes dentro de un solo `<>` (a un `<button>` real
  no le importa recibir un Fragment). Test de regresión en
  `button.test.tsx`.
- `ui/dropdown-menu.tsx` (agregado en este paquete): mismo bug de
  `data-open:`/`data-closed:` que el resto de los componentes shadcn del
  repo (ver más abajo) — corregido a `data-[state=open]:`/
  `data-[state=closed]:` en `DropdownMenuContent`, `DropdownMenuSubTrigger`
  y `DropdownMenuSubContent`, antes de que este paquete llegara a usarlo.
- Bug heredado de DS-001/DS-002 (P05.1): `dialog.tsx`, `sheet.tsx`,
  `popover.tsx`, `select.tsx`, `tooltip.tsx`, `tabs.tsx`, `separator.tsx`
  y `command.tsx` usaban clases como `data-open:`, `data-closed:`,
  `data-horizontal:`, `data-active:` o `data-selected:`, asumiendo
  atributos booleanos (`data-open`, presencia) que Radix/cmdk nunca
  agregan: Radix escribe `data-state="open"/"closed"/"active"` y
  `data-orientation="horizontal"/"vertical"` (verificado leyendo el
  código fuente de cada paquete en `node_modules`), y cmdk escribe
  literalmente `data-selected="true"/"false"` (verificado con un test:
  React nunca omite un `data-*` en `false`, lo serializa como texto) —
  en los dos casos la clase nunca podía coincidir. Se corrigió a
  `data-[state=open]:`, `data-[orientation=horizontal]:`,
  `data-[selected=true]:`, etc. en los ocho archivos. `field.tsx` tenía
  el mismo bug en `has-data-checked:`, corregido a
  `has-data-[state=checked]:`.
- Ninguna de esas animaciones de apertura/cierre funcionaba por una
  segunda razón, independiente de la anterior: las clases que las
  implementan (`animate-in`, `fade-in-0`, `zoom-in-95`,
  `slide-in-from-*`, etc.) no existen en Tailwind CSS 4 puro — las trae
  el paquete `tw-animate-css`, no instalado acá (no está en la lista de
  librerías aprobadas del plan, y es una utilidad CSS, no una pieza de
  UI). Se reimplementó el subconjunto que usan esos componentes a mano
  con `@utility` de Tailwind 4 en `src/styles/animations.css` (nuevo),
  leyendo `--tw-duration` (la misma variable que fija la utilidad núcleo
  `duration-*`) con un techo de 150 ms (`07` sección 5) si no se indica
  ninguna. `sheet.tsx` además bajó su `duration-200` a `duration-150`
  para no superar ese máximo. `prefers-reduced-motion` ya estaba cubierto
  de forma global en `globals.css` (P05.1); no hizo falta repetirlo acá.
- `tsconfig.json`: se sacó `compilerOptions.baseUrl` (P05.1 lo había
  agregado; TypeScript 6 lo marca obsoleto). El alias `@/*` lo sigue
  resolviendo `paths` solo (sin `baseUrl`, válido con `moduleResolution`
  `bundler`), y la CLI de shadcn lo sigue encontrando igual — probado en
  este paquete agregando y descartando `breadcrumb` (ahora sí lo
  necesitábamos, para DS-011).
- `/dev/design`: los textos de ejemplo de `KpiCard` usaban términos de
  módulos futuros ("tolerancia", "reemplazo pendiente", "Sin fichar").
  Se reemplazaron por los KPIs reales de la Base (`05_Pantallas_y_Navegacion.md`
  ADM-02): turnos hoy, presentes, próximos (2 h), sin registro, avisos de
  ausencia y demora.

### Quitado

- `next-themes`: solo lo usaba `sonner.tsx` para leer el tema del
  sistema operativo/navegador. La Base es solo modo claro (P-118): se
  saca la dependencia y se fija `theme="light"` en el `Toaster`.
- `public/CNAME` y `public/.nojekyll`: restos del despliegue estático de
  GitHub Pages, que Vite copiaba a `dist/`. Cloudflare Pages no los usa
  (INFRA-013, P03.6).

### Dependencias

- Agregado `@tanstack/react-table` `8.21.3` (publicado el 14 de abril de 2025) para `DataTable` (DS-008). ADR-021 pedía probar primero la mayor
  estable (9): se instaló `9.2.4` (28 de agosto de 2026) y se descartó —
  su API pública principal (`useTable` + `tableFeatures`, por _slots_) es
  incompatible con el patrón `useReactTable`/`ColumnDef`/`flexRender` que
  usan shadcn/ui y prácticamente todo el ecosistema; la única forma de
  recuperar esa API en la 9 es `@tanstack/react-table/legacy`, una capa
  de compatibilidad que la propia librería marca `@deprecated` en cada
  export ("compatibility layer for migrating from v8", no pensada para
  código nuevo). Se usó la cláusula de excepción de ADR-021 ("si resulta
  incompatible con los componentes de shadcn/ui, 8") y se instaló la 8.
- Quitado `next-themes` `0.4.6` (ver "Quitado" arriba).

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
