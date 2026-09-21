-- DB-014 (08_Fases_y_Backlog.md, F4 · Modelo de datos y RLS base)
--
-- Duodécimo bloque de 04_Modelo_de_Datos.md sección 11: políticas RLS de la sección 7.2, tabla
-- por tabla, en el mismo orden en que nacieron (0003 a 0010). Hasta este archivo, toda tabla
-- tenía RLS habilitada y cero políticas (acceso denegado a `anon`/`authenticated`, nota de
-- seguridad de 0003_profiles_roles_capabilities.sql): de acá en más, cada rol ve exactamente las
-- filas que describe 04 sección 7.2.
--
-- Convenciones de este archivo:
--   - Las políticas leen roles y capacidades del JWT con las funciones de `app` que ya existen
--     (app.is_admin(), app.has_role(), app.has_capability(), app.current_employee_id(),
--     app.supervises_shift(shift_id), app.shares_shift(shift_id)) -- sin subconsultas contra
--     user_roles/admin_capabilities (el hook ya los puso en el token, 04 sección 7.1). Las
--     subconsultas que sí aparecen (por ejemplo, "¿esta sede tiene un turno que comparto?") no son
--     de roles: resuelven a qué filas de una tabla de negocio llega cada rol, y son el equivalente
--     por-fila de app.shares_shift/app.supervises_shift cuando la tabla no tiene un `shift_id`
--     propio.
--   - Donde el rol solo puede escribir vía RPC (sección 9, "RPC" en 04 tabla 7.2), esta migración
--     NO agrega política de insert/update/delete para ese rol: las RPC son `security definer` y
--     no necesitan un grant de `authenticated` sobre la tabla (corren con los permisos de quien
--     las creó, dueño de la tabla). Esas RPC nacen en sus fases (10 a 15), no acá.
--   - Ningún rol tiene política de `delete`: nada se borra físicamente (04 sección 0, P-014,
--     P-105); la baja es siempre `update` (deleted_at, removed_at, status).
--   - Los roles que filtran "sus turnos" reutilizan app.supervises_shift(shift_id) (S) y
--     app.shares_shift(shift_id) (E) tal cual las definieron 0007/0010; para tablas sin
--     `shift_id` propio (profiles, employees, clients, sites) se arma el `exists` equivalente
--     contra assignments/supervisions.
--   - Las tablas con `deleted_at` filtran `deleted_at is null` en las políticas de S/E (04
--     sección 0: "las políticas RLS de roles no administrativos filtran deleted_at is null"); O/A
--     ven todo, incluidas las filas dadas de baja lógica (necesitan el historial completo).
--   - `to authenticated` en todas las políticas salvo las dos explícitas de `anon` sobre
--     company_settings (para que v_public_branding funcione bajo security_invoker, 0011).
--
-- Nota de arquitectura importante (pregunta que le hice a Mike en el reporte del tramo A; esta
-- es su respuesta, aplicada acá): Postgres no tiene RLS por columna, solo por fila. 04 sección
-- 7.2 pide, para `profiles` (E: compañeros) y `clients`/`client_contacts` (E: clientes de sus
-- turnos), exponer "solo columnas" limitadas (nombre/foto; solo nombre) a quien de otro modo
-- vería la fila completa. Como las diez vistas de 0011 son todas `security_invoker = true` (para
-- que la RLS de las tablas base decida qué filas se ven), la única manera de que v_people_basic
-- muestre compañeros bajo ese modo es que la política de SELECT de `profiles` le dé a
-- `authenticated` acceso de FILA a esas otras personas -- no hay forma de restringir, encima, las
-- columnas que ve *solo para esas filas* sin un grant de columnas distinto por fila (que Postgres
-- no ofrece). Mike decidió una solución intermedia, distinta según la tabla:
--   - `profiles`: se mantiene el acceso de fila del empleado a los perfiles de sus compañeros de
--     turno (política `profiles_select_employee_teammates` más abajo), sin restricción de
--     columna en este tramo. Riesgo residual ACEPTADO por Mike: un cliente API que consulte
--     `profiles` en crudo para la fila de un compañero puede leer `contact_email`/`phone` además
--     de nombre/foto (lo único que el frontend muestra, vía v_people_basic). No se resuelve con
--     `security definer` en la vista porque el encargo pide las diez vistas `security_invoker`.
--   - `client_contacts`: acá SÍ se cierra el acceso del empleado (política
--     `client_contacts_select_shift_party` más abajo, solo para supervisor): los datos de
--     contacto (teléfono, email) de la gente del cliente no los necesita un empleado, a
--     diferencia del nombre del cliente en `clients` (que sí conserva su acceso de fila para E,
--     con el mismo riesgo residual que `profiles` pero acotado a legal_name/trade_name/cuit/etc,
--     información de menor sensibilidad que un teléfono o email de contacto personal).

