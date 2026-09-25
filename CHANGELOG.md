# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y este proyecto sigue [Versionado Semántico](https://semver.org/lang/es/) (ADR-020).

## [Sin publicar]

## [0.7.0] - 2026-09-25

Servicios y generación de turnos (F10). El dueño y los administradores cargan los servicios recurrentes de cada cliente y sede, generan los turnos del mes, crean turnos puntuales, cambian su franja y los cancelan con motivo. Trae una migración nueva, `0023_rpc_shifts.sql`.

### Agregado

- RPC de turnos (P10.1, SHIFT-001 a SHIFT-006), en la migración `0023_rpc_shifts.sql`:
  - `create_shift`: turno puntual, con advertencia `HOLIDAY`.
  - `generate_shifts(año, mes)`: idempotente. Respeta días, vigencia, feriados (`works_on_holidays`) y el estado del servicio, del cliente y de la sede.
  - `update_shift_time`: recalcula las ventanas. Si las asignaciones se superponen, devuelve `ASSIGNMENT_OVERLAP` en lugar del `23P01` crudo.
  - `cancel_shift`: motivo obligatorio. Cancela las supervisiones asignadas y conserva las asignaciones.
  - `reload_shift_tasks`.
  - Las funciones que crean turnos copian el checklist vigente: el de la sede y, si no hay, el del cliente.
  - pgTAP de las cinco RPC y de las restricciones y la RLS de `services` (SERVICE-005).
  - Un mes de 240 servicios (5632 turnos) se genera en unos 6 s.
- Servicios recurrentes (P10.2, SERVICE-001 a SERVICE-004, SERVICE-006):
  - ADM-25: alta y edición, con días, franja, dotación, vigencia, "Trabaja los feriados" marcado por defecto (P-050), horas mensuales informativas, estado y notas.
  - Lista de servicios en la ficha del cliente y en la de la sede. Se pueden pausar, reactivar y finalizar.
- Turnos (P10.3, SHIFT-007 a SHIFT-011, SERVICE-008):
  - ADM-05 "Planificación · día", versión mínima: turnos del día con dotación y estado, fecha navegable, actualización cada 30 s si es hoy.
  - ADM-07: turno puntual con aviso de feriado. En la edición solo se cambia la franja: la dotación y las notas llegan en F11, con `update_shift_details`.
  - ADM-09 "Generar turnos del mes": resumen previo y resultado.
  - Diálogo de cancelación con motivo obligatorio.
  - Las acciones se muestran según la capacidad: `generate_shifts` y `cancel_shifts`.
- Pruebas (P10.4, SERVICE-007, SHIFT-012, TEST-007):
  - Suite e2e `tests/e2e-shifts-services/`, que genera un mes reservado y lejano, porque la generación abarca todo el sistema.
  - Casos de empleado y supervisor contra las RPC de turnos en la suite de permisos por API.

### Corregido

- Las suites e2e `e2e-clients-sites` y `e2e-users` fallaban enteras desde el `PasswordInput`: `getByLabel('Contraseña')` también encontraba el botón "Mostrar contraseña".
- `resolveUserId`, de la suite de permisos, solo leía la primera página de usuarios.

## [0.6.0] - 2026-09-24

Empleados y supervisores (F9). El dueño y los administradores dan de alta a empleados y supervisores con su usuario, gestionan su ficha completa, habilitaciones, disponibilidad y licencias, y encuentran a cualquiera desde el buscador global. Sin migraciones nuevas.

### Agregado

- Mostrar u ocultar la contraseña con un ojito en todos los campos de
  contraseña (P08.6, pedido de Mike): componente `PasswordInput`, que arranca
  siempre oculto y anuncia su estado a lectores de pantalla.
- pgTAP de permisos por rol en empleados (P09.1, EMP-013): escrituras de
  `employees`, habilitaciones, disponibilidad y licencias, y vistas por rol.
- Empleados y supervisores (P09.3, EMP-001 a EMP-005): ADM-16 listado con
  filtros por texto, rol, estado efectivo y cliente habilitado; ADM-18 alta
  con usuario (una sola llamada a la Edge Function `create_user`, sin riesgo
  de usuario huérfano) y edición de datos laborales y personales; ADM-17
  ficha con la pestaña Datos completa y baja en dos pasos con motivo
  obligatorio (revoca el acceso primero, después marca `employees.status`).
  `createAdminUser` de `users.ts` ahora acepta datos de empleado opcionales,
  reutilizado por el alta de ADM-18.
- `AvatarUpload` (P09.2, EMP-011): elegir una foto, recortarla en cuadrado
  (arrastre o teclado, con zoom), redimensionarla a 512×512 en el cliente y
  subirla al bucket `avatars`, o quitarla. Foto en el menú de usuario de la
  topbar, el pie de la sidebar, la cabecera del saludo móvil y COM-04.
- `GlobalSearch` (P09.2, EMP-012, CONFIRMADO en P09.0): buscador global de
  la topbar de `AdminShell` (solo dueño y administradores) contra
  `v_search`, agrupado en Empleados, Clientes y Sedes, con atajo `Ctrl K`/`/`
  y navegación por teclado.
- Ficha del empleado (P09.4, EMP-006 a EMP-010, EMP-015, EMP-016): pestañas
  Habilitaciones (clientes puntuales o todos), Disponibilidad (franjas por
  día), Licencias (alta y baja lógica; la ficha muestra "De licencia" con una
  vigente y una superpuesta se traduce a `LEAVE_OVERLAP`), y Próximos turnos,
  Asistencia y Calificaciones con estado vacío hasta F11. "Editar roles"
  empleado/supervisor desde la ficha, preservando dueño y administrador
  (decisión de Mike). ADM-16 muestra por omisión solo activos y de licencia
  (decisión de Mike).
- Suite e2e `tests/e2e-employees/` (P09.5, EMP-014, TEST-006): alta de
  empleado y de supervisor que entran a su vista, doble rol, baja que revoca
  el acceso, licencias, filtro por omisión, buscador global y 390 px sin
  scroll horizontal.
- Documentación: `docs/features/empleados.md` (DOC-009) y la sección de
  empleados de `docs/api.md`.

### Cambiado

- Los diálogos más altos que la pantalla se desplazan por dentro, sin cortar
  los botones.
- Las pestañas que no entran a lo ancho se desplazan dentro de su barra, sin
  generar scroll horizontal de página.
- La política de contenido (`public/_headers`) admite imágenes `blob:` para
  la vista previa del recorte de la foto de perfil.

### Corregido

- Las fechas sin hora (nacimiento, ingreso, baja) se mostraban un día antes
  por la zona horaria; ahora usan `formatCalendarDate`.

## [0.5.0] - 2026-09-24

Clientes y sedes (F8). El dueño y los administradores dan de alta clientes con sus contactos y sedes con ubicación, y las ven en un mapa. Sin migraciones nuevas.

### Agregado

- pgTAP de permisos por rol en clientes, contactos y sedes (P08.1, CLIENT-007,
  SITE-007): lectura por administrador, escritura con y sin capacidades,
  supervisor y empleado sin escritura, y bajas lógicas ocultas para ellos.
- Componentes de mapa `MapView` y `MapPicker` con Leaflet y OpenStreetMap
  (P08.2, SITE-004, SITE-005): marcadores por estado, popup, encuadre
  automático, búsqueda de direcciones con Nominatim (un pedido por acción, uno
  por segundo, limitado a Argentina) y coordenadas opcionales. Leaflet se
  carga en diferido y no entra al bundle inicial.
- Clientes (P08.3, CLIENT-001 a CLIENT-006, CLIENT-009): ADM-19 listado con
  búsqueda y filtro de estado, ADM-20 alta y edición con ubicación, ADM-21
  detalle con sedes, contactos (alta, edición, principal y baja lógica),
  servicios y tareas, y cambio de estado con la explicación de su efecto. CUIT
  repetido traducido a `CUIT_IN_USE`.
- Sedes (P08.4, SITE-001 a SITE-003, SITE-005, SITE-006, SITE-009, SITE-010):
  ADM-23 alta y edición con ubicación y restricciones, ADM-22 detalle con mapa
  y cambio de estado, ADM-24 mapa de sedes con filtro por cliente (pestaña
  "Mapa" de Clientes), y el componente `SiteInfo` para las vistas de empleado
  y supervisor. Nombre repetido traducido a `SITE_NAME_IN_USE`.
- Suite e2e `tests/e2e-clients-sites/` (P08.5, CLIENT-008, SITE-008,
  TEST-005), con el criterio de aceptación de F8 corrido por un
  administrador, acceso denegado a empleado y supervisor, y capturas a 390 px
  sin scroll horizontal.
- Documentación: `docs/features/clientes-y-sedes.md` (CLIENT-010, DOC-008) y
  las secciones `clients` y `sites` de `docs/api.md`.

