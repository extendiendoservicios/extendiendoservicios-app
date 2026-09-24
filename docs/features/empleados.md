# Empleados y supervisores (ADM-16 a ADM-18)

Tres pantallas bajo `/admin/empleados...`: listado (ADM-16), ficha (ADM-17)
y formulario de alta y edición (ADM-18). P09.3 (EMP-001 a EMP-005) y P09.4
(EMP-006 a EMP-010, EMP-015, EMP-016). Sin capacidad que las restrinja para
VER (`04_Modelo_de_Datos.md` sección 7.2: "employees | O, A: todas") — las
acciones que sí la exigen (`manage_users`) se ocultan pantalla por pantalla,
ver más abajo. Protegidas por `RequireRole allow={['owner','admin']}` del
grupo `/admin` (`router.tsx`) y por
`employees_update_admin`/`employees_insert_admin` del lado del servidor
(`0012_rls_policies.sql`).

De las siete pestañas de ADM-17, Datos, Habilitaciones, Disponibilidad y
Licencias están completas (P09.4). Próximos turnos y Calificaciones quedan
con su estado vacío y, la primera, con un enlace "Ver semana" ya cableado:
los turnos y las calificaciones llegan en fases posteriores (asignaciones y
supervisiones). Asistencia (ADM-12) también queda con su estado vacío: el
historial llega junto con el registro de asistencia.

## Permisos (`features/employees/permissions.ts`)

- **Editar datos laborales y personales** (`canEditEmployee`): el dueño y
  cualquier administrador, sin exigir `manage_users` (`06_API.md` sección
  3: "Editar datos laborales | O, A"; `employees_update_admin` usa
  `app.is_admin()` sin chequear la capacidad).
- **Crear, resetear contraseña, cerrar sesiones y dar de baja**
  (`canManageEmployeeAccounts`): el dueño y un administrador con
  `manage_users` (`06` sección 3: "Crear | O; A + manage_users"; mismo
  requisito para las acciones de la Edge Function).

El servidor vuelve a verificar todo esto (RLS y la Edge Function
`admin-users`) — estas funciones solo deciden qué botón mostrar.

## ADM-16 · Empleados · listado

