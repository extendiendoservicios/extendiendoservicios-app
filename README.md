# extendiendoservicios-app

Plataforma de gestión para **Extendiendo Servicios** (empresa de limpieza): una
SPA instalable como PWA con tres experiencias —administración, empleado y
supervisor— sobre Supabase.

## Estado actual

El repositorio tiene el scaffold base (Fase 2 del Plan Maestro): herramientas,
estructura de carpetas y una portada mínima ("Plataforma en construcción").
Todavía no hay backend propio vinculado ni pantallas reales.

`app.extendiendoservicios.com` sigue publicado hoy por **GitHub Pages desde
`main`** con la portada estática anterior. Eso no cambia hasta la Fase 3, que
migra el dominio a Cloudflare Pages sin cortar el servicio (crear el proyecto
de Pages, verificarlo en `*.pages.dev`, cambiar el CNAME y recién después
desactivar GitHub Pages — ver `docs/architecture.md` y ADR-013). **Por eso no
se fusiona nada en `main` hasta esa migración**: todo el trabajo de esta fase
vive en `develop` y en ramas de feature.

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
`.env.example` a `.env.local` y completá las variables (disponible desde la
Fase 3).

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

## Scripts disponibles

| Script                              | Qué hace                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------- |
| `pnpm dev`                          | Servidor de desarrollo (Vite).                                                  |
| `pnpm build`                        | Build de producción (`tsc -b && vite build`) a `dist/`.                         |
| `pnpm preview`                      | Sirve el build de `dist/` localmente.                                           |
| `pnpm lint`                         | ESLint sobre todo el proyecto.                                                  |
| `pnpm typecheck`                    | `tsc -b --noEmit`.                                                              |
| `pnpm test`                         | Vitest (unitarios y de componentes).                                            |
| `pnpm test:e2e`                     | Playwright (requiere `pnpm exec playwright install` una vez).                   |
| `pnpm format` / `pnpm format:check` | Prettier, escribir o solo verificar.                                            |
| `pnpm db:push`                      | Aplica migraciones a Supabase. Se habilita en la Fase 3 (proyecto vinculado).   |
| `pnpm db:types`                     | Genera `src/lib/database.types.ts`. Se habilita en la Fase 3.                   |
| `pnpm db:test`                      | Corre los tests pgTAP. Se habilita en la Fase 4 (primeras migraciones y tests). |

## Flujo de ramas

- `main` = producción. No recibe merges hasta que Cloudflare Pages reemplace a
  GitHub Pages (Fase 3).
- `develop` = staging.
- Trabajo día a día en ramas `feat/<TASK-ID>-descripción-corta`, con Pull
  Request a `develop` (plantilla en `.github/PULL_REQUEST_TEMPLATE.md`) y
  **squash merge**.
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

## Sobre la portada actual y el dominio (información operativa, no vigente para el futuro)

Mientras `app.extendiendoservicios.com` siga en GitHub Pages, valen estos
datos (dejan de aplicar en cuanto se complete la migración de la Fase 3):

- DNS en Cloudflare: registro `CNAME` `app` → `extendiendoservicios.github.io`,
  con el proxy (nube naranja) **desactivado** — el proxy de Cloudflare bloquea
  la emisión del certificado de GitHub Pages.
- `public/CNAME`, `public/.nojekyll`, `public/logo.png` y `public/favicon.png`
  son los archivos que ese despliegue estático necesita; Vite los copia tal
  cual a `dist/` en el build. El logo real de marca vive en `Images/` del
  proyecto (fuera de este repo); no se reconstruye a mano.
- `public/_redirects` (fallback SPA `/* /index.html 200`) es para Cloudflare
  Pages: no lo usa GitHub Pages, queda listo para la migración de la Fase 3.
