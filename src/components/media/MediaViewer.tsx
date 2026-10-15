import * as React from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ImageOff,
  Pin,
  PinOff,
  Trash2,
  X,
} from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { formatShortDate, formatTime } from '@/lib/format'
import { expiryText, fileLine, whenLine } from './details'
import type { MediaItem } from './types'

/**
 * `MediaViewer` (módulo H, §3): visor a pantalla completa de fotos y videos,
 * con deslizamiento (o flechas), reproducción de video con controles y los
 * datos del archivo: quién lo subió, cuándo y cuándo vence.
 *
 * Las acciones son opcionales y las decide quien lo usa según el rol y la
 * ventana de subida (H-02, H-12, H-15): si no pasás `onRemove`, `onToggleKeep`
 * u `onDownload`, el botón no aparece. El visor no confirma nada: «Quitar»
 * llama a `onRemove` y quien lo usa abre su `ConfirmDialog`.
 *
 * Deslizar a los costados cambia de archivo; sobre un video no se interpreta
 * el deslizamiento (choca con la barra de avance): ahí se usan las flechas.
 */
export interface MediaViewerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  items: MediaItem[]
  /** Posición del archivo abierto. */
  index: number
  onIndexChange: (index: number) => void
  /**
   * Pide la URL firmada del original cuando `item.url` es `null`. Se llama al
   * llegar a cada archivo, no antes.
   */
  resolveUrl?: (item: MediaItem) => Promise<string>
  /** «Quitar» (H-15): el autor, mientras la ventana siga abierta. */
  onRemove?: (item: MediaItem) => void
  /** «Conservar» / «Dejar de conservar» (H-08): solo dueño y administradores. */
  onToggleKeep?: (item: MediaItem, keep: boolean) => void
  /** «Descargar» un archivo. */
  onDownload?: (item: MediaItem) => void
  /** Apaga las acciones mientras se hace una (por ejemplo, quitando). */
  busy?: boolean
}

const SWIPE_MIN_PX = 50

