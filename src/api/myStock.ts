import { supabase } from '@/lib/supabase'
import { ApiError, fromPostgrestError } from './errors'

/**
 * `src/api/myStock.ts` (P25.4, módulo E, IS-11 a IS-14, IS-20, IS-28, IS-29):
 * la parte de celular de «Insumos y control de stock», para empleados y
 * coordinadores. Lee el catálogo sin precios ni cantidades
 * (`v_supply_catalog`), las opciones de turno y de sede para retirar
 * (`v_withdrawal_shift_options`, `v_withdrawal_site_options`), lo propio
 * (`v_my_withdrawals`, `v_my_shortage_reports`) y llama a `register_withdrawal`
 * (siempre el retiro propio: sin `p_person_id`) y `report_supply_shortage`
 * (`docs/database.md`, «Insumos y control de stock»).
 *
 * Nada de lo que sale de acá lleva precios ni stock (IS-20). La hora de cada
 * retiro la pone el servidor: se muestra la que devuelve la RPC (ADR-009).
 * Los hooks de TanStack Query están en `src/features/myStock/queries.ts`.
 */

export const SUPPLY_IMAGES_BUCKET = 'supply-images'

/** Vida de las URL firmadas de las imágenes (segundos). */
export const SUPPLY_IMAGE_TTL_SECONDS = 3600

/** Cuántos retiros y avisos propios trae cada lista. */
export const MY_STOCK_LIST_LIMIT = 30

// -------------------------------------------------------------------------
// 1. Errores (`hint` -> mensaje en español)
// -------------------------------------------------------------------------

/**
 * Mensaje para cada código de error de `register_withdrawal` y
 * `report_supply_shortage`. `INSUFFICIENT_STOCK` no está acá a propósito: se
 * muestra el mensaje del servidor, que para estos roles ya viene sin la
 * cantidad («No alcanza el stock de X. Consultá en la oficina.», IS-20).
 */
export const STOCK_HINT_MESSAGES: Record<string, string> = {
  FORBIDDEN: 'No tenés permiso para hacer esto.',
  INVALID_LINES: 'Agregá al menos un artículo para el retiro.',
  INVALID_QTY:
    'Las cantidades tienen que ser números enteros mayores que cero.',
  DUPLICATE_SUPPLY: 'Hay un artículo repetido. Dejalo una sola vez.',
  SUPPLY_NOT_FOUND: 'No encontramos ese artículo. Actualizá la lista.',
  SUPPLY_INACTIVE: 'Ese artículo ya no está disponible.',
  PERSON_REQUIRED: 'No pudimos identificar quién retira. Volvé a ingresar.',
  PERSON_NOT_FOUND: 'No pudimos identificar quién retira. Volvé a ingresar.',
  SHIFT_OR_SITE_REQUIRED: 'Elegí un turno o una sede para el retiro.',
  SHIFT_NOT_FOUND: 'No encontramos ese turno.',
  SHIFT_NOT_AVAILABLE: 'Ese turno está cancelado. Elegí otro.',
  SHIFT_NOT_ALLOWED: 'No podés elegir ese turno.',
  SITE_SHIFT_MISMATCH: 'La sede no corresponde a ese turno.',
  SITE_NOT_FOUND: 'No encontramos esa sede.',
  SITE_NOT_ALLOWED: 'No podés elegir esa sede.',
  NOTE_REQUIRED: 'Contanos para qué es: la observación es obligatoria.',
  SHORTAGE_TARGET_REQUIRED:
    'Elegí un artículo del catálogo o escribí cuál es el que falta.',
}

/** Mensaje en español de un código de error (`null` si no hay uno propio). */
export function stockErrorMessage(hint: string | null): string | null {
  if (!hint) return null
  return STOCK_HINT_MESSAGES[hint] ?? null
}

/**
 * Traduce el error de una RPC del módulo: pisa el texto del servidor con el
 * propio de cada código, salvo `INSUFFICIENT_STOCK` (se deja el del servidor).
 */
