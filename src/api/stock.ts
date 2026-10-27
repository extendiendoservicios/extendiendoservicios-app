import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import { ApiError, fromPostgrestError } from './errors'

/**
 * `src/api/stock.ts` (módulo E «Insumos y control de stock», P25.2): la parte
 * de **administración**. Catálogo, categorías, precios, ingresos y
 * devoluciones, ajustes y lectura de `v_stock_admin`,
 * `v_stock_movements_admin` y del historial de precios.
 *
 * Lo del celular (`register_withdrawal` propio, `report_supply_shortage`,
 * `v_supply_catalog`, `v_my_*` y `v_withdrawal_*_options`) vive en
 * `src/api/myStock.ts` (P25.4); no se mezclan.
 *
 * - Escritura solo por RPC (`security definer`): `upsert_supply`,
 *   `set_supply_active`, `set_supply_prices`, `upsert_supply_category`,
 *   `register_stock_entry` y `adjust_stock`. Todas exigen `manage_stock`
 *   (dueño: implícita). Un administrador sin la capacidad solo lee (IS-21).
 * - Los errores llegan como `P0001` con `hint = CÓDIGO` y mensaje en español
 *   (`docs/database.md`, «Insumos y control de stock»).
 * - Las imágenes van al bucket privado `supply-images`, ruta
 *   `{supply_id}/{uuid}.webp`; se leen con URL firmadas.
 */

export type StockMovementKind =
  Database['public']['Enums']['stock_movement_kind']
export type StockAdjustmentReason =
  Database['public']['Enums']['stock_adjustment_reason']

/** Bucket privado de las imágenes de los artículos (IS-32). */
export const SUPPLY_IMAGES_BUCKET = 'supply-images'
/** Vida de las URL firmadas de las imágenes: la tabla se queda abierta un rato. */
export const SUPPLY_IMAGE_URL_TTL_SECONDS = 30 * 60

// -------------------------------------------------------------------------
// Errores (hint -> mensaje en español)
// -------------------------------------------------------------------------

/**
 * Mensaje de cada código del contrato. Los códigos de `DYNAMIC_HINTS` traen
 * en el `message` del servidor datos que el cliente no tiene (el nombre del
 * artículo, cuánto stock hay): ahí se muestra el texto del servidor tal cual
 * y este mapa queda de respaldo por si llegara vacío.
 */
export const STOCK_ERROR_MESSAGES: Record<string, string> = {
  FORBIDDEN:
    'Para hacer esto necesitás el permiso «Gestionar stock». Pedíselo a la dueña.',
  INVALID_LINES: 'Agregá al menos un artículo, con su cantidad.',
  INVALID_QTY:
    'Las cantidades tienen que ser números enteros distintos de cero.',
  INVALID_PRICE:
    'Los precios tienen que ser mayores o iguales a cero y con hasta dos decimales.',
  DUPLICATE_SUPPLY: 'Un artículo no puede repetirse en el mismo movimiento.',
  SUPPLY_NOT_FOUND: 'El artículo no existe.',
  SUPPLY_INACTIVE: 'El artículo está desactivado. Activalo para moverlo.',
  INSUFFICIENT_STOCK: 'No alcanza el stock del artículo.',
  CODE_REQUIRED: 'Indicá el código interno.',
  NAME_REQUIRED: 'Indicá el nombre.',
  INVALID_MIN_QTY: 'El stock mínimo no puede ser negativo.',
  INVALID_IMAGE_PATH:
    'No pudimos guardar la imagen del artículo. Probá de nuevo.',
  CATEGORY_NOT_FOUND: 'La categoría no existe.',
  CATEGORY_INACTIVE: 'La categoría está desactivada. Elegí otra.',
  CODE_ALREADY_EXISTS:
    'Ya existe un artículo con ese código (no se distinguen mayúsculas).',
  INVALID_ACTIVE: 'Indicá si el artículo queda activo o desactivado.',
  STOCK_NOT_ZERO:
    'Para desactivar el artículo, primero ajustá el stock a cero.',
  INVALID_CATEGORY: 'Faltan datos de la categoría.',
  CATEGORY_IN_USE:
    'La categoría tiene artículos activos. Pasalos a otra categoría o desactivalos antes.',
  CATEGORY_NAME_EXISTS: 'Ya existe una categoría con ese nombre.',
  INVALID_KIND: 'El tipo tiene que ser ingreso o devolución.',
  REASON_REQUIRED: 'Elegí el motivo del ajuste.',
  NOTE_REQUIRED: 'Con el motivo «Otro» tenés que escribir una observación.',
  MOVEMENT_IMMUTABLE:
    'Los movimientos no se editan ni se borran. Corregí con un ajuste.',
}

