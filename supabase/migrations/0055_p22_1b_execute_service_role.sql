-- P22.1b · corrección de 0054: las vistas de administración (v_assignments_board,
-- v_supervisions_admin y v_presence_today) llaman a app.attendance_position, y 0054 solo le dio
-- `execute` a `authenticated`. `service_role` (la Edge Function y los scripts) también consulta
-- las vistas y fallaba con «permission denied for function attendance_position» (lo detectó el
-- pgTAP 0050, «service_role consulta todas las vistas de public sin error»).
--
-- `service_role` no tiene sesión de usuario: app.is_admin() es falso y la función no devuelve
-- filas, así que las columnas de posición salen null. No se le abre ninguna coordenada.

grant execute on function app.attendance_position(text, uuid) to service_role;
