import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import { computeNationalHolidays } from '@/features/settings/nationalHolidays'
import { ApiError, fromPostgrestError } from './errors'

/**
 * `src/api/settings.ts` (USERS-012 a USERS-016, patrón fijado en
 * `src/api/users.ts` — ver `src/api/README.md`): las cuatro pantallas de
 * "Configuración" que le siguen a ADM-27 en `05_Pantallas_y_Navegacion.md`
 * sección 2.7 — ADM-28 (empresa), ADM-29 (feriados), ADM-30 (criterios de
 * calificación) y ADM-31 (eventos de seguridad).
 *
 * A diferencia de `users.ts`, ninguna de estas cuatro pantallas tiene una
 * RPC propia (`06_API.md` sección 9: "upsert_rating_criteria(...),
 * upsert_holiday(...) | O | Mantenimiento simple (**o inserts directos con
 * RLS**)" — el backend ya construido optó por la segunda opción, no hay
 * `upsert_holiday`/`upsert_rating_criteria` en las migraciones): todas las
 * escrituras acá son `.from('tabla').insert/update(...)` directas, protegidas
 * solo por RLS. Dos consecuencias que no aparecen en `users.ts`:
 *
 * 1. Como no hay una RPC que arme el mensaje de error en español (`06`
 *    sección 0: "el mensaje lo escribe la propia función"), una violación de
 *    restricción (por ejemplo la fecha repetida de `holidays.holiday_date
 *    unique`) le llega a `supabase-js` con el texto en inglés de Postgres.
 *    `mapWriteError(...)` traduce los códigos de error conocidos (por ahora
 *    solo `23505`, unicidad) antes de envolver con `fromPostgrestError`; el
 *    resto de los códigos caen en el mensaje genérico de Postgres tal cual
 *    (documentado en el reporte del encargo, es una diferencia real con el
 *    patrón de `users.ts` que conviene que confirme el orquestador).
 * 2. `created_by`/`updated_by` no los completa un trigger (`app.set_updated_at`
 *    solo toca `updated_at`, ver `0001_extensions_and_schema_app.sql`): cada
 *    función que escribe acá recibe el `profileId` de quien está logueado
 *    como parámetro (lo pasa la pantalla, que ya lo tiene de `useAuth()`) y
 *    lo manda a mano en el `insert`/`update`.
 */

// -------------------------------------------------------------------------
// Errores de escritura directa a tabla (sin RPC, ver comentario de arriba)
// -------------------------------------------------------------------------

/**
 * Códigos de restricción de Postgres para los que hay traducción propia. No
 * delega en `fromPostgrestError` (que espera el `PostgrestError` completo de
 * `@supabase/supabase-js`): alcanza con `message`/`code`/`hint`, que es lo
 * único que devuelve cualquier variante del cliente en un error de escritura
 * -- así el resto de esta función no depende de un casteo al tipo exacto de
 * la librería.
 */
function mapWriteError(error: {
  code?: string | null
  message: string
  hint?: string | null
}): ApiError {
  if (error.code === '23505') {
    return new ApiError(
      'Ya existe un registro con esos datos (por ejemplo, la misma fecha).',
      'DUPLICATE',
    )
  }
  return fromPostgrestError(error)
}

// -------------------------------------------------------------------------
// 1. company_settings (USERS-012, ADM-28)
// -------------------------------------------------------------------------

export interface CompanySettings {
  name: string | null
  logoPath: string | null
  supportPhone: string | null
  locationConsentText: string | null
  updatedBy: string | null
  updatedAt: string
}

/**
 * Fila única de configuración de la empresa (04 sección 2.6: singleton
 * `id = 1`, creada por el seed). `company_settings_select_authenticated`
 * (0012) la deja leer completa a cualquier persona logueada — la pantalla
 * decide qué campos mostrar según el rol (owner ve todo, admin solo el
 * logo), no el servidor.
 */
