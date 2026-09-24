# Usuarios y configuración (ADM-27 a ADM-31)

Las cinco pantallas del grupo "Configuración" del menú de administración,
todas bajo `/admin/configuracion/...` y con la misma subnavegación
(`ConfigNav`, `src/features/settings/components/ConfigNav.tsx`):
usuarios y roles (ADM-27, P07.2), empresa (ADM-28), feriados (ADM-29),
criterios de calificación (ADM-30) y eventos de seguridad (ADM-31) —
estas últimas cuatro, P07.3.

## ADM-27 · Usuarios y roles

Pantalla `/admin/configuracion/usuarios` (P07.2, USERS-007 a USERS-011).
Gestiona accesos: quién puede entrar, con qué roles y, si es
administrador, con qué capacidades.

### Quién ve qué

Matriz completa en `Docs/Plan_Maestro/03_Plan_Maestro_Tecnico.md` sección 6. Resumen de esta pantalla en particular:

| Acción                                                             | Dueño                | Administrador con `manage_users`                                        | Administrador sin `manage_users` |
| ------------------------------------------------------------------ | -------------------- | ----------------------------------------------------------------------- | -------------------------------- |
| Ver la lista, con roles y estado                                   | Sí                   | Sí                                                                      | Sí                               |
| Ver "último inicio de sesión"                                      | Sí                   | No (columna en blanco — `security_events` es de lectura solo del dueño) | No                               |
| Crear un administrador                                             | Sí                   | No                                                                      | No                               |
| Resetear contraseña / cambiar email / cerrar sesiones / desactivar | Sí, sobre cualquiera | Sí, pero nunca sobre alguien con rol `owner` o `admin`                  | No                               |
| Reactivar                                                          | Sí                   | No                                                                      | No                               |
| Editar roles y capacidades                                         | Sí                   | No                                                                      | No                               |

Las dos últimas filas son más restrictivas del lado de la pantalla que lo
que el servidor permitiría (la RPC `set_user_roles` sí deja a un
administrador con `manage_users` tocar roles `employee`/`supervisor` de
alguien sin privilegios): `08_Fases_y_Backlog.md` deja USERS-010 explícito
como "solo dueño" para ADM-27 en particular — esa vía más amplia queda
para las pantallas de empleados (ADM-17/ADM-18, otro paquete), no para
acá. Decisión documentada en `src/features/users/permissions.ts`.

### Decisiones tomadas en este paquete

