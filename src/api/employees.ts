import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import { ApiError, fromPostgrestError } from './errors'
import {
  createAdminUser,
  deactivateUser as deactivateUserAccount,
  resetPassword as resetUserPassword,
  signOutUser as signOutUserAccount,
  type CreateUserEmployeeInput,
  type Role,
} from './users'

/**
 * `src/api/employees.ts` (EMP-001, patrón fijado en `src/api/users.ts` —
 * ver `src/api/README.md`): empleados y supervisores de ADM-16, ADM-17 y
 * ADM-18 (`06_API.md` sección 3). Una misma tabla `employees` para los dos
 * roles (P-038): "supervisor" es un rol más, no una tabla aparte.
 *
 * El alta y las acciones de cuenta (resetear contraseña, cerrar sesiones,
 * dar de baja) reutilizan tal cual las funciones de `src/api/users.ts`
 * -- la Edge Function `admin-users` es la misma para usuarios
 * administrativos y para empleados/supervisores (`06` sección 2.1), así que
 * este módulo no vuelve a escribir `invokeAdminUsers`.
 */

export type EmployeeEffectiveStatus =
  Database['public']['Enums']['employee_status'] | 'on_leave'

// -------------------------------------------------------------------------
// Errores de escritura directa a tabla (sin RPC, mismo criterio que clients.ts)
// -------------------------------------------------------------------------

function mapWriteError(error: {
  code?: string | null
  message: string
  hint?: string | null
}): ApiError {
  if (error.code === '23505') {
    if (error.message.includes('dni')) {
      return new ApiError('Ese DNI ya está registrado.', 'DNI_IN_USE')
    }
    if (error.message.includes('employee_number')) {
      return new ApiError(
        'Ese legajo ya está en uso.',
        'EMPLOYEE_NUMBER_IN_USE',
      )
    }
    return new ApiError('Ya existe un registro con esos datos.', 'DUPLICATE')
  }
  if (error.code === '23514') {
    if (error.message.includes('dni')) {
      return new ApiError(
        'El DNI tiene que tener solo dígitos.',
        'VALIDATION_ERROR',
      )
    }
    if (error.message.includes('cuil')) {
      return new ApiError(
        'El CUIL tiene que tener 11 dígitos.',
        'VALIDATION_ERROR',
      )
    }
    if (error.message.includes('employee_leaves_ends_on_check')) {
      return new ApiError(
        'La fecha "hasta" no puede ser anterior a la fecha "desde".',
        'VALIDATION_ERROR',
      )
    }
    if (error.message.includes('employee_availability')) {
      return new ApiError(
        'La hora de fin tiene que ser posterior a la hora de inicio.',
        'VALIDATION_ERROR',
      )
    }
  }
  // Exclusión de solapamiento de licencias (`employee_leaves_no_overlap`,
  // `0006_employees.sql`): a diferencia de `ASSIGNMENT_OVERLAP` o
  // `SHIFT_OVERLAP`, esta restricción vive en una tabla que se escribe
  // directo por PostgREST (sin RPC), así que llega como un 23P01 crudo de
  // Postgres, no como un `raise exception` con `hint` propio -- se traduce
  // acá, mismo criterio que el resto de este mapeador (06 sección 3:
  // "Solapamiento bloqueado por exclusión → LEAVE_OVERLAP").
  if (error.code === '23P01' && error.message.includes('employee_leaves')) {
    return new ApiError(
      'Esas fechas se superponen con otra licencia ya cargada de esa persona.',
      'LEAVE_OVERLAP',
    )
  }
  return fromPostgrestError(error)
}

// -------------------------------------------------------------------------
// 1. Listado (ADM-16, `v_employees`)
// -------------------------------------------------------------------------

/** Una fila del listado de ADM-16 (`v_employees`, `06` sección 3). */
export interface EmployeeListRow {
  profileId: string
  firstName: string
  lastName: string
  employeeNumber: number
  roles: Role[]
  effectiveStatus: EmployeeEffectiveStatus
  phone: string | null
  avatarPath: string | null
  dni: string
}

/** AJ2-17: lo mínimo para elegir empleados en un selector múltiple. */
export interface EmployeeOption {
  profileId: string
  name: string
  employeeNumber: number
}