### Cambiado

- Subtítulos de rutas sin referencias internas (IDs de pantalla ni parámetros
  de URL).

## [0.4.0] - 2026-09-24

Usuarios, roles y configuración (F7). El dueño administra los accesos desde la plataforma, y una persona desactivada pierde el acceso al instante. Incluye la corrección de la restauración de prueba (TEST-024).

### Agregado

- Edge Function `admin-users` (P07.1, USERS-001 a USERS-006): crear usuario,
  resetear contraseña, cambiar email, cerrar sesiones, desactivar (con motivo
  obligatorio) y reactivar. Verifica el JWT y que el perfil de quien actúa
  siga activo, exige el rol o la capacidad de cada acción, respeta la regla
  del último dueño, limita a 10 acciones por minuto por persona
  (`RATE_LIMITED`) y registra cada acción en `security_events`. Un
  administrador nuevo arranca con todas las capacidades activas.
- ADM-27 "Usuarios y roles" (P07.2, USERS-007 a USERS-011): lista de
  usuarios con roles, estado y último inicio de sesión (solo visible para
  el dueño), alta de administradores, editor de roles y capacidades (solo
  dueño) y las acciones por usuario (resetear contraseña, cambiar email,
  cerrar sesiones, desactivar con motivo obligatorio, reactivar), todas
  con sus errores de dominio traducidos en voseo. Primer dominio de
  `src/api/` con datos reales: patrón documentado en `src/api/README.md`
  (módulo por dominio, `ApiError`, hooks de TanStack Query 5 —
  incorporado en este paquete — con `QueryClient` único en
  `src/lib/queryClient.ts`).
- Configuración (P07.3, USERS-012 a USERS-016, DOC-007): ADM-28 Empresa
  (nombre, logo en el bucket `branding`, teléfono de soporte y texto de
  consentimiento de ubicación; el administrador edita solo el logo, que se ve
  en el ingreso y en la barra lateral), ADM-29 Feriados (lista por año, alta,
  baja lógica y "Cargar feriados nacionales de <año>", calculados para
  cualquier año, con los trasladables según la Ley 27.399), ADM-30 Criterios
  de calificación (guía de texto con vigencia y vista "Ver como supervisor") y
  ADM-31 Eventos de seguridad (filtros por tipo, persona y fecha). ADM-29 a
  ADM-31 son solo del dueño.
- ADM-27 muestra por defecto solo los usuarios activos, con el interruptor
  "Mostrar desactivados" (P07.7).
- Pruebas: suite e2e `tests/e2e-users/` del dueño que crea un administrador y
  le ajusta capacidades, la revocación inmediata, los límites del
  administrador, el último dueño y las pantallas de configuración (P07.4,
  USERS-018); tests Deno de `admin-users` con cliente simulado (TEST-004), que
  el CI corre en cada PR (P07.6).

### Cambiado

- Ventana de revocación cerrada (decisión de Mike, 23 sep 2026): las funciones
  de permisos y las políticas de "fila propia" exigen que el perfil siga
  activo (`0020`, `0022`), así que un token vigente de una persona
  desactivada deja de leer y escribir al instante. `jwt_expiry` baja de 3600
  a 900 segundos: quitar un rol tarda como máximo 15 minutos en surtir
  efecto.
- Los errores que no vienen de una RPC propia (restricciones, permisos de
  RLS) se muestran traducidos al español; ya no llega a la pantalla el texto
  crudo de Postgres.
- El menú desplegable base toma el ancho de su contenido, no el del botón que
  lo abre.

### Corregido

- `admin-users` respondía 500 con mensaje vacío al intentar desactivar a
  cualquier dueño (consulta con dos claves foráneas posibles); ahora responde
  `409 LAST_OWNER` con el último dueño, y todo error inesperado sale con un
  mensaje genérico en español (P07.5).
- `service_role` no podía actualizar `profiles` (el trigger de columnas pasa a
  `security definer`, `0020`).
- Los seeds cargaban los feriados trasladables en su fecha literal y omitían
  Güemes; ahora aplican la regla de la Ley 27.399 (P07.5).
- La restauración de prueba desde R2 (TEST-024, INFRA-024): ya no recrea la
  estructura de `public`, carga los datos con `session_replication_role =
replica` (sin superusuario) y borra los usuarios de `auth` antes de fijarlo,
  para que las cascadas no dejen sesiones huérfanas. Se quita la traba de
  `restore-test.yml`.
- Un pgTAP de feriados usaba fechas relativas a hoy y chocaba con los feriados
  reales de App_dev.

## [0.3.0] - 2026-09-23

Primer pase a producción con la aplicación de verdad: base de datos completa (F4), design system (F5) y autenticación real (F6). No hubo una versión 0.2.0 publicada aparte: el hito de F3 + F4 se juntó con este por decisión de Mike (P04.9), porque sin inicio de sesión no tenía sentido publicarlo en `app.`.

Entornos remotos y Auth (F3 · INFRA-010, INFRA-011, INFRA-019, INFRA-023), CI/CD, Sentry y robots de staging (F3 · INFRA-015 a INFRA-017, INFRA-021, INFRA-022), Cloudflare Pages, R2, respaldos y cabeceras de seguridad (F3 · INFRA-012, INFRA-018, INFRA-020), base del design system (F5 · DS-001, DS-002, DS-017), acciones, entradas, selectores, tarjetas y `StatusBadge` (F5 · DS-003 a DS-007), tablas, avatares, avisos, diálogos, timeline y lista de tareas (F5 · DS-008 a DS-012), `AdminShell`, `MobileShell` y el router con `RequireRole` (F5 · DS-013 a DS-015), más el banner "Entorno de prueba" (INFRA-022), y el cierre de F5: marca de la sidebar e íconos PWA desde un PNG temporal, `vite-plugin-pwa` y `/dev/design` completo (F5 · DS-016, DS-018 a DS-020, RESP-001, DOC-005), el cierre de F3 (F3 · DOC-003, INFRA-024, TEST-024), la revisión visual de cierre de F5 (P05.6), el inicio de F4: extensiones, esquema `app` y enumeraciones, con su runner de pgTAP (F4 · DB-001, DB-002, DB-022, TEST-001), la continuación de F4: personas y acceso, hook de Auth y funciones de permisos (F4 · DB-003, DB-004, DB-005, TEST-002), la continuación de F4: configuración y seguridad, clientes y sedes, y empleados (F4 · DB-006, DB-007, DB-008), la continuación de F4: servicios, turnos, asignaciones, checklists, tareas, asistencia, supervisiones y calificaciones (F4 · DB-009, DB-010, DB-011, DB-012), el SMTP de Resend en Auth, con las plantillas de correo en español (F6 · P06.0, más la parte de plantillas de AUTH-005), el registro del inicio de sesión en `security_events` (F6 · P06.1, AUTH-009, más la parte de base de datos de DOC-006), la autenticación real (F6 · AUTH-001, AUTH-002, AUTH-008, AUTH-010, AUTH-011), las pantallas comunes de autenticación (F6 · AUTH-003 a AUTH-007, DOC-006), el aviso de actualización de la PWA (RESP-009, adelantado de F17) y los e2e de autenticación (F6 · AUTH-012, TEST-003).

### Agregado

- SMTP de Resend en Supabase Auth (P06.0, ADR-022): bloque
  `[auth.email.smtp]` en `supabase/config.toml` (host `smtp.resend.com`,
  puerto 587/STARTTLS, remitente `no-reply@extendiendoservicios.com`,
  nombre visible "Extendiendo Servicios", clave desde
  `env(RESEND_API_KEY)`), aplicado a `App_dev` con `supabase config push`
  (verificado sin diferencias pendientes en el `config diff` posterior).
  `auth.rate_limit.email_sent` sube de 2 a 20 por hora, calculado contra el
  plan gratis de Resend (100/día, 3000/mes) y el uso esperable de la Base
  (recuperación de contraseña y cambio de email, unos sesenta usuarios).
  `auth.email.enable_confirmations` declarado en `false`: el alta de
  usuarios (P-011) la hace siempre un administrador con contraseña inicial,
  sin invitación por correo. Override para `App` en
  `[remotes.produccion.auth.email.smtp]`, con clave propia
  (`RESEND_API_KEY_PROD`) sin aplicar todavía (lo aplica Mike cuando F6
  llegue a producción). `supabase/.env.example` nuevo (documenta
  `RESEND_API_KEY` sin su valor). Dos hallazgos de la CLI 2.117.0
  documentados en `docs/environments.md`: `env(...)` solo se resuelve desde
  `supabase/.env` o el entorno del proceso (nunca la raíz del proyecto ni
  `.env.local`), y si la variable falta, `config push` no falla —empuja el
  texto literal `env(NOMBRE)` como valor, dejando Auth sin poder enviar
  correos sin ningún error visible (mismo patrón silencioso que el
  incidente de P04.9).