/** Códigos cuyo mensaje del servidor lleva datos propios (artículo, cantidades). */
const DYNAMIC_HINTS: ReadonlySet<string> = new Set([
  'INSUFFICIENT_STOCK',
  'SUPPLY_INACTIVE',
])

/** Pasa el error de las RPC de stock a `ApiError` con el mensaje en español de cada `hint`. */
export function mapStockError(error: {
  code?: string | null
  message: string
  hint?: string | null
}): ApiError {
  const hint = error.hint ?? null
  const mapped = hint ? STOCK_ERROR_MESSAGES[hint] : undefined
  if (hint && mapped) {
    const keepServerText =
      DYNAMIC_HINTS.has(hint) && error.message.trim() !== ''
    return new ApiError(keepServerText ? error.message : mapped, hint)
  }
  return fromPostgrestError(error)
}

// -------------------------------------------------------------------------
// Categorías
// -------------------------------------------------------------------------

export interface SupplyCategory {
  id: string
  name: string
  sortOrder: number
  active: boolean
}

interface CategoryRawRow {
  id: string
  name: string
  sort_order: number
  active: boolean
}

function mapCategory(row: CategoryRawRow): SupplyCategory {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    active: row.active,
  }
}

/** Todas las categorías (también las desactivadas), en su orden. */
export async function fetchSupplyCategories(): Promise<SupplyCategory[]> {
  const { data, error } = await supabase
    .from('supply_categories')
    .select('id, name, sort_order, active')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw mapStockError(error)
  return (data ?? []).map(mapCategory)
}

export interface SupplyCategoryInput {
  /** Sin `id` es un alta. */
  id?: string
  name: string
  sortOrder: number
  active: boolean
}

/** Alta o edición de una categoría (`upsert_supply_category`). */
export async function upsertSupplyCategory(
  input: SupplyCategoryInput,
): Promise<SupplyCategory> {
  const { data, error } = await supabase.rpc('upsert_supply_category', {
    p_name: input.name,
    p_sort_order: input.sortOrder,
    p_active: input.active,
    p_id: input.id,
  })
  if (error) throw mapStockError(error)
  return mapCategory(data)
}

// -------------------------------------------------------------------------
// Stock (v_stock_admin)
// -------------------------------------------------------------------------

/** `empty`: stock cero (rojo); `low`: hay mínimo y stock igual o menor (amarillo); `ok`. */
export type StockStatus = 'ok' | 'low' | 'empty'

export interface StockItem {
  id: string
  code: string
  name: string
  presentation: string | null
  categoryId: string
  categoryName: string
  categorySortOrder: number
  /** Ruta en `supply-images`; `null` si no tiene imagen. */
  imagePath: string | null
  /** `null` = sin aviso de mínimo. */
  minQty: number | null
  costPrice: number
  salePrice: number
  stockQty: number
  /** `stockQty × costPrice`. */
  stockValue: number
  status: StockStatus
  active: boolean
  notes: string | null
  updatedAt: string | null
}

interface StockRawRow {
  id: string | null
  code: string | null
  name: string | null
  presentation: string | null
  category_id: string | null
  category_name: string | null
  category_sort_order: number | null
  image_path: string | null
  min_qty: number | null
  cost_price: number | null
  sale_price: number | null
  stock_qty: number | null
  stock_value: number | null
  status: string | null
  active: boolean | null
  notes: string | null
  updated_at: string | null
}

const STOCK_SELECT =
  'id, code, name, presentation, category_id, category_name, category_sort_order, image_path, min_qty, cost_price, sale_price, stock_qty, stock_value, status, active, notes, updated_at'

function toStatus(value: string | null): StockStatus {
  return value === 'empty' || value === 'low' ? value : 'ok'
}

