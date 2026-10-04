# `tests`

Pruebas que no son unitarias (las unitarias viven junto a cada archivo en `src/` como
`*.test.ts(x)`, con Vitest). El mapa completo de lo que hay probado, a qué fila de
`09_Trazabilidad.md` y a qué caso borde corresponde está en `docs/test-inventory.md`.

## Suites de F18 contra `App_dev` (cuentas fijas)

Cuentas fijas `e2e-fijo-*` que arma `tests/fixtures/` (`pnpm test:fixtures:setup`), datos por test con
prefijo `e2e-` que cada test limpia, fechas relativas a hoy en hora de Argentina. Necesitan
`app/.env.local` con `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` y
`SEED_DEV_PASSWORD` (las mismas cuatro de `scripts/seed-dev.ts`); nunca corren contra producción.
Los archivos terminan en `.admin.ts`, `.empleado.ts` o `.supervisor.ts` para que el `testMatch` del
humo de CI (`*.spec.ts`) no los tome.

| Carpeta           | Qué es                                                                                                        | Cómo se corre                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `e2e/admin/`      | Administración: recorridos del dueño y del administrador, casos borde, permisos por interfaz, axe (42 tests)  | `pnpm test:e2e:admin`; proyectos `chromium`, `mobile`, `edge`, `a11y`, `dueno-config`, `dueno-final` |
| `e2e/empleado/`   | Empleado en celular (24 tests)                                                                                | `pnpm test:e2e:empleado`; proyectos `mobile` y `webkit` (iPhone 14)                                  |
| `e2e/supervisor/` | Supervisor en celular (12 tests)                                                                              | `pnpm test:e2e:supervisor`; proyectos `mobile` y `webkit`                                            |
| `permissions/`    | Matriz de permisos por API directa (1.580 casos), Vitest, ver `permissions/README.md`                         | `pnpm test:permissions`                                                                              |
| `load/`           | Carga ligera: 5 administradores y 30 empleados con polling (p50, p95, p99, errores)                           | `pnpm test:load` (manual, no corre en el nocturno)                                                   |
| `fixtures/`       | Cuentas y conjuntos de cuentas, sesiones, `Scenario` (datos por test), fechas, trazabilidad (`cubre`), axe    | —                                                                                                    |
| `lighthouse/`     | Lighthouse sobre staging (PWA y accesibilidad), ver su README                                                 | `pnpm test:lighthouse`                                                                               |
| `e2e/*.spec.ts`   | **Suite de humo** de `ci.yml` y de los despliegues: con variables falsas o contra la URL publicada, sin datos | `pnpm test:e2e`                                                                                      |

### Correrlas en paralelo (CI) sin pisarse

Cada suite tiene su propio conjunto de cuentas (`E2E_CONJUNTO`: `base` por omisión, `edge`, `a11y`,
`emp-movil`, `emp-webkit`, `sup`, `perm`). El barrido de residuos corre una sola vez antes de todo
(`node --env-file=.env.local tests/fixtures/setup-accounts.ts --barrer`) y las suites se ejecutan con
`E2E_SKIP_SWEEP=1`. Lo que usa al dueño del seed (`dueno-config` y `dueno-final`) corre al final.
El diseño, los tiempos medidos y el workflow propuesto están en `docs/test-inventory.md`, sección 10.
Para probar suites en paralelo en una sola máquina: `E2E_REUSE_SERVER=1` con un `vite preview` en el 5173. Los ingresos por API esperan y reintentan si el proveedor responde con el límite de tasa (429).

### Reglas

- Cada test lleva su rastro con `cubre('RB-A04', 'CB-10', 'P-051')`: etiquetas `@RB-A04` para filtrar
  con `--grep` y anotaciones en el informe HTML.
- Los nombres de las cuentas se piden con `nombreDe('empleado1')` y `reNombreDe(...)`, nunca con el
  literal: cambian según el conjunto.
- Un defecto de la aplicación se marca con `test.fail()` y una anotación `defecto` (en la matriz de
  permisos, `it.fails` en `permissions/suite/defectos.ts`); nunca se ajusta la prueba al defecto.
- Sin `sleep` fijos: aserciones que esperan solas. Las que dependen de la hora del día se saltean con
  un motivo (`isTooCloseToMidnight`) o afirman solo lo que vale a cualquier hora (`franjaYaEmpezo`).

## Suites viejas por dominio (`e2e-*`)

Siguen siendo suites independientes, con su propio `playwright.*.config.ts`, su propio arnés
(`helpers/`), las cuentas del seed en solo lectura y datos con prefijos propios (`E2E-P…`). **No
entran al nocturno** (salvo `e2e-auth`, que se suma al job del supervisor); se corren a mano:
`pnpm test:e2e:auth`, `:users`, `:clients-sites`, `:employees`, `:shifts-services`, `:assignments`,
`:checklists`, `:avisos-asistencia`, `:supervisiones`, `:tablero` y `:responsive`. Cada script hace
`pnpm build` y después Playwright con su puerto propio. El estado de cada una (resultado del 4 de
octubre de 2026 y destino: migrar, manual o sumar al nocturno) está en `docs/test-inventory.md`,
sección 8. `e2e-responsive/` y `lighthouse/` son la suite responsive (TEST-014, RB-X01): capturas a
390, 768, 1024, 1366 y 1440 px, Lighthouse sobre staging y la planilla de dispositivos reales
(`docs/matriz-dispositivos.md`, la completa Mike).
