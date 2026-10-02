# `tests/e2e-responsive`

Revisión responsive de la plataforma (RESP-003, RESP-005, RESP-006, RESP-007, P17.2,
`08_Fases_y_Backlog.md` F17, RB-X01), contra un backend real (`App_dev`). Mismo criterio que las demás
suites de backend real: en su propia carpeta porque necesita `SUPABASE_SERVICE_ROLE_KEY` para armar y
limpiar los datos (prefijo `E2E-P172`), y fuera del CI.

## Qué cubre cada archivo

- `screens-operacion.spec.ts` y `screens-gestion.spec.ts` (RESP-003, RESP-005): las pantallas ADM
  (rutas y pestañas de ADM-02 a ADM-31) con la cuenta del dueño a 390, 768 y 1024 px; las 20
  principales también a 1366 y 1440 px. En cada ancho: la pantalla abre en su ruta, sin scroll
  horizontal (`scrollWidth <= innerWidth`), tabbar de 5 ítems (Hoy, Planificar, Asistencia,
  Supervisiones, Más) por debajo de 1024 px y sidebar desde 1024 (60 px hasta 1279, 236 px desde
  1280), ninguna tabla visible por debajo de 1024 y tarjetas en los listados con datos. Guarda una
  captura de página completa por pantalla y ancho.
- `structure.spec.ts`:
  - RESP-005: listados con tarjetas (RowCard) a 390 y 768 px y tabla a 1024.
  - RESP-006: ADM-06, ADM-14 y ADM-15 son páginas por debajo de 1024 y panel desde 1024; ADM-08,
    ADM-11, ADM-27 (nuevo administrador) y ADM-30 (nuevo criterio) ocupan toda la pantalla a 390 px;
    a 768 px se registra el ancho (ver "Preguntas abiertas").
  - RESP-007: ADM-03 como lista de días con conteo y ADM-04 con un empleado por vez y selector.
  - RESP-004: "Más" abre Empleados, Clientes y sedes, Tareas y Configuración y navega.
- `touch-targets.spec.ts`: área de toque EFECTIVA de cada control a 390 px en todas las pantallas ADM
  (se mide con `elementFromPoint`, así cuenta el `::after` de `IconButton` y descuenta lo que otro
  elemento tapa). Mínimo 44 px; los enlaces en línea dentro de un texto, los controles deshabilitados
  y los marcadores del mapa quedan fuera del conteo.
- `mobile-390.spec.ts`: pantallas de empleado (`/app`) y supervisor (`/sup`) a 390 px con área segura
  simulada (47 px arriba, 34 px abajo, pisando `--safe-*`): cabecera, tabbar, FAB, ActionBar, contenido
  tapado, scroll horizontal y objetivos táctiles.

Las capturas y el detalle de cada hallazgo quedan en `test-results/responsive-capturas/` (carpeta
ignorada por git): `<pantalla>_<ancho>.png` y `hallazgos-<spec>.jsonl` (se vacían en cada corrida).

## Cómo correrla

Desde `app/`, con `.env.local` completo (las mismas cuatro variables que el resto de las suites):

```bash
pnpm test:e2e:responsive                           # construye y corre todo
pnpm test:e2e:responsive screens-operacion         # un solo archivo
```

Sin `pnpm build` previo no hay `dist/` actualizado: el script lo hace. Tarda unos 12 minutos en total;
si el entorno limita la duración de un comando, corré los archivos de a uno. Puerto 5173: no se puede
correr en paralelo con `pnpm dev` ni con otra suite de backend real.

## Cuidado con la hora

Los turnos "de hoy" cubren todo el día (00:00–23:59) y las demás fechas son relativas a hoy en hora de
Argentina. Dentro de los 6 minutos anteriores y los 4 posteriores a las 0:00 los specs se saltean con
un motivo explícito (`isTooCloseToMidnight`), porque el "hoy" cambia durante la corrida.

## Independencia y limpieza

Cada archivo crea su cliente, sede, servicio, empleados, supervisor, turnos, asignaciones y
supervisión y los borra al final. Las cuentas de Auth que la base no deja borrar (quedan referenciadas
por `security_events` y la auditoría) se banean y se desactivan, y la salida lo informa.

## Preguntas abiertas

- A 768 px los paneles (`Sheet`) miden 452 px; `05` sección 7 dice "drawers -> páginas completas" por
  debajo de 1024 px y `07` dice "452 px; en móvil ocupa toda la pantalla". El test registra el ancho
  y solo exige que el panel quepa en la ventana.