-- ---------------------------------------------------------------------------------------------
-- 1. profiles (04 sección 7.2)
-- ---------------------------------------------------------------------------------------------

create policy profiles_select_admin
  on public.profiles for select to authenticated
  using (app.is_admin());

create policy profiles_select_own
  on public.profiles for select to authenticated
  using (id = auth.uid());

-- S: "perfiles de empleados de sus turnos" -- full row (sin el paréntesis "(solo columnas...)"
-- que la sección 7.2 solo adosa al caso E, ver nota de arquitectura arriba).
create policy profiles_select_supervisor_team
  on public.profiles for select to authenticated
  using (
    app.has_role('supervisor')
    and exists (
      select 1
      from public.assignments a
      where a.employee_id = profiles.id
        and a.removed_at is null
        and app.supervises_shift(a.shift_id)
    )
  );

-- E: "perfiles de compañeros de sus turnos" (P-103) -- ver nota de arquitectura arriba sobre el
-- límite "solo columnas" (nombre, foto) de v_people_basic.
create policy profiles_select_employee_teammates
  on public.profiles for select to authenticated
  using (
    app.has_role('employee')
    and exists (
      select 1
      from public.assignments mine
      join public.assignments theirs on theirs.shift_id = mine.shift_id
      where mine.employee_id = auth.uid()
        and mine.removed_at is null
        and theirs.employee_id = profiles.id
        and theirs.removed_at is null
    )
  );

-- Update propio: limitado a contact_email, phone, avatar_path, location_consent_at,
-- last_seen_changes_at (04 sección 7.2). El `with check` de acá solo repite la condición de fila
-- (no se puede "mover" la fila a otro id); la restricción de COLUMNAS llega en 0017_grants.sql
-- (DB-017, tramo B): `grant update (contact_email, phone, avatar_path, location_consent_at,
-- last_seen_changes_at) on public.profiles to authenticated` en lugar del `update` amplio que
-- concede hoy el ACL por defecto del esquema (nota de seguridad de 0003). Hasta que 0017 se
-- aplique, esta política por sí sola NO impide que una persona actualice otras columnas de su
-- propia fila (por ejemplo is_active) -- queda anotado en el reporte de la tarea para que no se
-- pierda, tal cual pidió el encargo.
create policy profiles_update_own
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy profiles_update_admin
  on public.profiles for update to authenticated
  using (app.is_admin())
  with check (app.is_admin());

-- Insert: solo por el trigger app.handle_new_user() (security definer, 0003) -- sin política.
-- Delete: nunca (04 sección 7.2: "Delete nunca") -- sin política.

-- ---------------------------------------------------------------------------------------------
-- 2. user_roles (04 sección 7.2)
-- ---------------------------------------------------------------------------------------------

create policy user_roles_select_admin
  on public.user_roles for select to authenticated
  using (app.is_admin());

create policy user_roles_select_own
  on public.user_roles for select to authenticated
  using (profile_id = auth.uid());

-- Insert/Update/Delete: RPC set_user_roles (DB-015, tramo B) -- sin política.

-- ---------------------------------------------------------------------------------------------
-- 3. admin_capabilities (04 sección 7.2)
-- ---------------------------------------------------------------------------------------------

create policy admin_capabilities_select_owner
  on public.admin_capabilities for select to authenticated
  using (app.has_role('owner'));