- Plantillas de los correos de Auth en español con voseo (parte de
  AUTH-005 que asigna ADR-022; las pantallas COM-02 y COM-03 siguen en
  P06.3): `supabase/templates/recovery.html` (recuperación de contraseña,
  la única que se dispara hoy) y `supabase/templates/email_change.html`
  (hoy inactiva, declarada como red), con sus asuntos en
  `[auth.email.template.*]` de `supabase/config.toml`. HTML de correo: CSS
  en línea, maquetado con tablas, sin fuentes ni imágenes externas, legible
  a 360 px y con el fondo declarado en cada celda para los clientes que
  fuerzan modo oscuro. El botón usa `#356A70` en vez del teal de marca
  porque con texto blanco el teal no llega al contraste mínimo. La duración
  del enlace que anuncia el correo sale de `auth.otp_expiry`, no de una
  suposición. `supabase/templates` queda fuera de Prettier
  (`.prettierignore`): reacomoda el espacio en blanco alrededor de los
  elementos en línea y en un correo eso se ve. Aplicadas a `App_dev` y
  verificadas con un correo real recibido en bandeja de entrada.
- Inicio de F4 (P04.1): migración `0001_extensions_and_schema_app.sql`
  (DB-001) con la extensión `btree_gist`, el esquema `app` y sus primeras
  tres funciones —`app.set_updated_at()` (trigger de trazabilidad),
  `app.local_ts(date, time)` (fecha y hora de Argentina a instante UTC,
  `immutable`, ADR-019) y `app.valid_weekdays(smallint[])`— y migración
  `0002_enums.sql` (DB-002) con las 15 enumeraciones de
  `04_Modelo_de_Datos.md` sección 3. Las dos aplicadas en `App_dev`
  (`pnpm db:push`) y con tipos regenerados sin diferencia
  (`src/lib/database.types.ts`). Runner de pgTAP (DB-022, TEST-001):
  `pnpm db:test` (`scripts/db-test.sh`) corre `supabase test db --linked`
  en una máquina de desarrollo o `--db-url "$SUPABASE_DB_URL_DEV"` en CI;
  convención de test por archivo (transacción con `rollback`, extensión
  `pgtap` creada dentro de esa misma transacción, no en una migración)
  documentada en `supabase/tests/README.md`, con los primeros dos tests
  (`0001_extensions_and_schema_app.test.sql`,
  `0002_enums.test.sql`). `docs/database.md` nuevo (convenciones, esquema
  `app`, enumeraciones, cómo escribir una migración y correr pgTAP).
  Los 31 tests pasan contra `App_dev` (`pnpm db:test`, 2 archivos). Para
  que corrieran hubo que agregar dos líneas a cada archivo: con `--linked`
  la CLI entra con el rol temporal `cli_login_postgres`, que es miembro de
  `postgres` pero no hereda sus permisos (`set local role postgres`), y
  las funciones de pgTAP viven en el esquema `extensions`, fuera del
  `search_path` (`set local search_path`). Verificado además que una
  corrida no deja rastro: se desinstaló `pgtap` de `App_dev`, se corrió
  `pnpm db:test` y al terminar la extensión volvió a no estar (la CLI la
  instala y la desinstala alrededor de la corrida).
- Continuación de F4 (P04.2): migración
  `0003_profiles_roles_capabilities.sql` (DB-003, DB-004, DB-005) con las
  tablas `profiles`, `user_roles` y `admin_capabilities` (RLS habilitada
  de entrada, sin políticas todavía: llegan en `0012`, DB-014), el trigger
  `app.handle_new_user()` sobre `auth.users`, el trigger "último owner"
  (`app.prevent_last_owner_removal()`, código `LAST_OWNER`), las funciones
  de permisos (`jwt_roles`, `jwt_capabilities`, `has_role`, `is_admin`,
  `has_capability`, `require_role`, `require_admin`, `require_capability`,
  todas con `search_path` fijo desde que nacen) y el hook de Auth
  `app.custom_access_token_hook` (agrega los claims `roles`/`capabilities`
  al JWT; `security definer` porque `supabase_auth_admin` no tiene
  `bypassrls` y las tablas que lee ya tienen RLS habilitada). Hook
  habilitado en `supabase/config.toml`
  (`[auth.hook.custom_access_token]`) y aplicado a `App_dev` con
  `supabase config push` (comando documentado en `docs/environments.md`
  para cuando corresponda aplicarlo a `App`, con la advertencia de orden:
  primero la migración, después el `config push`, o se corta el login de
  producción). `tests.as_user(email)` (TEST-002): fixture de pgTAP que
  simula una sesión autenticada fijando `request.jwt.claims` con los
  claims que arma el propio hook; documentado en
  `supabase/tests/README.md`. 96 tests pgTAP pasan contra `App_dev`
  (`pnpm db:test`, 4 archivos); tipos regenerados sin diferencia.
- Continuación de F4 (P04.3): migraciones
  `0004_company_holidays_security_events.sql` (DB-006),
  `0005_clients_sites.sql` (DB-007) y `0006_employees.sql` (DB-008) — los
  maestros: `company_settings` (singleton `id = 1`), `holidays`,
  `security_events` con `app.log_security_event(...)` (uso interno, sin
  `execute` para `authenticated`/`anon`); `clients`, `client_contacts`
  (un solo contacto principal por cliente, índice único parcial) y
  `sites` (nombre único por cliente, `unique (id, client_id)` para las
  FK compuestas que van a agregar `services`/`shifts` en `0007`);
  `employees` (secuencia `employee_number_seq`, editable),
  `employee_client_permissions`, `employee_availability` (check
  `end_time > start_time`) y `employee_leaves` (check
  `ends_on >= starts_on` y restricción de exclusión sobre el rango de
  fechas con `btree_gist`, acotada a `deleted_at is null` para que una
  licencia corregida no siga bloqueando su rango). RLS habilitada en las
  diez tablas desde que nacen, sin políticas todavía (llegan en `0012`,
  DB-014). Tres decisiones menores documentadas en `docs/database.md`:
  `status` de `clients`/`sites`/`employees` nace en `'active'` por
  defecto (el modelo no lo anota); `security_events.actor_id`/
  `target_id` referencian `profiles.id` igual que `user_roles.granted_by`
  en `0003`; ningún `check` de formato para `cuit`/`dni` (el modelo los
  describe en prosa, no como `check`, a diferencia de, por ejemplo, el
  rango horario de `employee_availability`). Las tres migraciones
  aplicadas en `App_dev` (`pnpm db:push`) y tipos regenerados sin
  diferencia. 219 tests pgTAP pasan contra `App_dev` (`pnpm db:test`, 7
  archivos).
- Continuación de F4 (P04.4): migraciones `0007_services_shifts_assignments.sql`
  (DB-009), `0008_checklists_tasks.sql` (DB-010), `0009_attendance.sql`
  (DB-011) y `0010_supervisions_ratings.sql` (DB-012) — el corazón de la
  operación: `services` (días de la semana con `app.valid_weekdays`,
  franja, dotación 1..10, vigencia, `works_on_holidays` default `true`);
  `shifts` (columnas generadas `starts_at`/`ends_at` con `app.local_ts`,
  verificado sin horario de verano en enero y julio, ADR-019; unicidad
  parcial `(service_id, shift_date)` donde un turno cancelado sigue
  bloqueando el día pero uno dado de baja lógica lo libera, ADR-010;
  campos de cancelación con `check` de conjunto); `assignments` (franja
  propia opcional, columnas denormalizadas `shift_date`/`"window"` —
  entre comillas porque `window` es palabra reservada de SQL — mantenidas
  por el trigger `app.sync_assignment_window` tanto al insertar/editar la
  asignación como al cambiar la franja del turno; restricción de
  exclusión `assignments_no_overlap` con `btree_gist`, P-053, verificada
  con turnos que se pisan, adyacentes, con franja propia que evita el
  cruce y con una asignación quitada que libera el rango; unicidad
  parcial `(shift_id, employee_id)` independiente de la exclusión).
  `checklist_templates` (una por cliente y una por sede como máximo,
  ADR-011) y `checklist_template_items` (unicidad `(template_id,
position)` deferrable, para reordenar dos ítems en un solo `update`);
  `shift_tasks` (copia del checklist en el turno, `not_done` exige
  motivo); FK `shifts.checklist_template_id -> checklist_templates`
  agregada acá porque esa tabla no existía todavía en `0007`.
  `attendance_records` (`unique (assignment_id, kind)`, `reason`
  obligatorio si `source = admin`, ADR-009) y `attendance_notices`
  (`minutes_late` 1..600 obligatorio si `kind = delay`, `reason_code`
  obligatorio si `kind = absence`, `reason_text` obligatorio si
  `reason_code = other`, varios avisos por asignación). `supervisions`
  (unicidad parcial `(shift_id, supervisor_id)` entre las no canceladas,
  P-086), `supervision_attendance`, `ratings` (`score` 1..5, `unique
(supervision_id, assignment_id)`) y `rating_criteria`. Completan la
  sección 5 del modelo: `app.current_employee_id()`, `app.shares_shift`
  (en `0007`, ya existían `employees`/`shifts`/`assignments`) y
  `app.supervises_shift` (en `0010`, recién con `supervisions`), las tres
  `security definer` por el mismo motivo que el hook de `0003`. RLS
  habilitada en las trece tablas desde que nacen, sin políticas todavía
  (llegan en `0012`, DB-014). Decisiones menores documentadas en
  `docs/database.md`: `services.site_id`/`shifts.site_id not null`;
  `works_on_holidays`/`checklist_templates.name`/varias columnas
  `position` sin anotación explícita del modelo pero tratadas como
  `not null` por consistencia; un `check` propio de franja en
  `assignments` que en la práctica queda de respaldo porque el
  constructor de `tstzrange` del trigger ya rechaza antes una franja
  invertida (`22000`); el `update` del trigger al cambiar el turno no
  filtra `removed_at is null` (recalcula también asignaciones quitadas,
  sin efecto en ninguna regla vigente). Las cuatro migraciones aplicadas
  en `App_dev` (`pnpm db:push`) y tipos regenerados sin diferencia. 439
  tests pgTAP pasan contra `App_dev` (`pnpm db:test`, 12 archivos).
