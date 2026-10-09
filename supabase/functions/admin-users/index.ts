// Edge Function `admin-users` (USERS-001 a USERS-006, ADR-005, 06_API.md sección 2.1).
//
// Única función del proyecto que usa la clave `service_role` de Auth (excepción explícita a
// ADR-004, "sin capa de API"): las seis acciones que necesitan la Admin API de Supabase Auth
// (crear usuario, resetear contraseña, cambiar email de login, cerrar sesiones, desactivar y
// reactivar). Nunca hace nada que una RPC `security definer` pueda hacer -- eso vive en
// `supabase/migrations/0013_rpc_users.sql`.
//
// Verificaciones, en este orden, antes de tocar cualquier dato (06 sección 2.1):
//   1. `Origin` en la lista blanca (si viene declarado; ver `_shared/cors.ts`).
//   2. JWT válido -- lo exige el gateway de Supabase (`verify_jwt` por defecto, no declarado en
//      `config.toml`: no hace falta desactivarlo para nada de esto), pero además esta función
//      resuelve quién es la persona llamando y su estado con una lectura fresca a la base (nunca
//      confía en los claims `roles`/`capabilities` del propio JWT del llamador): son exactamente
//      los claims que la migración `0020_permission_functions_active_check.sql` dejó de
//      considerar confiables hasta que expiran, y esta función es la que puede dejar a alguien
//      sin acceso -- no tendría sentido que decidiera con datos potencialmente viejos.
//   3. Perfil activo y no borrado (mismo criterio que `app.current_profile_active()`).
//   4. Rol/capacidad según la acción (tabla de 06 sección 2.1).
//   5. Límite de 10 acciones por minuto por persona que actúa (CONFIRMADO por Mike el 23 sep
//      2026, P07.0) -- contado sobre `security_events`, ver `checkRateLimit` más abajo.
//
// Todas las acciones registran su evento en `security_events` (P-104) al terminar con éxito.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { corsHeaders, getAllowedOrigins } from '../_shared/cors.ts'

// ---------------------------------------------------------------------------------------------
// Tipos y constantes del dominio (calcados de 04_Modelo_de_Datos.md, no se importan desde
// `src/`: la Edge Function corre en Deno, fuera del build de Vite).
// ---------------------------------------------------------------------------------------------

export type AppRole = 'owner' | 'admin' | 'supervisor' | 'employee'

export type AdminCapability =
  | 'manage_users'
  | 'cancel_shifts'
  | 'edit_ratings'
  | 'edit_checklists'
  | 'manage_attendance'
  | 'generate_shifts'
  | 'manage_supervisions'

// Las siete capacidades (04 sección 2.1): "Al crear un administrador se insertan las siete en
// true" -- CONFIRMADO por Mike el 23 sep 2026 (P07.0), ya no es POR CONFIRMAR.
const ALL_CAPABILITIES: AdminCapability[] = [
  'manage_users',
  'cancel_shifts',
  'edit_ratings',
  'edit_checklists',
  'manage_attendance',
  'generate_shifts',
  'manage_supervisions',
]

// Eventos que esta función puede registrar (subconjunto de `security_event_type`, 04 sección 2.6)
// y que cuentan para el límite de acciones por minuto (no cuenta `sign_in`, que registra un
// trigger aparte, AUTH-009). `admin_action_rejected` (migración 0030, SEG-03) es el intento
// rechazado de una persona ya identificada (FORBIDDEN, validación, no encontrada...): cuenta
// para el límite igual que una acción exitosa.
type AdminUsersEventType =
  | 'user_created'
  | 'user_deactivated'
  | 'user_reactivated'
  | 'password_reset_by_admin'
  | 'sessions_revoked'
  | 'email_changed'
  | 'admin_action_rejected'

const RATE_LIMITED_EVENT_TYPES: AdminUsersEventType[] = [
  'user_created',
  'user_deactivated',
  'user_reactivated',
  'password_reset_by_admin',
  'sessions_revoked',
  'email_changed',
  'admin_action_rejected',
]

// CONFIRMADO por Mike el 23 sep 2026 (P07.0): 10 acciones por minuto por persona que actúa.
const RATE_LIMIT_MAX_ACTIONS = 10
const RATE_LIMIT_WINDOW_SECONDS = 60

// Códigos estables de error (06_API.md sección 2.1 y sección 15, más RATE_LIMITED -- ver la nota
// de la migración 0020 y el reporte de la tarea: 06 no fija cómo contar el límite ni con qué
// código, así que se elige el más simple que funciona con varias instancias de la función).
type ErrorHint =
  | 'ORIGIN_NOT_ALLOWED'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'LAST_OWNER'
  | 'EMAIL_IN_USE'
  | 'EMPLOYEE_DATA_REQUIRED'
  | 'DNI_IN_USE'
  | 'EMPLOYEE_NUMBER_IN_USE'
  | 'PROFILE_NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'RATE_LIMITED'
  | 'UNKNOWN_ACTION'
  | 'INTERNAL_ERROR'

