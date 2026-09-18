# Arquitectura

Fuente: `03_Plan_Maestro_Tecnico.md` secciones 1 y 2 del Plan Maestro
(`Docs/Plan_Maestro/` fuera de este repo). Este archivo se actualiza en el
mismo PR que cambie algo de lo que describe.

## En una frase

Un **monolito modular**: una sola aplicación web (React, PWA) con tres
experiencias por rol, servida como sitio estático desde Cloudflare Pages, que
habla directamente con Supabase (Postgres con RLS, Auth, Storage) y ejecuta
las reglas de negocio en funciones SQL transaccionales; una única Edge
Function para administrar usuarios; sin servidores propios.

## Diagrama

```text
                 ┌──────────────────────────── Cloudflare ────────────────────────────┐
                 │  DNS + certificado          Pages (estático)          R2 (backups) │
                 │  app.extendiendoservicios.com   dev.extendiendoservicios.com        │
                 └───────────────┬──────────────────────┬────────────────────▲────────┘
                                 │ HTTPS                │                    │ pg_dump diario
   ┌──────────────┐   ┌──────────▼──────────┐  ┌────────▼─────────┐   ┌──────┴───────┐
   │ Escritorio   │   │ SPA (React + Vite)  │  │ SPA (misma app)  │   │ GitHub       │
   │ Dueño/Admin  │──▶│ /admin  AdminShell  │  │ /app  /sup       │   │ Actions      │
   └──────────────┘   │ PWA, service worker │  │ MobileShell      │   │ CI · deploy  │
   ┌──────────────┐   └──────────┬──────────┘  └────────┬─────────┘   │ backup       │
   │ Celular      │              │ supabase-js (anon key + JWT)       │ keepalive    │
   │ Empleado/Sup │──────────────┴─────────────┬────────┘             └──────┬───────┘
   └──────────────┘                            │                             │ supabase db push
                 ┌─────────────────────────────▼─────────────────────────────▼────────┐
                 │                         Supabase (App / App_dev)                    │
                 │  Auth (email+pass, hook de claims: roles, capabilities)              │
                 │  PostgREST ──▶ RLS por rol ──▶ tablas y vistas v_*                   │
                 │  RPC (funciones SQL security definer: reglas + transacciones)        │
                 │  Storage: avatars, branding                                          │
                 │  Edge Function admin-users (service_role, solo 6 acciones)           │
                 │  Logs de Auth/DB · security_events                                   │
                 └──────────────────────────────────────────────────────────────────────┘
                 Externos sin cuenta: tiles de OpenStreetMap, Nominatim (búsqueda de dirección)
                 Sentry (errores de frontend, plan sin cargo)
```

## Principios

| Principio                                         | Cómo se aplica                                                                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| El servidor decide                                | Toda regla vive en Postgres (restricciones, RLS, RPC). El frontend replica validaciones solo para feedback.       |
| Un código, tres experiencias                      | Rutas `/admin`, `/app`, `/sup` con shells propios y carga diferida por vía.                                       |
| Estados persistidos mínimos, derivados calculados | "Sin cubrir", "sin registro", "próximo", "salida anticipada" se calculan en vistas por hora del servidor.         |
| Nada se borra                                     | Baja lógica en maestros; asignaciones quitadas con motivo; turnos cancelados conservados.                         |
| Extensible sin rehacer                            | Enumeraciones, capacidades, vistas, buckets y Edge Functions como puntos de extensión (`10_Extension_Points.md`). |
| Proporcional                                      | Sin API propia, sin colas, sin Realtime, sin contenedores. Cada complejidad adicional requiere ADR.               |

## Fronteras con los módulos

Los módulos A–I no tienen tablas, pantallas ni RPC en la Base. La Base guarda
lo que es barato y no compromete (coordenadas, `updated_by`, `source` de cada
registro) y deja el resto para su ADR. La lista completa de lo recortado del
mockup está en `05_Pantallas_y_Navegacion.md` sección 8 y en
`10_Extension_Points.md` del Plan Maestro.

## Stack

Versiones fijadas en ADR-021 (`docs/adr/ADR-021-versiones-del-stack.md`): el
Plan Maestro (`03` sección 2) fija versiones concretas, pero la Fase 2 empezó
con las versiones mayores estables al momento de implementar, con Node 24 LTS
en lugar de Node 20.

