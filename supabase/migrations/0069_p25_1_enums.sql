-- P25.1 (módulo E, «Insumos y control de stock», 26 oct 2026), primera de tres migraciones.
--
-- Solo las enumeraciones. `alter type ... add value` no puede usarse en la misma transacción en
-- la que se agrega el valor (Postgres exige el commit antes de referenciarlo), así que todo lo que
-- los usa (tablas, RPC, vistas y políticas) está en 0070_p25_1_insumos_y_stock.sql. Mismo criterio
-- que 0032 y 0062.
--
--   - admin_capability: 'manage_stock' («Gestionar stock», IS-19, IS-21). El dueño la tiene
--     implícita (app.has_capability); a un administrador la otorga el dueño con set_admin_capability.
--   - stock_movement_kind: ingreso, devolución, retiro, ajuste, control de stock y anulación (§3).
--   - stock_adjustment_reason: motivos de un ajuste (IS-10).
--   - supply_shortage_status: estados de un aviso de faltante (IS-29).
--   - security_event_type: 'stock_movement_voided' (anulación de un movimiento, IS-27) y
--     'supply_price_changed' (cambio de precio de un artículo, IS-22).

alter type public.admin_capability add value if not exists 'manage_stock';

comment on type public.admin_capability is 'Capacidad activable por administrador: Gestionar usuarios, Cancelar turnos, Editar calificaciones, Editar plantillas de tareas, Registrar asistencia por otros, Generar turnos del mes, Asignar supervisiones y Gestionar stock (manage_stock, 0069, módulo E).';

create type public.stock_movement_kind as enum (
  'entry',
  'return',
  'withdrawal',
  'adjustment',
  'count',
  'reversal'
);

comment on type public.stock_movement_kind is 'Tipo de movimiento de stock (0069, módulo E): Ingreso, Devolución (un ingreso, IS-08), Retiro, Ajuste, Control de stock y Anulación (contramovimiento enlazado, IS-27).';

create type public.stock_adjustment_reason as enum (
  'count',
  'breakage',
  'expired',
  'data_error',
  'other'
);

comment on type public.stock_adjustment_reason is 'Motivo de un ajuste de stock (0069, IS-10): Control de stock, Rotura, Vencimiento, Error de carga, Otro.';

create type public.supply_shortage_status as enum (
  'open',
  'resolved'
);

comment on type public.supply_shortage_status is 'Estado de un aviso de faltante de insumo (0069, IS-29): Abierto o Resuelto.';

alter type public.security_event_type add value if not exists 'stock_movement_voided';
alter type public.security_event_type add value if not exists 'supply_price_changed';

comment on type public.security_event_type is 'Tipo de evento de seguridad registrado en security_events (04 sección 2.6). Incluye admin_action_rejected (0030), name_changed (0032), los de B1 (0052), workday_corrected / workday_auto_closed (0062, P24.1) y stock_movement_voided / supply_price_changed (0069, P25.1).';
