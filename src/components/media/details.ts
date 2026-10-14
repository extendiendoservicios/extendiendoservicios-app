import { formatCalendarDate, formatShortDate, formatTime } from '@/lib/format'
import type { MediaItem } from './types'

/**
 * Líneas de información del visor (`MediaViewer`). Todo puro, para poder
 * probarlo sin React.
 */

/** Tamaño legible: «850 B», «170 KB», «8,4 MB». */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${Math.round(kb)} KB`
  const mb = kb / 1024
  const text = mb < 10 ? mb.toFixed(1) : String(Math.round(mb))
  return `${text.replace('.', ',')} MB`
}

function toValidDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** «mar 13 oct, 18:14». */
export function formatDateTime(date: Date): string {
  return `${formatShortDate(date)}, ${formatTime(date)}`
}

function durationText(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

/** Texto de vencimiento: «Vence el 12 nov 2026», «Conservada: no vence», etc. */
export function expiryText(item: MediaItem): string | null {
  if (item.unavailable === 'expired') return 'Venció'
  if (item.unavailable === 'removed') return 'Quitada'
  if (item.keep) return 'Conservada: no vence'
  if (item.expiresOn) return `Vence el ${formatCalendarDate(item.expiresOn)}`
  return null
}

/**
 * Cuándo se sacó y cuándo se subió. «Sacada» solo aparece si hay
 * `captured_at` y difiere de la subida en más de un minuto.
 */
export function whenLine(item: MediaItem): string | null {
  const details = item.details
  const uploaded = toValidDate(details?.uploadedAt)
  const captured = toValidDate(details?.capturedAt)
  const parts: string[] = []
  const takenWord = item.kind === 'video' ? 'Grabado' : 'Sacada'
  if (
    captured &&
    (!uploaded || Math.abs(uploaded.getTime() - captured.getTime()) > 60_000)
  ) {
    parts.push(`${takenWord} ${formatDateTime(captured)}`)
  }
  if (uploaded) parts.push(`Subida ${formatDateTime(uploaded)}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** «Foto · 170 KB · Vence el 12 nov 2026» / «Video · 0:28 · 8,4 MB · …». */
export function fileLine(item: MediaItem): string {
  const parts: string[] = [item.kind === 'video' ? 'Video' : 'Foto']
  if (item.kind === 'video' && item.durationSeconds != null) {
    parts.push(durationText(item.durationSeconds))
  }
  const size = item.details?.sizeBytes
  if (size != null && size > 0) parts.push(formatFileSize(size))
  const expiry = expiryText(item)
  if (expiry) parts.push(expiry)
  return parts.join(' · ')
}