export class DomainError extends Error {
  constructor(
    public readonly hint: ErrorHint,
    message: string,
    public readonly status: number,
  ) {
    super(message)
  }
}

const errors = {
  originNotAllowed: () =>
    new DomainError(
      'ORIGIN_NOT_ALLOWED',
      'Este origen no está autorizado para llamar a esta función.',
      403,
    ),
  unauthenticated: () =>
    new DomainError(
      'UNAUTHENTICATED',
      'Iniciá sesión de nuevo para continuar.',
      401,
    ),
  forbidden: () =>
    new DomainError('FORBIDDEN', 'No tenés permiso para hacer esto.', 403),
  lastOwner: () =>
    new DomainError('LAST_OWNER', 'No se puede quitar al último dueño.', 409),
  emailInUse: () =>
    new DomainError('EMAIL_IN_USE', 'Ese email ya está en uso.', 409),
  employeeDataRequired: () =>
    new DomainError(
      'EMPLOYEE_DATA_REQUIRED',
      'Para asignar el rol de empleado o supervisor hace falta cargar los datos de empleado (al menos el DNI).',
      400,
    ),
  // `owner`: a quién pertenece (quien da de alta ya puede ver a todo el personal), así se nota si
  // la persona ya había quedado cargada.
  dniInUse: (owner?: string) =>
    new DomainError(
      'DNI_IN_USE',
      owner
        ? `Ese DNI ya está registrado: es de ${owner}.`
        : 'Ese DNI ya está registrado.',
      409,
    ),
  employeeNumberInUse: (employeeNumber?: number, owner?: string) =>
    new DomainError(
      'EMPLOYEE_NUMBER_IN_USE',
      employeeNumber !== undefined && owner
        ? `El legajo ${employeeNumber} ya es de ${owner}. Elegí otro.`
        : 'Ese legajo ya está en uso. Elegí otro.',
      409,
    ),
  profileNotFound: () =>
    new DomainError('PROFILE_NOT_FOUND', 'No encontramos a esa persona.', 404),
  validation: (message: string) =>
    new DomainError('VALIDATION_ERROR', message, 400),
  rateLimited: () =>
    new DomainError(
      'RATE_LIMITED',
      'Hiciste demasiadas acciones en poco tiempo. Esperá un minuto e intentá de nuevo.',
      429,
    ),
  unknownAction: (action: string) =>
    new DomainError('UNKNOWN_ACTION', `La acción "${action}" no existe.`, 400),
  // El mensaje QUE VE la persona usuaria siempre es el mismo genérico en español (nunca vacío ni
  // el texto crudo de Postgres/PostgREST, que podría filtrar detalles del esquema): el detalle
  // técnico (`detail`, puede ser el `message` de un error de Postgres, potencialmente vacío --
  // se vio en vivo con un error de embed ambiguo de PostgREST sobre una consulta `head: true`,
  // defecto encontrado por la suite e2e de P07.4) se deja constancia en el log de la función con
  // `console.error`, nunca en la respuesta.
  internal: (detail: string) => {
    console.error('admin-users: error interno', detail || '(sin detalle)')
    return new DomainError(
      'INTERNAL_ERROR',
      'Ocurrió un error inesperado. Intentá de nuevo en unos minutos.',
      500,
    )
  },
}

// ---------------------------------------------------------------------------------------------
// Cliente con service_role (nunca en el navegador, se lee solo de Deno.env acá adentro) ----------
// ---------------------------------------------------------------------------------------------

function createAdminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceRoleKey) {
    throw errors.internal(
      'Faltan las variables de entorno de la función (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).',
    )
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

// ---------------------------------------------------------------------------------------------
// Quién llama: perfil activo + roles + capacidades, leídos en vivo de la base (no del JWT) -------
// ---------------------------------------------------------------------------------------------

export interface Actor {
  id: string
  roles: AppRole[]
  capabilities: AdminCapability[]
}

export async function resolveActor(
  admin: SupabaseClient,
  authorizationHeader: string | null,
): Promise<Actor> {
  if (!authorizationHeader) {
    throw errors.unauthenticated()
  }
  const jwt = authorizationHeader.replace(/^Bearer\s+/i, '')
  const { data: userData, error: userError } = await admin.auth.getUser(jwt)
  if (userError || !userData.user) {
    throw errors.unauthenticated()
  }

  const actorId = userData.user.id

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('is_active, deleted_at')
    .eq('id', actorId)
    .maybeSingle()
  if (profileError) {
    throw errors.internal(profileError.message)
  }
  if (!profile || profile.is_active !== true || profile.deleted_at !== null) {
    // Mismo criterio que app.current_profile_active() (0020): perfil inactivo o borrado ->
    // FORBIDDEN, no un detalle de "no existe" que delate cuentas.
    throw errors.forbidden()
  }

  const { data: rolesRows, error: rolesError } = await admin
    .from('user_roles')
    .select('role')
    .eq('profile_id', actorId)
  if (rolesError) {
    throw errors.internal(rolesError.message)
  }
  const roles = (rolesRows ?? []).map((r) => r.role as AppRole)

  let capabilities: AdminCapability[] = []
  if (roles.includes('admin')) {
    const { data: capRows, error: capError } = await admin
      .from('admin_capabilities')
      .select('capability')
      .eq('profile_id', actorId)
      .eq('enabled', true)
    if (capError) {
      throw errors.internal(capError.message)
    }
    capabilities = (capRows ?? []).map((c) => c.capability as AdminCapability)
  }

  return { id: actorId, roles, capabilities }
}

export function isOwner(actor: Actor): boolean {
  return actor.roles.includes('owner')
}

export function isAdminWithManageUsers(actor: Actor): boolean {
  return (
    actor.roles.includes('admin') && actor.capabilities.includes('manage_users')
  )
}

/** O siempre puede; A necesita manage_users. FORBIDDEN si ninguna de las dos. */
export function requireOwnerOrManageUsers(actor: Actor): void {
  if (!isOwner(actor) && !isAdminWithManageUsers(actor)) {
    throw errors.forbidden()
  }
}

/**
 * Regla "ídem" de 06 sección 2.1 (reset_password, update_email, deactivate_user,
 * sign_out_user): un admin con manage_users no puede actuar sobre alguien que ya tiene el rol
 * owner o admin. El owner no tiene esta restricción.
 */
export async function assertCanActOnTarget(
  admin: SupabaseClient,
  actor: Actor,
  targetProfileId: string,
): Promise<AppRole[]> {
  const { data: targetRolesRows, error } = await admin
    .from('user_roles')
    .select('role')
    .eq('profile_id', targetProfileId)
  if (error) {
    throw errors.internal(error.message)
  }
  const targetRoles = (targetRolesRows ?? []).map((r) => r.role as AppRole)

  if (!isOwner(actor)) {
    const targetIsPrivileged =
      targetRoles.includes('owner') || targetRoles.includes('admin')
    if (targetIsPrivileged) {
      throw errors.forbidden()
    }
  }

  return targetRoles
}

// ---------------------------------------------------------------------------------------------
// Límite de acciones por minuto (CONFIRMADO por Mike el 23 sep 2026, P07.0) -----------------------
// ---------------------------------------------------------------------------------------------

// Decisión menor (06_API.md no fija cómo guardar el conteo): en vez de una tabla nueva solo para
// contar, se cuenta sobre `security_events`, que de todos modos ya guarda cada acción exitosa de
// esta función (P-104) -- así el límite funciona igual con varias instancias de la Edge Function
// corriendo en paralelo (todas leen y escriben la misma tabla en Postgres, sin estado en memoria
// de la función) y no hace falta mantener una tabla ni una limpieza aparte. Es una lectura por
// `actor_id` con un índice ya existente (`security_events_actor_id_idx`, 0004) y un filtro de
// fecha reciente, barata para el volumen de esta función (nunca miles de acciones por minuto).
// No es perfectamente atómico bajo carrera (dos pedidos simultáneos del mismo actor podrían leer
// el mismo conteo antes de que el primero inserte su evento) -- aceptable acá: el límite es una
// salvaguarda contra abuso o un error de automatización, no un control de concurrencia fino, y
// el peor caso es dejar pasar una acción de más en una carrera exacta de milisegundos.
async function checkRateLimit(
  admin: SupabaseClient,
  actorId: string,
): Promise<void> {
  const since = new Date(
    Date.now() - RATE_LIMIT_WINDOW_SECONDS * 1000,
  ).toISOString()
  const { count, error } = await admin
    .from('security_events')
    .select('id', { count: 'exact', head: true })
    .eq('actor_id', actorId)
    .in('event_type', RATE_LIMITED_EVENT_TYPES)
    .gte('created_at', since)
  if (error) {
    throw errors.internal(error.message)
  }
  if ((count ?? 0) >= RATE_LIMIT_MAX_ACTIONS) {
    throw errors.rateLimited()
  }
}

// `auth.admin.signOut(jwt, scope)` de supabase-js revoca LA SESIÓN DUEÑA DEL TOKEN que se le
// pasa (lo usa como Authorization: Bearer de la request a /auth/v1/logout), no "todas las
// sesiones de este profile_id" -- verificado en vivo contra App_dev (ver el reporte de la
// tarea): pasarle un uuid ahí manda un JWT inválido y GoTrue devuelve 401. Por eso, para revocar
// todas las sesiones de una persona (reset_password, deactivate_user, sign_out_user, 06 sección
// 2.1) se usa la RPC `public.admin_revoke_user_sessions` (0021_admin_revoke_user_sessions.sql),
// que borra directo de auth.sessions -- tabla que PostgREST no expone, de ahí que haga falta una
// función en vez de `.from('sessions')`.
async function revokeAllSessions(
  admin: SupabaseClient,
  profileId: string,
): Promise<void> {
  const { error } = await admin.rpc('admin_revoke_user_sessions', {
    p_profile_id: profileId,
  })
  if (error) {
    throw errors.internal(error.message)
  }
}

async function logEvent(
  admin: SupabaseClient,
  eventType: AdminUsersEventType,
  actorId: string,
  targetId: string | null,
  details: Record<string, unknown>,
  ip: string | null,
): Promise<void> {
  const { error } = await admin.from('security_events').insert({
    event_type: eventType,
    actor_id: actorId,
    target_id: targetId,
    details,
    ip,
  })
  if (error) {
    // Mismo criterio que app.log_sign_in() (0019): un fallo al auditar no puede tirar abajo la
    // acción que ya se hizo de verdad (la persona ya quedó creada/desactivada/etc en Auth). Se
    // deja constancia en el log de la función, no se corta la respuesta.
    console.error(
      'admin-users: no se pudo registrar el evento',
      eventType,
      error,
    )
  }
}

// ---------------------------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------------------------

interface EmployeeInput {
  dni: string
  employee_number?: number | null
  cuil?: string | null
  address?: string | null
  birth_date?: string | null
  hire_date?: string | null
  emergency_contact_name?: string | null
  emergency_contact_phone?: string | null
  emergency_contact_relationship?: string | null
  notes?: string | null
}

interface CreateUserInput {
  email: string
  password: string
  first_name: string
  last_name: string
  roles: AppRole[]
  employee?: EmployeeInput
}

function assertValidCreateUserInput(
  body: Record<string, unknown>,
): CreateUserInput {
  const { email, password, first_name, last_name, roles, employee } = body
  if (typeof email !== 'string' || !email.includes('@')) {
    throw errors.validation('El email no es válido.')
  }
  if (typeof password !== 'string' || password.length < 8) {
    throw errors.validation(
      'La contraseña tiene que tener al menos 8 caracteres.',
    )
  }
  if (typeof first_name !== 'string' || first_name.trim() === '') {
    throw errors.validation('Falta el nombre.')
  }
  if (typeof last_name !== 'string' || last_name.trim() === '') {
    throw errors.validation('Falta el apellido.')
  }
  if (
    !Array.isArray(roles) ||
    roles.length === 0 ||
    !roles.every((r) =>
      ['owner', 'admin', 'supervisor', 'employee'].includes(r as string),
    )
  ) {
    throw errors.validation('Indicá al menos un rol válido.')
  }
  let employeeInput: EmployeeInput | undefined
  if (employee !== undefined && employee !== null) {
    if (typeof employee !== 'object') {
      throw errors.validation('Los datos de empleado no son válidos.')
    }
    const e = employee as Record<string, unknown>
    if (typeof e.dni !== 'string' || e.dni.trim() === '') {
      throw errors.validation('Los datos de empleado necesitan un DNI.')
    }
    if (
      e.employee_number !== undefined &&
      e.employee_number !== null &&
      !(
        typeof e.employee_number === 'number' &&
        Number.isInteger(e.employee_number) &&
        e.employee_number > 0
      )
    ) {
      throw errors.validation(
        'El legajo tiene que ser un número entero mayor que 0.',
      )
    }
    employeeInput = { ...e, dni: e.dni.trim() } as EmployeeInput
  }
  return {
    email: email.trim(),
    password,
    first_name,
    last_name,
    roles: roles as AppRole[],
    employee: employeeInput,
  }
}

/** "Nombre Apellido" de quien tiene la ficha, para los avisos de duplicado. */
async function employeeName(
  admin: SupabaseClient,
  profileId: string,
): Promise<string | undefined> {
  const { data } = await admin
    .from('profiles')
    .select('first_name, last_name')
    .eq('id', profileId)
    .maybeSingle()
  return data ? `${data.first_name} ${data.last_name}`.trim() : undefined
}

/** Traduce los errores P0001 de `admin_create_user_records` (0035) a los de esta función. */
function mapRecordsError(error: {
  message?: string
  hint?: string | null
}): DomainError {
  switch (error.hint) {
    case 'DNI_IN_USE':
      return errors.dniInUse()
    case 'EMPLOYEE_NUMBER_IN_USE':
      return errors.employeeNumberInUse()
    case 'EMPLOYEE_DATA_REQUIRED':
      return errors.employeeDataRequired()
    case 'PROFILE_NOT_FOUND':
      return errors.profileNotFound()
    case 'VALIDATION_ERROR':
      return errors.validation(
        error.message ?? 'Los datos de empleado no son válidos.',
      )
    default:
      return errors.internal(
        error.message ?? 'No se pudieron guardar los datos de la persona.',
      )
  }
}

// Alta en dos tramos (0035, defecto del 9 oct 2026 en producción):
//   1. La cuenta de Auth: nueva, o la que quedó a medias de un intento anterior con el mismo
//      email (sin roles ni ficha, `admin_find_orphan_account`), que se retoma con la contraseña
//      y el nombre de ahora. Así un alta fallida nunca bloquea el email.
//   2. Perfil, ficha de empleado, roles y capacidades en UNA transacción
//      (`admin_create_user_records`). Si falla, la cuenta queda sin nada y el próximo intento la
//      retoma.
// Los chequeos de DNI y legajo van antes del tramo 1 para avisar a quién pertenece el dato
// repetido sin tocar Auth; la restricción unique de la tabla sigue siendo la garantía final.
export async function actionCreateUser(
  admin: SupabaseClient,
  actor: Actor,
  body: Record<string, unknown>,
  ip: string | null,
): Promise<Record<string, unknown>> {
  const input = assertValidCreateUserInput(body)

  const needsEmployeeRow =
    input.roles.includes('employee') || input.roles.includes('supervisor')

  if (!isOwner(actor)) {
    // A + manage_users: "solo roles supervisor y employee" (06 sección 2.1).
    if (!isAdminWithManageUsers(actor)) {
      throw errors.forbidden()
    }
    const requestsPrivileged = input.roles.some(
      (r) => r === 'owner' || r === 'admin',
    )
    if (requestsPrivileged) {
      throw errors.forbidden()
    }
  }

  if (needsEmployeeRow && !input.employee) {
    throw errors.employeeDataRequired()
  }

  if (input.employee) {
    const { data: existingDni, error: dniError } = await admin
      .from('employees')
      .select('profile_id, employee_number')
      .eq('dni', input.employee.dni)
      .maybeSingle()
    if (dniError) {
      throw errors.internal(dniError.message)
    }
    if (existingDni) {
      const name = await employeeName(admin, existingDni.profile_id)
      throw errors.dniInUse(
        name
          ? `${name} (legajo ${existingDni.employee_number})`
          : `la persona con legajo ${existingDni.employee_number}`,
      )
    }

    const requestedNumber = input.employee.employee_number
    if (requestedNumber !== undefined && requestedNumber !== null) {
      const { data: existingNumber, error: numberError } = await admin
        .from('employees')
        .select('profile_id, employee_number')
        .eq('employee_number', requestedNumber)
        .maybeSingle()
      if (numberError) {
        throw errors.internal(numberError.message)
      }
      if (existingNumber) {
        throw errors.employeeNumberInUse(
          requestedNumber,
          await employeeName(admin, existingNumber.profile_id),
        )
      }
    }
  }

  const userMetadata = {
    first_name: input.first_name,
    last_name: input.last_name,
  }

  const { data: orphanId, error: orphanError } = await admin.rpc(
    'admin_find_orphan_account',
    { p_email: input.email },
  )
  if (orphanError) {
    throw errors.internal(orphanError.message)
  }

  let profileId: string
  const resumed = typeof orphanId === 'string'
  if (resumed) {
    profileId = orphanId as string
    const { error: updateError } = await admin.auth.admin.updateUserById(
      profileId,
      {
        password: input.password,
        email_confirm: true,
        user_metadata: userMetadata,
      },
    )
    if (updateError) {
      throw errors.internal(updateError.message)
    }
  } else {
    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        email: input.email,
        password: input.password,
        email_confirm: true,
        user_metadata: userMetadata,
      })
    if (createError || !created.user) {
      if (
        createError?.message
          ?.toLowerCase()
          .includes('already been registered') ||
        createError?.message?.toLowerCase().includes('already registered') ||
        createError?.code === 'email_exists'
      ) {
        throw errors.emailInUse()
      }
      throw errors.internal(
        createError?.message ?? 'No se pudo crear el usuario.',
      )
    }
    // app.handle_new_user() (0003) ya insertó la fila de profiles al crearse el usuario en Auth.
    profileId = created.user.id
  }

  const { data: records, error: recordsError } = await admin.rpc(
    'admin_create_user_records',
    {
      p_profile_id: profileId,
      p_actor_id: actor.id,
      p_first_name: input.first_name,
      p_last_name: input.last_name,
      p_roles: input.roles,
      p_employee: input.employee
        ? {
            dni: input.employee.dni,
            employee_number: input.employee.employee_number ?? null,
            cuil: input.employee.cuil ?? null,
            address: input.employee.address ?? null,
            birth_date: input.employee.birth_date ?? null,
            hire_date: input.employee.hire_date ?? null,
            emergency_contact_name:
              input.employee.emergency_contact_name ?? null,
            emergency_contact_phone:
              input.employee.emergency_contact_phone ?? null,
            emergency_contact_relationship:
              input.employee.emergency_contact_relationship ?? null,
            notes: input.employee.notes ?? null,
          }
        : null,
    },
  )
  if (recordsError) {
    // La transacción no dejó nada: la cuenta de Auth queda sin roles ni ficha y el próximo
    // intento con el mismo email la retoma (admin_find_orphan_account).
    console.error(
      'admin-users: create_user no pudo guardar ficha y roles; la cuenta queda para retomar',
      profileId,
      recordsError,
    )
    throw mapRecordsError(recordsError)
  }

  await logEvent(
    admin,
    'user_created',
    actor.id,
    profileId,
    {
      email: input.email,
      roles: input.roles,
      ...(resumed ? { resumed: true } : {}),
    },
    ip,
  )

  const employeeNumber =
    (records as { employee_number?: number | null } | null)?.employee_number ??
    null

  return { profile_id: profileId, employee_number: employeeNumber }
}

