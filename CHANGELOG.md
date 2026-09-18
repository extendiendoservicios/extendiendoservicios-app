# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y este proyecto sigue [Versionado Semántico](https://semver.org/lang/es/) (ADR-020).

## [Sin publicar]

Entornos remotos y Auth (F3 · INFRA-010, INFRA-011, INFRA-019, INFRA-023).

### Agregado

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
