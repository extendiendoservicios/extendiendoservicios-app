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

| Carpeta                | Qué es                                                                                                                                                                                          | Cómo se corre                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `e2e/admin/`           | Administración: recorridos del dueño y del administrador, casos borde, permisos por interfaz, axe, la coordinación libre y Insumos (`insumos.admin.ts`, 27 tests) (78 tests)                    | `pnpm test:e2e:admin`; proyectos `chromium`, `mobile`, `edge`, `a11y`, `dueno-config` |
| `e2e/empleado/`        | Empleado en celular (25 tests) e Insumos (`insumos.empleado.ts`, 12 tests)                                                                                                                      | `pnpm test:e2e:empleado`; proyectos `mobile` y `webkit` (iPhone 14)                   |
| `e2e/supervisor/`      | Coordinador en celular (27 tests): jornada, coordinación libre, calificar, historial, doble rol (P24.5) e Insumos (`insumos.supervisor.ts`, 5 tests)                                            | `pnpm test:e2e:supervisor`; proyectos `mobile` y `webkit`                             |
| `e2e-ajustes-reunion/` | Ajustes de la reunión del 6 oct 2026 (AJ-01 a AJ-10): nombre, «En camino», «Llegada tarde», horas, calificación promedio, asistencia de la ficha, resumen por cliente, axe (conjunto `ajustes`) | `pnpm test:e2e:ajustes-reunion`; proyectos `desktop` y `mobile`; ver su README        |
| `permissions/`         | Matriz de permisos por API directa (3.382 casos, 20 de ellos esperados como defecto), Vitest, ver `permissions/README.md`                                                                       | `pnpm test:permissions`                                                               |
| `load/`                | Carga ligera: 5 administradores y 30 empleados con polling (p50, p95, p99, errores)                                                                                                             | `pnpm test:load` (manual, no corre en el nocturno)                                    |
| `fixtures/`            | Cuentas y conjuntos de cuentas, sesiones, `Scenario` (datos por test), `InsumosE2e` (`stock.ts`: datos de Insumos con su purga) y `stock-ui.ts`, fechas, trazabilidad (`cubre`), axe            | —                                                                                     |
| `lighthouse/`          | Lighthouse sobre staging (PWA y accesibilidad), ver su README                                                                                                                                   | `pnpm test:lighthouse`                                                                |
| `e2e/*.spec.ts`        | **Suite de humo** de `ci.yml` y de los despliegues: con variables falsas o contra la URL publicada, sin datos                                                                                   | `pnpm test:e2e`                                                                       |

### Correrlas en paralelo (CI) sin pisarse

Cada suite tiene su propio conjunto de cuentas (`E2E_CONJUNTO`: `base` por omisión, `edge`, `a11y`,
`emp-movil`, `emp-webkit`, `sup`, `perm`, `ajustes`). El barrido de residuos corre una sola vez antes de todo
(`node --env-file=.env.local tests/fixtures/setup-accounts.ts --barrer`) y las suites se ejecutan con
`E2E_SKIP_SWEEP=1`. Lo que edita la configuración de la empresa (`dueno-config`, singleton que la matriz de permisos también toca) corre al final; el recorrido del dueño ya no necesita ir al final desde que el cierre de sesión es local (DEF-04, P18.6).
El nocturno (`.github/workflows/e2e-app-dev.yml`) corre estos conjuntos como jobs paralelos, uno por suite (guía y tiempos en `docs/deployment.md` sección 14); el diseño y los tiempos medidos están en `docs/test-inventory.md`, sección 10.
En Windows, el navegador WebKit de pruebas a veces deja un proceso `WebKitNetworkProcess` huérfano al cerrar y Playwright no termina aunque todos los tests pasaron (se cortó a los 30 minutos con `globalTimeout`; TEST-029, `docs/test-report-f18.md` sección 3.3). Si pasa, terminá ese proceso a mano (`taskkill /F /IM WebKitNetworkProcess.exe`); en el nocturno (Linux) no se vio.
Para probar suites en paralelo en una sola máquina: `E2E_REUSE_SERVER=1` con un `vite preview` en el 5173. Los ingresos por API esperan y reintentan si el proveedor responde con el límite de tasa (429).

### Coordinación libre y jornada (P24.5)