/**
 * Empleados activos (estado guardado, igual que los candidatos de la
 * asignación: quien está de licencia hoy puede figurar para un turno futuro),
 * por legajo ascendente. Alimenta el selector de «Nuevo turno» y de
 * «Empleados fijos» del servicio.
 */
export async function fetchActiveEmployeeOptions(): Promise<EmployeeOption[]> {
  const { data, error } = await supabase
    .from('v_employees')
    .select('profile_id, first_name, last_name, employee_number')
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('employee_number', { ascending: true })

  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map((row) => ({
    profileId: row.profile_id as string,
    name: `${row.first_name as string} ${row.last_name as string}`,
    employeeNumber: row.employee_number as number,
  }))
}

export interface EmployeeListFilters {
  /** Busca en nombre, apellido, DNI y legajo (si el texto es numérico). */
  text?: string
  role?: 'employee' | 'supervisor' | 'all'
  status?: EmployeeEffectiveStatus | 'all'
}

/**
 * Lista de empleados y supervisores (`06` sección 3: "Listar |
 * from('v_employees') | O, A | Filtros: texto (nombre, legajo, DNI), rol,
 * estado efectivo, cliente habilitado"). El filtro por cliente habilitado
 * se resuelve en la pantalla (`useEmployeeClientPermissionsQuery` más abajo
 * más `filterEmployeesByClient`, `employeeListFilters.ts`): la dotación es
 * chica (decenas de personas, criterio de F9) y ese filtro depende de una
 * regla ("lista vacía = habilitado para todos", P-034) que no se puede
 * expresar como un simple `.eq()` sobre la vista.
 */
export async function fetchEmployees(
  filters: EmployeeListFilters = {},
): Promise<EmployeeListRow[]> {
  let query = supabase
    .from('v_employees')
    .select(
      'profile_id, first_name, last_name, employee_number, roles, effective_status, phone, avatar_path, dni',
    )
    .is('deleted_at', null)
    // AJ2-01: siempre por número de legajo ascendente.
    .order('employee_number', { ascending: true })

  const text = filters.text?.trim()
  if (text) {
    const escaped = text.replace(/[%_]/g, '\\$&')
    const orParts = [
      `first_name.ilike.%${escaped}%`,
      `last_name.ilike.%${escaped}%`,
      `dni.ilike.%${escaped}%`,
    ]
    if (/^[0-9]+$/.test(text)) {
      orParts.push(`employee_number.eq.${text}`)
    }
    query = query.or(orParts.join(','))
  }
  if (filters.role && filters.role !== 'all') {
    query = query.contains('roles', [filters.role])
  }
  if (filters.status && filters.status !== 'all') {
    query = query.eq('effective_status', filters.status)
  }

  const { data, error } = await query
  if (error) {
    throw fromPostgrestError(error)
  }

  return (data ?? []).map((row) => ({
    profileId: row.profile_id as string,
    firstName: row.first_name as string,
    lastName: row.last_name as string,
    employeeNumber: row.employee_number as number,
    roles: row.roles ?? [],
    effectiveStatus: row.effective_status as EmployeeEffectiveStatus,
    phone: row.phone,
    avatarPath: row.avatar_path,
    dni: row.dni as string,
  }))
}

/**
 * DNI de una lista de empleados, para los imprimibles (AJ2-16). Dueño y
 * administradores leen `employees.dni` (no pasa por `v_assignments_board`).
 */
export async function fetchEmployeeDnisByIds(
  employeeIds: string[],
): Promise<Map<string, string>> {
  if (employeeIds.length === 0) {
    return new Map()
  }
  const { data, error } = await supabase
    .from('employees')
    .select('profile_id, dni')
    .in('profile_id', employeeIds)

  if (error) {
    throw fromPostgrestError(error)
  }
  return new Map((data ?? []).map((row) => [row.profile_id, row.dni]))
}

/**
 * Clientes habilitados por empleado (`employee_client_permissions`), para
 * el filtro "cliente habilitado" de ADM-16 (`employeeListFilters.ts`
 * resuelve la regla de lista vacía = habilitado para todos, no esta
 * función). Un empleado sin filas acá no aparece como clave del mapa.
 */
export async function fetchEmployeeClientPermissions(): Promise<
  Map<string, string[]>
