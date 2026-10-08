-- P19.5a (ajustes pedidos por los dueños en la reunión del 6 oct 2026), primera de dos migraciones.
--
-- Solo los valores nuevos de enumeración. `alter type ... add value` no puede usarse en la misma
-- transacción en la que se agrega el valor (Postgres exige el commit antes de referenciarlo), así
-- que todo lo que los usa (restricción, RPC, vistas) está en 0033_p19_5a_ajustes_reunion.sql.
--
--   - notice_kind: 'on_the_way' ("En camino": el empleado avisa que sale para el turno).
--   - security_event_type: 'name_changed' (cambio de nombre de una persona, update_person_name).

alter type public.notice_kind add value if not exists 'on_the_way';
alter type public.security_event_type add value if not exists 'name_changed';

comment on type public.notice_kind is 'Tipo de aviso: Demora, Ausencia, En camino (0032).';
comment on type public.security_event_type is 'Tipo de evento de seguridad registrado en security_events (04 sección 2.6). Incluye admin_action_rejected (0030) y name_changed (0032).';