function mapStockRow(row: StockRawRow): StockItem {
  return {
    id: row.id ?? '',
    code: row.code ?? '',
    name: row.name ?? '',
    presentation: row.presentation,
    categoryId: row.category_id ?? '',
    categoryName: row.category_name ?? '',
    categorySortOrder: row.category_sort_order ?? 0,
    imagePath: row.image_path,
    minQty: row.min_qty,
    costPrice: Number(row.cost_price ?? 0),
    salePrice: Number(row.sale_price ?? 0),
    stockQty: Number(row.stock_qty ?? 0),
    stockValue: Number(row.stock_value ?? 0),
    status: toStatus(row.status),
    active: row.active ?? false,
    notes: row.notes,
    updatedAt: row.updated_at,
  }
}

/**
 * Todos los artículos (activos e inactivos) de `v_stock_admin`, por categoría
 * y nombre (IS-25). Los filtros de texto, categoría, «Solo con aviso» e
 * «Incluir inactivos» los aplica la pantalla sobre esta lista: el catálogo es
 * chico y así los filtros responden al instante.
 */
export async function fetchStockItems(): Promise<StockItem[]> {
  const { data, error } = await supabase
    .from('v_stock_admin')
    .select(STOCK_SELECT)
    .order('category_sort_order', { ascending: true })
    .order('category_name', { ascending: true })
    .order('name', { ascending: true })
    .order('presentation', { ascending: true })
  if (error) throw mapStockError(error)
  return ((data ?? []) as unknown as StockRawRow[]).map(mapStockRow)
}

/** Un artículo (la ficha). Lanza `SUPPLY_NOT_FOUND` si no existe. */
export async function fetchStockItem(id: string): Promise<StockItem> {
  const { data, error } = await supabase
    .from('v_stock_admin')
    .select(STOCK_SELECT)
    .eq('id', id)
    .maybeSingle()
  if (error) throw mapStockError(error)
  if (!data) {
    throw new ApiError('El artículo no existe.', 'SUPPLY_NOT_FOUND')
  }
  return mapStockRow(data)
}

// -------------------------------------------------------------------------
// Historial de precios
// -------------------------------------------------------------------------

export interface SupplyPriceChange {
  id: string
  supplyId: string
  changedAt: string
  /** Nombre de quien lo cambió; `null` si no se sabe (cambio del sistema). */
  changedByName: string | null
  /** `null` en el alta (`source = 'create'`). */
  oldCostPrice: number | null
  newCostPrice: number
  oldSalePrice: number | null
  newSalePrice: number
  /** `create` (alta), `manual` (ficha) o `entry` (costo de un ingreso, IS-23). */
  source: string
}

interface PriceChangeRawRow {
  id: string
  supply_id: string
  changed_at: string
  old_cost_price: number | null
  new_cost_price: number
  old_sale_price: number | null
  new_sale_price: number
  source: string
  profiles: { first_name: string | null; last_name: string | null } | null
}

/** Historial de precios de un artículo, del cambio más reciente al más antiguo. */
export async function fetchSupplyPriceChanges(
  supplyId: string,
): Promise<SupplyPriceChange[]> {
  const { data, error } = await supabase
    .from('supply_price_changes')
    .select(
      'id, supply_id, changed_at, old_cost_price, new_cost_price, old_sale_price, new_sale_price, source, profiles!supply_price_changes_changed_by_fkey(first_name, last_name)',
    )
    .eq('supply_id', supplyId)
    .order('changed_at', { ascending: false })
    .order('id', { ascending: true })
  if (error) throw mapStockError(error)
  return ((data ?? []) as unknown as PriceChangeRawRow[]).map((row) => {
    const name =
      `${row.profiles?.first_name ?? ''} ${row.profiles?.last_name ?? ''}`.trim()
    return {
      id: row.id,
      supplyId: row.supply_id,
      changedAt: row.changed_at,
      changedByName: name === '' ? null : name,
      oldCostPrice:
        row.old_cost_price == null ? null : Number(row.old_cost_price),
      newCostPrice: Number(row.new_cost_price),
      oldSalePrice:
        row.old_sale_price == null ? null : Number(row.old_sale_price),
      newSalePrice: Number(row.new_sale_price),
      source: row.source,
    }
  })
}

// -------------------------------------------------------------------------
// Movimientos (v_stock_movements_admin)
// -------------------------------------------------------------------------