export async function actionResetPassword(
  admin: SupabaseClient,
  actor: Actor,
  body: Record<string, unknown>,
  ip: string | null,
): Promise<Record<string, unknown>> {
  const { profile_id, new_password } = body
  if (typeof profile_id !== 'string') {
    throw errors.validation('Falta profile_id.')
  }
  if (typeof new_password !== 'string' || new_password.length < 8) {
    throw errors.validation(
      'La contraseña nueva tiene que tener al menos 8 caracteres.',
    )
  }

  requireOwnerOrManageUsers(actor)
  await assertCanActOnTarget(admin, actor, profile_id)

  const { error: updateError } = await admin.auth.admin.updateUserById(
    profile_id,
    { password: new_password },
  )
  if (updateError) {
    if (updateError.code === 'user_not_found') {
      throw errors.profileNotFound()
    }
    throw errors.internal(updateError.message)
  }

  await revokeAllSessions(admin, profile_id)

  await logEvent(admin, 'password_reset_by_admin', actor.id, profile_id, {}, ip)

  return { profile_id }
}

export async function actionUpdateEmail(
  admin: SupabaseClient,
  actor: Actor,
  body: Record<string, unknown>,
  ip: string | null,
): Promise<Record<string, unknown>> {
  const { profile_id, email } = body
  if (typeof profile_id !== 'string') {
    throw errors.validation('Falta profile_id.')
  }
  if (typeof email !== 'string' || !email.includes('@')) {
    throw errors.validation('El email no es válido.')
  }

  requireOwnerOrManageUsers(actor)
  await assertCanActOnTarget(admin, actor, profile_id)

  const { error: updateError } = await admin.auth.admin.updateUserById(
    profile_id,
    { email, email_confirm: true },
  )
  if (updateError) {
    if (
      updateError.code === 'email_exists' ||
      updateError.message?.toLowerCase().includes('already been registered')
    ) {
      throw errors.emailInUse()
    }
    if (updateError.code === 'user_not_found') {
      throw errors.profileNotFound()
    }
    throw errors.internal(updateError.message)
  }

  await logEvent(admin, 'email_changed', actor.id, profile_id, { email }, ip)

  return { profile_id }
}

