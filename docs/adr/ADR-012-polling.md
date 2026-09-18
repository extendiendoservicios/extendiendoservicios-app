# ADR-012 · Polling en lugar de Realtime

Fecha: 17 de septiembre de 2026 · Estado: **Aceptado** · Origen: P-005, RB-A08

## Problema

La V3 pide "avisos de ausencia y demora en tiempo real en el tablero". Supabase ofrece Realtime; el plan sin cargo limita conexiones concurrentes.

## Alternativas

1. Polling con TanStack Query (30 s en tablero y asistencia, 60 s en otras listas).
2. Supabase Realtime (cambios de Postgres).

## Decisión

Alternativa 1.

## Motivo

"Tiempo real" en el sentido operativo se cumple con un minuto de latencia; sin conexiones persistentes que cuenten contra el plan; más simple y robusto en redes móviles.

## Consecuencias

- `refetchInterval` en los hooks del tablero y de asistencia; indicador de "actualizado hace n segundos".
- Las vistas del tablero deben ser baratas (índices por fecha); se mide con el seed ampliado.
- Cambiar a Realtime es reemplazar el hook, no la pantalla, si un módulo lo exige.
