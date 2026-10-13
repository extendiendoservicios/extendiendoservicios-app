import * as React from 'react'
import {
  AlertCircle,
  Camera,
  CameraOff,
  CheckCircle2,
  Film,
  Image as ImageIcon,
  ImagePlus,
  RotateCw,
  Video,
  X,
} from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ProgressBar } from '@/components/ProgressBar'
import { DEFAULT_MEDIA_LIMITS } from '@/lib/media/constants'
import {
  MediaError,
  isMediaError,
  mediaErrorMessage,
  type MediaErrorCode,
} from '@/lib/media/errors'
import type {
  MediaKind,
  MediaUploadFn,
  ProcessedMedia,
  UploadedMedia,
} from '@/lib/media/types'
import { VideoRecorderDialog } from './VideoRecorderDialog'

/**
 * `MediaCapture` (módulo H, §3 y §4): los tres caminos para sumar evidencia
 * al turno — «Sacar foto» (cámara del teléfono), «Elegir de la galería» y
 * «Grabar video» (grabador propio) —, el contador de topes y la cola de
 * subida con progreso y reintento.
 *
 * No sabe nada de Supabase: la subida la recibe en `upload`
 * (`MediaUploadFn`, ver `src/lib/media/types.ts`). La compresión se carga en
 * diferido la primera vez que se elige un archivo.
 *
 * `counts` es lo que YA está confirmado en el servidor (por ejemplo desde
 * `v_my_day`); el componente le suma lo que está en cola o subiéndose, así
 * los topes no se pasan aunque se elijan varios archivos juntos. Quien lo usa
 * tiene que actualizar `counts` dentro de `onUploaded` (el componente espera
 * esa promesa antes de dar la subida por terminada).
 */
export interface MediaCaptureProps {
  /** Sube un archivo ya comprimido: `begin_shift_media` → Storage → `confirm_shift_media`. */
  upload: MediaUploadFn
  /** Fotos y videos ya confirmados de esta persona en este turno. */
  counts: { photos: number; videos: number }
  /** Topes por persona y turno (H-11). Por defecto 10 fotos y 2 videos. */
  limits?: { photos: number; videos: number }
  /** Después de cada subida confirmada. Acá se refresca `counts`. */
  onUploaded?: (
    uploaded: UploadedMedia,
    media: ProcessedMedia,
  ) => void | Promise<void>
  /** Sin permiso para subir ahora (ventana cerrada, turno anulado…). Muestra los botones apagados. */
  disabled?: boolean
  /** Por qué está deshabilitado; se muestra debajo de los botones. */
  disabledReason?: string
  /** Sede con `photos_not_allowed` (H-13): sin botones, solo el aviso. */
  photosNotAllowed?: boolean
  className?: string
}

type Phase = 'waiting' | 'processing' | 'uploading' | 'done' | 'error'

interface QueueItem {
  id: number
  name: string
  kind: MediaKind
  phase: Phase
  /** 0 a 1; solo se muestra en videos de la galería (compresión) y en la subida. */
  fraction: number
  /** `realtime`: el celular no tiene WebCodecs y tarda lo que dura el video. */
  slowMode: boolean
  error: string | null
  retryable: boolean
}

interface QueueWork {
  source: File | null
  processed: ProcessedMedia | null
  controller: AbortController | null
}

const NON_RETRYABLE: ReadonlySet<MediaErrorCode> = new Set([
  'unsupported_file',
  'image_unreadable',
  'video_unreadable',
  'video_too_long',
  'video_too_large',
])

const DONE_VISIBLE_MS = 3000

