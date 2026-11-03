import { supabase } from '@/lib/supabase'
import { ApiError, fromPostgrestError } from './errors'
import { invokeAdminUsers } from './users'

/**
 * `src/api/ownerDelete.ts` (P27.7, OD-22 y OD-23): borrado físico, solo del
 * dueño (excepción deliberada a P-014). Siempre se consulta primero la vista
 * previa (`owner_delete_preview_*`): dice qué se borra y qué lo frena. Recién
 * después se llama a la función de borrado (`owner_delete_*`), que repite las
 * comprobaciones dentro de la transacción y verifica el nombre escrito.
 *
 * El empleado no se borra con la RPC directa: va por la Edge Function
 * `admin-users` (acción `delete_user`), que además borra el usuario de Auth.
 * Si Auth falla responde `AUTH_DELETE_FAILED` y repetir la llamada termina el
 * trabajo.
 */

export type OwnerDeleteKind =
  'shift' | 'service' | 'service_shifts' | 'site' | 'client' | 'employee'

/** Qué frena el borrado (`{code, count, message}`; el `message` viene en español del servidor). */
export interface OwnerDeleteBlocker {
  code: string
  count: number
  message: string
}

/** Un renglón de «qué se va a borrar». */
export interface OwnerDeleteItem {
  code: string
  label: string
  count: number
}

/** Turno que se saltea en «Eliminar turnos sin historia desde…». */
export interface OwnerDeleteSkippedShift {
  shiftId: string
  shiftDate: string
  reasons: string[]
  message: string
}

export interface OwnerDeletePreview {
  entity: string
  id: string
  /** Nombre que el diálogo muestra y que hay que escribir para confirmar. */
  name: string
  canDelete: boolean
  blockers: OwnerDeleteBlocker[]
  willDelete: OwnerDeleteItem[]
  /** Nombres que el servidor acepta además de `name` (razón social, nombre comercial...). */
  alternativeNames: string[]
  /** Solo `service_shifts`. */
  fromDate: string | null
  deletableCount: number | null
  skipped: OwnerDeleteSkippedShift[]
}

interface RawPreview {
  entity: string
  id: string
  name: string
  can_delete: boolean
  blockers?: OwnerDeleteBlocker[] | null
  will_delete?: OwnerDeleteItem[] | null
  legal_name?: string | null
  trade_name?: string | null
  from_date?: string | null
  deletable_count?: number | null
  skipped?: {
    shift_id: string
    shift_date: string
    reasons?: string[] | null
    message: string
  }[]
}

/** Pasa la respuesta cruda de `owner_delete_preview_*` a la forma de la pantalla. */
export function parseOwnerDeletePreview(raw: RawPreview): OwnerDeletePreview {
  return {
    entity: raw.entity,
    id: raw.id,
    name: raw.name,
    canDelete: raw.can_delete,
    blockers: raw.blockers ?? [],
    willDelete: raw.will_delete ?? [],
    alternativeNames: [raw.legal_name, raw.trade_name].filter(
      (value): value is string => Boolean(value),
    ),
    fromDate: raw.from_date ?? null,
    deletableCount: raw.deletable_count ?? null,
    skipped: (raw.skipped ?? []).map((item) => ({
      shiftId: item.shift_id,
      shiftDate: item.shift_date,
      reasons: item.reasons ?? [],
      message: item.message,
    })),
  }
}

