# ADR-004 · Supabase directo con RLS y funciones SQL, sin capa de API

Fecha: 17 de septiembre de 2026 · Estado: **Aceptado** (con la excepción de ADR-005) · Origen: P-003, P-004

## Problema

La V3 fija Supabase como base de datos, usuarios y archivos. Hay que decidir si el frontend habla directo con Supabase o a través de una API propia.

## Alternativas

1. Supabase directo: PostgREST con RLS para lecturas y escrituras simples; funciones SQL `security definer` (RPC) para operaciones con reglas.
2. API propia en Cloudflare Workers (Hono) delante de Supabase.
3. Supabase Edge Functions como capa general.

## Decisión

Alternativa 1. Las operaciones críticas (generar turnos, crear turno con asignaciones, asignar, registrar inicio y fin, avisar, calificar, cancelar, cerrar) son funciones SQL transaccionales que verifican rol y capacidad adentro.

## Motivo

Sin servidores que mantener ni costo; transacciones en la base; ninguna regla depende del frontend; coherente con "reglas de acceso por rol" de la V3.

## Consecuencias

- Disciplina en SQL: cada RPC con tests pgTAP; errores con mensaje en español y código estable en `hint`.
- Los roles y capacidades viajan en el JWT mediante un hook de Auth para que RLS no consulte tablas.
- Lo que requiere `service_role` (crear usuarios, revocar sesiones) no puede hacerse así: ADR-005.
- Integraciones externas futuras (push, WhatsApp) irán en Edge Functions o Workers, no en una API general.