/** Una línea de movimiento (una fila de `v_stock_movements_admin`). */
export interface StockMovementLine {
  movementId: string
  lineId: string
  kind: StockMovementKind
  recordedAt: string
  recordedByName: string | null
  personId: string | null
  personName: string | null
  shiftId: string | null
  /** `YYYY-MM-DD`. */
  shiftDate: string | null
  startTime: string | null
  endTime: string | null
  clientId: string | null
  clientName: string | null
  siteId: string | null
  siteName: string | null
  supplier: string | null
  documentNumber: string | null
  reason: StockAdjustmentReason | null
  note: string | null
  countId: string | null
  reversesId: string | null
  /** Con valor = el movimiento está «Anulado». */
  voidedAt: string | null
  voidedByName: string | null
  voidReason: string | null
  supplyId: string
  supplyCode: string
  supplyName: string
  supplyPresentation: string | null
  categoryId: string | null
  /** Con signo: positivo entra, negativo sale. */
  qtyDelta: number
  unitCost: number
  unitSale: number
  lineCost: number
  lineSale: number
  stockAfter: number
}

export interface StockMovementFilters {
  supplyId?: string
  /** Desde este día de Argentina (incluido), `YYYY-MM-DD`. */
  dateFrom?: string
  /** Hasta este día de Argentina (incluido), `YYYY-MM-DD`. */
  dateTo?: string
  kind?: StockMovementKind
  /** `profiles.id` de quien retira. */
  personId?: string
  clientId?: string
  siteId?: string
  /** Tope de filas; por defecto `STOCK_MOVEMENTS_LIMIT`. */
  limit?: number
}

/** Tope de seguridad de las listas de movimientos. */
export const STOCK_MOVEMENTS_LIMIT = 500

const MOVEMENTS_SELECT =
  'movement_id, line_id, kind, recorded_at, recorded_by_name, person_id, person_name, shift_id, shift_date, start_time, end_time, client_id, client_name, site_id, site_name, supplier, document_number, reason, note, count_id, reverses_id, voided_at, voided_by_name, void_reason, supply_id, supply_code, supply_name, supply_presentation, category_id, qty_delta, unit_cost, unit_sale, line_cost, line_sale, stock_after'

/** Inicio del día (`YYYY-MM-DD`) en hora de Argentina (UTC-3 fijo, ADR-019), como instante ISO. */
export function argentinaDayStart(day: string): string {
  return `${day}T00:00:00-03:00`
}

/** Inicio del día siguiente, para usar como tope exclusivo de un rango «hasta». */
export function argentinaNextDayStart(day: string): string {
  const [year = 0, month = 1, date = 1] = day.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, date + 1))
  return argentinaDayStart(next.toISOString().slice(0, 10))
}

interface MovementRawRow {
  movement_id: string | null
  line_id: string | null
  kind: StockMovementKind | null
  recorded_at: string | null
  recorded_by_name: string | null
  person_id: string | null
  person_name: string | null
  shift_id: string | null
  shift_date: string | null
  start_time: string | null
  end_time: string | null
  client_id: string | null
  client_name: string | null
  site_id: string | null
  site_name: string | null
  supplier: string | null
  document_number: string | null
  reason: StockAdjustmentReason | null
  note: string | null
  count_id: string | null
  reverses_id: string | null
  voided_at: string | null
  voided_by_name: string | null
  void_reason: string | null
  supply_id: string | null
  supply_code: string | null
  supply_name: string | null
  supply_presentation: string | null
  category_id: string | null
  qty_delta: number | null
  unit_cost: number | null
  unit_sale: number | null
  line_cost: number | null
  line_sale: number | null
  stock_after: number | null
}

function mapMovementRow(row: MovementRawRow): StockMovementLine {
  return {
    movementId: row.movement_id ?? '',
    lineId: row.line_id ?? '',
    kind: row.kind ?? 'adjustment',
    recordedAt: row.recorded_at ?? '',
    recordedByName: row.recorded_by_name,
    personId: row.person_id,
    personName: row.person_name,
    shiftId: row.shift_id,
    shiftDate: row.shift_date,
    startTime: row.start_time,
    endTime: row.end_time,
    clientId: row.client_id,
    clientName: row.client_name,
    siteId: row.site_id,
    siteName: row.site_name,
    supplier: row.supplier,
    documentNumber: row.document_number,
    reason: row.reason,
    note: row.note,
    countId: row.count_id,
    reversesId: row.reverses_id,
    voidedAt: row.voided_at,
    voidedByName: row.voided_by_name,
    voidReason: row.void_reason,
    supplyId: row.supply_id ?? '',
    supplyCode: row.supply_code ?? '',
    supplyName: row.supply_name ?? '',
    supplyPresentation: row.supply_presentation,
    categoryId: row.category_id,
    qtyDelta: Number(row.qty_delta ?? 0),
    unitCost: Number(row.unit_cost ?? 0),
    unitSale: Number(row.unit_sale ?? 0),
    lineCost: Number(row.line_cost ?? 0),
    lineSale: Number(row.line_sale ?? 0),
    stockAfter: Number(row.stock_after ?? 0),
  }
}