- **Por defecto la lista solo muestra usuarios activos** (P07.7, decisión de
  Mike del 23 sep 2026: en producción se van acumulando los que dejan de
  trabajar, y una lista con todos mezclados se vuelve difícil de leer —
  `App_dev` ya tenía ~48 desactivados, casi todos de prueba). El interruptor
  "Mostrar desactivados" de la barra superior suma a los desactivados (con
  su insignia de estado, sin cambios ahí). Filtro en el **cliente**
  (`filterUsersByStatus`, `src/features/users/userListFilters.ts`), no en la
  consulta: `fetchUsers` ya trae la lista completa en una sola consulta
  liviana (decenas de filas, sin paginado) y de esa misma lista completa
  dependen también los roles y "último inicio de sesión" — pedirle al
  servidor dos variantes distintas por este interruptor duplicaría la
  consulta sin necesidad; el polling de 60 s sigue trayendo todo, el
  interruptor solo decide qué parte se muestra. Si con el filtro apagado no
  queda ningún activo, un estado vacío aparte lo explica ("No hay usuarios
  activos... Activá 'Mostrar desactivados' para verlos") en vez de mostrar
  el mismo "Todavía no hay usuarios" que cuando no hay nadie cargado. El
  interruptor no persiste entre sesiones (dura mientras la pantalla está
  abierta, con `useState`) y usa el mismo `Switch` de `RolesCapabilitiesSheet`
  (`@/components/ui/switch`), con etiqueta visible asociada por
  `htmlFor`/`id`. Al desactivar a alguien desde el menú de acciones, con el
  interruptor apagado esa persona deja de verse: el aviso de éxito lo aclara
  ("Para volver a verla en la lista, activá 'Mostrar desactivados'") en vez
  de agregar más estado para acordarse de "quién se acaba de ir".
- **La alta desde ADM-27 es siempre de un administrador** (`roles:
['admin']`), nunca de dueño/supervisor/empleado: la Edge Function
  `admin-users` rechaza con `FORBIDDEN` a quien no sea el dueño si pide un
  rol privilegiado, y el botón de alta ya está oculto para quien no sea
  dueño (`canCreateAdminUser`). Crear empleados/supervisores sigue siendo
  ADM-18 (otro paquete, EMP-003).
- **La lista no muestra el email de login.** No está en `profiles` (vive
  en `auth.users`, fuera del alcance de PostgREST) y
  `05_Pantallas_y_Navegacion.md` no lo pide para ADM-27 (solo "roles,
  estado, último inicio de sesión"). Para cambiar el email de alguien no
  hace falta ver el actual, solo escribir el nuevo.
- **Sin polling en el editor de roles/capacidades ni en los diálogos de
  acción**: son formularios/paneles que se abren a demanda, no listas
  permanentes en pantalla. Sí hay polling de 60 s en la lista principal y
  en "último inicio de sesión" (regla común, `02_Decisiones.md` P-005),
  con el indicador "Actualizado hace n s" (`UpdatedAgo.tsx`).
- **Quitar un rol cierra las sesiones de la persona automáticamente**
  (`06_API.md` sección 2.2: "si se quita un rol, el frontend llama
  `sign_out_user`"). `RolesCapabilitiesSheet` avisa esto antes de guardar
  si la selección nueva le saca algún rol a la persona.
- **Las capacidades se guardan solas, al tocar cada `ToggleRow`** (sin un
  botón "Guardar" aparte para ellas) — los roles, en cambio, se guardan
  con un botón explícito, porque reemplazan el conjunto completo de una
  sola vez (una sola RPC, `set_user_roles`) y tienen el efecto colateral de
  cerrar sesiones.
- **Cerrar sesiones y reactivar no piden motivo** (no están en la lista de
  acciones de `07_Design_System.md` sección 2.4 que lo exigen): confirmación
  simple. **Desactivar sí** (motivo obligatorio, `ConfirmDialog`).

### Qué falta / para el orquestador

- No hay forma, con el contrato actual, de que el dueño vea el email de
  login ACTUAL de alguien antes de cambiarlo (la Edge Function no expone
  una acción de lectura sobre `auth.users`, y PostgREST no llega ahí). Hoy
  no hace falta (el diálogo de "Cambiar email" solo pide el nuevo), pero si
  una pantalla futura necesitara mostrarlo, hace falta una acción nueva en
  `admin-users` (o una vista que la exponga) — trabajo de
  `backend-supabase`.
- El indicador "Actualizado hace n s" (`src/features/users/components/
UpdatedAgo.tsx`) quedó local a este dominio porque es la primera pantalla
  con polling. Si una próxima pantalla ADM con polling lo necesita,
  conviene subirlo a `src/components/` (pedido a front-plataforma) en vez
  de duplicarlo.

## ADM-28 · Empresa

Pantalla `/admin/configuracion/empresa` (P07.3, USERS-012 y USERS-013).
Nombre, logo, teléfono de soporte y texto de consentimiento de ubicación
(`company_settings`, fila única `id = 1`).

### Quién ve qué

La visitan dueño y administrador por igual, pero no ven lo mismo
(`05_Pantallas_y_Navegacion.md` línea 92: "ADM-28 la ven dueño y
administrador pero solo el logo lo edita también el administrador"):

| Campo                                                | Dueño | Administrador                    |
| ---------------------------------------------------- | ----- | -------------------------------- |
| Logo                                                 | Sí    | Sí                               |
| Nombre, teléfono de soporte, texto de consentimiento | Sí    | No (ni se muestra el formulario) |

`canEditCompanyDetails`/`canEditCompanyLogo` (`src/features/settings/
permissions.ts`) deciden esto del lado de la pantalla; RLS
(`company_settings_select_authenticated`) deja leer la fila completa a
cualquier persona logueada, así que ocultar es responsabilidad de la
pantalla, no del servidor.

### Decisiones tomadas en este paquete

- **Logo con nombre de archivo fijo** (`logo.{ext}`, bucket `branding`,
  `upsert: true`): pisa el anterior en vez de acumular versiones. Si la
  extensión cambia (por ejemplo de `.png` a `.svg`), se borra el archivo
  viejo del bucket a mano (best effort) para no dejar huérfanos.
- **USERS-013, logo en login y sidebar**: ambos reusan `useBranding`/
  `brandingLogoUrl` (`src/features/auth/useBranding.ts`, ya existía desde
  P06.3 para COM-01/COM-05); `AdminShell` es el único archivo tocado fuera
  del dominio de `settings` en este paquete, con el mismo criterio de
  reserva que ya tenía el login: sin logo propio cargado, se sigue viendo
  el isotipo de marca de `public/icons/`.
- **Vista previa del logo en ADM-28 con el isotipo de `public/favicon.png`
  como reserva**, no el isotipo blanco de la sidebar: la miniatura se
  muestra sobre fondo claro (tarjeta de la pantalla), y el isotipo blanco
  está pensado para el fondo oscuro de la sidebar — usar el mismo ahí se
  vería invisible.

## ADM-29 · Feriados

Pantalla `/admin/configuracion/feriados` (P07.3, USERS-014). Solo dueño.
Lista de feriados por año (`holidays`), alta manual, baja lógica y
"Cargar feriados nacionales de \<año\>".

### Decisiones tomadas en este paquete

- **"Cargar feriados nacionales" no es una tabla de fechas por año**, es
  un cálculo con reglas fijas (`src/features/settings/
nationalHolidays.ts`): `06_API.md` describe el botón como "una lista fija
  en el frontend, PROPUESTO", interpretado acá como "sin depender de un
  servicio externo", no como un array de fechas escritas a mano (ver el
  comentario de cabecera de ese archivo para el detalle de cada feriado y
  sus límites). Cobertura:
  - **9 fijos** (Año Nuevo, Día de la Memoria, Malvinas, Día del
    Trabajador, Revolución de Mayo, Belgrano, Independencia, Inmaculada
    Concepción, Navidad): nunca cambian de fecha.
  - **3 móviles atados a Pascua** (Carnaval lunes y martes, Viernes Santo):
    calculados con el algoritmo de Gauss para el domingo de Pascua,
    exactos para cualquier año.
  - **3 trasladables por regla fija de "n-ésimo lunes del mes"** (San
    Martín: 3er lunes de agosto; Diversidad Cultural: 2do lunes de
    octubre; Soberanía Nacional: 4to lunes de noviembre).
  - **Güemes (17 de junio)**: la ley permite trasladarlo a un lunes cercano
    solo si el Poder Ejecutivo lo decreta ESE año en particular (no es una
    regla fija) — se carga siempre en su fecha original; un traslado
    puntual, o cualquier "puente" extraordinario, lo carga el dueño a mano
    como un feriado más.
- **No duplica fechas existentes**: si la fecha nacional ya está cargada y
  activa, se saltea; si está de baja lógica, se reactiva reusando la fila
  (evita chocar con la restricción de unicidad de `holiday_date`, que no
  distingue activos de dados de baja).
- **La baja es lógica** (`deleted_at`), nunca se borra físicamente. Los
  turnos ya generados con ese feriado no se recalculan.

## ADM-30 · Criterios de calificación

Pantalla `/admin/configuracion/criterios` (P07.3, USERS-015). Solo dueño.
Guía de texto para que el supervisor califique (`rating_criteria`), no un
puntaje por criterio.

### Decisiones tomadas en este paquete

- **"Cerrar" un criterio pone `valid_to` en hoy, no lo borra**: la fila
  queda en el historial, visible en la lista como "Cerrado el \<fecha\>".
  Solo los criterios vigentes (`valid_to` nulo) se pueden reordenar, editar
  o cerrar de nuevo.
- **Reordenar reescribe `position` de todas las filas** en el orden final
  que ya armó la pantalla (mismo patrón que ADM-26), sin una RPC de
  reordenamiento propia.
- **"Ver como supervisor"** muestra únicamente los criterios vigentes hoy
  (`valid_from`/`valid_to`), en el mismo orden que va a ver el supervisor
  al calificar.

## ADM-31 · Eventos de seguridad

Pantalla `/admin/configuracion/seguridad` (P07.3, USERS-016). Solo dueño,
solo lectura. Filtra `security_events` por tipo de evento, usuario y rango
de fechas.

### Decisiones tomadas en este paquete

- **RLS ya resuelve el "solo dueño"**: para cualquier otra sesión la
  consulta vuelve vacía (`security_events_select_owner`), sin error. La
  pantalla igual muestra `OwnerOnlyNotice` en vez del contenido para un
  administrador que entrara por URL directa, para no dar a entender que
  "no hay eventos" cuando en realidad es que no puede verlos.
- **Etiquetas de `security_event_type` en español** definidas en
  `src/features/settings/securityEventLabels.ts`: el modelo de datos no
  trae una etiqueta de pantalla para este enum (a diferencia de otros que
  sí la traen documentada), así que se escribieron acá.
- **Techo de 500 filas, sin paginado real**: alcanza de sobra para el
  volumen esperado de personas de la operación; si algún día no alcanzara,
  el filtro de fecha "desde" acota el volumen.

## Qué toca de `front-plataforma` (excepción puntual, USERS-013)

`AdminShell.tsx` (sidebar) ya usa `useBranding`/`brandingLogoUrl` para
mostrar el logo propio de la empresa cuando existe. `LoginPage.tsx` ya lo
hacía desde P06.3, no necesitó cambios en este paquete.
