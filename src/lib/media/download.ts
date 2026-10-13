/**
 * Descarga de evidencia (módulo H, §3): un archivo por URL firmada con
 * nombre legible, o varios en un ZIP armado en el navegador con `fflate`.
 *
 * Nombre: `AAAA-MM-DD_Cliente_Sede_Persona_NN.ext`, p. ej.
 * `2026-10-13_ClienteX_SedeY_Nombre_01.jpg`. La fecha es la del turno en
 * hora de Buenos Aires.
 */

import { tz } from '@date-fns/tz'
import { format } from 'date-fns'
import { BUENOS_AIRES_TIME_ZONE } from '../format'
import { MediaError } from './errors'

export interface DownloadItem {
  /** URL firmada del original (vida corta: generarla justo antes de descargar). */
  url: string
  /** Fecha del turno: `Date`, instante ISO o fecha `YYYY-MM-DD`. */
  date: Date | string
  client: string
  site: string
  person: string
  /** Sin punto: `jpg`, `mp4`, `webm`. */
  extension: string
}

const MAX_PART_LENGTH = 30

/**
 * Una parte del nombre, sin tildes ni espacios ni símbolos: «Sede Norte (2)»
 * pasa a `SedeNorte2`. Vacío queda `SinDato`.
 */
export function sanitizeNamePart(value: string): string {
  const cleaned = value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/ñ/gi, (m) => (m === 'ñ' ? 'n' : 'N'))
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join('')
    .slice(0, MAX_PART_LENGTH)
  return cleaned || 'SinDato'
}

function dateStamp(date: Date | string): string {
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date
  const value = typeof date === 'string' ? new Date(date) : date
  if (Number.isNaN(value.getTime())) return '0000-00-00'
  return format(value, 'yyyy-MM-dd', { in: tz(BUENOS_AIRES_TIME_ZONE) })
}

function sanitizeExtension(extension: string): string {
  return extension.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'
}

export function buildMediaFileName(
  item: Omit<DownloadItem, 'url'>,
  index: number,
): string {
  const number = String(index).padStart(2, '0')
  return [
    dateStamp(item.date),
    sanitizeNamePart(item.client),
    sanitizeNamePart(item.site),
    sanitizeNamePart(item.person),
    number,
  ]
    .join('_')
    .concat('.', sanitizeExtension(item.extension))
}

/**
 * Nombres de varios archivos. El `NN` cuenta dentro de cada combinación de
 * fecha, cliente, sede y persona, en el orden en que llegan, así no se pisan
 * dos fotos del mismo turno.
 */
export function assignFileNames(
  items: ReadonlyArray<Omit<DownloadItem, 'url'>>,
): string[] {
  const counters = new Map<string, number>()
  return items.map((item) => {
    const key = [
      dateStamp(item.date),
      sanitizeNamePart(item.client),
      sanitizeNamePart(item.site),
      sanitizeNamePart(item.person),
    ].join('_')
    const next = (counters.get(key) ?? 0) + 1
    counters.set(key, next)
    return buildMediaFileName(item, next)
  })
}

/** Guarda un Blob en el dispositivo con el nombre indicado. */
export function saveBlob(blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = fileName
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // El navegador necesita un momento para empezar a leer el Blob.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000)
}

async function fetchBlob(url: string, signal?: AbortSignal): Promise<Blob> {
  let response: Response
  try {
    response = await fetch(url, { signal })
  } catch (error) {
    if (signal?.aborted) throw new MediaError('canceled')
    throw new MediaError('download_failed', undefined, { cause: error })
  }
  if (!response.ok) throw new MediaError('download_failed')
  return response.blob()
}

/**
 * Descarga un archivo desde una URL firmada con el nombre dado. Se baja como
 * Blob y se guarda con `download`, porque en un origen distinto (Storage) el
 * atributo `download` de un enlace directo se ignora.
 */
export async function downloadFile(
  url: string,
  fileName: string,
  signal?: AbortSignal,
): Promise<void> {
  const blob = await fetchBlob(url, signal)
  saveBlob(blob, fileName)
}

export interface DownloadZipOptions {
  /** Nombre del ZIP, con o sin `.zip`. Por defecto `fotos-y-videos.zip`. */
  zipName?: string
  signal?: AbortSignal
  /** Archivos ya bajados y total. */
  onProgress?: (done: number, total: number) => void
}

/**
 * Baja varios archivos y los junta en un ZIP en el navegador. Las fotos y los
 * videos ya vienen comprimidos, así que el ZIP los guarda sin recomprimir.
 * Devuelve el Blob (además de dispararlo como descarga).
 */
export async function downloadZip(
  items: ReadonlyArray<DownloadItem>,
  options: DownloadZipOptions = {},
): Promise<Blob> {
  const { signal, onProgress } = options
  if (items.length === 0) throw new MediaError('download_failed')

  const { Zip, ZipPassThrough } = await import('fflate')
  const names = assignFileNames(items)
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let failure: Error | null = null
  let finish!: () => void
  const finished = new Promise<void>((resolve) => {
    finish = resolve
  })

  const zip = new Zip((error, chunk, final) => {
    if (error) failure = error
    else chunks.push(chunk)
    if (final || error) finish()
  })

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    const name = names[i]
    if (!item || !name) continue
    const blob = await fetchBlob(item.url, signal)
    const file = new ZipPassThrough(name)
    zip.add(file)
    file.push(new Uint8Array(await blob.arrayBuffer()), true)
    onProgress?.(i + 1, items.length)
  }
  zip.end()
  await finished
  if (failure)
    throw new MediaError('download_failed', undefined, { cause: failure })

  const zipName = (options.zipName ?? 'fotos-y-videos').replace(/\.zip$/i, '')
  const blob = new Blob(chunks, { type: 'application/zip' })
  saveBlob(blob, `${zipName}.zip`)
  return blob
}
