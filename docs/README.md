# `docs`

Documentación del repositorio (no el Plan Maestro, que vive fuera del repo en
`Docs/Plan_Maestro/`). Todo en español, actualizado en el mismo PR que el
cambio que documenta (`03_Plan_Maestro_Tecnico.md` sección 17).

## Qué existe hoy

| Archivo                              | Contenido                                                                                                                                |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [`architecture.md`](architecture.md) | Arquitectura en una frase, diagrama, principios, fronteras con los módulos y stack con versiones (ADR-021).                              |
| [`environments.md`](environments.md) | Entornos, cuentas con sus refs de proyecto, variables y secretos, cómo se vincula cada uno (INFRA-010, INFRA-011, INFRA-019, INFRA-023). |
| [`adr/`](adr/README.md)              | Copia de los ADR del Plan Maestro (`ADR-001` a `ADR-021`). Los ADR nuevos que surjan durante la implementación se agregan acá.           |

## Qué llega en cada fase

| Archivo                                                   | Contenido                                                                                       | Fase           |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------- |
| `deployment.md`                                           | Workflows, aprobación, rollback                                                                 | F3             |
| `database.md`                                             | Diagrama, diccionario, convenciones, cómo escribir migraciones y tests                          | F4             |
| `design-system.md`                                        | Tokens, componentes, `/dev/design`                                                              | F5             |
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
