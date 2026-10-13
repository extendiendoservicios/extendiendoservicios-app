import type { MediaGridGroup, MediaItem } from '@/components/media'
import type { SignedUrlMap, ShiftMediaRow } from '@/api/mediaAdmin'
import { formatDateOnly } from '@/features/settings/dateOnly'
import { formatTime } from '@/lib/format'

/**
 * Del dato de `v_shift_media` a lo que muestran `MediaGrid` y `MediaViewer`
 * (módulo H, ADM-32, ADM-06 y ADM-15). Todo puro, sin React ni Supabase.
 */

/** Extensión del archivo según su ruta (`.../{id}.jpg`); `jpg` si no se sabe. */
export function extensionOfPath(storagePath: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(storagePath)
  return match?.[1]?.toLowerCase() ?? 'jpg'
}

/** Nombre accesible de un archivo: «Foto de Ana Pérez, 08:15». */
export function mediaLabel(row: ShiftMediaRow): string {
  const what = row.kind === 'video' ? 'Video' : 'Foto'
  const when = row.capturedAt ?? row.createdAt
  const who = row.uploaderName || 'una persona'
  return when ? `${what} de ${who}, ${formatTime(when)}` : `${what} de ${who}`
}

export function toMediaItem(
  row: ShiftMediaRow,
  thumbUrls: SignedUrlMap | undefined,
): MediaItem {
  return {
    id: row.id,
    kind: row.kind,
    thumbUrl: row.hasFile ? (thumbUrls?.get(row.thumbPath) ?? null) : null,
    label: mediaLabel(row),
    authorName: row.uploaderName || undefined,
    takenAt: row.capturedAt ?? row.createdAt,
    expiresOn: row.expiresOn,
    keep: row.keep,
    durationSeconds: row.durationSeconds,
    unavailable: row.hasFile ? null : 'expired',
    canRemove: false,
  }
}

/** Título de un turno en la grilla de ADM-32: «jue 13 ago · Cliente · Sede». */
export function shiftGroupTitle(
  row: Pick<ShiftMediaRow, 'shiftDate' | 'clientName' | 'siteName'>,
): string {
  const parts = [
    row.shiftDate ? formatDateOnly(row.shiftDate) : '',
    row.clientName,
    row.siteName,
  ].filter(Boolean)
  return parts.join(' · ')
}

export interface ShiftMediaGroup {
  shiftId: string
  /** «jue 13 ago · Cliente · Sede» completo (nombre accesible). */
  title: string
  /** Solo la fecha: «jue 13 ago». */
  dateLabel: string
  /** Cliente y sede: «Cliente · Sede». */
  restLabel: string
  rows: ShiftMediaRow[]
}

/**
 * Agrupa por turno respetando el orden de llegada (la consulta deja juntas
 * las filas de un mismo turno). Si por algún corte de página un turno
 * reaparece más adelante, se suma al grupo que ya existía.
 */
export function groupRowsByShift(
  rows: readonly ShiftMediaRow[],
): ShiftMediaGroup[] {
  const groups = new Map<string, ShiftMediaGroup>()
  for (const row of rows) {
    let group = groups.get(row.shiftId)
    if (!group) {
      group = {
        shiftId: row.shiftId,
        title: shiftGroupTitle(row),
        dateLabel: row.shiftDate ? formatDateOnly(row.shiftDate) : '',
        restLabel: [row.clientName, row.siteName].filter(Boolean).join(' · '),
        rows: [],
      }
      groups.set(row.shiftId, group)
    }
    group.rows.push(row)
  }
  return Array.from(groups.values())
}

/** Cuántas fotos y cuántos videos hay: «3 fotos · 1 video». */
export function describeCounts(rows: readonly ShiftMediaRow[]): string {
  const photos = rows.filter((row) => row.kind === 'photo').length
  const videos = rows.length - photos
  const parts: string[] = []
  if (photos > 0) parts.push(`${photos} ${photos === 1 ? 'foto' : 'fotos'}`)
  if (videos > 0) parts.push(`${videos} ${videos === 1 ? 'video' : 'videos'}`)
  return parts.join(' · ')
}

/**
 * Grupos por persona para ADM-06 y ADM-15, con el orden de primera aparición.
 * El supervisor se distingue en el título.
 */
export function groupRowsByPerson(
  rows: readonly ShiftMediaRow[],
  thumbUrls: SignedUrlMap | undefined,
): MediaGridGroup[] {
  const groups = new Map<string, { title: string; rows: ShiftMediaRow[] }>()
  for (const row of rows) {
    let group = groups.get(row.uploadedBy)
    if (!group) {
      const name = row.uploaderName || 'Persona sin nombre'
      group = {
        title:
          row.uploaderRole === 'supervisor' ? `${name} · Supervisión` : name,
        rows: [],
      }
      groups.set(row.uploadedBy, group)
    }
    group.rows.push(row)
  }
  return Array.from(groups, ([id, group]) => ({
    id,
    title: group.title,
    subtitle: describeCounts(group.rows),
    items: group.rows.map((row) => toMediaItem(row, thumbUrls)),
  }))
}

/**
 * «Sin fotos» (H-07): el turno pide fotos, ya empezó y no hay ninguna (ni
 * siquiera una constancia de una que venció). Un turno que todavía no empezó
 * o que se canceló no se marca: sería un aviso falso.
 */
export function isMissingPhotos(
  shift: { requiresPhotos: boolean; status: string },
  rows: readonly ShiftMediaRow[],
): boolean {
  if (!shift.requiresPhotos) return false
  if (shift.status !== 'in_progress' && shift.status !== 'completed') {
    return false
  }
  return !rows.some((row) => row.kind === 'photo')
}

/** Días que faltan para el vencimiento, a partir de `YYYY-MM-DD` de hoy. */
export function daysUntil(expiresOn: string, today: string): number {
  const a = Date.parse(`${expiresOn}T00:00:00Z`)
  const b = Date.parse(`${today}T00:00:00Z`)
  return Math.round((a - b) / 86_400_000)
}