/**
 * Líneas de movimiento, de la más reciente a la más antigua. Los filtros los
 * pone el cliente (la vista no los resuelve); las fechas son días de Argentina.
 */
export async function fetchStockMovements(
  filters: StockMovementFilters = {},
): Promise<StockMovementLine[]> {
  let query = supabase
    .from('v_stock_movements_admin')
    .select(MOVEMENTS_SELECT)
    .order('recorded_at', { ascending: false })
    .order('movement_id', { ascending: false })
    .order('line_id', { ascending: true })
    .limit(filters.limit ?? STOCK_MOVEMENTS_LIMIT)

  if (filters.supplyId) query = query.eq('supply_id', filters.supplyId)
  if (filters.dateFrom) {
    query = query.gte('recorded_at', argentinaDayStart(filters.dateFrom))
  }
  if (filters.dateTo) {
    query = query.lt('recorded_at', argentinaNextDayStart(filters.dateTo))
  }
  if (filters.kind) query = query.eq('kind', filters.kind)
  if (filters.personId) query = query.eq('person_id', filters.personId)
  if (filters.clientId) query = query.eq('client_id', filters.clientId)
  if (filters.siteId) query = query.eq('site_id', filters.siteId)

  const { data, error } = await query
  if (error) throw mapStockError(error)
  return ((data ?? []) as unknown as MovementRawRow[]).map(mapMovementRow)
}

// -------------------------------------------------------------------------
// Alta y edición del artículo (upsert_supply + imagen)
// -------------------------------------------------------------------------

export interface SupplyInput {
  /** Sin `id` es un alta (el cliente genera uno para subir la imagen antes). */
  id?: string
  code: string
  name: string
  presentation: string | null
  categoryId: string
  /** `null` = sin aviso de mínimo. */
  minQty: number | null
  /** Solo cuentan en el alta; después se cambian con `setSupplyPrices`. */
  costPrice?: number
  salePrice?: number
  notes: string | null
}

/**
 * Ruta nueva de la imagen de un artículo: `{supply_id}/{uuid}.webp` (o `.jpg`
 * si el navegador no pudo generar WebP; el bucket admite los dos).
 */
export function supplyImagePath(
  supplyId: string,
  contentType = 'image/webp',
): string {
  const extension = contentType === 'image/jpeg' ? 'jpg' : 'webp'
  return `${supplyId}/${crypto.randomUUID()}.${extension}`
}

export interface SupplyImageChange {
  /** `keep` deja la imagen que tiene; `remove` la quita; `replace` sube `blob`. */
  action: 'keep' | 'remove' | 'replace'
  blob?: Blob
  /** Ruta actual (en una edición), para conservarla o borrarla. */
  currentPath?: string | null
}

export interface SavedSupply {
  id: string
  code: string
  imagePath: string | null
}

/** Sube la imagen (ya comprimida) al bucket `supply-images` y devuelve su ruta. */
export async function uploadSupplyImage(
  supplyId: string,
  blob: Blob,
): Promise<string> {
  const path = supplyImagePath(supplyId, blob.type)
  const { error } = await supabase.storage
    .from(SUPPLY_IMAGES_BUCKET)
    .upload(path, blob, {
      contentType: blob.type || 'image/webp',
      upsert: false,
    })
  if (error) {
    throw new ApiError(
      'No pudimos subir la imagen. Revisá tu conexión y probá de nuevo.',
      'IMAGE_UPLOAD_FAILED',
    )
  }
  return path
}

/** Borra objetos del bucket; nunca lanza (una imagen suelta no justifica un error). */
export async function removeSupplyImages(
  paths: readonly string[],
): Promise<void> {
  const real = paths.filter((path) => path !== '')
  if (real.length === 0) return
  try {
    await supabase.storage.from(SUPPLY_IMAGES_BUCKET).remove(real)
  } catch {
    // Queda un archivo huérfano en el bucket: no afecta a nadie.
  }
}