export function toStockError(error: {
  code?: string | null
  message: string
  hint?: string | null
}): ApiError {
  const base = fromPostgrestError(error)
  const own = stockErrorMessage(base.hint)
  return own ? new ApiError(own, base.hint) : base
}

// -------------------------------------------------------------------------
// 2. Tipos
// -------------------------------------------------------------------------

/** Un artículo del catálogo (sin precios ni cantidades, IS-20). */
export interface SupplyCatalogItem {
  id: string
  code: string
  name: string
  presentation: string | null
  categoryId: string | null
  categoryName: string | null
  categorySortOrder: number
  imagePath: string | null
  /** «Sin stock»: no se puede elegir para un retiro (IS-28). */
  outOfStock: boolean
}

/** Un turno que se puede elegir para el retiro (IS-28). */
export interface WithdrawalShiftOption {
  shiftId: string
  shiftDate: string
  startTime: string
  endTime: string
  startsAt: string | null
  openEnded: boolean
  clientName: string
  siteId: string
  siteName: string
  /** Un turno propio del empleado. */
  isAssigned: boolean
  /** «Mis sedes» del coordinador (CJ-25). */
  isPriority: boolean
}

/** Una sede para un retiro sin turno puntual. */
export interface WithdrawalSiteOption {
  siteId: string
  siteName: string
  clientId: string
  clientName: string
  isPriority: boolean
}

export interface WithdrawalLine {
  supplyId: string
  code: string
  name: string
  presentation: string | null
  qty: number
}

/** Un retiro propio (también los que cargó la oficina a mi nombre). */
export interface MyWithdrawal {
  movementId: string
  recordedAt: string
  note: string | null
  onBehalf: boolean
  registeredByName: string | null
  shiftId: string | null
  shiftDate: string | null
  startTime: string | null
  endTime: string | null
  clientName: string | null
  siteName: string | null
  totalQty: number
  /** Anulado por la administración (IS-27). */
  voidedAt: string | null
  voidReason: string | null
  lines: WithdrawalLine[]
}

export type ShortageStatus = 'open' | 'resolved'

/** Un aviso de faltante propio. */
export interface MyShortageReport {
  id: string
  createdAt: string
  status: ShortageStatus
  /** Artículo del catálogo con su presentación, o `null` si fue texto libre. */
  supplyName: string | null
  supplyCode: string | null
  description: string | null
  shiftDate: string | null
  startTime: string | null
  endTime: string | null
  clientName: string | null
  siteName: string | null
  comment: string | null
  resolvedAt: string | null
  resolvedByName: string | null
  resolutionNote: string | null
}

export interface WithdrawalInput {
  lines: { supplyId: string; qty: number }[]
  /** Turno puntual o sede (uno de los dos). */
  shiftId?: string | null
  siteId?: string | null
  /** Obligatoria sin turno (la RPC también lo exige). */
  note?: string | null
}

/** Lo que devuelve `register_withdrawal`: sin precios ni stock. */
export interface WithdrawalResult {
  movementId: string
  /** Hora oficial: la del servidor. */
  recordedAt: string
  shiftId: string | null
  siteId: string | null
  note: string | null
  lines: WithdrawalLine[]
}

export interface ShortageInput {
  /** Un artículo del catálogo **o** una descripción libre. */
  supplyId?: string | null
  description?: string | null
  shiftId?: string | null
  siteId?: string | null
  comment?: string | null
}

export interface ShortageResult {
  id: string
  status: ShortageStatus
  createdAt: string
  supplyId: string | null
  description: string | null
}

// -------------------------------------------------------------------------
// 3. Mapeos
// -------------------------------------------------------------------------

interface RawLine {
  supply_id: string
  code: string
  name: string
  presentation: string | null
  qty: number
}

function asArray<T>(json: unknown): T[] {
  return Array.isArray(json) ? (json as T[]) : []
}