export async function fetchCompanySettings(): Promise<CompanySettings> {
  const { data, error } = await supabase
    .from('company_settings')
    .select(
      'name, logo_path, support_phone, location_consent_text, updated_by, updated_at',
    )
    .eq('id', 1)
    .single()

  if (error) {
    throw fromPostgrestError(error)
  }

  return {
    name: data.name,
    logoPath: data.logo_path,
    supportPhone: data.support_phone,
    locationConsentText: data.location_consent_text,
    updatedBy: data.updated_by,
    updatedAt: data.updated_at,
  }
}

export interface UpdateCompanySettingsInput {
  name?: string | null
  supportPhone?: string | null
  locationConsentText?: string | null
  /** `profiles.id` de quien guarda (ver nota de cabecera, punto 2). */
  updatedBy: string
}

/**
 * Actualiza nombre, teléfono y/o texto de consentimiento (solo dueño,
 * `canEditCompanyDetails` en `permissions.ts` ya oculta estos campos para un
 * administrador). El logo se sube y se asocia aparte (`uploadCompanyLogo`).
 */
export async function updateCompanySettings(
  input: UpdateCompanySettingsInput,
): Promise<void> {
  const patch: Database['public']['Tables']['company_settings']['Update'] = {
    updated_by: input.updatedBy,
  }
  if (input.name !== undefined) patch.name = input.name
  if (input.supportPhone !== undefined) patch.support_phone = input.supportPhone
  if (input.locationConsentText !== undefined) {
    patch.location_consent_text = input.locationConsentText
  }

  const { error } = await supabase
    .from('company_settings')
    .update(patch)
    .eq('id', 1)

  if (error) {
    throw mapWriteError(error)
  }
}

const LOGO_MAX_SIZE_BYTES = 1_048_576 // 1 MB (0014_storage_buckets.sql, ADR-016)
const LOGO_ALLOWED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/svg+xml',
  'image/webp',
])
const LOGO_MIME_TO_EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
}

/** Mensaje de validación de logo, repetido del lado del cliente (ver `schemas.ts`). */
export function validateLogoFile(file: File): string | null {
  if (!LOGO_ALLOWED_MIME_TYPES.has(file.type)) {
    return 'El logo tiene que ser PNG, JPEG, SVG o WebP.'
  }
  if (file.size > LOGO_MAX_SIZE_BYTES) {
    return 'El logo no puede superar 1 MB.'
  }
  return null
}

/**
 * Sube el logo al bucket `branding` (`0014_storage_buckets.sql`: nombre fijo
 * `logo.{ext}`, upsert) y actualiza `company_settings.logo_path` (USERS-012,
 * P-117). `previousLogoPath` es opcional: si la extensión cambió respecto al
 * logo anterior, se intenta borrar el archivo viejo para no dejar huérfanos
 * en el bucket -- best effort, un error acá no interrumpe la subida (el
 * logo nuevo ya quedó guardado y asociado, que es lo que importa).
 */
export async function uploadCompanyLogo(
  file: File,
  updatedBy: string,
  previousLogoPath: string | null,
): Promise<{ logoPath: string }> {
  const validationError = validateLogoFile(file)
  if (validationError) {
    throw new ApiError(validationError, 'INVALID_FILE')
  }

  // `validateLogoFile` ya comprobó que `file.type` es una de las claves de
  // `LOGO_MIME_TO_EXTENSION`; el `?? 'png'` es solo para que TypeScript no
  // vea `extension` como potencialmente `undefined` (`noUncheckedIndexedAccess`),
  // nunca debería usarse en los hechos.
  const extension = LOGO_MIME_TO_EXTENSION[file.type] ?? 'png'
  const logoPath = `logo.${extension}`

  const { error: uploadError } = await supabase.storage
    .from('branding')
    .upload(logoPath, file, { upsert: true, contentType: file.type })

  if (uploadError) {
    throw new ApiError(
      'No pudimos subir el logo. Probá de nuevo en un momento.',
      null,
    )
  }

  const { error: updateError } = await supabase
    .from('company_settings')
    .update({ logo_path: logoPath, updated_by: updatedBy })
    .eq('id', 1)

  if (updateError) {
    throw mapWriteError(updateError)
  }

  if (previousLogoPath && previousLogoPath !== logoPath) {
    await supabase.storage.from('branding').remove([previousLogoPath])
  }

  return { logoPath }
}