- Cierre de F3 (P03.7): `.github/workflows/restore-test.yml`
  (`workflow_dispatch` con confirmación `restaurar-app-dev`, sin correr
  todavía — se dispara recién con las tablas de F4, TEST-024).
  `docs/environments.md`/`docs/deployment.md`/`README.md` puestos al día:
  se activaron los tres interruptores de despliegue, primer respaldo real
  verificado, `dev.`/`app.` sirviendo desde Cloudflare Pages con GitHub
  Pages desactivado, el pase `develop → main` con merge commit, el límite
  de `workflow_dispatch` a la rama por defecto, la cuenta de Sentry ya
  creada, y la guía clic por clic de INFRA-024 (avisos de uso de Supabase y
  de fallos de workflows).
- Corrección de P03.7 (decisión de Mike, 19 sep 2026): la restauración de
  prueba ahora repone en `App_dev` el esquema `public` **más los usuarios
  de auth** (`auth.users`, `auth.identities`, lo mínimo para que las
  referencias de `public` hacia `auth.users` cierren) y **borra todo lo
  restaurado antes de terminar** (siempre, incluso si algo falla a mitad de
  camino), porque `dev.` sirve desde `App_dev` y no es un entorno seguro
  mientras esos usuarios sigan ahí. `scripts/restore-from-r2.sh` reescrito:
  verifica que `App_dev` tenga las mismas migraciones que el volcado antes
  de tocar nada (`supabase_migrations.schema_migrations`); restaura `public`
  en tres secciones (`pre-data`/`data`/`post-data`, aprovechando que
  PostgreSQL deja las claves foráneas para `post-data`) para no depender de
  ningún orden entre tablas; agrega el modo `--confirmar-vacio`; nunca
  imprime contenido de ninguna tabla, solo conteos. `restore-test.yml` suma
  un paso `if: always()` que corre ese modo como segunda confirmación,
  independiente de la limpieza del propio script. `docs/deployment.md`
  sección 6.3 registra las dos decisiones con su motivo (en vez de la
  pregunta pendiente de la entrega anterior) y cómo volver a cargar datos
  de prueba después. Sin confirmar: si el rol `postgres` (Session pooler)
  tiene privilegios reales de `INSERT`/`DELETE` sobre `auth.users`/
  `auth.identities` — la documentación pública de Supabase no lo dice
  (dice que `postgres` "has admin privileges" pero recomienda no escribir
  en `auth.users` a mano); queda una consulta de solo lectura para que
  Mike lo confirme antes de la primera corrida real.
- Marca de la sidebar e íconos PWA (DS-018, PNG temporal — decisión de
  Mike del 19 sep 2026 de recortar el isotipo del PNG original en vez de
  esperar el vectorial IF-08; deuda **DS-020** registrada en
  `docs/design-system.md` para cuando llegue): `public/icons/` con los
  recortes que preparó el orquestador desde `Images/` (isotipo blanco a
  34 px con `@2x`/`@3x`, íconos
  PWA 192/512/512 maskable y `apple-touch-icon` 180, todos copiados tal
  cual, sin redibujar ni recolorear). Sidebar de `AdminShell`
  (`AdminSidebar`) reemplaza el lockup completo de P05.4 por el patrón de
  `07` sección 1.5/`Mockup/png/D01.png`: isotipo de 34 px + lockup de
  texto "EXTENDIENDO / SERVICIOS" (dos líneas, 12.5 px/700/mayúsculas/
  tracking 1.3 px) con una regla de 26×2 px debajo, colapsada a solo el
  isotipo, y sin nombres accesibles duplicados (`alt=""` en la imagen
  cuando el texto es visible, `alt="Extendiendo Servicios"` cuando no).
  `index.html`: `apple-touch-icon` al ícono de 180 y `theme-color` al teal
  de marca `#569EA4`, igual que el manifest (antes, `#0E1017` de la
  portada oscura).
  `public/logo.png`/`favicon.png` no se tocan (los sigue usando la
  portada, el 404 y el `og:image`).
