# `tests/e2e-p31`

Suite e2e de las observaciones de la dirección del 23 de noviembre de 2026 (D-01 a D-14, P31, verificación
independiente P31.6), contra un backend real (`App_dev`). Usa las cuentas fijas de `tests/fixtures/` (conjunto
`ajustes`, ver `accounts.ts`) y datos por test con prefijo `e2e-` que cada test limpia. Nunca corre contra
producción. Las fechas son relativas a «hoy» en hora de Argentina.

## Qué cubre cada archivo

| Archivo                             | Decisión   | Qué prueba                                                                                                                                                                                                           |
| ----------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `d01-fijos-cubiertos.desktop.ts`    | D-01, D-02 | Un fijo con licencia o choque cuyo turno ya cubrió otra persona no es tarjeta punteada; el que sigue sin cubrir y es futuro sí; un turno pasado no aparece. Por pantalla y por `employee_fixed_gaps`.                |
| `d06-eliminar-turno.desktop.ts`     | D-06       | «Eliminar turno» en el ⋮ del calendario del empleado, en la tarjeta punteada y en Calendario › Día (dueño); con historia no deja; un administrador no lo ve.                                                         |
| `d07-horario-finalizado.desktop.ts` | D-07       | Editar el horario de un turno finalizado (dueño y administrador) desde la ficha del turno, Calendario › Día y el calendario del empleado; horas 240 → 294 / 268 / 266 min; mover de día queda bloqueado.             |
| `d08-observaciones.desktop.ts`      | D-08       | Alta, varias por día, edición, cambio de color y baja (lógica) de una observación del calendario; sale en la hoja impresa del mes; las cargan dueño y administrador.                                                 |
| `d05-color-cliente.desktop.ts`      | D-05       | «Cambiar color del cliente» desde el calendario o la pizarra pide confirmación, cambia el color del cliente y los dos pintan lo mismo; la pizarra guarda `color_index` nulo.                                         |
| `d03-finalizar-servicio.desktop.ts` | D-03       | Finalizar o pausar un servicio: casilla marcada elimina los turnos futuros sin historia y avisa del que queda; destildada no elimina; el administrador ve «Quedan N turnos futuros» y no se borra nada.              |
| `d10-supervision-estado.desktop.ts` | D-10       | Segunda línea «Supervisado» / «Supervisando» / «Sin supervisión» en Servicios de hoy (Resumen) y Asistencia de hoy; nada si el turno no empezó.                                                                      |
| `d10-supervision-estado.movil.ts`   | D-10       | Lo mismo en las tarjetas del celular (390 px).                                                                                                                                                                       |
| `d09-proximos-dias.movil.ts`        | D-09       | Coordinador › Más › «Próximos días»: 7 días agrupados con Mis sedes / Otras sedes, sin acciones, sin hoy ni hoy + 8 ni cancelados; «Tus servicios» para el doble rol; el empleado no entra.                          |
| `d14-ubicacion.movil.ts`            | D-14       | Aviso, ayuda según el celular y «Reintentar» con la ubicación simulada que falla (permiso, sin señal, tiempo agotado); respaldo de baja precisión a los 8 s; el fichaje de inicio y de fin guarda el motivo técnico. |
| `d12-tablas.desktop.ts`             | D-12       | Clientes y Asistencia de hoy: orden por clic y ancho recordado al recargar; Empleados, Feriados, Supervisiones y Usuarios con asideros de ancho.                                                                     |

Los permisos de lo nuevo (RLS, RPC y vistas por API directa) están en
`tests/permissions/suite/104-p31.permissions.ts`.

## Cómo correrla

Desde `app/`, con `.env.local` completo (las mismas cuatro variables de `scripts/seed-dev.ts`):

```bash
pnpm test:e2e:p31
```

Sin volver a compilar (con `dist/` ya hecho) y de a un archivo o un proyecto:

```bash
E2E_SKIP_SWEEP=1 node --env-file=.env.local ./node_modules/@playwright/test/cli.js test \
  --config=tests/e2e-p31/playwright.p31.config.ts --project=desktop d01
```

Proyectos: `desktop` (1280 px, archivos `*.desktop.ts`) y `mobile` (390 px táctil, ubicación concedida,
archivos `*.movil.ts`). Corren de a uno (`workers: 1`). El puerto 5173 queda ocupado por `vite preview`.
