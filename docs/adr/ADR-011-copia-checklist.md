# ADR-011 · Copia del checklist al turno

Fecha: 17 de septiembre de 2026 · Estado: **Aceptado** · Origen: P-058, P-059, P-061, P-063

## Problema

Las tareas de un turno pueden leerse en vivo de la plantilla o copiarse al turno. Las plantillas cambian con el tiempo; los turnos pasados deben reflejar lo que se pidió ese día.

## Alternativas

1. Copiar los ítems de la plantilla a `shift_tasks` al crear el turno.
2. Leer la plantilla en vivo y guardar solo los estados.

## Decisión

Alternativa 1. Plantilla por cliente con plantilla propia opcional por sede (copia de la del cliente, editable). Al crear el turno se copia la de la sede si existe, si no la del cliente. `reload_shift_tasks` permite refrescar un turno no iniciado.

## Motivo

Historia inmutable; cambiar plantillas no altera turnos pasados ni en curso; consultas simples.

## Consecuencias

- Un turno creado antes de que exista plantilla tiene cero tareas hasta que se recargue.
- Las tareas son del turno (compartidas por el equipo), no de cada asignación.
- Ítems con `is_required`; en la Base solo cambia la presentación.