// -------------------------------------------------------------------------
// 2. holidays (USERS-014, ADM-29)
// -------------------------------------------------------------------------

export interface Holiday {
  id: string
  holidayDate: string
  name: string | null
  deletedAt: string | null
}

/**
 * Feriados de un año, incluidos los dados de baja lógica (04 sección 2.6,
 * P-050): la política `holidays_write_owner` ("for all") deja al dueño ver
 * también los borrados, sumada por RLS (OR) a `holidays_select_authenticated`
 * (que sí filtra `deleted_at is null`) -- hace falta ver los borrados para
 * que "Cargar feriados nacionales" (`loadNationalHolidays`) no choque contra
 * `holiday_date unique` reinsertando una fecha que ya existe, aunque esté de
 * baja (la restricción no tiene `where deleted_at is null`, ver el reporte
 * del encargo). La pantalla filtra los borrados para no listarlos.
 */
export async function fetchHolidays(year: number): Promise<Holiday[]> {
  const { data, error } = await supabase
    .from('holidays')
    .select('id, holiday_date, name, deleted_at')
    .gte('holiday_date', `${year}-01-01`)
    .lte('holiday_date', `${year}-12-31`)
    .order('holiday_date', { ascending: true })

  if (error) {
    throw fromPostgrestError(error)
  }

  return (data ?? [])
    .filter(
      (row): row is typeof row & { holiday_date: string } =>
        row.holiday_date != null,
    )
    .map((row) => ({
      id: row.id,
      holidayDate: row.holiday_date,
      name: row.name,
      deletedAt: row.deleted_at,
    }))
}

export interface CreateHolidayInput {
  holidayDate: string
  name: string
  createdBy: string
}

/** Alta manual de un feriado (dueño). */
export async function createHoliday(input: CreateHolidayInput): Promise<void> {
  const { error } = await supabase.from('holidays').insert({
    holiday_date: input.holidayDate,
    name: input.name,
    created_by: input.createdBy,
  })

  if (error) {
    throw mapWriteError(error)
  }
}

/** Baja lógica de un feriado (P-014/P-105: nada se borra físicamente). */
export async function deactivateHoliday(
  id: string,
  updatedBy: string,
): Promise<void> {
  const { error } = await supabase
    .from('holidays')
    .update({ deleted_at: new Date().toISOString(), updated_by: updatedBy })
    .eq('id', id)

  if (error) {
    throw mapWriteError(error)
  }
}

/**
 * Reactiva un feriado dado de baja, reusando la fila existente en vez de
 * insertar una nueva (evita el choque con `holiday_date unique` -- ver el
 * comentario de `fetchHolidays`). Solo la usa `loadNationalHolidays` cuando
 * la fecha nacional coincide con un feriado que ya estaba borrado.
 */
async function reactivateHoliday(
  id: string,
  name: string,
  updatedBy: string,
): Promise<void> {
  const { error } = await supabase
    .from('holidays')
    .update({ deleted_at: null, name, updated_by: updatedBy })
    .eq('id', id)

  if (error) {
    throw mapWriteError(error)
  }
}

export interface LoadNationalHolidaysResult {
  created: number
  reactivated: number
  skipped: number
}

/**
 * "Cargar feriados nacionales de <año>" (USERS-014, `06_API.md`: "botón...
 * con una lista fija en el frontend, PROPUESTO"). La lista no es un array de
 * fechas por año (imposible de mantener a mano para siempre, ver el reporte
 * del encargo sobre feriados móviles y trasladables): son reglas fijas de
 * `nationalHolidays.ts`, calculadas para el año pedido. No duplica fechas que
 * ya existan (activas: se saltean; de baja: se reactivan, ver comentario de
 * `fetchHolidays`).
 */