> {
  const { data, error } = await supabase
    .from('employee_client_permissions')
    .select('employee_id, client_id')

  if (error) {
    throw fromPostgrestError(error)
  }

  const clientIdsByEmployeeId = new Map<string, string[]>()
  for (const row of data ?? []) {
    const list = clientIdsByEmployeeId.get(row.employee_id) ?? []
    list.push(row.client_id)
    clientIdsByEmployeeId.set(row.employee_id, list)
  }
  return clientIdsByEmployeeId
}

/**
 * Próximo legajo sugerido para ADM-18 (P-036: "lo genera el sistema, pero
 * podría editarse"). Es solo una sugerencia para el formulario,
 * `max(employee_number) + 1` (1 si todavía no hay ninguno); el alta guarda
 * el legajo que quede escrito (ver `createEmployeeUser`).
 */
export async function fetchSuggestedEmployeeNumber(): Promise<number> {
  const { data, error } = await supabase
    .from('employees')
    .select('employee_number')
    .order('employee_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw fromPostgrestError(error)
  }
  return (data?.employee_number ?? 0) + 1
}

// -------------------------------------------------------------------------
// 2. Ficha y formulario (ADM-17, ADM-18)
// -------------------------------------------------------------------------

export interface EmployeeDetail {
  profileId: string
  firstName: string
  lastName: string
  employeeNumber: number
  roles: Role[]
  status: Database['public']['Enums']['employee_status']
  effectiveStatus: EmployeeEffectiveStatus
  isActiveAccount: boolean
  deletedAt: string | null
  avatarPath: string | null
  dni: string
  cuil: string | null
  address: string | null
  birthDate: string | null
  hireDate: string | null
  terminatedAt: string | null
  phone: string | null
  contactEmail: string | null
  emergencyContactName: string | null
  emergencyContactPhone: string | null
  emergencyContactRelationship: string | null
  notes: string | null
}

/** Ficha de ADM-17 (`06` sección 3: "Ficha | from('v_employees').eq('profile_id') + …"). */
export async function fetchEmployeeDetail(
  profileId: string,
): Promise<EmployeeDetail> {
  const { data, error } = await supabase
    .from('v_employees')
    .select('*')
    .eq('profile_id', profileId)
    .single()

  if (error) {
    throw fromPostgrestError(error)
  }

  return {
    profileId: data.profile_id as string,
    firstName: data.first_name as string,
    lastName: data.last_name as string,
    employeeNumber: data.employee_number as number,
    roles: data.roles ?? [],
    status: data.status as Database['public']['Enums']['employee_status'],
    effectiveStatus: data.effective_status as EmployeeEffectiveStatus,
    isActiveAccount: data.profile_is_active === true,
    deletedAt: data.deleted_at,
    avatarPath: data.avatar_path,
    dni: data.dni as string,
    cuil: data.cuil,
    address: data.address,
    birthDate: data.birth_date,
    hireDate: data.hire_date,
    terminatedAt: data.terminated_at,
    phone: data.phone,
    contactEmail: data.contact_email,
    emergencyContactName: data.emergency_contact_name,
    emergencyContactPhone: data.emergency_contact_phone,
    emergencyContactRelationship: data.emergency_contact_relationship,
    notes: data.notes,
  }
}

export interface EmployeeCreateInput {
  firstName: string
  lastName: string
  email: string
  password: string
  roles: Role[]
  employeeNumber: number
  phone: string | null
  dni: string
  cuil: string | null
  address: string | null
  birthDate: string | null
  hireDate: string | null
  emergencyContactName: string | null
  emergencyContactPhone: string | null
  emergencyContactRelationship: string | null
  notes: string | null
}

/**
 * Alta de un empleado o supervisor (EMP-003, `06` sección 3: "Crear | Edge
 * create_user | O; A + manage_users | Un empleado siempre tiene usuario
 * (P-016)"). Una sola llamada a la Edge Function: crea (o retoma, si quedó a
 * medias) la cuenta de Auth y guarda ficha y roles en una transacción
 * (`admin-users/index.ts`, `actionCreateUser`, y `0035_altas_atomicas.sql`).
 *
 * El legajo pedido viaja en el alta y la ficha nace con ese número. Antes la
 * ficha nacía con un legajo provisorio de `employee_number_seq` y se
 * corregía después; cuando el provisorio coincidía con un legajo cargado a
 * mano, el alta fallaba a mitad de camino (defecto del 9 oct 2026 en
 * producción).
 */