function mapLine(raw: RawLine): WithdrawalLine {
  return {
    supplyId: raw.supply_id,
    code: raw.code,
    name: raw.name,
    presentation: raw.presentation ?? null,
    qty: raw.qty,
  }
}

export function mapCatalogRow(row: {
  id: string | null
  code: string | null
  name: string | null
  presentation: string | null
  category_id: string | null
  category_name: string | null
  category_sort_order: number | null
  image_path: string | null
  out_of_stock: boolean | null
}): SupplyCatalogItem {
  return {
    id: row.id as string,
    code: row.code ?? '',
    name: row.name ?? '',
    presentation: row.presentation,
    categoryId: row.category_id,
    categoryName: row.category_name,
    categorySortOrder: row.category_sort_order ?? 0,
    imagePath: row.image_path,
    outOfStock: Boolean(row.out_of_stock),
  }
}

// -------------------------------------------------------------------------
// 4. Lecturas
// -------------------------------------------------------------------------

/** El catálogo activo, ordenado por categoría y nombre. */
export async function fetchSupplyCatalog(): Promise<SupplyCatalogItem[]> {
  const { data, error } = await supabase
    .from('v_supply_catalog')
    .select('*')
    .order('category_sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) throw fromPostgrestError(error)
  return (data ?? []).map(mapCatalogRow)
}

/** Los turnos entre los que puede elegir quien retira (IS-28). */
export async function fetchWithdrawalShiftOptions(): Promise<
  WithdrawalShiftOption[]
> {
  const { data, error } = await supabase
    .from('v_withdrawal_shift_options')
    .select('*')
    .order('is_priority', { ascending: false })
    .order('shift_date', { ascending: true })
    .order('start_time', { ascending: true })

  if (error) throw fromPostgrestError(error)
  return (data ?? []).map((row) => ({
    shiftId: row.shift_id as string,
    shiftDate: row.shift_date as string,
    startTime: row.start_time ?? '00:00:00',
    endTime: row.end_time ?? '23:59:00',
    startsAt: row.starts_at,
    openEnded: Boolean(row.open_ended),
    clientName: row.client_name ?? '',
    siteId: row.site_id as string,
    siteName: row.site_name ?? '',
    isAssigned: Boolean(row.is_assigned),
    isPriority: Boolean(row.is_priority),
  }))
}

/** Las sedes para un retiro sin turno puntual, «Mis sedes» primero. */
export async function fetchWithdrawalSiteOptions(): Promise<
  WithdrawalSiteOption[]
> {
  const { data, error } = await supabase
    .from('v_withdrawal_site_options')
    .select('*')
    .order('is_priority', { ascending: false })
    .order('client_name', { ascending: true })
    .order('site_name', { ascending: true })

  if (error) throw fromPostgrestError(error)
  return (data ?? []).map((row) => ({
    siteId: row.site_id as string,
    siteName: row.site_name ?? '',
    clientId: row.client_id ?? '',
    clientName: row.client_name ?? '',
    isPriority: Boolean(row.is_priority),
  }))
}

/** Mis retiros, el más reciente primero. */
export async function fetchMyWithdrawals(
  limit = MY_STOCK_LIST_LIMIT,
): Promise<MyWithdrawal[]> {
  const { data, error } = await supabase
    .from('v_my_withdrawals')
    .select('*')
    .order('recorded_at', { ascending: false })
    .limit(limit)

  if (error) throw fromPostgrestError(error)
  return (data ?? []).map((row) => ({
    movementId: row.movement_id as string,
    recordedAt: row.recorded_at as string,
    note: row.note,
    onBehalf: Boolean(row.on_behalf),
    registeredByName: row.registered_by_name,
    shiftId: row.shift_id,
    shiftDate: row.shift_date,
    startTime: row.start_time,
    endTime: row.end_time,
    clientName: row.client_name,
    siteName: row.site_name,
    totalQty: row.total_qty ?? 0,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
    lines: asArray<RawLine>(row.lines).map(mapLine),
  }))
}

/** Mis avisos de faltante (la vista trae los abiertos primero). */
export async function fetchMyShortageReports(
  limit = MY_STOCK_LIST_LIMIT,
): Promise<MyShortageReport[]> {
  const { data, error } = await supabase
    .from('v_my_shortage_reports')
    .select('*')
    .order('status', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw fromPostgrestError(error)
  return (data ?? []).map((row) => ({
    id: row.id as string,
    createdAt: row.created_at as string,
    status: row.status ?? 'open',
    supplyName: row.supply_name,
    supplyCode: row.supply_code,
    description: row.description,
    shiftDate: row.shift_date,
    startTime: row.start_time,
    endTime: row.end_time,
    clientName: row.client_name,
    siteName: row.site_name,
    comment: row.comment,
    resolvedAt: row.resolved_at,
    resolvedByName: row.resolved_by_name,
    resolutionNote: row.resolution_note,
  }))
}

/**
 * Firma las imágenes del bucket privado `supply-images` en una sola llamada
 * (nunca se arma una URL pública). Devuelve ruta -> URL; lo que no se pudo
 * firmar no aparece y la pantalla muestra el ícono de siempre.
 */
export async function signSupplyImages(
  paths: readonly string[],
  expiresInSeconds = SUPPLY_IMAGE_TTL_SECONDS,
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(paths.filter((path) => path !== '')))
  const urls = new Map<string, string>()
  if (unique.length === 0) return urls

  const { data } = await supabase.storage
    .from(SUPPLY_IMAGES_BUCKET)
    .createSignedUrls(unique, expiresInSeconds)

  for (const item of data ?? []) {
    if (item.path && item.signedUrl && !item.error) {
      urls.set(item.path, item.signedUrl)
    }
  }
  return urls
}

// -------------------------------------------------------------------------
// 5. RPC
// -------------------------------------------------------------------------

interface RawWithdrawalResult {
  movement: {
    id: string
    recorded_at: string
    shift_id: string | null
    site_id: string | null
    note: string | null
  }
  lines: RawLine[]
}

/** Registra el retiro propio (`p_person_id` no se manda). Descuenta el stock en el momento (IS-13). */
export async function registerWithdrawal(
  input: WithdrawalInput,
): Promise<WithdrawalResult> {
  const { data, error } = await supabase.rpc('register_withdrawal', {
    p_lines: input.lines.map((line) => ({
      supply_id: line.supplyId,
      qty: line.qty,
    })),
    p_shift_id: input.shiftId || undefined,
    p_site_id: input.shiftId ? undefined : input.siteId || undefined,
    p_note: input.note?.trim() || undefined,
  })
  if (error) throw toStockError(error)

  const raw = data as unknown as RawWithdrawalResult
  return {
    movementId: raw.movement.id,
    recordedAt: raw.movement.recorded_at,
    shiftId: raw.movement.shift_id,
    siteId: raw.movement.site_id,
    note: raw.movement.note,
    lines: asArray<RawLine>(raw.lines).map(mapLine),
  }
}

/** Avisa que falta un insumo: un artículo del catálogo o un texto libre (IS-29). */
export async function reportSupplyShortage(
  input: ShortageInput,
): Promise<ShortageResult> {
  const { data, error } = await supabase.rpc('report_supply_shortage', {
    p_supply_id: input.supplyId || undefined,
    p_description: input.supplyId
      ? undefined
      : input.description?.trim() || undefined,
    p_shift_id: input.shiftId || undefined,
    p_site_id: input.shiftId ? undefined : input.siteId || undefined,
    p_comment: input.comment?.trim() || undefined,
  })
  if (error) throw toStockError(error)

  return {
    id: data.id,
    status: data.status,
    createdAt: data.created_at,
    supplyId: data.supply_id,
    description: data.description,
  }
}