/**
 * Guarda el artículo con su imagen (IS-04, IS-32). Orden de alta:
 * 1. el cliente elige el `id` del artículo (`crypto.randomUUID`);
 * 2. sube la imagen a `{id}/{uuid}.webp` (la política de Storage solo pide
 *    `manage_stock`, no que el artículo exista);
 * 3. llama a `upsert_supply` con `p_id` y `p_image_path`.
 * Si el paso 3 falla, borra la imagen que acaba de subir. En una edición,
 * `upsert_supply` reemplaza TODOS los campos: por eso se manda siempre la
 * ruta vigente (o `null` si se quitó), y la imagen anterior se borra recién
 * cuando el servidor confirmó el cambio.
 */
export async function saveSupply(
  input: SupplyInput,
  image: SupplyImageChange,
): Promise<SavedSupply> {
  const supplyId = input.id ?? crypto.randomUUID()
  const isEdit = input.id != null
  const previousPath = image.currentPath ?? null

  let imagePath: string | null = isEdit ? previousPath : null
  let uploadedPath: string | null = null
  if (image.action === 'remove') {
    imagePath = null
  } else if (image.action === 'replace') {
    if (!image.blob) {
      throw new ApiError('Elegí una imagen para subir.', 'IMAGE_REQUIRED')
    }
    uploadedPath = await uploadSupplyImage(supplyId, image.blob)
    imagePath = uploadedPath
  }

  const { data, error } = await supabase.rpc('upsert_supply', {
    p_id: supplyId,
    p_code: input.code,
    p_name: input.name,
    p_presentation: input.presentation ?? undefined,
    p_category_id: input.categoryId,
    p_min_qty: input.minQty ?? undefined,
    p_cost_price: isEdit ? undefined : input.costPrice,
    p_sale_price: isEdit ? undefined : input.salePrice,
    p_notes: input.notes ?? undefined,
    p_image_path: imagePath ?? undefined,
  })
  if (error) {
    if (uploadedPath) await removeSupplyImages([uploadedPath])
    throw mapStockError(error)
  }

  if (previousPath && previousPath !== imagePath) {
    await removeSupplyImages([previousPath])
  }
  return { id: data.id, code: data.code, imagePath: data.image_path }
}

/** Cambia costo y venta (`set_supply_prices`); deja historial. */
export async function setSupplyPrices(
  supplyId: string,
  costPrice: number,
  salePrice: number,
): Promise<void> {
  const { error } = await supabase.rpc('set_supply_prices', {
    p_supply_id: supplyId,
    p_cost_price: costPrice,
    p_sale_price: salePrice,
  })
  if (error) throw mapStockError(error)
}

/** Desactiva (solo con stock cero, IS-26) o reactiva un artículo. */
export async function setSupplyActive(
  supplyId: string,
  active: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('set_supply_active', {
    p_supply_id: supplyId,
    p_active: active,
  })
  if (error) throw mapStockError(error)
}

// -------------------------------------------------------------------------
// Ingreso o devolución, y ajuste
// -------------------------------------------------------------------------

export interface StockEntryLineInput {
  supplyId: string
  /** Entero mayor a cero. */
  qty: number
  /** Costo unitario cargado; opcional. */
  unitCost?: number | null
  /** `true` actualiza además el costo vigente del artículo (IS-23). */
  updateCost?: boolean
}

export interface StockEntryInput {
  lines: StockEntryLineInput[]
  /** `entry` (ingreso, por defecto) o `return` (devolución, IS-08). */
  kind?: Extract<StockMovementKind, 'entry' | 'return'>
  supplier?: string | null
  documentNumber?: string | null
  note?: string | null
}

/** Una línea ya registrada, con el stock que quedó. */
export interface StockPostedLine {
  supplyId: string
  code: string
  name: string
  presentation: string | null
  qtyDelta: number
  unitCost: number
  unitSale: number
  stockAfter: number
}

export interface StockPostResult {
  movementId: string
  kind: StockMovementKind
  recordedAt: string
  lines: StockPostedLine[]
}

interface PostPayload {
  movement?: { id?: string; kind?: StockMovementKind; recorded_at?: string }
  lines?: Array<{
    supply_id: string
    code?: string
    name?: string
    presentation?: string | null
    qty_delta?: number | string
    unit_cost?: number | string | null
    unit_sale?: number | string | null
    stock_after?: number | string | null
  }>
}