export async function actionSignOutUser(
  admin: SupabaseClient,
  actor: Actor,
  body: Record<string, unknown>,
  ip: string | null,
): Promise<Record<string, unknown>> {
  const { profile_id } = body
  if (typeof profile_id !== 'string') {
    throw errors.validation('Falta profile_id.')
  }

  requireOwnerOrManageUsers(actor)
  await assertCanActOnTarget(admin, actor, profile_id)

  // DEF-P08: la persona tiene que existir. Va DESPUÉS de las verificaciones de permiso para no
  // delatar qué ids existen a quien no puede actuar; igual que las demás acciones, un id que no
  // existe responde PROFILE_NOT_FOUND y no deja ningún evento de "sesiones cerradas".
  const { data: targetProfile, error: targetError } = await admin
    .from('profiles')
    .select('id')
    .eq('id', profile_id)
    .maybeSingle()
  if (targetError) {
    throw errors.internal(targetError.message)
  }
  if (!targetProfile) {
    throw errors.profileNotFound()
  }

  await revokeAllSessions(admin, profile_id)

  await logEvent(admin, 'sessions_revoked', actor.id, profile_id, {}, ip)

  return { profile_id }
}

export async function actionDeactivateUser(
  admin: SupabaseClient,
  actor: Actor,
  body: Record<string, unknown>,
  ip: string | null,
): Promise<Record<string, unknown>> {
  const { profile_id, reason } = body
  if (typeof profile_id !== 'string') {
    throw errors.validation('Falta profile_id.')
  }
  if (typeof reason !== 'string' || reason.trim() === '') {
    throw errors.validation('Indicá el motivo.')
  }

  requireOwnerOrManageUsers(actor)
  const targetRoles = await assertCanActOnTarget(admin, actor, profile_id)

  if (targetRoles.includes('owner')) {
    // Regla del último dueño (06 sección 2.1, P-017): acá lo relevante es que quede al menos un
    // OWNER ACTIVO, no solo un owner con el rol -- un owner desactivado no puede ejercer nada.
    // `profiles!user_roles_profile_id_fkey!inner`: `user_roles` tiene DOS FK hacia `profiles`
    // (`profile_id` y `granted_by`) -- sin el hint del nombre de la restricción, PostgREST no
    // puede elegir sola cuál usar para el embed y devuelve PGRST201 (ambigüedad), que sin este
    // fix hacía que desactivar a CUALQUIER dueño respondiera 500 en vez de validar la regla del
    // último dueño (defecto encontrado por la suite e2e de P07.4, mismo patrón que
    // `src/api/users.ts`).
    const { count, error } = await admin
      .from('user_roles')
      .select(
        'profile_id, profiles!user_roles_profile_id_fkey!inner(is_active, deleted_at)',
        {
          count: 'exact',
          head: true,
        },
      )
      .eq('role', 'owner')
      .neq('profile_id', profile_id)
      .eq('profiles.is_active', true)
      .is('profiles.deleted_at', null)
    if (error) {
      throw errors.internal(error.message)
    }
    if ((count ?? 0) === 0) {
      throw errors.lastOwner()
    }
  }

  // "banned_until = infinity" (06 sección 2.1): la Admin API de GoTrue no acepta el literal
  // "infinity" en `ban_duration` (espera una duración que `time.ParseDuration` de Go pueda
  // interpretar), así que se usa una duración muy larga -- 100 años -- como equivalente práctico
  // (decisión menor, documentada en el reporte de la tarea).
  const { error: banError } = await admin.auth.admin.updateUserById(
    profile_id,
    { ban_duration: '876000h' },
  )
  if (banError) {
    if (banError.code === 'user_not_found') {
      throw errors.profileNotFound()
    }
    throw errors.internal(banError.message)
  }

  const { error: profileError } = await admin
    .from('profiles')
    .update({
      is_active: false,
      deleted_at: new Date().toISOString(),
      updated_by: actor.id,
    })
    .eq('id', profile_id)
  if (profileError) {
    throw errors.internal(profileError.message)
  }

  await revokeAllSessions(admin, profile_id)

  await logEvent(
    admin,
    'user_deactivated',
    actor.id,
    profile_id,
    { reason },
    ip,
  )

  return { profile_id }
}