export function MediaViewer({
  open,
  onOpenChange,
  items,
  index,
  onIndexChange,
  resolveUrl,
  onRemove,
  onToggleKeep,
  onDownload,
  busy = false,
}: MediaViewerProps) {
  const safeIndex = Math.min(Math.max(index, 0), Math.max(items.length - 1, 0))
  const item = items[safeIndex]
  const swipeStart = React.useRef<{ x: number; y: number } | null>(null)

  // Si se quitó el último archivo, no queda nada que mostrar.
  React.useEffect(() => {
    if (open && items.length === 0) onOpenChange(false)
  }, [open, items.length, onOpenChange])

  // Si el índice quedó fuera de rango (se quitó un archivo), se corrige.
  React.useEffect(() => {
    if (open && items.length > 0 && index !== safeIndex) {
      onIndexChange(safeIndex)
    }
  }, [open, items.length, index, safeIndex, onIndexChange])

  const go = React.useCallback(
    (delta: number) => {
      const next = safeIndex + delta
      if (next >= 0 && next < items.length) onIndexChange(next)
    },
    [safeIndex, items.length, onIndexChange],
  )

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      go(-1)
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      go(1)
    }
  }

  function handlePointerDown(event: React.PointerEvent) {
    const onVideo = (event.target as HTMLElement).closest('video') !== null
    swipeStart.current = onVideo ? null : { x: event.clientX, y: event.clientY }
  }

  function handlePointerUp(event: React.PointerEvent) {
    const start = swipeStart.current
    swipeStart.current = null
    if (!start) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.5) {
      go(dx < 0 ? 1 : -1)
    }
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onKeyDown={handleKeyDown}
          className="fixed inset-0 z-50 flex flex-col bg-black text-white outline-none"
        >
          <DialogPrimitive.Title className="sr-only">
            Visor de fotos y videos
          </DialogPrimitive.Title>

          <div className="flex items-center justify-between px-2 pt-[max(env(safe-area-inset-top),8px)] pb-1">
            <p className="px-3 text-[14px] font-semibold tabular-nums">
              {items.length > 0 ? `${safeIndex + 1} de ${items.length}` : ''}
            </p>
            <DialogPrimitive.Close
              aria-label="Cerrar el visor"
              className="grid size-11 place-content-center rounded-md text-white outline-none hover:bg-white/10 focus-visible:ring-3 focus-visible:ring-white"
            >
              <X aria-hidden="true" className="size-6" />
            </DialogPrimitive.Close>
          </div>

          <div
            className="relative min-h-0 flex-1 touch-pan-y select-none"
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerCancel={() => (swipeStart.current = null)}
          >
            {item && (
              <ViewerMedia key={item.id} item={item} resolveUrl={resolveUrl} />
            )}

            {safeIndex > 0 && <NavButton side="left" onClick={() => go(-1)} />}
            {safeIndex < items.length - 1 && (
              <NavButton side="right" onClick={() => go(1)} />
            )}
          </div>

          {item && (
            <div className="flex flex-col gap-3 bg-surface px-4 pt-3 pb-[max(env(safe-area-inset-bottom),16px)] text-text">
              <ViewerInfo item={item} />
              {(onRemove || onToggleKeep || onDownload) && (
                <div className="flex flex-wrap gap-2">
                  {onDownload && (
                    <Button
                      type="button"
                      variant="ghost"
                      icon={Download}
                      disabled={busy || !!item.unavailable}
                      onClick={() => onDownload(item)}
                    >
                      Descargar
                    </Button>
                  )}
                  {onToggleKeep && (
                    <Button
                      type="button"
                      variant="ghost"
                      icon={item.keep ? PinOff : Pin}
                      disabled={busy || !!item.unavailable}
                      onClick={() => onToggleKeep(item, !item.keep)}
                    >
                      {item.keep ? 'Dejar de conservar' : 'Conservar'}
                    </Button>
                  )}
                  {onRemove && item.canRemove !== false && (
                    <Button
                      type="button"
                      variant="destructive"
                      icon={Trash2}
                      disabled={busy || !!item.unavailable}
                      onClick={() => onRemove(item)}
                    >
                      Quitar
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function NavButton({
  side,
  onClick,
}: {
  side: 'left' | 'right'
  onClick: () => void
}) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Anterior' : 'Siguiente'}
      className={cn(
        'absolute top-1/2 grid size-11 -translate-y-1/2 place-content-center rounded-full bg-black/60 text-white outline-none hover:bg-black/80 focus-visible:ring-3 focus-visible:ring-white',
        side === 'left' ? 'left-2' : 'right-2',
      )}
    >
      <Icon aria-hidden="true" className="size-6" />
    </button>
  )
}

function ViewerMedia({
  item,
  resolveUrl,
}: {
  item: MediaItem
  resolveUrl?: (item: MediaItem) => Promise<string>
}) {
  const [resolved, setResolved] = React.useState<string | null>(null)
  const [failed, setFailed] = React.useState(false)
  const url = item.url ?? resolved
  const needsUrl = !item.unavailable && !item.url && !!resolveUrl

  React.useEffect(() => {
    if (!needsUrl || !resolveUrl) return
    let cancelled = false
    resolveUrl(item).then(
      (next) => {
        if (!cancelled) setResolved(next)
      },
      () => {
        if (!cancelled) setFailed(true)
      },
    )
    return () => {
      cancelled = true
    }
    // Se pide una vez por archivo (el componente se remonta con `key={item.id}`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsUrl])

  if (item.unavailable) {
    return (
      <Message>
        {item.unavailable === 'expired'
          ? 'Este archivo ya venció y se borró. Queda la constancia del turno.'
          : item.unavailable === 'deleted'
            ? `${item.unavailableNote ?? 'Eliminada'}. Queda la constancia del turno.`
            : 'Quien lo subió quitó este archivo.'}
      </Message>
    )
  }
  if (failed) return <Message>No pudimos cargar este archivo.</Message>
  if (!url) {
    return (
      <div
        role="status"
        className="grid size-full place-content-center text-[14px]"
      >
        Cargando…
      </div>
    )
  }

  if (item.kind === 'video') {
    return (
      // La evidencia son videos cortos de celular, sin pista de subtítulos.
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <video
        key={url}
        src={url}
        poster={item.thumbUrl ?? undefined}
        controls
        playsInline
        preload="metadata"
        aria-label={item.label}
        onError={() => setFailed(true)}
        className="size-full object-contain"
      />
    )
  }
  return (
    <img
      src={url}
      alt={item.label}
      draggable={false}
      onError={() => setFailed(true)}
      className="size-full object-contain"
    />
  )
}

function Message({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid size-full place-content-center gap-3 px-8 text-center text-[14px] leading-snug">
      <ImageOff aria-hidden="true" className="mx-auto size-8" />
      <p>{children}</p>
    </div>
  )
}

function ViewerInfo({ item }: { item: MediaItem }) {
  if (item.details) return <ViewerDetails item={item} />

  const taken = item.takenAt ? new Date(item.takenAt) : null
  const validTaken = taken && !Number.isNaN(taken.getTime()) ? taken : null
  const expiry = expiryText(item)

  return (
    <div className="flex flex-col gap-0.5 text-[13px] leading-snug">
      {item.authorName && (
        <p className="font-semibold text-text">{item.authorName}</p>
      )}
      <p className="text-text-2 tabular-nums">
        {[
          validTaken
            ? `${formatShortDate(validTaken)}, ${formatTime(validTaken)}`
            : null,
          expiry,
        ]
          .filter(Boolean)
          .join(' · ')}
      </p>
    </div>
  )
}

/** Versión con contexto (administración): quién, dónde, qué turno, cuándo y qué archivo. */
function ViewerDetails({ item }: { item: MediaItem }) {
  const details = item.details
  const who = [item.authorName, details?.authorRole].filter(Boolean).join(' · ')
  const when = whenLine(item)
  return (
    <div className="flex flex-col gap-0.5 text-[13px] leading-snug">
      {who && <p className="font-semibold text-text">{who}</p>}
      {details?.place && <p className="text-text-2">{details.place}</p>}
      {details?.shiftLabel && (
        <p className="text-text-2 tabular-nums">{details.shiftLabel}</p>
      )}
      {when && <p className="text-text-2 tabular-nums">{when}</p>}
      <p className="text-text-2 tabular-nums">{fileLine(item)}</p>
    </div>
  )
}
