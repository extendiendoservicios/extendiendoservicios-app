# extendiendoservicios-app

Plataforma de gestión para **Extendiendo Servicios** (empresa de limpieza): una
SPA instalable como PWA con tres experiencias —administración, empleado y
supervisor— sobre Supabase.

## Estado actual

Fases F2 y F3 del Plan Maestro cerradas (repositorio base, entornos,
CI/CD, respaldos) y F5 en curso (design system y shells). Todavía no hay
modelo de datos (F4) ni pantallas reales de cada dominio: el router expone
placeholders detrás de `RequireRole`.

`app.extendiendoservicios.com` (producción, rama `main`) y
`dev.extendiendoservicios.com` (staging, rama `develop`) los sirve
**Cloudflare Pages**, publicados por `deploy-production.yml`/
`deploy-staging.yml` en cada pase a esas ramas. La migración desde GitHub
Pages (Fase 3) ya se hizo sin cortar el servicio: se creó el proyecto de
Pages, se verificó en `*.pages.dev`, se cambiaron los dominios y recién
después se desactivó GitHub Pages — detalle en `docs/deployment.md` sección
7 y ADR-013.

## Requisitos

- Node 24 (ver `.node-version`).
- pnpm (versión estable actual; el repo no usa npm ni yarn).

## Cómo instalar

```bash
pnpm install
```

## Cómo correr

```bash
pnpm dev
```

Abre `http://localhost:5173`. Contra un backend real (`App_dev`), copiá
`.env.example` a `.env.local` y completá las variables.

## Cómo vincular Supabase

El proyecto remoto de desarrollo es `App_dev` (staging y desarrollo, ver
`docs/environments.md`). Cada desarrollador vincula su copia local una sola
vez, con sesión ya iniciada (`pnpm exec supabase login`, la hace Mike):

```bash
pnpm exec supabase link --project-ref anesttvrnpsaaaxaquce
```

No pide la contraseña de la base de datos (usa la API de gestión). El estado
del link vive en `supabase/.temp/` (gitignorado), no se comitea.

**`App` (producción) nunca se vincula ni se toca desde una máquina de
desarrollo.** Se usa solo desde el workflow de despliegue a producción, con
secretos de GitHub y aprobación de Mike -- ver `docs/environments.md`.

## Cloudflare (wrangler)

`wrangler` es dependencia de desarrollo del repositorio, no una instalación
global: se usa como `pnpm exec wrangler <comando>`. El proyecto de Pages
(`extendiendoservicios-app`) publica `app.`/`dev.` en cada pase a
`main`/`develop`, y el bucket R2 de respaldos (`es-backups`) recibe el
volcado diario cifrado de `App`. Ver `docs/environments.md` y
`docs/deployment.md`.

## Cómo probar

```bash
pnpm test        # Vitest + Testing Library
pnpm test:e2e    # Playwright
```

`pnpm test:e2e` necesita los navegadores de Playwright instalados una vez por
máquina:

```bash
pnpm exec playwright install
```

## Cómo formatear y verificar

```bash
pnpm lint           # ESLint
pnpm typecheck      # TypeScript estricto
pnpm format         # Prettier --write
pnpm format:check   # Prettier --check (lo que corre en CI)
```

Estos mismos controles (lint, format, typecheck) corren también en cada commit
vía Husky + lint-staged: no hace falta acordarse de correrlos a mano.

El repo fija los finales de línea en LF con `.gitattributes`: Git para
Windows suele traer `core.autocrlf=true` a nivel sistema, que deja el
working tree en CRLF después de cualquier `clone` o `checkout` y hace fallar
a `pnpm format:check` (Prettier exige LF); `.gitattributes` evita ese
problema sin depender de la configuración de cada máquina.

## Scripts disponibles

