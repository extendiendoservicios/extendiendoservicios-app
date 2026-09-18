# ADR-019 · Zona horaria única de Argentina

Fecha: 17 de septiembre de 2026 · Estado: **Aceptado** · Origen: DT-21, P-057, P-066, P-068

## Problema

Turnos con fecha y franja, registros con instante, "sin registro" calculado contra la hora de inicio: hay que fijar cómo se interpretan fechas y horas.

## Alternativas

1. Zona única `America/Argentina/Buenos_Aires`; fechas de calendario en `date`, franjas en `time`, instantes en `timestamptz`; conversión con una función inmutable.
2. Zona por sede o por usuario.

## Decisión

Alternativa 1.

## Motivo

La operación es local; Argentina no tiene horario de verano; simplifica cálculos y evita errores de conversión en el cliente.

## Consecuencias

- `app.local_ts(date, time)` convierte a instante; columnas generadas `starts_at` y `ends_at` en `shifts`.
- Sin turnos que crucen medianoche (`end_time > start_time`).
- El cliente formatea con `date-fns` y la zona fija; nunca confía en la hora del dispositivo para reglas.