export async function createEmployeeUser(input: EmployeeCreateInput): Promise<{
  profileId: string
  employeeNumber: number
}> {
  const employee: CreateUserEmployeeInput = {
    dni: input.dni,
    employeeNumber: input.employeeNumber,
    cuil: input.cuil,
    address: input.address,
    birthDate: input.birthDate,
    hireDate: input.hireDate,
    emergencyContactName: input.emergencyContactName,
    emergencyContactPhone: input.emergencyContactPhone,
    emergencyContactRelationship: input.emergencyContactRelationship,
    notes: input.notes,
  }

  const { profileId, employeeNumber } = await createAdminUser({
    email: input.email,
    password: input.password,
    firstName: input.firstName,
    lastName: input.lastName,
    roles: input.roles,
    phone: input.phone,
    employee,
  })

  return { profileId, employeeNumber: employeeNumber ?? input.employeeNumber }
}

export interface EmployeeUpdateInput {
  firstName: string
  lastName: string
  phone: string | null
  contactEmail: string | null
  employeeNumber: number
  dni: string
  cuil: string | null
  address: string | null
  birthDate: string | null
  hireDate: string | null
  emergencyContactName: string | null
  emergencyContactPhone: string | null
  emergencyContactRelationship: string | null
  notes: string | null
}

/**
 * Edición de datos laborales y personales (EMP-004, `06` sección 3: "Editar
 * datos laborales | from('employees').update(...) | O, A | employee_number
 * editable y único"). El email de login no se toca acá (`05` línea 67: "sin
 * cambiar el email de login acá: eso es la acción de usuario") -- eso es
 * `updateEmail` de `src/api/users.ts`, disponible desde la ficha si hiciera
 * falta en una fase posterior.
 *
 * Dos `update` (uno a `profiles`, otro a `employees`): mismo criterio que
 * `clients.ts`, sin RPC propia para esto (`06` no la pide). Si el primero
 * corre bien y el segundo falla, el nombre/teléfono/email de contacto ya
 * quedaron guardados -- no es un problema práctico (son columnas
 * independientes, reintentar el formulario completo vuelve a mandar los
 * mismos valores del primero sin duplicar nada).
 */
export async function updateEmployee(
  profileId: string,
  input: EmployeeUpdateInput,
  updatedBy: string,
): Promise<EmployeeDetail> {
  const { error: profileError } = await supabase
    .from('profiles')
    .update({
      first_name: input.firstName,
      last_name: input.lastName,
      phone: input.phone,
      contact_email: input.contactEmail,
    })
    .eq('id', profileId)
  if (profileError) {
    throw mapWriteError(profileError)
  }

  const { error: employeeError } = await supabase
    .from('employees')
    .update({
      employee_number: input.employeeNumber,
      dni: input.dni,
      cuil: input.cuil,
      address: input.address,
      birth_date: input.birthDate,
      hire_date: input.hireDate,
      emergency_contact_name: input.emergencyContactName,
      emergency_contact_phone: input.emergencyContactPhone,
      emergency_contact_relationship: input.emergencyContactRelationship,
      notes: input.notes,
      updated_by: updatedBy,
    })
    .eq('profile_id', profileId)
  if (employeeError) {
    throw mapWriteError(employeeError)
  }

  return fetchEmployeeDetail(profileId)
}

// -------------------------------------------------------------------------
// 3. Baja en dos pasos (EMP-005, `06` sección 3: "Baja | update employees +
//    Edge deactivate_user | O; A + manage_users | Dos pasos en una acción
//    de pantalla")
// -------------------------------------------------------------------------

/**
 * Dos pasos, en este orden -- decisión menor (`06` no fija el orden, ver el
 * reporte de EMP-005): primero se revoca el acceso con la Edge Function
 * (`deactivate_user`: banea el login, marca `profiles.is_active = false` y
 * cierra sesiones) y recién después se marca `employees.status =
 * 'terminated'`. Si el segundo paso fallara, la persona queda con el
 * acceso YA bloqueado pero con `employees.status` todavía en `active` (una
 * etiqueta desactualizada en la ficha, corregible reintentando) -- se
 * prefiere ese estado parcial al inverso (marcar la baja laboral pero dejar
 * el acceso abierto), porque el riesgo de seguridad de un ex empleado que
 * todavía puede iniciar sesión es peor que el de un dato administrativo
 * demorado.
 */