/** Vista previa del borrado. `fromDate` es obligatoria solo para `service_shifts`. */
export async function fetchOwnerDeletePreview(
  kind: OwnerDeleteKind,
  id: string,
  fromDate?: string,
): Promise<OwnerDeletePreview> {
  const response = await (() => {
    switch (kind) {
      case 'shift':
        return supabase.rpc('owner_delete_preview_shift', { p_shift_id: id })
      case 'service':
        return supabase.rpc('owner_delete_preview_service', {
          p_service_id: id,
        })
      case 'service_shifts':
        return supabase.rpc('owner_delete_preview_service_shifts', {
          p_service_id: id,
          p_from_date: fromDate ?? '',
        })
      case 'site':
        return supabase.rpc('owner_delete_preview_site', { p_site_id: id })
      case 'client':
        return supabase.rpc('owner_delete_preview_client', {
          p_client_id: id,
        })
      case 'employee':
        return supabase.rpc('owner_delete_preview_employee', {
          p_employee_id: id,
        })
    }
  })()
  if (response.error) {
    throw fromPostgrestError(response.error)
  }
  return parseOwnerDeletePreview(response.data as unknown as RawPreview)
}

/** Resultado de un borrado: conteos de lo que se borró. */
export interface OwnerDeleteResult {
  entity: string
  id: string
  name: string | null
  deleted: Record<string, number>
  /** Turnos con historia que se saltearon (solo `service_shifts`). */
  skippedCount: number
}

interface RawDeleteResult {
  entity?: string
  id?: string
  profile_id?: string
  name?: string | null
  deleted?: Record<string, number> | null
  skipped_count?: number | null
  photo_path?: string | null
}

function parseDeleteResult(
  kind: OwnerDeleteKind,
  id: string,
  raw: RawDeleteResult | null,
): OwnerDeleteResult {
  return {
    entity: raw?.entity ?? kind,
    id: raw?.id ?? raw?.profile_id ?? id,
    name: raw?.name ?? null,
    deleted: raw?.deleted ?? {},
    skippedCount: raw?.skipped_count ?? 0,
  }
}

/**
 * Borra de verdad. `confirmName` es el nombre que escribió la persona (no se
 * usa en el turno). `fromDate` solo para `service_shifts`.
 */
export async function ownerDelete(input: {
  kind: OwnerDeleteKind
  id: string
  confirmName: string
  fromDate?: string
}): Promise<OwnerDeleteResult> {
  const { kind, id, confirmName, fromDate } = input

  if (kind === 'employee') {
    // Por la Edge Function: primero la base y después el usuario de Auth.
    const data = await invokeAdminUsers<RawDeleteResult>('delete_user', {
      profile_id: id,
      confirm_name: confirmName,
    })
    return parseDeleteResult(kind, id, data)
  }

  const response = await (() => {
    switch (kind) {
      case 'shift':
        return supabase.rpc('owner_delete_shift', { p_shift_id: id })
      case 'service':
        return supabase.rpc('owner_delete_service', {
          p_service_id: id,
          p_confirm_name: confirmName,
        })
      case 'service_shifts':
        return supabase.rpc('owner_delete_service_shifts', {
          p_service_id: id,
          p_from_date: fromDate ?? '',
          p_confirm_name: confirmName,
        })
      case 'site':
        return supabase.rpc('owner_delete_site', {
          p_site_id: id,
          p_confirm_name: confirmName,
        })
      case 'client':
        return supabase.rpc('owner_delete_client', {
          p_client_id: id,
          p_confirm_name: confirmName,
        })
    }
  })()
  if (response.error) {
    throw fromPostgrestError(response.error)
  }
  const raw = response.data as unknown as RawDeleteResult
  if (kind === 'client' && raw.photo_path) {
    await removeClientPhotoFile(raw.photo_path)
  }
  return parseDeleteResult(kind, id, raw)
}

/**
 * Borra de Storage la foto del cliente que acaba de borrarse (el servidor
 * devuelve la ruta). Mejor esfuerzo: si falla, el cliente ya no existe y un
 * archivo huérfano no frena nada, así que no se propaga el error.
 */
export async function removeClientPhotoFile(path: string): Promise<boolean> {
  const { error } = await supabase.storage.from('client-photos').remove([path])
  return !error
}

/** ¿El error es el aviso de que Auth no se pudo borrar (repetir termina el trabajo)? */
export function isAuthDeleteFailed(error: unknown): boolean {
  return error instanceof ApiError && error.hint === 'AUTH_DELETE_FAILED'
}
