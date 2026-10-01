# `tests/e2e-tablero`

Suite e2e y de rendimiento del tablero operativo ADM-02 (DASH-008/DASH-009/TEST-013, P16.2,
`08_Fases_y_Backlog.md` F16, RB-A07), contra un backend real (`App_dev`). Mismo criterio que las
demás suites de backend real: en su propia carpeta porque necesita `SUPABASE_SERVICE_ROLE_KEY`
para armar y limpiar los datos (prefijo `E2E-P162`).

## Qué cubre cada archivo

- `dashboard-desktop.spec.ts` (DASH-008, escritorio 1280 px):
  - escenario con una ausencia avisada, un sin registro y un turno sin cubrir: los tres aparecen
    en "Requiere atención" y los KPIs los cuentan (por diferencia contra una lectura previa);
  - "Abrir turno" navega a ADM-06; "Registrar en nombre" abre el panel (ADM-11) y, al registrar el
    inicio, el tablero se actualiza solo (sin recargar) y la alerta de "sin registro" desaparece;
  - todas las alertas visibles y ningún botón "Ver las N";
  - permisos: un administrador sin `manage_attendance` no ve "Registrar en nombre" ni "Asignar"
    (después del inicio del turno, `06` sección 8); el dueño sí (control positivo); empleado y
    supervisor no entran a `/admin`.
- `dashboard-mobile.spec.ts` (DASH-008, 390 px): KPIs en dos columnas (la quinta de ancho
  completo), solo 5 alertas visibles con más de 5 y "Ver las N" que despliega el resto, acciones
  al pie de cada tarjeta, "Servicios de hoy" como tarjetas y sin scroll horizontal. Adjunta
  capturas.
- `dashboard-performance.spec.ts` (DASH-009, escritorio): 24 turnos y 40 asignaciones en el día;
  5 corridas desde la navegación hasta ver los KPIs y las 40 filas; informa los tiempos y la
  cantidad de consultas REST, y exige menos de 1,5 s en cada corrida y que no haya consultas por
  fila.

Los unitarios de TEST-013 viven junto al código: `src/features/dashboard/kpis.test.ts` y
`attention.test.ts` (`pnpm test`).

## Cómo correrla

Desde `app/`, con `.env.local` completo (las mismas cuatro variables que el resto de suites de
backend real):

```bash
pnpm test:e2e:tablero                      # desktop y mobile
pnpm test:e2e:tablero --project=desktop
```

Puerto 5173: no se puede correr en paralelo con `pnpm dev` ni con otra suite de backend real.

## Cuidado con la hora

Las fechas y las horas no dependen de a qué hora se corre:

- Todos los turnos son del día de hoy de Argentina, calculado una vez al armar el escenario.
- Para "ya pasó" (sin registro, en curso pasada la hora de fin, sin cubrir) se usa la franja fija
  `00:00–00:01` del día del turno, no "ahora menos n minutos". A cualquier hora del día esa franja
  ya terminó.
- Para el rendimiento, 24 franjas fijas de una hora (`00:00–00:59` ... `23:00–23:59`).
- El reloj del servidor (`now()` de `v_assignments_board` y `v_shifts_board`) no se puede
  controlar desde afuera, así que el único margen que queda es la medianoche: dentro de los 6
  minutos anteriores y los 4 posteriores a las 0:00 de Argentina los specs se saltean con un
  motivo explícito (`isTooCloseToMidnight`): el "hoy" del tablero cambia durante la corrida, o la
  franja `00:00–00:01` todavía no terminó.

## Independencia y limpieza

Cada test crea su cliente, sedes, empleados y turnos y los borra al final (`TableroScenario`):
borrado físico de asistencia, asignaciones, turnos, sedes, clientes y cuentas. Si la base no deja
borrar algo, queda con baja lógica y se informa en la salida. Como el tablero cuenta todo lo de
hoy, los KPIs se verifican por diferencia contra una lectura previa y las alertas se buscan por el
nombre de los datos propios.