export async function terminateEmployee(
  profileId: string,
  reason: string,
  updatedBy: string,
): Promise<void> {
  await deactivateUserAccount(profileId, reason)

  const { error } = await supabase
    .from('employees')
    .update({
      status: 'terminated',
      terminated_at: new Date().toISOString().slice(0, 10),
      updated_by: updatedBy,
    })
    .eq('profile_id', profileId)
  if (error) {
    throw new ApiError(
      'Desactivamos el acceso de la persona, pero no pudimos actualizar su estado laboral a baja. Volvé a intentarlo desde la ficha.',
      'EMPLOYEE_STATUS_NOT_UPDATED',
    )
  }
}

// Reexportadas tal cual desde `users.ts` (EMP-005): resetear contraseña y
// cerrar sesiones de un empleado son la misma acción de la Edge Function
// que USERS-011 ya usa para administradores -- ver el comentario de
// cabecera de este módulo.
export const resetEmployeePassword = resetUserPassword
export const signOutEmployee = signOutUserAccount

// -------------------------------------------------------------------------
// 4. Habilitaciones por cliente (EMP-006, `employee_client_permissions`,
//    P-034: "lista vacía = habilitado para todos")
// -------------------------------------------------------------------------

export interface EmployeeClientPermission {
  clientId: string
  clientName: string
}

interface ClientPermissionRow {
  client_id: string
  clients: { legal_name: string; trade_name: string | null } | null
}

/** Clientes habilitados de una persona puntual, para la pestaña Habilitaciones de ADM-17. */
export async function fetchEmployeeClientPermissionsFor(
  employeeId: string,
): Promise<EmployeeClientPermission[]> {
  const { data, error } = await supabase
    .from('employee_client_permissions')
    .select('client_id, clients(legal_name, trade_name)')
    .eq('employee_id', employeeId)

  if (error) {
    throw fromPostgrestError(error)
  }
  return ((data ?? []) as ClientPermissionRow[])
    .map((row) => ({
      clientId: row.client_id,
      clientName: row.clients?.trade_name ?? row.clients?.legal_name ?? '',
    }))
    .sort((a, b) => a.clientName.localeCompare(b.clientName, 'es'))
}

/** Alta de una habilitación (`06` sección 3: "insert/delete en employee_client_permissions"). */
export async function addEmployeeClientPermission(
  employeeId: string,
  clientId: string,
  createdBy: string,
): Promise<void> {
  const { error } = await supabase.from('employee_client_permissions').insert({
    employee_id: employeeId,
    client_id: clientId,
    created_by: createdBy,
  })
  if (error) {
    if (error.code === '23505') {
      throw new ApiError(
        'Ese cliente ya está habilitado para esta persona.',
        'DUPLICATE',
      )
    }
    throw mapWriteError(error)
  }
}

/** Quita una habilitación (no es baja lógica: la tabla no tiene `deleted_at`, `06` sección 3). */
export async function removeEmployeeClientPermission(
  employeeId: string,
  clientId: string,
): Promise<void> {
  const { error } = await supabase
    .from('employee_client_permissions')
    .delete()
    .eq('employee_id', employeeId)
    .eq('client_id', clientId)
  if (error) {
    throw mapWriteError(error)
  }
}

// -------------------------------------------------------------------------
// 5. Disponibilidad declarada (EMP-007, `employee_availability`, P-035)
// -------------------------------------------------------------------------

export interface EmployeeAvailabilitySlot {
  id: string
  /** `0` = domingo .. `6` = sábado (`04_Modelo_de_Datos.md` sección 2.1, `extract(dow from ...)`). */
  weekday: number
  /** `"HH:mm:ss"`, tal cual la devuelve Postgres para una columna `time`. */
  startTime: string
  endTime: string
}

export async function fetchEmployeeAvailability(
  employeeId: string,
): Promise<EmployeeAvailabilitySlot[]> {
  const { data, error } = await supabase
    .from('employee_availability')
    .select('id, weekday, start_time, end_time')
    .eq('employee_id', employeeId)
    .order('weekday', { ascending: true })
    .order('start_time', { ascending: true })

  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    weekday: row.weekday,
    startTime: row.start_time,
    endTime: row.end_time,
  }))
}

