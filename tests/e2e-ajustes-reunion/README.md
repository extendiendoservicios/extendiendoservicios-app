# `tests/e2e-ajustes-reunion`

Suite e2e de los ajustes que pidieron los dueños en la reunión del 6 de octubre de 2026 (AJ-01 a AJ-10,
P19.5, verificación independiente P19.5d), contra un backend real (`App_dev`). Usa las cuentas fijas de
`tests/fixtures/` (conjunto propio `ajustes`, ver `accounts.ts`) y datos por test con prefijo `e2e-`
que cada test limpia. Nunca corre contra producción.

## Qué cubre cada archivo

| Archivo                       | Ajuste         | Qué prueba                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `nombre.desktop.ts`           | AJ-01          | El dueño ve «Editar nombre» en Configuración → Usuarios y cambia el nombre de otra persona y el suyo (queda el evento «Nombre modificado» en Eventos de seguridad); un administrador no ve la opción; el administrador cambia su nombre desde Mi perfil y la cabecera se actualiza; nombre vacío o de más de 100 caracteres se rechaza.    |
| `nombre.movil.ts`             | AJ-01          | Mi perfil a 390 px del empleado y del supervisor: formulario de una columna, cabecera («Hola, …» y «Mi perfil, …») actualizada sin recargar, evento registrado.                                                                                                                                                                            |
| `en-camino.movil.ts`          | AJ-02          | Celular del empleado: con un turno que empieza dentro de 3 h aparece «Estoy en camino», la hoja ofrece 10, 15, 20, 30, 45 y 60 min o «No sé / sin estimar», la tarjeta muestra «Avisaste que estás en camino · llegás ~HH:MM» (la hora que guardó el servidor) y «Cambiar hora estimada»; a más de 3 h no hay botón y el servidor rechaza. |
| `estados.desktop.ts`          | AJ-02/03/07/08 | Planilla de administración (tablero «Servicios de hoy» y Asistencia de hoy): «En camino» celeste con «llega ~HH:MM» y filtro; «Llegada tarde» amarilla (menos de 15 min) contra «Sin registro» roja; turno cancelado; tilde verde / advertencia con motivo / «en curso» en Horas; «Finalizado» en verde y «En curso» del turno en azul.    |
| `calificaciones.desktop.ts`   | AJ-04/05       | Columna «Calificación» del listado de Empleados (estrellas, promedio con coma, cantidad, ordenable) y tercera línea de la ficha; coincide con el promedio calculado desde la base.                                                                                                                                                         |
| `asistencia-ficha.desktop.ts` | AJ-06          | Pestaña Asistencia de la ficha: horas por turno, total del período al mover Desde y Hasta, «Descargar detalle» (dueño y administrador) con membrete y logo, tabla, total y dos firmas, `window.print` reemplazado por un contador, impresión emulada en una página A4; doble rol con columna «Tipo»; 390 px.                               |
| `clientes.desktop.ts`         | AJ-09/10       | Pestaña «Resumen de servicios» del cliente (período, totales, detalle por turno, hoja con una firma) y columna «Horas (mes)» de Clientes coherente con el resumen; 390 px.                                                                                                                                                                 |
| `accesibilidad.*.ts`          | todos          | axe-core (sin violaciones críticas ni serias) sobre las pantallas nuevas o cambiadas, en escritorio y en celular.                                                                                                                                                                                                                          |

## Cómo correrla

Desde `app/`, con `.env.local` completo (las mismas cuatro variables de `scripts/seed-dev.ts`):

```bash
pnpm test:e2e:ajustes-reunion
```

El puerto es el 5173 (lista blanca de CORS de la Edge Function `admin-users`): no se puede correr a la vez
que `pnpm dev`. El config fija el conjunto `ajustes` solo (`conjunto.ts`); en el nocturno lo fija el job
con `E2E_CONJUNTO=ajustes`. Proyectos: `desktop` (1280 px) para `*.desktop.ts` y `mobile` (390 px,
táctil, geolocalización concedida) para `*.movil.ts`; corren de a un archivo (`workers: 1`).

## Horas del día y salteos

Nada depende de la hora a la que corre la prueba, salvo lo que no se puede evitar, que se saltea con un
motivo explícito (`helpers/tiempo.ts`):

- **«En camino»** necesita un turno que empiece dentro de 45 min (y dure 60) o a 210 min: se saltea si no
  queda margen antes de la medianoche de Argentina.
- **«Llegada tarde» / «Sin registro»** necesitan turnos que empezaron hace 3 y 20 min: se saltea entre las
  0:00 y las 0:21 (el turno no puede cruzar la medianoche). El turno cancelado, entre las 0:00 y las 0:04.
- **Horas en Servicios de hoy** y **Finalizado / En curso** usan la franja fija 00:00–00:30 con horas de
  pared fijadas a mano: se saltean antes de las 0:45.
- Las pruebas de calificaciones, asistencia de la ficha y resumen por cliente fechan la asistencia en horas
  fijas (pasadas o de hoy) cargadas con la clave de servicio: no dependen de la hora.

## Datos y limpieza

Cada test crea su cliente, sus sedes, turnos, asignaciones y supervisiones con prefijo `e2e-` y los borra
en el `finally` (`Scenario.cleanup`); el barrido del nocturno limpia lo que haya quedado de una corrida
cortada. Los tests de nombre cambian el nombre de cuentas fijas y del **dueño del seed** y lo reponen con
la misma puerta de la app (`update_person_name`); borran los eventos `name_changed` que ellos mismos
generaron. Por eso el job nocturno va al final, después de `dueno`.

## Defectos abiertos marcados con `test.fail()`

- **DEF-AJ-01** (`estados.desktop.ts`): la planilla de administración muestra «Esperado» en la asignación
  de un turno cancelado con aviso «En camino» o «Llegada tarde»; ninguna marca dice «Cancelado». Cuando se
  corrija, el test pasa y Playwright avisa que hay que sacar la anotación.

## P19.5h: vencimiento de «En camino»

- `vencimiento.desktop.ts` (planilla) y `vencimiento.movil.ts` (celular): «En camino» vence a la hora estimada + 15 min (sin estimación, inicio + 15). Los avisos se fechan con `helpers/aviso.ts`.
- `objetivo-tactil.movil.ts`: el enlace de «Supervisiones de hoy» mide 44 px o más a 390 px.
- `estados.desktop.ts`: el turno cancelado muestra «Cancelado» tachado (DEF-AJ-01, sin `test.fail`).
