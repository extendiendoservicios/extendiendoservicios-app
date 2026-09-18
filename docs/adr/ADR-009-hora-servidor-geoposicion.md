# ADR-009 · Hora del servidor y geoposición guardada sin validar

Fecha: 17 de septiembre de 2026 · Estado: **Aceptado** · Origen: P-065, P-066, P-067, P-068, P-091, P-108

## Problema

El registro de inicio y fin es la función más sensible de la Base. El mockup usaba hora del dispositivo, geocerca y offline. La V3 manda geocerca, tolerancias y offline a módulos, pero la dueña declaró que su problema principal es saber que el personal está en el lugar.

## Alternativas

Hora: (a) del servidor; (b) del dispositivo.
Ubicación: (a) no se pide; (b) se guarda si el empleado la concede, sin validar ni mostrar; (c) se guarda y se muestra.

## Decisión

Hora del servidor (`now()` en la RPC). Ubicación alternativa (b): se pide con consentimiento explícito (texto provisto por el cliente, que tiene asesoramiento legal), se guardan latitud, longitud y precisión si el empleado la concede, no se valida contra la sede ni se muestra en la Base. El registro funciona igual sin ubicación. Un inicio y un fin por asignación, en cualquier momento del día del turno.

## Motivo

Sin módulo C la única hora confiable es la del servidor. Guardar coordenadas es barato, habilita el módulo B sin reconstruir historia y respeta el consentimiento.

## Consecuencias

- `attendance_records` y `supervision_attendance` con columnas de coordenadas nulas.
- Pantalla de consentimiento antes del primer pedido de permiso; `profiles.location_consent_at`.
- El administrador que registra en nombre del empleado puede indicar una hora dentro del día (POR CONFIRMAR); queda marcado `source = 'admin'` con motivo.
- Cuando entre el módulo B, se decidirá si se validan y muestran las coordenadas guardadas.