export interface EmployeeAvailabilitySlotInput {
  weekday: number
  startTime: string
  endTime: string
}

/** Alta de una franja (`0006_employees.sql`: `end_time > start_time`, mismo check que replica el esquema zod). */
export async function createEmployeeAvailability(
  employeeId: string,
  input: EmployeeAvailabilitySlotInput,
  createdBy: string,
): Promise<void> {
  const { error } = await supabase.from('employee_availability').insert({
    employee_id: employeeId,
    weekday: input.weekday,
    start_time: input.startTime,
    end_time: input.endTime,
    created_by: createdBy,
  })
  if (error) {
    throw mapWriteError(error)
  }
}

/** Quita una franja (sin baja lógica: `employee_availability` no tiene `deleted_at`, es traza simple). */
export async function deleteEmployeeAvailability(id: string): Promise<void> {
  const { error } = await supabase
    .from('employee_availability')
    .delete()
    .eq('id', id)
  if (error) {
    throw mapWriteError(error)
  }
}

// -------------------------------------------------------------------------
// 6. Licencias (EMP-008, `employee_leaves`, P-033)
// -------------------------------------------------------------------------

export interface EmployeeLeave {
  id: string
  startsOn: string
  endsOn: string | null
  reason: string | null
  deletedAt: string | null
}

/** Todas las licencias de la persona, incluidas las dadas de baja lógica (para el historial, `06` sección 3). */
export async function fetchEmployeeLeaves(
  employeeId: string,
): Promise<EmployeeLeave[]> {
  const { data, error } = await supabase
    .from('employee_leaves')
    .select('id, starts_on, ends_on, reason, deleted_at')
    .eq('employee_id', employeeId)
    .order('starts_on', { ascending: false })

  if (error) {
    throw fromPostgrestError(error)
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    reason: row.reason,
    deletedAt: row.deleted_at,
  }))
}

export interface EmployeeLeaveInput {
  startsOn: string
  endsOn: string | null
  reason: string | null
}

/** Alta de una licencia. Errores posibles: `LEAVE_OVERLAP` (exclusión de solapamiento, `06` sección 3). */
export async function createEmployeeLeave(
  employeeId: string,
  input: EmployeeLeaveInput,
  createdBy: string,
): Promise<void> {
  const { error } = await supabase.from('employee_leaves').insert({
    employee_id: employeeId,
    starts_on: input.startsOn,
    ends_on: input.endsOn,
    reason: input.reason,
    created_by: createdBy,
  })
  if (error) {
    throw mapWriteError(error)
  }
}

/**
 * Edición de una licencia (AJ2-08): fechas y motivo, con el mismo formulario
 * del alta. Es un update de la misma fila, así que la exclusión de
 * solapamiento no la compara consigo misma; sí choca contra otras licencias
 * vigentes (`LEAVE_OVERLAP`).
 */
export async function updateEmployeeLeave(
  id: string,
  input: EmployeeLeaveInput,
  updatedBy: string,
): Promise<void> {
  const { error } = await supabase
    .from('employee_leaves')
    .update({
      starts_on: input.startsOn,
      ends_on: input.endsOn,
      reason: input.reason,
      updated_by: updatedBy,
    })
    .eq('id', id)
  if (error) {
    throw mapWriteError(error)
  }
}

/**
 * Baja lógica de una licencia (EMP-008, "no ofrezcas borrar físicamente,
 * aunque la política de la base lo permita" -- ver el reporte del encargo).
 * Libera el rango de fechas que ocupaba para la exclusión de solapamiento
 * (`employee_leaves_no_overlap` filtra `where deleted_at is null`), así que
 * después se puede cargar otra licencia superpuesta si hacía falta corregir
 * una carga errónea.
 */
export async function deactivateEmployeeLeave(
  id: string,
  updatedBy: string,
): Promise<void> {
  const { error } = await supabase
    .from('employee_leaves')
    .update({ deleted_at: new Date().toISOString(), updated_by: updatedBy })
    .eq('id', id)
  if (error) {
    throw mapWriteError(error)
  }
}