export async function loadNationalHolidays(
  year: number,
  createdBy: string,
): Promise<LoadNationalHolidaysResult> {
  const nationalHolidays = computeNationalHolidays(year)
  const existing = await fetchHolidays(year)
  const existingByDate = new Map(
    existing.map((holiday) => [holiday.holidayDate, holiday]),
  )

  let created = 0
  let reactivated = 0
  let skipped = 0

  for (const holiday of nationalHolidays) {
    const existingHoliday = existingByDate.get(holiday.date)
    if (!existingHoliday) {
      await createHoliday({
        holidayDate: holiday.date,
        name: holiday.name,
        createdBy,
      })
      created += 1
      continue
    }
    if (existingHoliday.deletedAt) {
      await reactivateHoliday(existingHoliday.id, holiday.name, createdBy)
      reactivated += 1
      continue
    }
    skipped += 1
  }

  return { created, reactivated, skipped }
}

// -------------------------------------------------------------------------
// 3. rating_criteria (USERS-015, ADM-30)
// -------------------------------------------------------------------------

export interface RatingCriterion {
  id: string
  position: number
  title: string
  description: string | null
  validFrom: string
  validTo: string | null
}

/**
 * Guía de calificación completa, vigente y pasada (04 sección 2.5, P-080,
 * P-087, P-101: "O, A, S: vigentes y pasadas" -- la pantalla ADM-30 en sí es
 * solo del dueño por `05_Pantallas_y_Navegacion.md`, pero la tabla también la
 * lee un administrador o supervisor desde otras pantallas, por eso RLS no la
 * restringe más).
 */
export async function fetchRatingCriteria(): Promise<RatingCriterion[]> {
  const { data, error } = await supabase
    .from('rating_criteria')
    .select('id, position, title, description, valid_from, valid_to')
    .order('position', { ascending: true })

  if (error) {
    throw fromPostgrestError(error)
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    position: row.position,
    title: row.title,
    description: row.description,
    validFrom: row.valid_from,
    validTo: row.valid_to,
  }))
}

export interface CreateRatingCriterionInput {
  title: string
  description: string | null
  position: number
  createdBy: string
}

/** Alta de un criterio nuevo, al final de la lista (`position`). */
export async function createRatingCriterion(
  input: CreateRatingCriterionInput,
): Promise<void> {
  const { error } = await supabase.from('rating_criteria').insert({
    title: input.title,
    description: input.description,
    position: input.position,
    created_by: input.createdBy,
  })

  if (error) {
    throw mapWriteError(error)
  }
}

export interface UpdateRatingCriterionInput {
  id: string
  title: string
  description: string | null
  updatedBy: string
}

/** Edición de título/descripción de un criterio existente. */
export async function updateRatingCriterion(
  input: UpdateRatingCriterionInput,
): Promise<void> {
  const { error } = await supabase
    .from('rating_criteria')
    .update({
      title: input.title,
      description: input.description,
      updated_by: input.updatedBy,
    })
    .eq('id', input.id)

  if (error) {
    throw mapWriteError(error)
  }
}

/**
 * Cierra un criterio vigente: pone `valid_to` en hoy, no lo borra (P-087,
 * `04` sección 2.5: "Cerrar un criterio es poner valid_to; no se borra").
 */
export async function closeRatingCriterion(
  id: string,
  updatedBy: string,
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)
  const { error } = await supabase
    .from('rating_criteria')
    .update({ valid_to: today, updated_by: updatedBy })
    .eq('id', id)

  if (error) {
    throw mapWriteError(error)
  }
}

