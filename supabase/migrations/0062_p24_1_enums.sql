-- P24.1 (coordinación libre y jornada del coordinador, 23 oct 2026), primera de dos migraciones.
--
-- Solo los valores nuevos de enumeración. `alter type ... add value` no puede usarse en la misma
-- transacción en la que se agrega el valor (Postgres exige el commit antes de referenciarlo), así
-- que todo lo que los usa (RPC y cierre automático) está en
-- 0063_p24_1_jornada_coordinador.sql. Mismo criterio que 0032.
--
--   - security_event_type: 'workday_corrected' (la administración corrigió, agregó o registró una
--     jornada o una pausa de un coordinador, CJ-32) y 'workday_auto_closed' (el cierre automático
--     de las 23:55 cerró una jornada abierta, CJ-31: es el aviso a la administración).

alter type public.security_event_type add value if not exists 'workday_corrected';
alter type public.security_event_type add value if not exists 'workday_auto_closed';

comment on type public.security_event_type is 'Tipo de evento de seguridad registrado en security_events (04 sección 2.6). Incluye admin_action_rejected (0030), name_changed (0032), los de B1 (0052) y workday_corrected / workday_auto_closed (0062, P24.1).';