create policy admin_capabilities_select_own
  on public.admin_capabilities for select to authenticated
  using (profile_id = auth.uid());

-- Insert/Update/Delete: RPC set_admin_capability, solo owner (DB-015, tramo B) -- sin política.

-- ---------------------------------------------------------------------------------------------
-- 4. employees (04 sección 7.2)
-- ---------------------------------------------------------------------------------------------

create policy employees_select_admin
  on public.employees for select to authenticated
  using (app.is_admin());

create policy employees_select_own
  on public.employees for select to authenticated
  using (profile_id = auth.uid());

-- S: "empleados de sus turnos" -- full row (a diferencia de E, que en esta tabla NO tiene
-- política de compañeros: 04 sección 7.2 dice explícitamente "E: propio (todas las columnas) y
-- compañeros vía vista básica", es decir, compañeros solo entra por v_people_basic/profiles, no
-- por esta tabla).
create policy employees_select_supervisor_team
  on public.employees for select to authenticated
  using (
    app.has_role('supervisor')
    and exists (
      select 1
      from public.assignments a
      where a.employee_id = employees.profile_id
        and a.removed_at is null
        and app.supervises_shift(a.shift_id)
    )
  );

-- Insert: "O, A (A con manage_users para crear)" -- app.has_capability ya es true para owner
-- siempre y para admin solo si la capacidad está en el JWT (04 sección 5), así que esta única
-- condición cubre exactamente "O; A con manage_users".
create policy employees_insert_admin
  on public.employees for insert to authenticated
  with check (app.has_capability('manage_users'));

-- Update: "O, A" sin exigir la capacidad (editar datos laborales, 06_API.md sección 3, no está
-- condicionado a manage_users; solo el alta y la Edge Function de baja lo están).
create policy employees_update_admin
  on public.employees for update to authenticated
  using (app.is_admin())
  with check (app.is_admin());

-- ---------------------------------------------------------------------------------------------
-- 5. employee_client_permissions, employee_availability, employee_leaves (04 sección 7.2)
-- ---------------------------------------------------------------------------------------------

create policy employee_client_permissions_select_admin
  on public.employee_client_permissions for select to authenticated
  using (app.is_admin());

create policy employee_client_permissions_select_own
  on public.employee_client_permissions for select to authenticated
  using (employee_id = auth.uid());

create policy employee_client_permissions_write_admin
  on public.employee_client_permissions for all to authenticated
  using (app.is_admin())
  with check (app.is_admin());

create policy employee_availability_select_admin
  on public.employee_availability for select to authenticated
  using (app.is_admin());

create policy employee_availability_select_own
  on public.employee_availability for select to authenticated
  using (employee_id = auth.uid());

create policy employee_availability_write_admin
  on public.employee_availability for all to authenticated
  using (app.is_admin())
  with check (app.is_admin());

-- employee_leaves: O, A ven todo (incluidas licencias dadas de baja lógica, para historial); E
-- ve las propias vigentes (deleted_at is null, 04 sección 0).
create policy employee_leaves_select_admin
  on public.employee_leaves for select to authenticated
  using (app.is_admin());

create policy employee_leaves_select_own
  on public.employee_leaves for select to authenticated
  using (employee_id = auth.uid() and deleted_at is null);

create policy employee_leaves_write_admin
  on public.employee_leaves for all to authenticated
  using (app.is_admin())
  with check (app.is_admin());

-- ---------------------------------------------------------------------------------------------
-- 6. clients, client_contacts (04 sección 7.2)
-- ---------------------------------------------------------------------------------------------

-- S, E: "clientes de sus turnos" -- mismo `exists` contra shifts que usa app.shares_shift/
-- app.supervises_shift por dentro, pero acá no hay un shift_id de la fila: se recorre shifts.
-- Ver nota de arquitectura al principio del archivo sobre el paréntesis "(solo nombre)" de E.
create policy clients_select_admin
  on public.clients for select to authenticated
  using (app.is_admin());