| Elemento          | Opción                                                                                                                  | Razón                                            | ADR      |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------- |
| Frontend          | React 19, Vite 8, TypeScript 6.0 estricto, React Router 7 en modo SPA                                                   | Ecosistema, SDK de Supabase, sin SSR innecesario | 002, 021 |
| Forma             | SPA única responsive + PWA (`vite-plugin-pwa` 1)                                                                        | Un despliegue; nada de la Base exige nativo      | 001      |
| UI                | Tailwind CSS 4, shadcn/ui (Radix), lucide-react                                                                         | Accesibilidad resuelta, tokens del mockup        | 003, 021 |
| Gestión de estado | TanStack Query 5 para servidor; hooks de React para local; Zustand solo si hace falta                                   | Estado de servidor es casi todo el estado        | 002      |
| Formularios       | react-hook-form 7 con `@hookform/resolvers` 5                                                                           | Rendimiento, integración con zod                 | 002      |
| Validación        | zod 4 en cliente (espejo) + restricciones, RLS y RPC en Postgres (fuente de verdad)                                     | Feedback inmediato sin duplicar la verdad        | 004      |
| Backend           | Supabase: Postgres, PostgREST, Auth, Storage, una Edge Function (Deno)                                                  | Sin servidores; V3 fija Supabase                 | 004, 005 |
| Base de datos     | Postgres con RLS, enumeraciones, `btree_gist`, funciones `security definer`, vistas `security_invoker`, pgTAP           | Reglas por rol en la base                        | 004      |
| Autenticación     | Supabase Auth email y contraseña; hook de claims; sesión persistente                                                    | Decisión de Mike                                 | 008      |
| Storage           | Supabase Storage, buckets `avatars` y `branding`                                                                        | Uso previsto                                     | 016      |
| Mapas             | Leaflet 1.9 / react-leaflet 5, tiles OSM, Nominatim                                                                     | Sin costo ni cuentas                             | 017      |
| Fechas            | date-fns 4 con locale `es`, zona fija                                                                                   | Ligero, árbol de importación                     | 019, 021 |
| Tablas            | TanStack Table (mayor estable actual; 8 si resulta incompatible con shadcn/ui)                                          | Ligero, sin licencia                             | 003, 021 |
| Hosting           | Cloudflare Pages                                                                                                        | Certificado, previews                            | 013      |
| DNS y certificado | Cloudflare (`extserviciosapp@gmail.com`)                                                                                | V3                                               | 013      |
| Deployment        | GitHub Actions: CI en PR, staging automático, producción con aprobación                                                 | Repetible y auditable                            | 018      |
| Entornos          | Local (frontend) contra `App_dev`; staging `App_dev`; producción `App`                                                  | Sin Docker por ahora                             | 014      |
| Respaldos         | `pg_dump` diario a R2 cifrado                                                                                           | Sin costo, verificable                           | 015      |
| Testing           | Vitest + Testing Library; pgTAP; Playwright (chromium, webkit, móvil); Deno test para la Edge Function; axe; Lighthouse | Rápido, integrado con Vite                       | 002      |
| Logs y errores    | Logs de Supabase (Auth, Postgres, API); `security_events`; Sentry frontend plan sin cargo                               | Suficiente y sin costo                           | —        |
| Calidad           | ESLint 9 con typescript-eslint 8 (react-hooks, jsx-a11y), Prettier, Husky + lint-staged                                 | Estándar                                         | 021      |
| Paquetes          | pnpm (versión estable actual), Node 24 LTS                                                                              | Velocidad, lockfile estricto                     | 021      |
| Versionado        | Semver desde 0.1.0, `CHANGELOG.md`                                                                                      | Decisión de Mike                                 | 020      |

Las versiones exactas instaladas quedan fijadas en `pnpm-lock.yaml`.

## Documentos relacionados

- `docs/adr/` — copia de las decisiones de arquitectura (`ADR-001` a
  `ADR-021`).
- `docs/environments.md`, `docs/deployment.md` — entornos e infraestructura
  (desde la Fase 3).
- `docs/database.md` — modelo de datos (desde la Fase 4).