Ruta `/admin/empleados`. Tabla (`DataTable`) con foto y nombre (enlaza a la
ficha), legajo, roles, estado efectivo (incluido "De licencia",
`v_employees.effective_status`) y teléfono. Sin columna "próximo turno":
`v_employees` no la trae (el criterio de EMP-002 la condiciona a "si
`v_employees` lo trae" — decisión menor, ver el reporte del encargo P09.3).

Filtros: texto (nombre, apellido, DNI y legajo si es numérico, con
`useDebouncedValue` de 300 ms), rol (empleado/supervisor), estado efectivo y
cliente habilitado. Los tres primeros se resuelven en el servidor
(`fetchEmployees`); el de cliente habilitado se resuelve en el cliente
(`filterEmployeesByClient`, `employeeListFilters.ts`) porque depende de la
regla de P-034 ("lista vacía = habilitado para todos"), que no se puede
expresar como un `.eq()` simple sobre la vista. Paginación en el cliente (20
filas por página): la dotación completa es chica (decenas de personas,
criterio de F9), así que no hace falta paginar en el servidor. Polling de
60 s con "Actualizado hace n s" (`UpdatedAgo.tsx`, tercera copia del mismo
componente — ver la nota de "decisiones menores" del reporte del encargo
sobre subirlo a `src/components/`).

Botón "Nuevo empleado" (ADM-18) solo si `canManageEmployeeAccounts`.

### Filtro de estado por omisión (decisión de Mike, 24 sep 2026)

Por defecto (`statusFilter === 'all'`, etiqueta "Activos y de licencia") la
lista saca las bajas — mismo criterio que ADM-27 oculta los desactivados por
omisión (`filterUsersByStatus`). A diferencia de ADM-27 (un interruptor),
acá ya existía un `Select` de estado con la opción "Baja": elegirla a
propósito sigue mostrando solo esas personas. La lógica vive en
`filterEmployeesByDefaultStatus` (`employeeListFilters.ts`), aplicada en el
cliente después de `filterEmployeesByClient` sobre las filas que ya trajo
`fetchEmployees`.

## ADM-17 · Empleado · ficha

Ruta `/admin/empleados/:id`. Cabecera con foto (`Avatar`), nombre, legajo,
roles y estado efectivo (`StatusBadge`). Acciones en la cabecera:

- "Resetear contraseña", "Cerrar sesiones", "Dar de baja" — solo si
  `canManageEmployeeAccounts` y la persona no está ya de baja.
- "Editar" (ADM-18) — solo si `canEditEmployee`.

Pestañas sincronizadas con `?pestana=` (por omisión, sin el parámetro, es
"Datos"). **Datos**: personales (DNI, CUIL, teléfono, domicilio, fecha de
nacimiento), laborales (legajo, fecha de ingreso, fecha de baja si
corresponde, notas), contacto de emergencia (nombre, teléfono, vínculo) y
usuario y roles (roles, estado de la cuenta —`StatusBadge domain="user"`—,
email de contacto, botón "Editar roles" — ver más abajo). En las filas con
un dato opcional que falta, la fila entera se omite (nunca un "—" suelto).

### Editar roles desde la ficha (decisión de Mike, 24 sep 2026)

Los roles `employee`/`supervisor` se editan con un botón "Editar roles" en
la sección "Usuario y roles" de la pestaña Datos (`EmployeeRolesDialog.tsx`),
visible con `canManageEmployeeAccounts` (mismo requisito que crear o dar de
baja: dueño, o administrador con `manage_users` — la RPC `set_user_roles`
exige esa misma capacidad, `0013_rpc_users.sql`). Dos casillas ("Empleado",
"Supervisor"), al menos una marcada (`employeeRolesEditSchema`). Owner y
administrador **no** aparecen en este diálogo ni se tocan acá: si la
persona ya tenía alguno de esos dos roles (caso raro: alguien con fila en
`employees` que también es admin), `nextEmployeeRoles` (`schemas.ts`) los
preserva tal cual al armar el conjunto completo que se le manda a
`set_user_roles` — siguen gestionándose desde ADM-27.

`useSetEmployeeRolesMutation` (`features/employees/queries.ts`) es una copia
corta de `useSetUserRolesMutation` (`features/users/queries.ts`, ADM-27): si
el conjunto resultante le saca un rol a la persona, cierra sus sesiones
después (P-015) — una copia y no una reexportación porque acá hace falta
invalidar `employeesKeys` (ficha y listado), no `usersKeys`.

### Habilitaciones por cliente (EMP-006, P-034)

`employee_client_permissions`, alta y quitar (`06` sección 3: "insert/delete",
sin baja lógica — la tabla no tiene `deleted_at`). Un texto fijo en la
pestaña explica la regla de P-034: lista vacía = habilitado para todos los
clientes. El selector de "agregar" (`useClientFilterOptionsQuery`, ya
existente en `features/sites/queries.ts`) solo ofrece los clientes que
todavía no están habilitados. Quitar pide confirmación simple
(`SimpleConfirmDialog`, sin motivo obligatorio: no está en la lista de
`07_Design_System.md` sección 2.4) y, si era la última habilitación
cargada, el texto de confirmación avisa que la persona vuelve a quedar
habilitada para todos.

### Disponibilidad declarada (EMP-007, P-035)

`employee_availability`, franjas por día de la semana (`0`..`6` =
domingo..sábado, `extract(dow from ...)`), agrupadas por día para leerlas
rápido (orden de exhibición: semana empieza en lunes). Formulario en línea
(día, desde, hasta) con validación de franja (`employeeAvailabilitySlotSchema`,
`end_time > start_time`, mismo check que `0006_employees.sql`). Alta y
quitar; sin editar una franja existente (se quita y se vuelve a cargar —
decisión menor, ver el reporte del encargo). Quitar pide confirmación
simple, sin motivo obligatorio.

### Licencias (EMP-008, P-033)

`employee_leaves`, alta con "desde" obligatorio y "hasta" opcional (licencia
abierta), listadas de la más reciente a la más vieja. Estado derivado
(`deriveEmployeeLeaveStatus`, `employeeLeaveStatus.ts`, sin React):
"Futura" (todavía no empezó), "Vigente" (cubre hoy) o "Terminada" (ya
terminó) — mismo criterio que `v_employees.effective_status` para "de
licencia", pero clasificando las tres categorías en vez de un solo
booleano. Una licencia vigente es lo que hace que la cabecera de la ficha y
el listado (ADM-16) muestren "De licencia".

**Baja lógica, nunca borrado físico**: "Dar de baja" marca `deleted_at` en
vez de borrar la fila, aunque la política de la base permitiría el borrado
físico (ver "Pendiente" del reporte del encargo P09.4 — se prefirió no
ofrecerlo desde la pantalla). Las licencias dadas de baja se siguen
mostrando en la lista, atenuadas, para conservar el historial; dejan de
contar para "de licencia" y liberan el rango de fechas que ocupaban (la
exclusión de solapamiento filtra `where deleted_at is null`,
`employee_leaves_no_overlap`).

**`LEAVE_OVERLAP`**: la exclusión de solapamiento vive en una tabla que se
escribe directo por PostgREST (sin RPC), así que llega como un `23P01` crudo
de Postgres, no como un `raise exception` con `hint` propio — `mapWriteError`
(`src/api/employees.ts`) lo traduce a un mensaje en español con ese `hint`
(`06` sección 3: "Solapamiento bloqueado por exclusión → LEAVE_OVERLAP").

### Próximos turnos (EMP-009) y Calificaciones (EMP-010)

Estado vacío sin referencias internas, con "Ver semana" en Próximos turnos
enlazando a `/admin/planificacion?vista=semana` (ADM-04, todavía un
placeholder). Los turnos llegan con las asignaciones (fase posterior) y las
calificaciones con las supervisiones — hoy no hay datos que traer.

### Baja en dos pasos (EMP-005)

`terminateEmployee` (`src/api/employees.ts`), con motivo obligatorio
(`ConfirmDialog`, DS-010, vía `TerminateEmployeeDialog`). Dos pasos, en este
orden (decisión menor: `06_API.md` no fija el orden):

1. Edge Function `admin-users`, `deactivate_user` — banea el login, marca
   `profiles.is_active = false` y cierra sesiones.
2. `employees.status = 'terminated'` (+ `terminated_at`).

Si el segundo paso fallara, la persona queda con el acceso YA bloqueado
pero con `employees.status` todavía en `active` — un dato administrativo
desactualizado, corregible reintentando desde la ficha. Se prefirió este
orden al inverso (marcar la baja laboral y recién después revocar el
acceso) porque el riesgo de un ex empleado que todavía puede iniciar sesión
es peor que el de una etiqueta demorada. La función avisa ese caso puntual
con `ApiError('...', 'EMPLOYEE_STATUS_NOT_UPDATED')`.

No hay acción para reactivar una baja desde esta pantalla (fuera del
alcance de EMP-005; la Edge Function la tiene, pero `05_Pantallas_y_
Navegacion.md` no la pide acá).

## ADM-18 · Empleado · formulario

Rutas `/admin/empleados/nuevo` y `/admin/empleados/:id/editar`
(`EmployeeFormPage.tsx`), que elige entre dos componentes según
`useParams().id` en vez de un único formulario con campos condicionales
(alta y edición comparten los bloques de datos personales/laborales/
contacto de emergencia, pero difieren en usuario+roles+foto — ver la nota
del componente y el reporte del encargo).

### Alta (EMP-003)

Orden pensado para cargar rápido (criterio de F9: cada persona en menos de
tres minutos): roles (checkboxes "Empleado"/"Supervisor", al menos uno),
usuario (email de login y contraseña inicial, `PasswordInput`), datos
personales, datos laborales (legajo sugerido y editable, fecha de ingreso,
notas) y contacto de emergencia. Sin foto en este paso: `AvatarUpload`
necesita un `profileId` que todavía no existe antes de crear — se sube
después, desde la ficha o volviendo a esta misma ruta en modo edición.

Una sola llamada a la Edge Function `create_user` (`createEmployeeUser`,
`src/api/employees.ts`) crea el usuario de Auth y la fila de `employees` en
el mismo paso del servidor: no hay ningún punto intermedio del lado del
cliente que pueda dejar un usuario de Auth huérfano si algo falla a mitad
de camino (ver el comentario de cabecera de `actionCreateUser` en
`admin-users/index.ts` y el reporte del encargo P09.3).

**Legajo sugerido y editable**: la Edge Function no acepta elegir el legajo
al crear (lo asigna `employee_number_seq`). El formulario sugiere
`max(employee_number) + 1` y, si la persona lo cambió, `createEmployeeUser`
aplica un `update` aparte después de crear. Si ese `update` fallara (por
ejemplo, otra alta se quedó con ese número mientras tanto), la función NO
lanza — la persona ya está creada — sino que devuelve
`employeeNumberWarning` con un texto para avisar aparte del éxito
(`toast.warning`, en vez de `toast.error`).

### Edición (EMP-004)

Foto (`AvatarUpload`), los mismos bloques de datos personales/laborales/
contacto de emergencia, y contacto (email de contacto,
`profiles.contact_email`). Sin email de login ni contraseña (acción de
usuario, no de esta pantalla) ni roles: cambiarlos queda fuera del alcance
de "editar datos laborales y personales" de EMP-004 — desde P09.4 se hace
con "Editar roles" en la pestaña Datos de la ficha (ADM-17), no en este
formulario.

## Esquemas (`features/employees/schemas.ts`)

Repiten las restricciones del servidor, no las reemplazan:
`0016_hardening.sql` (`employees_dni_format_check`: solo dígitos;
`employees_cuil_format_check`: 11 dígitos si se carga). El legajo se valida
como texto (`^[0-9]+$`, positivo), no con `z.coerce.number()`: el tipo de
entrada y el de salida de `z.coerce` no coinciden, lo que rompe el tipado de
`zodResolver` con `useForm` — se convierte a `number` recién al mapear al
input de `src/api/employees.ts`.