/** Normaliza el JSON que devuelven `register_stock_entry` y `adjust_stock`. */
export function parseStockPostResult(payload: unknown): StockPostResult {
  const raw = (payload ?? {}) as PostPayload
  return {
    movementId: raw.movement?.id ?? '',
    kind: raw.movement?.kind ?? 'entry',
    recordedAt: raw.movement?.recorded_at ?? '',
    lines: (raw.lines ?? []).map((line) => ({
      supplyId: line.supply_id,
      code: line.code ?? '',
      name: line.name ?? '',
      presentation: line.presentation ?? null,
      qtyDelta: Number(line.qty_delta ?? 0),
      unitCost: Number(line.unit_cost ?? 0),
      unitSale: Number(line.unit_sale ?? 0),
      stockAfter: Number(line.stock_after ?? 0),
    })),
  }
}

/** Ingreso o devolución de varios artículos (`register_stock_entry`, IS-09, IS-23). */
export async function registerStockEntry(
  input: StockEntryInput,
): Promise<StockPostResult> {
  const lines = input.lines.map((line) => ({
    supply_id: line.supplyId,
    qty: line.qty,
    ...(line.unitCost != null ? { unit_cost: line.unitCost } : {}),
    ...(line.unitCost != null && line.updateCost ? { update_cost: true } : {}),
  }))
  const { data, error } = await supabase.rpc('register_stock_entry', {
    p_lines: lines,
    p_kind: input.kind ?? 'entry',
    p_supplier: input.supplier ?? undefined,
    p_document_number: input.documentNumber ?? undefined,
    p_note: input.note ?? undefined,
  })
  if (error) throw mapStockError(error)
  return parseStockPostResult(data)
}

export interface AdjustStockInput {
  supplyId: string
  /** Con signo, entero distinto de cero: `+` suma, `-` resta. */
  delta: number
  reason: StockAdjustmentReason
  /** Obligatoria con `other`. */
  note?: string | null
}

/** Ajuste de una fila (`adjust_stock`, IS-10): el número no se pisa, queda un movimiento. */
export async function adjustStock(
  input: AdjustStockInput,
): Promise<StockPostResult> {
  const { data, error } = await supabase.rpc('adjust_stock', {
    p_supply_id: input.supplyId,
    p_delta: input.delta,
    p_reason: input.reason,
    p_note: input.note ?? undefined,
  })
  if (error) throw mapStockError(error)
  return parseStockPostResult(data)
}

// -------------------------------------------------------------------------
// Resumen (Resumen del tablero y barra lateral)
// -------------------------------------------------------------------------

export interface StockSummary {
  /** Avisos de faltante abiertos. */
  openReports: number
  /** Artículos con avisos abiertos (un artículo con varios avisos cuenta uno). */
  openShortages: number
  /** Activos con stock cero. */
  outOfStock: number
  /** Activos con mínimo y stock entre 1 y el mínimo. */
  belowMin: number
}

/** Contadores de `get_stock_summary()` (dueño y administradores, sin exigir la capacidad). */
export async function fetchStockSummary(): Promise<StockSummary> {
  const { data, error } = await supabase.rpc('get_stock_summary')
  if (error) throw mapStockError(error)
  const raw = (data ?? {}) as Record<string, number | string | undefined>
  return {
    openReports: Number(raw.open_reports ?? 0),
    openShortages: Number(raw.open_shortages ?? 0),
    outOfStock: Number(raw.out_of_stock ?? 0),
    belowMin: Number(raw.below_min ?? 0),
  }
}

// -------------------------------------------------------------------------
// Imágenes (URL firmadas)
// -------------------------------------------------------------------------

/** Mapa ruta -> URL firmada. Las rutas que no se pudieron firmar no aparecen. */
export type SupplyImageUrlMap = Map<string, string>

/**
 * Firma varias rutas de `supply-images` en una sola llamada (bucket privado:
 * nunca se arma una URL pública). Quita duplicados y rutas vacías; si Storage
 * falla, devuelve lo que haya (la tabla se ve igual, con el ícono de reemplazo).
 */
export async function createSupplyImageUrls(
  paths: readonly (string | null)[],
  expiresInSeconds: number = SUPPLY_IMAGE_URL_TTL_SECONDS,
): Promise<SupplyImageUrlMap> {
  const unique = Array.from(
    new Set(
      paths.filter((path): path is string => path != null && path !== ''),
    ),
  )
  const urls: SupplyImageUrlMap = new Map()
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