- `vite-plugin-pwa` 1.3.0 (RESP-001, P-089): manifest (`name`/`short_name`/
  `description`/`lang: 'es-AR'`/`start_url`/`scope: '/'`/
  `display: 'standalone'` — "pantalla completa" sin la barra del
  navegador, no `fullscreen`, que ocultaría además la barra de estado del
  celular — `theme_color`/`background_color: '#569EA4'`, íconos 192/512
  `purpose: 'any'` + 512 `purpose: 'maskable'`), service worker
  (`strategies: 'generateSW'`) con precache exclusivo del build
  (`globPatterns` de JS/CSS/HTML/fuentes/íconos, sin `runtimeCaching`:
  ninguna llamada a Supabase, Nominatim ni OpenStreetMap se cachea) y
  `navigateFallback: '/index.html'` para la SPA.
  `registerType: 'prompt'` sin ninguna interfaz todavía (decisión del
  orquestador: el service worker nuevo queda esperando —
  `skipWaiting`/`clientsClaim` nunca se llaman solos, verificado en
  `dist/sw.js` — y se activa recién cuando se cierran todas las pestañas,
  para no interrumpir a un empleado fichando; el aviso "hay una versión
  nueva" es RESP-009, F17). `devOptions.enabled: false`: sin service
  worker en `pnpm dev`. Verificado que `/dev/*` no queda en el precache
  (`pnpm build` + `grep` sobre `dist/sw.js`), y con Playwright contra
  `pnpm preview` que el service worker se registra (`state: 'activating'`
  en la primera instalación) y el manifest se lee
  (`content-type: application/manifest+json`) sin errores de consola.
- `public/_headers` (INFRA-018, de infra-devops — este paquete solo
  agregó las reglas de caché, sin tocar el resto): dos bloques nuevos,
  `/sw.js` y `/manifest.webmanifest`, con `Cache-Control: no-cache` (sin
  hash de contenido en el nombre de archivo, a diferencia de
  `dist/assets/*`, así que sin esto un CDN o el navegador podrían
  quedarse con una copia vieja y una actualización del build no llegaría
  nunca a una app ya instalada). Verificado con `wrangler pages dev` que
  las dos rutas combinan este `Cache-Control` con las cabeceras de
  seguridad del bloque `/*` existente (CSP, HSTS, etc.), sin perder
  ninguna.
- `/dev/design` completo (DS-016): `DropdownMenu` ("más acciones" de una
  fila y menú de usuario de la sidebar), `Drawer`/`Sheet` (452 px a la
  derecha, cabecera/cuerpo con scroll/pie a ancho completo — hasta ahora
  solo se veía el `Sheet side="bottom"` del menú "Más"), `ActionBar`
  (ejemplo de M16 dentro del contenedor móvil de 390 px) y
  `StagingBanner` (con una réplica estática al lado, porque el componente
  real solo se ve con `VITE_APP_ENV=staging`). Inventario completo contra
  `07` sección 2 en el reporte del encargo.
- `docs/design-system.md` (DS-019/DOC-005): documento cerrado de F5 —
  secciones nuevas de marca (DS-018/DS-020) y PWA (RESP-001) con el
  detalle de cada decisión, inventario de `/dev/design` (DS-016) y ajuste
  de las notas de P05.4 que quedaban desactualizadas.

- Shells y router (DS-013 a DS-015, P05.4): `AdminShell`
  (`src/app/shells/AdminShell.tsx`) con sidebar teal de 236 px (las ocho
  secciones de P-121, colapsa a íconos de 60 px entre 1024 y 1279 px con
  `Tooltip`, tabbar inferior por debajo de 1024 con un menú "Más" en
  `Sheet` para el resto de las secciones), topbar con menú de usuario
  (`DropdownMenu`, agregado en este paquete) y punto de extensión para el
  buscador global (P09.0, sin ningún input real todavía); `MobileShell`
  (`src/app/shells/MobileShell.tsx`) para empleado y supervisor, con
  cabecera de saludo o navbar de subpágina según la ruta, tabbar propio de
  cada rol (con el `Fab` "Fichar" integrado en el de empleado) y
  `ActionBar` (`src/app/shells/ActionBar.tsx`) para las acciones al pie de
  una subpágina. Router (`src/app/router.tsx`, `src/app/routes/*`) con las
  51 rutas de `05_Pantallas_y_Navegacion.md` sección 5 como placeholders
  (título, `screenId` y "Pantalla en construcción."), un `RequireRole`
  (`src/features/auth/RequireRole.tsx`) por grupo (`/admin`, `/app`,
  `/sup`, y `/perfil` con el shell según el rol) sobre una sesión
  provisoria (`src/features/auth/session.ts`) que P06.2 reemplaza sin
  tocar rutas ni shells (ver `docs/design-system.md`), 404 con la marca
  (`src/pages/common/NotFoundPage.tsx`) y `AdminShell`/`MobileShell`
  detrás de `React.lazy` para que el celular no baje el código de
  administración (ni viceversa).
- `/dev/rol` (solo en desarrollo, mismo patrón que `/dev/design`): simula
  un rol (dueño, administrador, empleado, supervisor, o empleado y
  supervisor a la vez) para recorrer los shells antes de que exista
  AUTH-002; se guarda en `localStorage`
  (`src/features/auth/devRole.ts`). Ni la página ni la clave de
  `localStorage` quedan en `dist/` (verificado con `pnpm build` + `grep`
  sobre el bundle).
- `StagingBanner` (`src/components/StagingBanner.tsx`, INFRA-022): franja
  "Entorno de prueba…" (`role="status"`) cuando `VITE_APP_ENV=staging`,
  montada una sola vez en `RootLayout` (`router.tsx`) para que la vean
  todos los layouts, portada incluida, sin tocar cada uno por separado.
  Nunca en `production` ni en `local`.
- Tests de Testing Library para `RequireRole` (sin sesión, rol de otra
  vía, sin ningún rol, rol correcto, más de un rol a la vez), `AdminShell`
  (colapso de la sidebar y aparición del tabbar según el ancho, mismo
  criterio de `matchMedia` simulado que P05.3) y `StagingBanner` (los tres
  entornos). E2e nuevo
  (`tests/e2e/protected-route-redirect.spec.ts`): una ruta protegida sin
  sesión termina en `/ingresar` para `/admin`, `/app` y `/sup`.

- Acciones (DS-003): `Button` restyleado (`variant`: `primary`/`ghost`/
  `dark`/`destructive`/`link`; `size`: `sm`/`md`/`mobile`; ícono a la
  izquierda; estado `loading` con spinner, deshabilita y lo informa a
  lectores de pantalla), `IconButton` (34×34) y `Fab` ("Fichar", 46 px,
  elevado -14 px sobre la tabbar).
- Entrada (DS-004): `Input`/`Textarea` restyleados (ícono, `error`,
  variante `mobile`), `Select` restyleado, `Combobox` con búsqueda (sobre
  `command` + `popover`), `Switch`/`Checkbox`/`RadioGroup` restyleados y
  `ToggleRow` (fila de toggle con título y ayuda).
- Selección y fecha/hora (DS-005): `SegmentedControl` (con variante móvil y
  opción crítica en rojo, patrón ARIA `radiogroup`/`radio` con teclado),
  `OptionCard`, `Stepper`, `WeekdayPicker` (`0` = domingo), `TimeInput` y
  `DatePicker`/`MonthPicker` en español con la semana desde el lunes.
- Presentación (DS-006): `Card` restyleado (`CardHeader`, variantes
  `flush` y `hero`), `KpiCard` (`accent`/`ok`/`warn`/`crit`), `EmptyState`
  y `ProgressBar` (`ok`/`warn`).
- Estados (DS-007): `StatusBadge` y el mapa único de estados en
  `src/components/status/` (`07` sección 3 completa, con los derivados
  `uncovered`/`upcoming`/`no_record`/`early_leave` y el sufijo "· n min"),
  más el helper de filas de tabla `crit`/`warn`.
- `/dev/design` (adelanto parcial de DS-016): vidriera de los componentes
  de este paquete con sus variantes y estados, solo en desarrollo
  (`import.meta.env.DEV`, no queda en el build de producción).
- Tests de Testing Library para `Button` (loading), `StatusBadge` (mapeo
  completo y sufijo de minutos), `SegmentedControl` (teclado y ARIA),
  `Stepper` (límites) y `WeekdayPicker` (valor y orden).
- `afterEach(cleanup)` en `src/test/setup.ts`: sin `test.globals` en
  Vitest, `@testing-library/react` no encontraba un `afterEach` global del
  que colgar su limpieza automática entre tests, y el DOM de cada
  `render()` se acumulaba dentro del mismo archivo. No afectaba a los
  tests existentes (uno por archivo) pero rompía cualquier suite con más
  de un `it()`, como las de este paquete.
- Corrección de un bug heredado de DS-002: los componentes shadcn
  (`checkbox`, `switch`, `radio-group`) usaban clases `data-checked:`
  asumiendo un atributo booleano que Radix nunca agrega (la versión
  instalada usa `data-state="checked"`), así que el estado marcado nunca
  se veía. Se corrigió a `data-[state=checked]:` en los tres, más
  `OptionCard`.
- Tokens nuevos en `tokens.css`: `--r-xs` (radio de `Checkbox`),
  `--primary-200`, `--sh-hero` y `--ring-soft` (ver `docs/design-system.md`
  para el detalle de cada uno).
- Proyecto de Cloudflare Pages `extendiendoservicios-app` (cuenta
  `extserviciosapp@gmail.com`, sin proyecto de Git conectado: el build lo
  hace GitHub Actions) y bucket R2 privado `es-backups` (clase Standard, sin
  acceso público, con las reglas de ciclo de vida `retencion-diaria` —30
  días, prefijo `diarios/`— y `retencion-mensual` —370 días, prefijo
  `mensuales/`—), creados con `wrangler` (INFRA-012, INFRA-020).
- `scripts/backup-to-r2.sh`: `pg_dump --format=custom` de `App` → cifrado
  simétrico con `gpg` (AES256, `BACKUP_PASSPHRASE`) → subida a R2 por su API
  S3, con el prefijo de retención (`diarios/`/`mensuales/`) según el día.
  Instala un cliente de PostgreSQL 17 desde el repositorio oficial (PGDG) si
  el runner no lo trae, porque los proyectos de Supabase corren Postgres
  17.6. El volcado sin cifrar nunca se sube ni queda en disco más que en un
  directorio temporal que se borra siempre (`trap`). Lo reutilizan
  `.github/workflows/backup.yml` (cron diario 03:00 Argentina, más
  `workflow_dispatch`, detrás del interruptor `BACKUP_ENABLED`) y el volcado
  previo obligatorio de `deploy-production.yml` antes de cualquier
  migración en producción (ADR-015), al que se le agregó el secreto
  `CLOUDFLARE_ACCOUNT_ID` que le faltaba para poder armar el endpoint de R2
  (INFRA-018).
- `scripts/restore-from-r2.sh`: baja un respaldo de R2, lo descifra y lo
  restaura con `pg_restore --clean --if-exists` **solo en `App_dev`** (nunca
  lee ninguna variable de producción); exige el argumento de confirmación
  `restaurar-app-dev` y, si la terminal es interactiva, una segunda
  confirmación escrita. Paso a paso y advertencias en `docs/deployment.md`;
  la restauración real sobre un proyecto remoto queda para P03.7 (TEST-024).
- `public/_headers`: `Strict-Transport-Security`, `X-Content-Type-Options`,
  `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy` (solo
  geolocalización propia, el resto de las funciones sensibles en cero) y
  `Content-Security-Policy` con `connect-src`/`img-src` acotados a los dos
  proyectos de Supabase, la ingesta de Sentry (región UE), Nominatim y los
  tiles de OpenStreetMap (`03` sección 3.6, ADR-016, ADR-017). `style-src
'self' 'unsafe-inline'`: comprobado con Playwright contra un build real
  que sonner (`Toaster`) necesita `'unsafe-inline'` para su hoja de estilos
  inyectada por `document.createElement('style')`, mientras que el
  posicionamiento de Radix/Floating UI no lo necesita (usa CSSOM, no el
  atributo `style`). `deploy-staging.yml` ahora inserta
  `X-Robots-Tag: noindex` dentro del mismo bloque `/*` de `dist/_headers` en
  vez de sobrescribirlo (INFRA-018, INFRA-022).
- `.github/workflows/ci.yml`: un solo job (`CI`, nombre estable para la
  futura protección de ramas) en cada Pull Request a `develop` o `main` con
  `pnpm install --frozen-lockfile`, lint, typecheck, `format:check`, test,
  build y Playwright (solo `chromium`, contra el build local; navegadores
  instalados en el runner en cada corrida). Los pasos de `db:types --check`
  y pgTAP quedan escritos pero condicionados a que exista al menos una
  migración o un test de base (`supabase/migrations/`, `supabase/tests/`):
  se saltean con un mensaje explícito mientras F4 no los agregue (INFRA-015).
- `.github/workflows/deploy-staging.yml` (push a `develop`) y
  `.github/workflows/deploy-production.yml` (push a `main`, con el
  environment `production` y revisor Mike): `db push` y `functions deploy`
  de `admin-users` condicionados igual que en CI; build con las variables
  del entorno correspondiente; despliegue a Cloudflare Pages con
  `pnpm exec wrangler pages deploy`; smoke test de Playwright contra la URL
  publicada. Producción exige además un volcado previo de `App` a R2
  (ADR-015) que falla a propósito si `scripts/backup-to-r2.sh` no existe
  todavía (pendiente de P03.4), y no crea la etiqueta de versión (la crea
  el orquestador). Ninguno de los dos hace nada remoto todavía: ambos
  workflows completos quedan detrás de las variables de repositorio
  `STAGING_DEPLOY_ENABLED`/`PRODUCTION_DEPLOY_ENABLED` (INFRA-016,
  INFRA-017).
- `@sentry/react` inicializado en `src/lib/sentry.ts`, llamado desde
  `main.tsx`: no hace nada sin `VITE_SENTRY_DSN` (test en
  `src/lib/sentry.test.ts`); con DSN, `environment` = `VITE_APP_ENV`,
  `release` = la versión de `package.json`, `sendDefaultPii: false`, sin
  Session Replay ni tracing. `vite.config.ts` agrega `@sentry/vite-plugin`
  solo si hay `SENTRY_AUTH_TOKEN`: sube los source maps a la región UE de
  Sentry (`url: 'https://de.sentry.io/'`, organización
  `extendiendo-servicios`) y los borra de `dist/` en el mismo paso del
  build (`sourcemaps.filesToDeleteAfterUpload`, verificado incluso cuando
  la subida falla); una falla al subir no bloquea el build
  (`errorHandler`). Sin el token, no se generan `.map` en absoluto
  (INFRA-021).
- `public/robots.txt` con `Disallow: /` en los tres entornos: la
  aplicación es una herramienta interna con login, no un sitio público
  (recomendación justificada en el reporte del encargo, no una decisión
  cerrada). `deploy-staging.yml` además agrega la cabecera
  `X-Robots-Tag: noindex` generando `dist/_headers` en el propio build
  (INFRA-022).
- `packageManager` fijado en `package.json` (`pnpm@12.4.2`) para que
  `corepack enable` resuelva la misma versión de pnpm en cualquier
  máquina y en los tres workflows nuevos, sin repetirla a mano.
- `docs/deployment.md` (primera versión, DOC-003): los cinco workflows,
  qué dispara cada uno, los interruptores de despliegue, la aprobación
  manual de producción, el rollback (`03` sección 16) y los secretos que
  usa cada workflow.
- `docs/environments.md`: nota sobre `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_ANON_KEY` y `VITE_SENTRY_DSN` como secretos de GitHub
  (no solo variables de Pages), porque el build lo hace GitHub Actions y
  no el build integrado de Cloudflare Pages.

- `App_dev` vinculado (`supabase link --project-ref anesttvrnpsaaaxaquce`);
  `supabase/config.toml` con `project_id` significativo y `major_version = 17`
  verificado contra los proyectos remotos (INFRA-010).
- Configuración de Auth versionada en `supabase/config.toml`: sin registro
  público, contraseña mínima de 8 caracteres, JWT de 1 hora, sesión
  persistente sin expiración por tiempo ni por inactividad, `site_url` y
  URLs de redirección de `App_dev`, y un bloque `[remotes.produccion.auth]`
  con los valores de `App` listo para cuando Mike decida aplicarlo
  (INFRA-011). Aplicado hoy solo en `App_dev` con `supabase config push`.
- `.github/workflows/keepalive.yml`: consulta semanal (`select 1`, más
  `workflow_dispatch`) a `App_dev` por el Session pooler, para evitar la
  pausa por inactividad del plan sin cargo (INFRA-019).
- `docs/environments.md`: entornos, cuentas con sus refs de proyecto, tabla
  de variables y secretos, cómo vincula cada desarrollador y los comandos
  preparados para que Mike cargue los secretos de GitHub (INFRA-023).
- `wrangler` como dependencia de desarrollo (`pnpm exec wrangler`), con los
  scripts de instalación de `esbuild` y `workerd` habilitados en
  `pnpm-workspace.yaml` (los únicos que necesita para funcionar).
- Tokens del design system en `src/styles/tokens.css` (color, foco, radios,
  sombras y contenedores de `07_Design_System.md` sección 1), mapeados a las
  variables que espera shadcn/ui y a la paleta de Tailwind CSS 4 (`@theme`,
  ADR-021), con breakpoints `sm` 480, `md` 768, `lg` 1024, `xl` 1280
  (DS-001).
- Tailwind CSS 4 con `@tailwindcss/vite`, y Inter self-hosted en
  `public/fonts/` (pesos 400/500/600/700, subset latin,
  `font-display: swap`, sin Google Fonts en runtime) (DS-001).
- shadcn/ui sobre Radix, con `components.json` y los componentes base
  (button, input, select, dialog, sheet, table, tabs, badge, alert, field
  —reemplazo de `form`—, calendar, popover, command, avatar, skeleton,
  sonner, tooltip, switch, checkbox, radio-group) en `src/components/ui/`,
  conectados a los tokens (DS-002).
- Utilidades de formato de fecha, hora y duración en español de Argentina,
  con zona fija `America/Argentina/Buenos_Aires` (`src/lib/format.ts`,
  ADR-019, DS-017).
- `docs/design-system.md` (DOC-005, en curso).
- `DataTable` sobre TanStack Table 8 (`src/components/DataTable.tsx`,
  DS-008): encabezado y celdas de `07` sección 2.3, variante `compact`,
  ordenamiento por columna, paginación por rango controlada desde afuera
  (`pagination`/`onPaginationChange`/`pageCount`/`rowCount`), filas
  `crit`/`warn` con el helper de `src/components/status`, estado de carga
  con `Skeleton` y estado vacío con `EmptyState`. Por debajo de 1024 px
  (`05` sección 7) se renderiza como una lista de `RowCard`, con
  `meta.card`/`meta.cardLabel` por columna definiendo qué muestra la
  tarjeta — ver `useMediaQuery` (`src/hooks/useMediaQuery.ts`), nuevo.
  `ui/table.tsx` restyleado (encabezado `#FAFBFC`, mayúsculas 10 px,
  celdas 12 px).
- `Avatar` (`src/components/Avatar.tsx`) de 28 px con foto o iniciales,
  sobre los seis colores fijos del mockup asignados por hash
  determinístico del id (DJB2), y `PersonCell` (nombre 600 + subtítulo
  11 px) (DS-009). `ui/avatar.tsx` restyleado a un único tamaño real
  (`default` 28 px / `compact` 26 px, en vez de los `default`/`sm`/`lg`
  genéricos de shadcn).
- `Alert` restyleado con las variantes `crit`/`warn`/`info` de `07`
  sección 2.3, colores exactos de `.a-crit`/`.a-warn`/`.a-info`
  (`ds.css`); `ConfirmDialog` (`src/components/ConfirmDialog.tsx`),
  diálogo de confirmación con motivo obligatorio (botón de confirmar
  deshabilitado mientras el motivo esté vacío, motivo devuelto recortado
  en `onConfirm`) — reutilizable para cancelar turno, quitar asignación y
  cerrar asignación (SHIFT-011) (DS-010).
- `Timeline` (puntos `pending`/`on`/`ok`/`crit`), `Tabs` restyleado
  (subrayado teal de 2 px, se simplifica a esa única variante — la
  variante "píldora" ya la cubre `SegmentedControl`), `Breadcrumb`
  restyleado (agregado con la CLI de shadcn), `Tooltip` restyleado (fondo
  `--dark`, 11 px, con los tres estados reales de Radix:
  `delayed-open`/`instant-open`/`closed`) (DS-011).
- `TaskList`/`TaskItem` (`src/components/TaskList.tsx`,
  `TaskItem.tsx`, DS-012): casilla de 22 px con los cuatro estados de
  `shift_tasks.status`, variante `done` atenuada, variante "next"
  resaltada (calculada por `TaskList`: la tarea `in_progress`, o si
  ninguna lo está, la primera `pending`), "no realizada" con motivo
  obligatorio (reutiliza `ConfirmDialog`), etiqueta "Opcional" cuando
  `is_required` es falso (P-059), modo solo lectura (sin acciones, sin
  callbacks), objetivo táctil de 44 px en la casilla sin cambiar su
  tamaño visual. No llama a ninguna API: solo avisa por callback.
- `/dev/design` completado con ejemplos realistas de la Base: una
  `DataTable` de "Servicios de hoy" con estados mezclados (incluida una
  fila `crit` — sin registro — y una `warn` — salida anticipada), una
  `TaskList` interactiva y otra solo lectura (checklist de M10), una
  `Timeline` de una asignación, los seis colores de `Avatar`, `Alert` con
  las tres variantes, disparadores de `Toast` y de `ConfirmDialog`, y
  `Tabs`/`Breadcrumb`/`Tooltip`/`Skeleton`. `<Toaster />` montado una sola
  vez en `main.tsx`.
- Tests de Testing Library para `DataTable` (ordenamiento, paginación por
  rango y el cambio a `RowCard` por debajo de 1024 px, simulando
  `window.matchMedia`), `Avatar` (hash estable, fallback a iniciales),
  `ConfirmDialog` (confirmar deshabilitado sin motivo, motivo devuelto
  recortado) y `TaskItem` ("no realizada" exige motivo, solo lectura no
  dispara callbacks, etiqueta "Opcional", atenuado con hora de
  finalización).
- Registro del inicio de sesión en `security_events` (P06.1, AUTH-009,
  P-104): migración `0019_security_events_sign_in.sql` con
  `app.log_sign_in()` (trigger `security definer` sobre
  `after insert on auth.sessions`) y el trigger `trg_log_sign_in`. Se
  confirmó en vivo contra `App_dev`, entre las dos alternativas que
  dejaba abiertas `06_API.md` sección 1, que el trigger sobre
  `auth.sessions` (en vez de una Edge Function `log-sign-in`) es viable:
  el rol de las migraciones puede crearlo, la tabla trae `ip` como
  esperaba el plan, y un login real seguido de un refresco de token
  mostró que cada sesión nueva es un `insert` (dispara el evento una vez
  por inicio de sesión real) mientras que el refresco solo actualiza la
  fila existente (no duplica el evento). Lo central de la tarea: un
  fallo al registrar el evento no puede cortar el login -- `app.
log_sign_in()` envuelve la llamada a `app.log_security_event(...)`
  (0004) en su propio `exception when others`, así que aunque
  `security_events.actor_id` no encuentre la fila de `profiles`
  correspondiente (u ocurra cualquier otro error, presente o futuro), el
  `insert` en `auth.sessions` -- y con él, el login -- se completa
  igual; se deja un `raise warning` en los logs de Postgres para poder
  detectarlo. Probado con pgTAP
  (`supabase/tests/0019_security_events_sign_in.test.sql`, 12
  aserciones: estructura, camino feliz con `ip`/`details.session_id`,
  que un refresco simulado no duplica el evento, camino de fallo sin
  `profile` que no revienta el `insert`, y que la función no se puede
  invocar directamente) y verificado con un login real contra una cuenta
  del seed (`andrea.rios@extendiendoservicios.com`), con la fila de
  prueba y la sesión limpiadas después. Documentado en
  `docs/database.md` (parte de base de datos de DOC-006, ya que
  `docs/security.md` todavía no existe -- llega completo en F6 con las
  pantallas de Auth).
- Autenticación real (P06.2, AUTH-001, AUTH-002, AUTH-008, AUTH-010,
  AUTH-011): cliente de Supabase tipado (`persistSession`,
  `autoRefreshToken`), `AuthProvider`/`useAuth` (sesión, perfil, roles y
  capacidades desde los claims del JWT, `signOut`, `refreshProfile`) y
  `RequireRole` sobre esos claims. `devRole.ts` borrado: `/dev/rol` pasa a
  hacer un login real contra una cuenta del seed y sigue fuera de `dist/`.
- Pantallas comunes de autenticación (P06.3, AUTH-003 a AUTH-007,
  DOC-006): COM-01 Ingreso (logo y teléfono de soporte desde
  `v_public_branding`), COM-02 Recuperar, COM-03 Restablecer, COM-04
  Perfil propio y COM-05 Sin acceso; `/` redirige según sesión y rol, y
  `authErrors.ts` traduce los errores de Auth al español sin delatar qué
  emails tienen cuenta.
- Aviso de actualización de la PWA (RESP-009, adelantado de F17):
  `PwaUpdateProvider` (chequeo cada hora y al volver de segundo plano,
  `SKIP_WAITING` y recarga recién con el worker nuevo activo) y
  `PwaUpdateBanner` en los tres shells. Sin esto, quien tuviera la PWA
  instalada podía quedarse con una versión vieja indefinidamente.
  `workbox-window` 7.4.1 como dependencia directa.
- e2e de autenticación (P06.4, AUTH-012, TEST-003): suite
  `tests/e2e-auth/` contra `App_dev` con su propio config de Playwright
  (`chromium` y `mobile` a 390 px) y el script `pnpm test:e2e:auth`, fuera
  de los workflows de CI y de despliegue. Cubre el ingreso por rol,
  credenciales erróneas con mensaje idéntico exista o no el email,
  recuperación de punta a punta, persistencia de sesión y cuenta
  baneada, con cuentas descartables que se borran al final. Unitario de
  `homePathForRoles` (`src/features/auth/session.test.ts`).

### Corregido

- Revisión de P05.4 (orquestador):
  - Con contenido más alto que la ventana, la cabecera y el tabbar de los
    dos shells se iban con el scroll. En el celular, el botón "Fichar"
    quedaba fuera de la pantalla hasta llegar al final. Ahora scrollea el
    documento: la topbar, la navbar de subpágina y los tabbar son
    `sticky`, y la sidebar es `sticky` con el alto de la ventana y scroll
    propio. `<main>` dejó de ser contenedor de scroll, así que `ActionBar`
    se ancla a la ventana; además ocupa todo el ancho (márgenes negativos
    sobre el `p-4` de `<main>`). El saludo de la raíz sí se va con el
    scroll.
  - `RequireRole`: con un rol que no corresponde a la vía, redirige a la
    vía propia (`homePathForRoles` en `session.ts`) y no a `/sin-acceso`,
    como pide `05` sección 5. `/sin-acceso` queda para quien no tiene
    ningún rol.
  - Sidebar: los `<li>` de cada sección estaban directo dentro de `<nav>`;
    ahora van en un `<ul>`, y cada `<nav>` lleva su nombre ("Operación",
    "Configuración") también expandida.
  - Los nombres de ejemplo del simulador de rol (`devRole.ts`) llegaban a
    `dist/`. Ahora quedan como código muerto en el build.
  - `index.html` declaraba `color-scheme: dark`, heredado de la portada
    provisoria, y `body` no tenía color propio: el texto sin clase salía
    blanco sobre el fondo claro de los shells. Ahora es `light` y `body`
    usa `--text` y `--bg`. La portada define sus propios colores y no
    cambia.
- `ui/button.tsx`: `<Button asChild>` (usado por primera vez en este
  paquete, en `/dev/rol`) rompía siempre con "Slot failed to slot onto its
  children" — `Slot.Root` (Radix) exige exactamente un elemento hijo, y el
  `return` de `Button` le pasaba tres nodos sueltos (ícono/spinner,
  `children`, texto de carga para lectores de pantalla). Se corrigió
  armando un único nodo: con `asChild` es directamente `children`; sin
  `asChild`, los tres de antes dentro de un solo `<>` (a un `<button>` real
  no le importa recibir un Fragment). Test de regresión en
  `button.test.tsx`.
- `ui/dropdown-menu.tsx` (agregado en este paquete): mismo bug de
  `data-open:`/`data-closed:` que el resto de los componentes shadcn del
  repo (ver más abajo) — corregido a `data-[state=open]:`/
  `data-[state=closed]:` en `DropdownMenuContent`, `DropdownMenuSubTrigger`
  y `DropdownMenuSubContent`, antes de que este paquete llegara a usarlo.
- Bug heredado de DS-001/DS-002 (P05.1): `dialog.tsx`, `sheet.tsx`,
  `popover.tsx`, `select.tsx`, `tooltip.tsx`, `tabs.tsx`, `separator.tsx`
  y `command.tsx` usaban clases como `data-open:`, `data-closed:`,
  `data-horizontal:`, `data-active:` o `data-selected:`, asumiendo
  atributos booleanos (`data-open`, presencia) que Radix/cmdk nunca
  agregan: Radix escribe `data-state="open"/"closed"/"active"` y
  `data-orientation="horizontal"/"vertical"` (verificado leyendo el
  código fuente de cada paquete en `node_modules`), y cmdk escribe
  literalmente `data-selected="true"/"false"` (verificado con un test:
  React nunca omite un `data-*` en `false`, lo serializa como texto) —
  en los dos casos la clase nunca podía coincidir. Se corrigió a
  `data-[state=open]:`, `data-[orientation=horizontal]:`,
  `data-[selected=true]:`, etc. en los ocho archivos. `field.tsx` tenía
  el mismo bug en `has-data-checked:`, corregido a
  `has-data-[state=checked]:`.
- Ninguna de esas animaciones de apertura/cierre funcionaba por una
  segunda razón, independiente de la anterior: las clases que las
  implementan (`animate-in`, `fade-in-0`, `zoom-in-95`,
  `slide-in-from-*`, etc.) no existen en Tailwind CSS 4 puro — las trae
  el paquete `tw-animate-css`, no instalado acá (no está en la lista de
  librerías aprobadas del plan, y es una utilidad CSS, no una pieza de
  UI). Se reimplementó el subconjunto que usan esos componentes a mano
  con `@utility` de Tailwind 4 en `src/styles/animations.css` (nuevo),
  leyendo `--tw-duration` (la misma variable que fija la utilidad núcleo
  `duration-*`) con un techo de 150 ms (`07` sección 5) si no se indica
  ninguna. `sheet.tsx` además bajó su `duration-200` a `duration-150`
  para no superar ese máximo. `prefers-reduced-motion` ya estaba cubierto
  de forma global en `globals.css` (P05.1); no hizo falta repetirlo acá.
- `tsconfig.json`: se sacó `compilerOptions.baseUrl` (P05.1 lo había
  agregado; TypeScript 6 lo marca obsoleto). El alias `@/*` lo sigue
  resolviendo `paths` solo (sin `baseUrl`, válido con `moduleResolution`
  `bundler`), y la CLI de shadcn lo sigue encontrando igual — probado en
  este paquete agregando y descartando `breadcrumb` (ahora sí lo
  necesitábamos, para DS-011).
- `/dev/design`: los textos de ejemplo de `KpiCard` usaban términos de
  módulos futuros ("tolerancia", "reemplazo pendiente", "Sin fichar").
  Se reemplazaron por los KPIs reales de la Base (`05_Pantallas_y_Navegacion.md`
  ADM-02): turnos hoy, presentes, próximos (2 h), sin registro, avisos de
  ausencia y demora.
- Revisión visual de cierre de F5 (P05.6, orquestador), a 1440, 1024, 768
  y 390 px:
  - Sidebar colapsada (1024 a 1279 px): cada link medía 16 px de ancho,
    lo mismo que el ícono, y el resaltado del activo era una franja
    angosta. Ahora es un cuadrado de 44 px.
  - Color de borde por defecto en `globals.css`. En Tailwind 4, `border`
    sin color usa el color del texto: el borde de `Sheet` (el menú "Más" y
    el drawer) salía casi negro.
  - `Sheet` a los costados: 452 px desde 768 px y toda la pantalla por
    debajo, como pide `07` sección 2.4 (antes, tres cuartos del ancho y
    como máximo 384 px).
  - Objetivos táctiles de 44 px en móvil (`07`): avatar y "Volver" de
    `MobileShell`, menú de usuario de `AdminShell`, la X de `Sheet` y
    `Dialog` y "Volver al inicio" del 404. Se agranda el área con un
    `::after`, sin cambiar cómo se ven.
  - Textos de shadcn que habían quedado en inglés: "Close" pasa a
    "Cerrar" (`Sheet`, `Dialog`) y `CommandDialog` pasa a "Buscar".
  - `/dev/design`: el ejemplo de tres columnas de `Field` volvía a usar
    "Tolerancia (min)", un término de módulos futuros (P-068). Ahora
    muestra "Inicio / Fin / Dotación", los campos de ADM-07.
  - `/dev/rol`: la opción elegida usaba `bg-primary-050`, una clase que
    no existe; pasa a `bg-primary-50`.
- `vite.config.ts`: los source maps se generan con `sourcemap: 'hidden'`.
  El JS publicado ya no apunta a un `.map` que se borra después de
  subirlo a Sentry (Sentry los asocia por debug ID).

### Quitado

- `next-themes`: solo lo usaba `sonner.tsx` para leer el tema del
  sistema operativo/navegador. La Base es solo modo claro (P-118): se
  saca la dependencia y se fija `theme="light"` en el `Toaster`.
- `public/CNAME` y `public/.nojekyll`: restos del despliegue estático de
  GitHub Pages, que Vite copiaba a `dist/`. Cloudflare Pages no los usa
  (INFRA-013, P03.6).

### Dependencias

- Agregado `@tanstack/react-table` `8.21.3` (publicado el 14 de abril de 2025) para `DataTable` (DS-008). ADR-021 pedía probar primero la mayor
  estable (9): se instaló `9.2.4` (28 de agosto de 2026) y se descartó —
  su API pública principal (`useTable` + `tableFeatures`, por _slots_) es
  incompatible con el patrón `useReactTable`/`ColumnDef`/`flexRender` que
  usan shadcn/ui y prácticamente todo el ecosistema; la única forma de
  recuperar esa API en la 9 es `@tanstack/react-table/legacy`, una capa
  de compatibilidad que la propia librería marca `@deprecated` en cada
  export ("compatibility layer for migrating from v8", no pensada para
  código nuevo). Se usó la cláusula de excepción de ADR-021 ("si resulta
  incompatible con los componentes de shadcn/ui, 8") y se instaló la 8.
- Quitado `next-themes` `0.4.6` (ver "Quitado" arriba).

## [0.1.0] - 2026-09-18

Repositorio base: scaffold del proyecto, herramientas de calidad y documentación
inicial (F2 · INFRA-001 a INFRA-009, DOC-001, DOC-002).

### Agregado

- Proyecto Vite + React 19 + TypeScript 6.0 estricto + React Router 7 en modo
  SPA, con alias `@/` (INFRA-002).
- ESLint 9 (typescript-eslint, react-hooks, jsx-a11y), Prettier y EditorConfig
  (INFRA-003).
- Vitest + Testing Library + jsdom, con un test de humo (INFRA-004).
- Playwright con proyectos chromium, webkit y mobile a 390 px (INFRA-005).
- Husky + lint-staged: en cada commit corren ESLint (`--fix`) y Prettier sobre
  los archivos en stage, y `pnpm typecheck` sobre todo el proyecto
  (INFRA-006).
- `supabase init`, `.env.example` y los scripts `db:push`, `db:types`,
  `db:test` (INFRA-007).
- Estructura de carpetas de `03_Plan_Maestro_Tecnico.md` sección 3.4, con un
  `README.md` en cada carpeta clave (INFRA-008).
- Página "en construcción" en `src/pages/common/` como shell mínimo del
  frontend, reemplazando la portada estática anterior de GitHub Pages.
- Plantilla de Pull Request (`.github/PULL_REQUEST_TEMPLATE.md`) con las
  secciones qué, cómo probar, tarea del backlog y migraciones incluidas
  (INFRA-009).
- Este `CHANGELOG.md` (INFRA-009).
- `README.md` raíz reescrito: qué es la plataforma, estado actual, cómo
  instalar y correr el proyecto, scripts disponibles y flujo de ramas
  (DOC-001).
- `docs/architecture.md` con la arquitectura y el stack del Plan Maestro
  (sección 1 y 2), y copia de los ADR (`ADR-001` a `ADR-021`) en `docs/adr/`
  (DOC-002).
- `.gitattributes` que fija los finales de línea en LF (`text=auto eol=lf`),
  para que `pnpm format:check` no falle en Windows después de un `clone` o un
  `checkout` (INFRA-006).

### Corregido

- Se fijó `prettier` en `3.9.6` (en vez de `3.9.8`, publicada menos de un día
  antes) y se eliminó la excepción `minimumReleaseAgeExclude` que saltaba la
  protección de pnpm contra versiones recién publicadas.
- Se formateó todo el repositorio con Prettier (`README.md`,
  `src/pages/common/ConstructionPage.css`, `tests/e2e/construction-page.spec.ts`)
  y se agregaron los scripts `format` y `format:check`.

[0.1.0]: https://github.com/extendiendoservicios/extendiendoservicios-app/releases/tag/0.1.0
