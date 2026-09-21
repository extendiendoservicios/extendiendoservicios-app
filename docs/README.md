# `docs`

Documentación del repositorio (no el Plan Maestro, que vive fuera del repo en
`Docs/Plan_Maestro/`). Todo en español, actualizado en el mismo PR que el
cambio que documenta (`03_Plan_Maestro_Tecnico.md` sección 17).

## Qué existe hoy

| Archivo                                | Contenido                                                                                                                                                                                                                                                                                          |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`architecture.md`](architecture.md)   | Arquitectura en una frase, diagrama, principios, fronteras con los módulos y stack con versiones (ADR-021).                                                                                                                                                                                        |
| [`environments.md`](environments.md)   | Entornos, cuentas con sus refs de proyecto, variables y secretos (con el paso a paso para crear los tokens de Cloudflare/R2 con permisos mínimos), cómo se vincula cada uno (INFRA-010, INFRA-011, INFRA-012, INFRA-019, INFRA-020, INFRA-023).                                                    |
| [`deployment.md`](deployment.md)       | Los cinco workflows, interruptores de despliegue, aprobación de producción, respaldos a R2 y restauración, Cloudflare Pages/R2, rollback, Sentry, `public/_headers`/CSP y `robots.txt` por entorno, secretos por workflow (INFRA-012, INFRA-015 a INFRA-018, INFRA-020 a INFRA-022; en curso, F3). |
| [`design-system.md`](design-system.md) | Tokens, Tailwind, Inter, cómo agregar componentes de shadcn/ui, utilidades de formato (DS-001, DS-002, DS-017; en curso, F5).                                                                                                                                                                      |
| [`database.md`](database.md)           | Convenciones, esquema `app`, enumeraciones, cómo escribir una migración y correr pgTAP (DB-001, DB-002, DB-022; en curso, F4: todavía sin diagrama ni diccionario completo de tablas).                                                                                                             |
| [`adr/`](adr/README.md)                | Copia de los ADR del Plan Maestro (`ADR-001` a `ADR-021`). Los ADR nuevos que surjan durante la implementación se agregan acá.                                                                                                                                                                     |

## Qué llega en cada fase

| Archivo                                                   | Contenido                                                                                       | Fase           |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------- |
| `security.md`                                             | RLS por tabla, Edge Function                                                                    | F6             |
| `api.md`                                                  | Resumen de la API con ejemplos de llamada                                                       | F7 en adelante |
| `features/*.md`                                           | Una página por dominio: reglas, pantallas, RPC, casos borde (clientes, empleados, turnos, etc.) | F7 a F17       |
| `pwa.md`                                                  | Instalación, actualización, compatibilidad                                                      | F17            |
| `carga-inicial.md`                                        | Plantilla Excel e importación                                                                   | F19            |
| `guia-admin.md`, `guia-empleado.md`, `guia-supervisor.md` | Guías de uso por rol con capturas                                                               | F19            |
| `troubleshooting.md`                                      | Problemas conocidos y solución                                                                  | F19            |
| `runbook-produccion.md`                                   | Puesta en marcha, rollback, restauración, rotación de secretos                                  | F20            |

`README.md` (raíz del repo) y `CHANGELOG.md` no viven en esta carpeta pero
son parte de la misma documentación; se crean también en F2.