Desde la migración 0063 ya no hay asignación manual de supervisiones: el coordinador inicia su jornada y toma el turno (`take_supervision`). `assign_supervision`, `mark_supervision_not_done`, `supervision_check_in` y `supervision_check_out` están revocadas (42501). Para armar datos, `Scenario` (`tests/fixtures/scenario.ts`) ofrece:

- `tomarSupervision(turno, quien)`: deja la jornada en marcha y toma el turno con la sesión del coordinador (el turno tiene que ser de hoy y el coordinador tiene que cerrar o descartar la supervisión abierta antes de tomar otra).
- `supervisionDirecta(turno, quien, { estado, inicio, fin, jornadaId })`: con la clave de servicio, para historial, otros días y estados cerrados (`en_curso`, `completada`, `cancelada`, `no_realizada`).
- `asegurarJornada`, `jornadaDirecta` (cerrada sola, con pausas o con una supervisión «Sin cerrar»), `jornadaPasada` (por `admin_record_workday`) y `prioridad` (preferencias).
- `tomarCoordinador(quien)`: candado entre procesos por coordinador. La jornada es única por día y la supervisión abierta es de a una, así que dos tests no pueden usar el mismo coordinador a la vez; `cleanup()` suelta el candado y borra las jornadas.

### Insumos y control de stock (P25.5c)

- Los movimientos de stock, sus líneas, los controles y el historial de precios son **inmutables** (IS-27): la clave de servicio tampoco los borra por la API. Por eso `InsumosE2e` (`tests/fixtures/stock.ts`) crea los datos con las RPC reales y los limpia con `purgar()`, que corre un script SQL con la CLI de Supabase (`supabase db query --linked`) como el seed de insumos: apaga el trigger de inmutabilidad dentro de una transacción, borra solo lo que lleva el prefijo `e2e-<marca>-` y lo vuelve a prender. Antes de correr verifica que el proyecto vinculado sea el de `VITE_SUPABASE_URL` y nunca producción. Las marcas son `adm`, `emp`, `sup` y `permstock` (una por suite, para que dos archivos en paralelo no se pisen).
- La limpieza va **antes** que la de los clientes del escenario: un movimiento con turno o sede impide borrar el cliente. El barrido previo de `global-setup.ts` (y el de la matriz de permisos) purga los residuos de Insumos de una corrida cortada.
- El administrador fijo ahora tiene la capacidad `manage_stock` (`ADMIN_CAPABILITIES` pasó a ocho) y hay una cuenta fija nueva, `adminOperativo` (administrador con todas las capacidades que además es empleado), para el retiro en nombre de otra persona de quien también trabaja turnos (IS-35). Está en los conjuntos `base` y `perm`.
- «Cargar control» arma la hora del conteo con `HH:mm` (segundos en cero): los movimientos hechos dentro de ese mismo minuto cuentan como posteriores (IS-31). El test que carga el control con la hora por omisión espera a que pase el minuto (`esperarMinutoNuevo`).
- Los tests de celular no escriben en el buscador antes de mirar la barra de abajo: con un campo en foco la barra se oculta (teclado abierto, RESP-008).

### Reglas

- Cada test lleva su rastro con `cubre('RB-A04', 'CB-10', 'P-051')`: etiquetas `@RB-A04` para filtrar
  con `--grep` y anotaciones en el informe HTML.
- Los nombres de las cuentas se piden con `nombreDe('empleado1')` y `reNombreDe(...)`, nunca con el
  literal: cambian según el conjunto.
- Cada conjunto reserva su propio año lejano para lo que genera turnos o carga feriados (`anioLejano()`: 2193 en `base`, 2194 en `edge`...): `generate_shifts` y `holidays` son globales y dos conjuntos corriendo a la vez se pisarían.
- Un defecto de la aplicación se marca con `test.fail()` y una anotación `defecto` (en la matriz de
  permisos, `it.fails` en `permissions/suite/defectos.ts`); nunca se ajusta la prueba al defecto.
- Sin `sleep` fijos: aserciones que esperan solas. Las que dependen de la hora del día se saltean con
  un motivo (`isTooCloseToMidnight`) o afirman solo lo que vale a cualquier hora (`franjaYaEmpezo`, `franjaSigueProgramada`: "Programado" pasa a "Próximo" 2 horas antes del inicio).

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
