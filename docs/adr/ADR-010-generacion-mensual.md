# ADR-010 · Servicios recurrentes con generación mensual idempotente

Fecha: 17 de septiembre de 2026 · Estado: **Aceptado** · Origen: P-043, P-044, P-045, P-050, P-054, P-056

## Problema

La dueña arma el cronograma mensualmente y lo corrige a diario. Hay que decidir cómo se representan los servicios recurrentes y cómo nacen los turnos.

## Alternativas

1. Regla semanal con vigencia y generación mensual disparada por el administrador, sin tocar turnos existentes.
2. Generación automática continua (cron) a partir de la regla.
3. Sin recurrencia: cada mes se carga o copia a mano.

## Decisión

Alternativa 1. `services` guarda días de la semana, franja, dotación, vigencia y si trabaja en feriados. `generate_shifts(año, mes)` crea solo los turnos faltantes, respeta feriados y copia el checklist. Puede ejecutarse cuantas veces haga falta. Turnos puntuales sin servicio también existen.

## Motivo

Da control a la administración (decide cuándo generar), es idempotente (seguro de repetir), y separa el acuerdo (servicio) de la ocurrencia (turno) para que editar uno no destruya el otro.

## Consecuencias

- Unicidad `(service_id, shift_date)`.
- Editar un servicio no modifica turnos generados; el administrador vuelve a generar para crear faltantes; los cambios a turnos existentes se hacen turno por turno.
- Sin copiar mes ni límite de horizonte.
- Un cron de generación automática puede agregarse después como alerta o como módulo sin cambiar el modelo.
