# Architecture Decision Records — Extendiendo Servicios

Cada decisión técnica relevante tiene un archivo con el formato del brief (sección 32): Problema, Alternativas, Decisión, Motivo, Consecuencias, Estado. Estado posible: Propuesto, Aceptado, Reemplazado por ADR-nnn, Obsoleto. Los ADR no se editan después de aceptados: se escribe uno nuevo que reemplaza al anterior.

| ADR | Título | Estado | Decisión de origen |
|---|---|---|---|
| [ADR-001](ADR-001-spa-unica-pwa.md) | Una sola aplicación web con tres experiencias, instalable como PWA | Aceptado | P-001, P-008 |
| [ADR-002](ADR-002-react-vite-typescript.md) | React + Vite + TypeScript + React Router | Aceptado | P-002 |
| [ADR-003](ADR-003-tailwind-shadcn.md) | Tailwind CSS + shadcn/ui con tokens del mockup | Aceptado | P-116 |
| [ADR-004](ADR-004-supabase-rls-rpc.md) | Supabase directo con RLS y funciones SQL, sin capa de API | Aceptado | P-003, P-004 |
| [ADR-005](ADR-005-edge-function-admin-users.md) | Una Edge Function para administración de usuarios | Aceptado | P-011, P-012, P-014, P-015 |
| [ADR-006](ADR-006-roles-fijos-capacidades.md) | Cuatro roles fijos y capacidades por administrador | Aceptado | P-017, P-022 |
| [ADR-007](ADR-007-multirol.md) | Varios roles por persona | Aceptado | P-013, P-042 |
| [ADR-008](ADR-008-login-email.md) | Login por email con Supabase Auth | Aceptado | P-010 |
| [ADR-009](ADR-009-hora-servidor-geoposicion.md) | Hora del servidor y geoposición guardada sin validar | Aceptado | P-066, P-067, P-091 |
| [ADR-010](ADR-010-generacion-mensual.md) | Servicios recurrentes con generación mensual idempotente | Aceptado | P-044 |
| [ADR-011](ADR-011-copia-checklist.md) | Copia del checklist al turno | Aceptado | P-061 |
| [ADR-012](ADR-012-polling.md) | Polling en lugar de Realtime | Aceptado | P-005 |
| [ADR-013](ADR-013-cloudflare-pages.md) | Cloudflare Pages para la aplicación | Aceptado | P-007 |
| [ADR-014](ADR-014-entornos-sin-supabase-local.md) | Dos proyectos Supabase y desarrollo contra App_dev | Aceptado | P-111, P-112, P-115 |
| [ADR-015](ADR-015-backups-r2.md) | Respaldos diarios a Cloudflare R2 desde GitHub Actions | Aceptado | P-110, P-113 |
| [ADR-016](ADR-016-storage-avatars-branding.md) | Storage para foto de perfil y logo | Aceptado | P-037, P-117 |
| [ADR-017](ADR-017-leaflet-osm.md) | Leaflet + OpenStreetMap para mapas | Aceptado | P-023 |
| [ADR-018](ADR-018-un-repositorio.md) | Un repositorio para frontend y base de datos | Aceptado | P-006 |
| [ADR-019](ADR-019-zona-horaria-unica.md) | Zona horaria única de Argentina | Aceptado | DT-21, P-057 |
| [ADR-020](ADR-020-versionado.md) | Versionado semántico y changelog | Aceptado | P-127 |
| [ADR-021](ADR-021-versiones-del-stack.md) | Versiones del stack al iniciar la implementación | Aceptado | P-002, D-01 |