create policy clients_select_shift_party
  on public.clients for select to authenticated
  using (
    deleted_at is null
    and (
      (app.has_role('supervisor') and exists (
        select 1 from public.shifts sh where sh.client_id = clients.id and app.supervises_shift(sh.id)
      ))
      or (app.has_role('employee') and exists (
        select 1 from public.shifts sh where sh.client_id = clients.id and app.shares_shift(sh.id)
      ))
    )
  );

create policy clients_write_admin
  on public.clients for all to authenticated
  using (app.is_admin())
  with check (app.is_admin());

-- client_contacts: 04 sección 7.2 agrupa clients y client_contacts en una sola fila, pero acá el
-- alcance NO es igual: decisión de Mike (ver nota de arquitectura al principio del archivo) --
-- solo el supervisor llega a los contactos del cliente de su turno; el empleado no (los datos de
-- contacto -- teléfono, email de una persona del cliente -- no los necesita para hacer su
-- trabajo, a diferencia del nombre del cliente en `clients`, que sí conserva su acceso).
create policy client_contacts_select_admin
  on public.client_contacts for select to authenticated
  using (app.is_admin());

create policy client_contacts_select_shift_party
  on public.client_contacts for select to authenticated
  using (
    deleted_at is null
    and app.has_role('supervisor')
    and exists (
      select 1 from public.clients c
      where c.id = client_contacts.client_id
        and c.deleted_at is null
        and exists (
          select 1 from public.shifts sh where sh.client_id = c.id and app.supervises_shift(sh.id)
        )
    )
  );

create policy client_contacts_write_admin
  on public.client_contacts for all to authenticated
  using (app.is_admin())
  with check (app.is_admin());

-- ---------------------------------------------------------------------------------------------
-- 7. sites (04 sección 7.2)
-- ---------------------------------------------------------------------------------------------

-- S, E: "sedes de sus turnos" -- fila completa, sin el paréntesis de columnas que sí tiene
-- clients/profiles (04 sección 7.2 no lo repite acá).
create policy sites_select_admin
  on public.sites for select to authenticated
  using (app.is_admin());

create policy sites_select_shift_party
  on public.sites for select to authenticated
  using (
    deleted_at is null
    and (
      (app.has_role('supervisor') and exists (
        select 1 from public.shifts sh where sh.site_id = sites.id and app.supervises_shift(sh.id)
      ))
      or (app.has_role('employee') and exists (
        select 1 from public.shifts sh where sh.site_id = sites.id and app.shares_shift(sh.id)
      ))
    )
  );

create policy sites_write_admin
  on public.sites for all to authenticated
  using (app.is_admin())
  with check (app.is_admin());

-- ---------------------------------------------------------------------------------------------
-- 8. services (04 sección 7.2: "O, A. | O, A." -- sin acceso de S ni E)
-- ---------------------------------------------------------------------------------------------

create policy services_select_admin
  on public.services for select to authenticated
  using (app.is_admin());

create policy services_write_admin
  on public.services for all to authenticated
  using (app.is_admin())
  with check (app.is_admin());

-- ---------------------------------------------------------------------------------------------
-- 9. shifts (04 sección 7.2: "O, A: todos. S, E: sus turnos. | RPC.")
-- ---------------------------------------------------------------------------------------------

create policy shifts_select_admin
  on public.shifts for select to authenticated
  using (app.is_admin());

create policy shifts_select_supervisor
  on public.shifts for select to authenticated
  using (deleted_at is null and app.has_role('supervisor') and app.supervises_shift(id));

create policy shifts_select_employee
  on public.shifts for select to authenticated
  using (deleted_at is null and app.has_role('employee') and app.shares_shift(id));

-- Insert/Update/Delete: RPC (create_shift, generate_shifts, update_shift_time, cancel_shift,
-- reload_shift_tasks -- todas de fases 10/11, todavía no escritas) -- sin política.

-- ---------------------------------------------------------------------------------------------
-- 10. assignments (04 sección 7.2, P-103)
-- ---------------------------------------------------------------------------------------------

create policy assignments_select_admin
  on public.assignments for select to authenticated
  using (app.is_admin());