export async function actionReactivateUser(
  admin: SupabaseClient,
  actor: Actor,
  body: Record<string, unknown>,
  ip: string | null,
): Promise<Record<string, unknown>> {
  const { profile_id } = body
  if (typeof profile_id !== 'string') {
    throw errors.validation('Falta profile_id.')
  }

  // Solo owner (06 sección 2.1: "reactivate_user | profile_id | O").
  if (!isOwner(actor)) {
    throw errors.forbidden()
  }

  const { error: unbanError } = await admin.auth.admin.updateUserById(
    profile_id,
    { ban_duration: 'none' },
  )
  if (unbanError) {
    if (unbanError.code === 'user_not_found') {
      throw errors.profileNotFound()
    }
    throw errors.internal(unbanError.message)
  }

  const { error: profileError } = await admin
    .from('profiles')
    .update({ is_active: true, deleted_at: null, updated_by: actor.id })
    .eq('id', profile_id)
  if (profileError) {
    throw errors.internal(profileError.message)
  }

  await logEvent(admin, 'user_reactivated', actor.id, profile_id, {}, ip)

  return { profile_id }
}

// ---------------------------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------------------------

const ACTIONS: Record<
  string,
  (
    admin: SupabaseClient,
    actor: Actor,
    body: Record<string, unknown>,
    ip: string | null,
  ) => Promise<Record<string, unknown>>