/**
 * Reordena la guía completa (flechas ↑/↓ de la pantalla, mismo patrón que
 * ADM-26): reescribe `position` de cada fila según el orden final que ya
 * armó la pantalla. `orderedIds` tiene que incluir TODAS las filas vigentes
 * y pasadas que se muestran en la lista (mismo criterio que `fetchRatingCriteria`).
 */
export async function reorderRatingCriteria(
  orderedIds: string[],
  updatedBy: string,
): Promise<void> {
  for (const [index, id] of orderedIds.entries()) {
    const { error } = await supabase
      .from('rating_criteria')
      .update({ position: index, updated_by: updatedBy })
      .eq('id', id)

    if (error) {
      throw mapWriteError(error)
    }
  }
}

// -------------------------------------------------------------------------
// 4. security_events (USERS-016, ADM-31)
// -------------------------------------------------------------------------

export type SecurityEventType =
  Database['public']['Enums']['security_event_type']

export interface SecurityEvent {
  id: string
  eventType: SecurityEventType
  actorId: string | null
  actorName: string | null
  targetId: string | null
  targetName: string | null
  createdAt: string
}

export interface SecurityEventFilters {
  eventType?: SecurityEventType
  /** Filtra por `actor_id` -- "quién hizo la acción" (04 sección 2.6). */
  actorId?: string
  /** Fecha desde (incluida), `yyyy-MM-dd`. */
  dateFrom?: string
  /** Fecha hasta (incluida), `yyyy-MM-dd`. */
  dateTo?: string
}

const SECURITY_EVENTS_LIMIT = 500

/**
 * Lista de eventos de seguridad (solo dueño, `security_events_select_owner`
 * -- para cualquier otra sesión esta consulta vuelve vacía por RLS, sin
 * error). Trae nombre de actor/destinatario embebiendo `profiles` dos veces
 * (misma ambigüedad de FK que `fetchUsers` en `users.ts`: hay que nombrar la
 * restricción exacta porque `security_events` tiene dos columnas que
 * apuntan a `profiles`). `limit(500)`: techo de seguridad, no paginado real
 * (05 sección 2.7 pide "tabla filtrable", no paginación) -- con las
 * decenas de personas de la operación (P-040) alcanza de sobra incluso sin
 * filtrar; si algún día no alcanzara, la fecha "desde" acota el volumen.
 */
export async function fetchSecurityEvents(
  filters: SecurityEventFilters = {},
): Promise<SecurityEvent[]> {
  // Un único literal de plantilla (sin concatenar con `+`): el cliente
  // tipado de PostgREST infiere la forma de `data` a partir del TEXTO
  // LITERAL de este `select` -- si se arma con `+`, el tipo deja de ser un
  // literal y la inferencia cae a `GenericStringError` (visto en este mismo
  // encargo al escribirlo en varias líneas concatenadas).
  let query = supabase
    .from('security_events')
    .select(
      `id, event_type, actor_id, target_id, created_at,
       actor:profiles!security_events_actor_id_fkey(first_name, last_name),
       target:profiles!security_events_target_id_fkey(first_name, last_name)`,
    )
    .order('created_at', { ascending: false })
    .limit(SECURITY_EVENTS_LIMIT)

  if (filters.eventType) {
    query = query.eq('event_type', filters.eventType)
  }
  if (filters.actorId) {
    query = query.eq('actor_id', filters.actorId)
  }
  if (filters.dateFrom) {
    query = query.gte('created_at', `${filters.dateFrom}T00:00:00`)
  }
  if (filters.dateTo) {
    query = query.lte('created_at', `${filters.dateTo}T23:59:59`)
  }

  const { data, error } = await query

  if (error) {
    throw fromPostgrestError(error)
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    eventType: row.event_type,
    actorId: row.actor_id,
    actorName: row.actor
      ? `${row.actor.first_name} ${row.actor.last_name}`
      : null,
    targetId: row.target_id,
    targetName: row.target
      ? `${row.target.first_name} ${row.target.last_name}`
      : null,
    createdAt: row.created_at,
  }))
}