create policy assignments_select_supervisor
  on public.assignments for select to authenticated
  using (app.has_role('supervisor') and app.supervises_shift(shift_id));

-- E: propias + las de compañeros del mismo turno (P-103). app.shares_shift(shift_id) ya
-- devuelve true si el usuario actual tiene una asignación vigente en ESE turno, sin importar de
-- cuál fila de assignments se trate: cubre ambos casos ("propia" y "de un compañero") con una
-- sola condición.
create policy assignments_select_employee
  on public.assignments for select to authenticated
  using (app.has_role('employee') and app.shares_shift(shift_id));

-- Update: único caso de escritura directa (no-RPC) para un rol no administrativo en esta
-- migración (04 sección 7.2: "RPC. E: update de notes propia mientras el turno no esté
-- completed"). El `using` fija fila (propia, vigente, turno no completed); la restricción a la
-- columna `notes` (para que no pueda tocar `status`, por ejemplo) llega con
-- `grant update (notes) on public.assignments to authenticated` en 0017_grants.sql (DB-017,
-- tramo B) -- mismo patrón que profiles_update_own de arriba, anotado también en el reporte de
-- la tarea. No hace falta un `with check` sobre `status`/`removed_at` porque, hasta que ese
-- grant llegue, cualquier intento de tocar esas columnas desde este `using` ya sigue
-- restringido por fila (propia, no completed) aunque no todavía por columna.
create policy assignments_update_own_notes
  on public.assignments for update to authenticated
  using (
    app.has_role('employee')
    and employee_id = auth.uid()
    and removed_at is null
    and exists (
      select 1 from public.shifts sh
      where sh.id = assignments.shift_id
        and sh.status <> 'completed'
    )
  )
  with check (employee_id = auth.uid());

-- Insert/Delete: RPC (assign_employee, remove_assignment -- fase 11) -- sin política.

-- ---------------------------------------------------------------------------------------------
-- 11. attendance_records, attendance_notices (04 sección 7.2: "O, A: todos. S: de sus turnos.
--     E: propios. | RPC.")
-- ---------------------------------------------------------------------------------------------

create policy attendance_records_select_admin
  on public.attendance_records for select to authenticated
  using (app.is_admin());

create policy attendance_records_select_supervisor
  on public.attendance_records for select to authenticated
  using (
    app.has_role('supervisor')
    and exists (
      select 1 from public.assignments a
      where a.id = attendance_records.assignment_id
        and app.supervises_shift(a.shift_id)
    )
  );

create policy attendance_records_select_employee
  on public.attendance_records for select to authenticated
  using (
    app.has_role('employee')
    and exists (
      select 1 from public.assignments a
      where a.id = attendance_records.assignment_id
        and a.employee_id = auth.uid()
    )
  );

create policy attendance_notices_select_admin
  on public.attendance_notices for select to authenticated
  using (app.is_admin());

create policy attendance_notices_select_supervisor
  on public.attendance_notices for select to authenticated
  using (
    app.has_role('supervisor')
    and exists (
      select 1 from public.assignments a
      where a.id = attendance_notices.assignment_id
        and app.supervises_shift(a.shift_id)
    )
  );

create policy attendance_notices_select_employee
  on public.attendance_notices for select to authenticated
  using (
    app.has_role('employee')
    and exists (
      select 1 from public.assignments a
      where a.id = attendance_notices.assignment_id
        and a.employee_id = auth.uid()
    )
  );

-- Insert/Update/Delete de ambas tablas: RPC (record_check_in/out, admin_record_attendance,
-- close_assignment, notify_delay, notify_absence -- fases 13/14) -- sin política.

-- ---------------------------------------------------------------------------------------------
-- 12. checklist_templates, checklist_template_items (04 sección 7.2: "O, A. S, E: no. | O, A
--     con edit_checklists.")
-- ---------------------------------------------------------------------------------------------

create policy checklist_templates_select_admin
  on public.checklist_templates for select to authenticated
  using (app.is_admin());

create policy checklist_templates_write_admin
  on public.checklist_templates for all to authenticated
  using (app.has_capability('edit_checklists'))
  with check (app.has_capability('edit_checklists'));

create policy checklist_template_items_select_admin
  on public.checklist_template_items for select to authenticated
  using (app.is_admin());

create policy checklist_template_items_write_admin
  on public.checklist_template_items for all to authenticated
  using (app.has_capability('edit_checklists'))
  with check (app.has_capability('edit_checklists'));

-- ---------------------------------------------------------------------------------------------
-- 13. shift_tasks (04 sección 7.2: "O, A. S, E: de sus turnos. | RPC update_task_status.")
-- ---------------------------------------------------------------------------------------------

create policy shift_tasks_select_admin
  on public.shift_tasks for select to authenticated
  using (app.is_admin());

create policy shift_tasks_select_supervisor
  on public.shift_tasks for select to authenticated
  using (app.has_role('supervisor') and app.supervises_shift(shift_id));

create policy shift_tasks_select_employee
  on public.shift_tasks for select to authenticated
  using (app.has_role('employee') and app.shares_shift(shift_id));

-- Insert/Update/Delete: RPC update_task_status (fase 12/13) -- sin política para S/E; O/A
-- también escriben por RPC según 04 sección 7.2 ("RPC update_task_status"), sin excepción de
-- columna como en assignments -- sin política directa tampoco para O/A.

-- ---------------------------------------------------------------------------------------------
-- 14. supervisions, supervision_attendance (04 sección 7.2: "O, A: todas. S: propias. E: no. |
--     RPC.")
-- ---------------------------------------------------------------------------------------------

create policy supervisions_select_admin
  on public.supervisions for select to authenticated
  using (app.is_admin());

-- app.has_role('supervisor') además de "supervisor_id = auth.uid()" (decisión de consistencia,
-- ver el reporte del tramo A): sin este chequeo, a alguien a quien le quitaron el rol supervisor
-- le seguirían apareciendo sus supervisiones pasadas por esta política, a diferencia del resto de
-- las políticas de rol no administrativo de este archivo, que siempre verifican el rol vigente en
-- el JWT antes de mirar la relación de fila. No es una brecha de seguridad grave por sí sola (la
-- persona ya fue supervisora de esa fila, no está viendo datos ajenos), pero rompe el patrón del
-- resto del archivo y hace más difícil de leer un resultado de test cuando cambia el rol de una
-- persona entre corridas.
create policy supervisions_select_own
  on public.supervisions for select to authenticated
  using (app.has_role('supervisor') and supervisor_id = auth.uid());

create policy supervision_attendance_select_admin
  on public.supervision_attendance for select to authenticated
  using (app.is_admin());

-- Mismo criterio de consistencia que supervisions_select_own, aplicado acá también (no lo pidió
-- el encargo explícitamente para esta tabla, pero es el mismo patrón "S: propias" del mismo
-- bloque de 04 sección 7.2 y quedaría inconsistente dejarla afuera).
create policy supervision_attendance_select_own
  on public.supervision_attendance for select to authenticated
  using (
    app.has_role('supervisor')
    and exists (
      select 1 from public.supervisions s
      where s.id = supervision_attendance.supervision_id
        and s.supervisor_id = auth.uid()
    )
  );

-- Insert/Update/Delete de ambas tablas: RPC (assign_supervision, supervision_check_in/out,
-- complete_supervision, mark_supervision_not_done, cancel_supervision -- fase 15) -- sin
-- política. E: sin ninguna política (04 sección 7.2: "E: no").

-- ---------------------------------------------------------------------------------------------
-- 15. ratings (04 sección 7.2, P-084: "O, A: todas. S: propias. E: no.")
-- ---------------------------------------------------------------------------------------------

-- Criterio de aceptación explícito de F4 (08_Fases_y_Backlog.md): "un empleado del seed,
-- autenticado, no puede leer ratings" -- deliberadamente SIN ninguna política para `employee` en
-- esta tabla, ni siquiera restringida a sus propias calificaciones (P-084: "el empleado no ve
-- calificaciones en la Base. RLS lo impide.").
create policy ratings_select_admin
  on public.ratings for select to authenticated
  using (app.is_admin());

-- Mismo criterio de consistencia que supervisions_select_own (ver comentario ahí): sin
-- app.has_role('supervisor'), a alguien a quien le quitaron el rol le seguirían apareciendo las
-- calificaciones que hizo mientras lo era.
create policy ratings_select_own_supervision
  on public.ratings for select to authenticated
  using (
    app.has_role('supervisor')
    and exists (
      select 1 from public.supervisions s
      where s.id = ratings.supervision_id
        and s.supervisor_id = auth.uid()
    )
  );

-- Insert/Update/Delete: RPC rate_employee (fase 15) -- sin política.

-- ---------------------------------------------------------------------------------------------
-- 16. rating_criteria (04 sección 7.2: "O, A, S: vigentes y pasadas. E: no. | O.")
-- ---------------------------------------------------------------------------------------------

-- "Vigentes y pasadas" para O, A y S por igual: sin filtro de valid_to, ven todo el historial de
-- la guía (a diferencia de otras tablas, acá no hay distinción de alcance entre O/A y S).
create policy rating_criteria_select_staff
  on public.rating_criteria for select to authenticated
  using (app.is_admin() or app.has_role('supervisor'));

-- Solo el owner mantiene los criterios (04 sección 7.2: "O.", a diferencia del resto de los
-- maestros de configuración, que suelen admitir O y A).
create policy rating_criteria_write_owner
  on public.rating_criteria for all to authenticated
  using (app.has_role('owner'))
  with check (app.has_role('owner'));

-- ---------------------------------------------------------------------------------------------
-- 17. holidays (04 sección 7.2: "Todos autenticados. | O.")
-- ---------------------------------------------------------------------------------------------

create policy holidays_select_authenticated
  on public.holidays for select to authenticated
  using (deleted_at is null);

create policy holidays_write_owner
  on public.holidays for all to authenticated
  using (app.has_role('owner'))
  with check (app.has_role('owner'));

-- ---------------------------------------------------------------------------------------------
-- 18. company_settings (04 sección 7.2: "Todos autenticados (y anon solo name, logo_path,
--     support_phone vía v_public_branding). | O (A puede subir logo: se otorga a O y A).")
-- ---------------------------------------------------------------------------------------------

-- anon: fila completa visible por RLS (using true) -- company_settings es un singleton (una
-- sola fila, id = 1), así que no hay el problema de "misma fila con columnas distintas según
-- quién mira" que sí tienen profiles/clients (ver nota de arquitectura al principio del
-- archivo): acá el recorte de columnas para anon SÍ se puede lograr con un grant de columnas
-- (name, logo_path, support_phone) en 0017_grants.sql (DB-017, tramo B), porque todos los que
-- llegan por este camino (anon, sin sesión) comparten exactamente el mismo recorte -- no hay un
-- "propio" que necesite más columnas. Mientras 0017 no se aplique, anon ve la fila completa por
-- el ACL por defecto del esquema (nota de seguridad de 0003); v_public_branding igual solo
-- proyecta las tres columnas públicas (0011).
create policy company_settings_select_anon
  on public.company_settings for select to anon
  using (true);

create policy company_settings_select_authenticated
  on public.company_settings for select to authenticated
  using (true);

-- O y A pueden actualizar (04 sección 7.2, P-117: "admin o dueños" para el logo; se extiende a
-- toda la fila, ya que es la única que existe). Sin política de insert: la fila (id = 1) la crea
-- el seed (DB-019/DB-020) como postgres, que tiene bypassrls.
create policy company_settings_update_admin
  on public.company_settings for update to authenticated
  using (app.is_admin())
  with check (app.is_admin());

-- ---------------------------------------------------------------------------------------------
-- 19. security_events (04 sección 7.2: "O. | Solo funciones.")
-- ---------------------------------------------------------------------------------------------

create policy security_events_select_owner
  on public.security_events for select to authenticated
  using (app.has_role('owner'));

-- Insert/Update/Delete: solo app.log_security_event (security definer, 0004) y la Edge Function
-- admin-users (conexión service_role, bypassrls) -- sin política para authenticated ni anon.