export function MediaCapture({
  upload,
  counts,
  limits = DEFAULT_MEDIA_LIMITS,
  onUploaded,
  disabled = false,
  disabledReason,
  photosNotAllowed = false,
  className,
}: MediaCaptureProps) {
  const cameraInputRef = React.useRef<HTMLInputElement>(null)
  const galleryInputRef = React.useRef<HTMLInputElement>(null)
  const [items, setItems] = React.useState<QueueItem[]>([])
  const [notice, setNotice] = React.useState<string | null>(null)
  const [recorderOpen, setRecorderOpen] = React.useState(false)
  const [announcement, setAnnouncement] = React.useState('')

  const workRef = React.useRef(new Map<number, QueueWork>())
  const nextIdRef = React.useRef(1)
  const runningRef = React.useRef(false)
  const timersRef = React.useRef(new Set<ReturnType<typeof setTimeout>>())
  const mountedRef = React.useRef(true)
  const itemsRef = React.useRef<QueueItem[]>([])
  const uploadRef = React.useRef(upload)
  const onUploadedRef = React.useRef(onUploaded)
  React.useEffect(() => {
    uploadRef.current = upload
    onUploadedRef.current = onUploaded
  })

  React.useEffect(() => {
    mountedRef.current = true
    const work = workRef.current
    const timers = timersRef.current
    return () => {
      mountedRef.current = false
      timers.forEach((timer) => clearTimeout(timer))
      work.forEach((entry) => entry.controller?.abort())
    }
  }, [])

  function commit(next: QueueItem[]) {
    itemsRef.current = next
    if (mountedRef.current) setItems(next)
  }

  function patch(id: number, changes: Partial<QueueItem>) {
    commit(
      itemsRef.current.map((item) =>
        item.id === id ? { ...item, ...changes } : item,
      ),
    )
  }

  function remove(id: number) {
    workRef.current.delete(id)
    commit(itemsRef.current.filter((item) => item.id !== id))
  }

  async function process(id: number) {
    const work = workRef.current.get(id)
    const item = itemsRef.current.find((entry) => entry.id === id)
    if (!work || !item) return
    const controller = new AbortController()
    work.controller = controller
    const { signal } = controller

    try {
      if (!work.processed) {
        patch(id, { phase: 'processing', fraction: 0, error: null })
        const source = work.source
        if (!source) throw new MediaError('compression_failed')
        if (item.kind === 'photo') {
          const { compressImage } = await import('@/lib/media/compressImage')
          work.processed = await compressImage(source, { signal })
        } else {
          const { compressVideo } = await import('@/lib/media/compressVideo')
          work.processed = await compressVideo(source, {
            signal,
            onProgress: ({ fraction, mode }) =>
              patch(id, { fraction, slowMode: mode === 'realtime' }),
          })
        }
      }

      patch(id, { phase: 'uploading', fraction: 0, slowMode: false })
      const processed = work.processed
      const uploaded = await uploadRef.current(processed, {
        signal,
        onProgress: (fraction) =>
          patch(id, { fraction: Math.min(1, Math.max(0, fraction)) }),
      })
      if (signal.aborted) throw new MediaError('canceled')
      await onUploadedRef.current?.(uploaded, processed)

      work.processed = null
      work.source = null
      patch(id, { phase: 'done', fraction: 1 })
      setAnnouncement(item.kind === 'photo' ? 'Foto subida.' : 'Video subido.')
      const timer = setTimeout(() => {
        timersRef.current.delete(timer)
        remove(id)
      }, DONE_VISIBLE_MS)
      timersRef.current.add(timer)
    } catch (error) {
      if (
        signal.aborted ||
        (isMediaError(error) && error.code === 'canceled')
      ) {
        remove(id)
        return
      }
      const retryable = !(isMediaError(error) && NON_RETRYABLE.has(error.code))
      const message =
        error instanceof MediaError
          ? error.message
          : error instanceof Error && error.message
            ? error.message
            : mediaErrorMessage(error)
      patch(id, { phase: 'error', error: message, retryable, slowMode: false })
      setAnnouncement(message)
    } finally {
      work.controller = null
    }
  }

  async function pump() {
    if (runningRef.current) return
    runningRef.current = true
    try {
      // Un archivo por vez: comprimir varios fotos de 12 MP a la vez
      // se queda sin memoria en un teléfono económico.
      for (;;) {
        const next = itemsRef.current.find((item) => item.phase === 'waiting')
        if (!next) break
        await process(next.id)
      }
    } finally {
      runningRef.current = false
    }
  }

  function enqueue(
    entries: Array<{ name: string; kind: MediaKind; work: QueueWork }>,
  ) {
    if (entries.length === 0) return
    const created: QueueItem[] = entries.map((entry) => {
      const id = nextIdRef.current++
      workRef.current.set(id, entry.work)
      return {
        id,
        name: entry.name,
        kind: entry.kind,
        phase: 'waiting',
        fraction: 0,
        slowMode: false,
        error: null,
        retryable: true,
      }
    })
    commit([...itemsRef.current, ...created])
    void pump()
  }

  // Lo confirmado más lo que está en camino (los que fallaron no cuentan).
  const inFlight = (kind: MediaKind) =>
    items.filter(
      (item) =>
        item.kind === kind && item.phase !== 'error' && item.phase !== 'done',
    ).length
  const usedPhotos = counts.photos + inFlight('photo')
  const usedVideos = counts.videos + inFlight('video')
  const photosFull = usedPhotos >= limits.photos
  const videosFull = usedVideos >= limits.videos

  const canRecord =
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function'

  function pickFiles(
    event: React.ChangeEvent<HTMLInputElement>,
    from: 'camera' | 'gallery',
  ) {
    const files = Array.from(event.target.files ?? [])
    // Para poder elegir el mismo archivo dos veces seguidas.
    event.target.value = ''
    if (files.length === 0) return
    setNotice(null)

    let photos = usedPhotos
    let videos = usedVideos
    const accepted: Array<{ name: string; kind: MediaKind; work: QueueWork }> =
      []
    const problems = new Set<string>()

    for (const file of files) {
      const kind: MediaKind | null = file.type.startsWith('image/')
        ? 'photo'
        : file.type.startsWith('video/')
          ? 'video'
          : null
      if (!kind || (from === 'camera' && kind !== 'photo')) {
        problems.add(new MediaError('unsupported_file').message)
        continue
      }
      if (kind === 'photo') {
        if (photos >= limits.photos) {
          problems.add(
            `Ya llegaste al tope de ${limits.photos} fotos de este turno.`,
          )
          continue
        }
        photos += 1
      } else {
        if (videos >= limits.videos) {
          problems.add(
            `Ya llegaste al tope de ${limits.videos} ${limits.videos === 1 ? 'video' : 'videos'} de este turno.`,
          )
          continue
        }
        videos += 1
      }
      accepted.push({
        name: file.name || (kind === 'photo' ? 'Foto' : 'Video'),
        kind,
        work: { source: file, processed: null, controller: null },
      })
    }

    if (problems.size > 0) setNotice(Array.from(problems).join(' '))
    enqueue(accepted)
  }

  function handleRecorded(media: ProcessedMedia) {
    setNotice(null)
    enqueue([
      {
        name: 'Video grabado',
        kind: 'video',
        work: { source: null, processed: media, controller: null },
      },
    ])
  }

  function retry(id: number) {
    patch(id, { phase: 'waiting', error: null, fraction: 0 })
    void pump()
  }

  function cancel(id: number) {
    const work = workRef.current.get(id)
    if (work?.controller) {
      // `process` ve el aborto y saca el elemento de la cola.
      work.controller.abort()
      return
    }
    remove(id)
  }

  if (photosNotAllowed) {
    return (
      <div
        data-slot="media-capture"
        className={cn(
          'flex items-start gap-3 rounded-lg border border-border bg-surface px-4 py-3.5 text-[13px] leading-snug text-text-2',
          className,
        )}
      >
        <CameraOff
          aria-hidden="true"
          className="mt-px size-[18px] shrink-0 text-text-3"
        />
        <p>En esta sede no se permiten fotos.</p>
      </div>
    )
  }

  const photoDisabled = disabled || photosFull
  const videoDisabled = disabled || videosFull
  // La galería sirve mientras quede lugar para alguno de los dos tipos.
  const galleryAccept = [!photosFull && 'image/*', !videosFull && 'video/*']
    .filter(Boolean)
    .join(',')
  const galleryDisabled = disabled || (photosFull && videosFull)

  return (
    <div
      data-slot="media-capture"
      className={cn('flex flex-col gap-3', className)}
    >
      <div
        className="flex flex-wrap gap-2"
        aria-label="Topes del turno"
        role="group"
      >
        <CountChip
          icon={ImageIcon}
          used={usedPhotos}
          limit={limits.photos}
          singular="foto"
          plural="fotos"
        />
        <CountChip
          icon={Film}
          used={usedVideos}
          limit={limits.videos}
          singular="video"
          plural="videos"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Button
          type="button"
          size="mobile"
          icon={Camera}
          disabled={photoDisabled}
          onClick={() => cameraInputRef.current?.click()}
        >
          Sacar foto
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant="ghost"
            size="mobile"
            icon={ImagePlus}
            className="px-3 text-[14px] leading-tight whitespace-normal"
            disabled={galleryDisabled}
            onClick={() => galleryInputRef.current?.click()}
          >
            Elegir de la galería
          </Button>
          {canRecord && (
            <Button
              type="button"
              variant="ghost"
              size="mobile"
              icon={Video}
              className="px-3 text-[14px] leading-tight whitespace-normal"
              disabled={videoDisabled}
              onClick={() => {
                setNotice(null)
                setRecorderOpen(true)
              }}
            >
              Grabar video
            </Button>
          )}
        </div>
      </div>

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        data-testid="media-camera-input"
        onChange={(event) => pickFiles(event, 'camera')}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept={galleryAccept || 'image/*,video/*'}
        multiple
        hidden
        data-testid="media-gallery-input"
        onChange={(event) => pickFiles(event, 'gallery')}
      />

      {disabled && disabledReason && (
        <p className="text-[12.5px] leading-snug text-text-2">
          {disabledReason}
        </p>
      )}

      {notice && (
        <Alert variant="warn">
          <AlertCircle aria-hidden="true" />
          <AlertDescription className="text-[12.5px]">
            {notice}
          </AlertDescription>
        </Alert>
      )}

      {items.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Archivos en cola">
          {items.map((item) => (
            <QueueRow
              key={item.id}
              item={item}
              onRetry={() => retry(item.id)}
              onCancel={() => cancel(item.id)}
            />
          ))}
        </ul>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>

      <VideoRecorderDialog
        open={recorderOpen}
        onOpenChange={setRecorderOpen}
        onRecorded={handleRecorded}
      />
    </div>
  )
}

function CountChip({
  icon: Icon,
  used,
  limit,
  singular,
  plural,
}: {
  icon: React.ComponentType<{ className?: string }>
  used: number
  limit: number
  singular: string
  plural: string
}) {
  const full = used >= limit
  return (
    <span
      className={cn(
        'inline-flex min-h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-semibold tabular-nums',
        full
          ? 'border-warning-border bg-warning-bg text-warning-800'
          : 'border-border bg-surface text-text-2',
      )}
    >
      <Icon aria-hidden="true" className="size-[14px]" />
      {Math.min(used, limit)} de {limit} {limit === 1 ? singular : plural}
    </span>
  )
}

function phaseText(item: QueueItem): string {
  switch (item.phase) {
    case 'waiting':
      return 'En espera'
    case 'processing':
      return item.kind === 'photo'
        ? 'Preparando la foto…'
        : item.slowMode
          ? 'Preparando el video…'
          : 'Comprimiendo el video…'
    case 'uploading':
      return `Subiendo… ${Math.round(item.fraction * 100)} %`
    case 'done':
      return item.kind === 'photo' ? 'Foto subida' : 'Video subido'
    case 'error':
      return item.error ?? 'No se pudo subir'
  }
}

function QueueRow({
  item,
  onRetry,
  onCancel,
}: {
  item: QueueItem
  onRetry: () => void
  onCancel: () => void
}) {
  const busy = item.phase === 'processing' || item.phase === 'uploading'
  const showBar =
    item.phase === 'uploading' ||
    (item.phase === 'processing' && item.kind === 'video')
  const Icon =
    item.phase === 'done'
      ? CheckCircle2
      : item.phase === 'error'
        ? AlertCircle
        : item.kind === 'photo'
          ? ImageIcon
          : Film

  return (
    <li
      data-phase={item.phase}
      className={cn(
        'flex flex-col gap-2 rounded-lg border bg-surface px-3 py-2.5',
        item.phase === 'error' ? 'border-danger-border' : 'border-border',
      )}
    >
      <div className="flex items-center gap-3">
        <Icon
          aria-hidden="true"
          className={cn(
            'size-[18px] shrink-0',
            item.phase === 'done' && 'text-success',
            item.phase === 'error' && 'text-danger',
            item.phase !== 'done' && item.phase !== 'error' && 'text-text-3',
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-text">
            {item.name}
          </p>
          <p
            className={cn(
              'text-[12px] leading-snug tabular-nums',
              item.phase === 'error' ? 'text-danger-800' : 'text-text-2',
            )}
          >
            {phaseText(item)}
          </p>
        </div>
        {item.phase === 'error' && item.retryable && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            icon={RotateCw}
            onClick={onRetry}
          >
            Reintentar
          </Button>
        )}
        {item.phase !== 'done' && (
          <button
            type="button"
            onClick={onCancel}
            aria-label={
              item.phase === 'error'
                ? `Descartar ${item.name}`
                : `Cancelar ${item.name}`
            }
            className="grid size-11 shrink-0 place-content-center rounded-md text-text-2 outline-none hover:bg-bg focus-visible:ring-3 focus-visible:ring-ring"
          >
            <X aria-hidden="true" className="size-[18px]" />
          </button>
        )}
      </div>
      {showBar && (
        <ProgressBar value={item.fraction * 100} label={phaseText(item)} />
      )}
      {busy && item.slowMode && (
        <p className="text-[12px] leading-snug text-warning-800">
          Este teléfono tarda lo que dura el video. Dejá la pantalla abierta
          hasta que termine.
        </p>
      )}
    </li>
  )
}