> = {
  create_user: actionCreateUser,
  reset_password: actionResetPassword,
  update_email: actionUpdateEmail,
  sign_out_user: actionSignOutUser,
  deactivate_user: actionDeactivateUser,
  reactivate_user: actionReactivateUser,
}

// Rechazos que se registran y cuentan para el límite (SEG-03): todos los que ocurren una vez que
// se sabe quién es la persona, salvo los que no son un "intento" suyo o harían crecer el bloqueo
// solo (RATE_LIMITED: si se registrara, un bloqueo se auto-prolongaría mientras siga insistiendo;
// INTERNAL_ERROR: falla nuestra, no de la persona). UNAUTHENTICATED y ORIGIN_NOT_ALLOWED ocurren
// antes de identificar a nadie, así que nunca llegan acá con un actor.
function isCountableRejection(err: DomainError): boolean {
  return (
    err.hint !== 'RATE_LIMITED' &&
    err.hint !== 'INTERNAL_ERROR' &&
    err.hint !== 'UNAUTHENTICATED' &&
    err.hint !== 'ORIGIN_NOT_ALLOWED'
  )
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  origin: string | null,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json',
    },
  })
}

// `makeAdmin` existe para los tests (inyectan un cliente simulado); en producción es siempre
// createAdminClient().
export async function handleRequest(
  req: Request,
  makeAdmin: () => SupabaseClient = createAdminClient,
): Promise<Response> {
  const origin = req.headers.get('Origin')

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }

  // Para registrar el intento rechazado (SEG-03) hace falta saber quién es y qué pidió: se van
  // completando a medida que avanza la verificación.
  let admin: SupabaseClient | null = null
  let actor: Actor | null = null
  let action: string | null = null
  let ip: string | null = null

  try {
    // 1. Origin en la lista blanca (defensa en profundidad, ver `_shared/cors.ts`: además de
    //    esto, sin Access-Control-Allow-Origin el navegador ya bloquea la respuesta).
    if (origin && !getAllowedOrigins().includes(origin)) {
      throw errors.originNotAllowed()
    }

    if (req.method !== 'POST') {
      throw errors.validation('Esta función solo acepta POST.')
    }

    admin = makeAdmin()

    // 2 y 3. JWT válido + perfil activo (resolveActor lee todo en vivo de la base).
    actor = await resolveActor(admin, req.headers.get('Authorization'))

    // `x-forwarded-for` puede traer varias IP separadas por coma (una por cada salto de proxy
    // -- Cloudflare/el gateway de Supabase agregan la suya); `security_events.ip` es `inet`, que
    // solo acepta una dirección. Se toma la primera (la del cliente original), como es
    // convención. Se comprobó en vivo contra App_dev: sin este recorte, el insert fallaba con
    // "invalid input syntax for type inet" y logEvent() se comía el error en silencio, así que
    // ninguna acción quedaba auditada (y el límite de acciones por minuto, que cuenta sobre esta
    // misma tabla, nunca veía nada para contar).
    const rawIp = req.headers.get('x-forwarded-for')
    ip = rawIp ? rawIp.split(',')[0].trim() : null

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      throw errors.validation('El cuerpo tiene que ser JSON.')
    }
    const requestedAction = body.action
    if (typeof requestedAction === 'string') {
      action = requestedAction.slice(0, 40)
    }
    if (typeof requestedAction !== 'string' || !(requestedAction in ACTIONS)) {
      throw errors.unknownAction(String(requestedAction))
    }

    // 5. Límite de acciones por minuto (antes de ejecutar la acción, después de saber quién es).
    //    Cuenta las acciones exitosas y también los intentos rechazados (SEG-03).
    await checkRateLimit(admin, actor.id)

    // 4. Rol/capacidad: cada acción valida lo que le corresponde (06 sección 2.1) al principio de
    //    su propia función, antes de tocar nada.
    const result = await ACTIONS[requestedAction](admin, actor, body, ip)

    return jsonResponse({ data: result }, 200, origin)
  } catch (err) {
    if (err instanceof DomainError) {
      if (admin && actor && isCountableRejection(err)) {
        // SEG-03: el intento rechazado de una persona ya identificada queda registrado y suma al
        // límite de acciones por minuto, igual que una acción exitosa.
        await logEvent(
          admin,
          'admin_action_rejected',
          actor.id,
          null,
          {
            action,
            hint: err.hint,
          },
          ip,
        )
      }
      return jsonResponse(
        { error: { message: err.message, hint: err.hint } },
        err.status,
        origin,
      )
    }
    console.error('admin-users: error inesperado', err)
    return jsonResponse(
      {
        error: {
          message:
            'Ocurrió un error inesperado. Intentá de nuevo en unos minutos.',
          hint: 'INTERNAL_ERROR',
        },
      },
      500,
      origin,
    )
  }
}

// Se envuelve para que Deno no le pase su segundo argumento (ConnInfo) a `makeAdmin`.
Deno.serve((req) => handleRequest(req))