| Script                              | Qué hace                                                                                          |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| `pnpm dev`                          | Servidor de desarrollo (Vite).                                                                    |
| `pnpm build`                        | Build de producción (`tsc -b && vite build`) a `dist/`.                                           |
| `pnpm preview`                      | Sirve el build de `dist/` localmente.                                                             |
| `pnpm lint`                         | ESLint sobre todo el proyecto.                                                                    |
| `pnpm typecheck`                    | `tsc -b --noEmit`.                                                                                |
| `pnpm test`                         | Vitest (unitarios y de componentes).                                                              |
| `pnpm test:e2e`                     | Playwright (requiere `pnpm exec playwright install` una vez).                                     |
| `pnpm format` / `pnpm format:check` | Prettier, escribir o solo verificar.                                                              |
| `pnpm db:push`                      | Aplica migraciones a `App_dev` (una vez vinculado, ver arriba). Sin migraciones todavía (Fase 4). |
| `pnpm db:types`                     | Genera `src/lib/database.types.ts` desde `App_dev` (una vez vinculado).                           |
| `pnpm db:test`                      | Corre los tests pgTAP. Se habilita en la Fase 4 (primeras migraciones y tests).                   |

## Integración continua y despliegue

Cada Pull Request a `develop` o `main` corre el workflow `CI`
(`.github/workflows/ci.yml`): instala, lintea, tipa, formatea, testea,
construye y corre Playwright (`chromium`) contra ese build; es verificación
obligatoria en ambas ramas. Fusionar en `develop` dispara
`deploy-staging.yml` (publica en `dev.`); el pase de `develop` a `main`
(merge commit, con aprobación de Mike en el `environment` `production`)
dispara `deploy-production.yml` (publica en `app.`, con volcado previo a
R2). Un cron diario dispara `backup.yml` (respaldo cifrado de `App` a R2);
uno semanal, `keepalive.yml` (evita la pausa de `App_dev` por inactividad).
Detalle completo, interruptores, aprobación de producción, el pase a
producción y rollback: [`docs/deployment.md`](docs/deployment.md).

## Flujo de ramas

- `main` = producción, publicada en `app.extendiendoservicios.com`.
- `develop` = staging, publicada en `dev.extendiendoservicios.com`.
- Trabajo día a día en ramas `feat/<TASK-ID>-descripción-corta`, con Pull
  Request a `develop` (plantilla en `.github/PULL_REQUEST_TEMPLATE.md`) y
  **squash merge**.
- El pase de `develop` a `main` es un Pull Request fusionado con **merge
  commit** (no squash, para que el historial de ambas ramas no diverja) y
  requiere la aprobación de Mike en el `environment` `production`. Detalle:
  [`docs/deployment.md`](docs/deployment.md) sección 13.
- Versionado semántico desde `0.1.0` (ver `CHANGELOG.md` y ADR-020).

## Estructura de carpetas

```text
src/
├── app/         router, providers, shells (AdminShell, MobileShell)
├── api/         un módulo por dominio (clientes, turnos, asignaciones…)
├── features/    esquemas zod, hooks de TanStack Query y componentes por dominio
├── pages/       admin/ · app/ (empleado) · sup/ · auth/ · common/ · dev/
├── components/  ui/ (shadcn), propios, status/, map/, search/
├── lib/         cliente de Supabase, tipos generados, utilidades
└── styles/      tokens y estilos globales

supabase/        config, migraciones, la Edge Function admin-users, seed y tests pgTAP
scripts/         scripts de soporte (seed, importación, generación de tipos)
tests/           e2e (Playwright) y tests de permisos
docs/            documentación del repositorio (ver más abajo)
```

Detalle completo en `docs/architecture.md` (`03_Plan_Maestro_Tecnico.md`
sección 3.4 del Plan Maestro).

## Documentación

Todo lo específico del repositorio vive en [`docs/`](docs/README.md):
arquitectura y stack, entornos, despliegue, base de datos, seguridad, etc., a
medida que cada fase los agrega. Las decisiones de arquitectura del Plan
Maestro están copiadas en [`docs/adr/`](docs/adr/README.md).
