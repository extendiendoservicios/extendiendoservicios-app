import * as React from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { Loader2, Square, X } from 'lucide-react'
import { cn } from 'cn'
import { mediaErrorMessage } from '@/lib/media/errors'
import { VIDEO_MAX_SECONDS } from '@/lib/media/constants'
import { recordVideo, type VideoRecorderSession } from '@/lib/media/recordVideo'
import type { ProcessedMedia } from '@/lib/media/types'

/**
 * Grabador de video propio (módulo H, §3): pantalla completa con la vista
 * previa de la cámara trasera, cuenta regresiva de 30 s y corte automático.
 * Lo usa `MediaCapture` («Grabar video»); sale directo en MP4/WebM de unos
 * 3 MB, sin recomprimir.
 */
export interface VideoRecorderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Se llama con el video ya listo para subir; el diálogo se cierra solo. */
  onRecorded: (media: ProcessedMedia) => void
  /** Segundos máximos de grabación. Por defecto 30. */
  maxSeconds?: number
}

type Phase = 'opening' | 'ready' | 'recording' | 'saving' | 'error'

function formatCountdown(seconds: number): string {
  const safe = Math.max(0, seconds)
  const m = Math.floor(safe / 60)
  const s = safe % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function VideoRecorderDialog({
  open,
  onOpenChange,
  onRecorded,
  maxSeconds = VIDEO_MAX_SECONDS,
}: VideoRecorderDialogProps) {
  const videoRef = React.useRef<HTMLVideoElement>(null)
  const sessionRef = React.useRef<VideoRecorderSession | null>(null)
  const onRecordedRef = React.useRef(onRecorded)
  const onOpenChangeRef = React.useRef(onOpenChange)
  React.useEffect(() => {
    onRecordedRef.current = onRecorded
    onOpenChangeRef.current = onOpenChange
  })

  const [phase, setPhase] = React.useState<Phase>('opening')
  const [remaining, setRemaining] = React.useState(maxSeconds)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    // Estado inicial de cada apertura (el diálogo se desmonta al cerrarse,
    // pero el componente que lo contiene no).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhase('opening')
    setRemaining(maxSeconds)
    setError(null)

    recordVideo({
      maxSeconds,
      onTick: (left) => setRemaining(left),
    })
      .then((session) => {
        if (cancelled) {
          session.dispose()
          return
        }
        sessionRef.current = session
        const video = videoRef.current
        if (video) {
          video.srcObject = session.stream
          void Promise.resolve(video.play()).catch(() => undefined)
        }
        setPhase('ready')
        session.result.then(
          (media) => {
            if (cancelled) return
            setPhase('saving')
            session.dispose()
            sessionRef.current = null
            onRecordedRef.current(media)
            onOpenChangeRef.current(false)
          },
          (reason: unknown) => {
            if (cancelled) return
            session.dispose()
            sessionRef.current = null
            setError(mediaErrorMessage(reason))
            setPhase('error')
          },
        )
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        setError(mediaErrorMessage(reason))
        setPhase('error')
      })

    return () => {
      cancelled = true
      sessionRef.current?.dispose()
      sessionRef.current = null
    }
  }, [open, maxSeconds])

  function toggleRecording() {
    const session = sessionRef.current
    if (!session) return
    if (phase === 'ready') {
      setPhase('recording')
      session.start()
    } else if (phase === 'recording') {
      setPhase('saving')
      session.stop()
    }
  }

  const recording = phase === 'recording'
  const urgent = recording && remaining <= 5

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex flex-col bg-black text-white outline-none"
        >
          <DialogPrimitive.Title className="sr-only">
            Grabar video
          </DialogPrimitive.Title>

          <div className="relative min-h-0 flex-1">
            <video
              ref={videoRef}
              muted
              playsInline
              autoPlay
              aria-label="Vista previa de la cámara"
              className="h-full w-full object-cover"
            />

            {phase === 'opening' && (
              <p className="absolute inset-0 grid place-content-center gap-3 text-center text-[15px]">
                <Loader2
                  aria-hidden="true"
                  className="mx-auto size-6 animate-spin"
                />
                Abriendo la cámara…
              </p>
            )}

            {phase === 'error' && (
              <div
                role="alert"
                className="absolute inset-0 grid place-content-center gap-4 bg-black px-6 text-center"
              >
                <p className="text-[15px] leading-snug">{error}</p>
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="mx-auto min-h-11 min-w-11 rounded-md bg-white px-5 py-2 text-[14px] font-semibold text-text outline-none focus-visible:ring-3 focus-visible:ring-ring"
                >
                  Cerrar
                </button>
              </div>
            )}

            {(phase === 'ready' || recording) && (
              <div
                aria-live="off"
                className={cn(
                  'absolute top-[max(env(safe-area-inset-top),12px)] left-1/2 -translate-x-1/2 rounded-full px-4 py-1.5 text-[17px] font-semibold tabular-nums',
                  recording
                    ? urgent
                      ? 'bg-danger text-white'
                      : 'bg-black/70 text-white'
                    : 'bg-black/70 text-white',
                )}
              >
                <span className="sr-only">
                  {recording ? 'Quedan ' : 'Máximo '}
                  {remaining} segundos.{' '}
                </span>
                <span aria-hidden="true">
                  {recording ? '● ' : ''}
                  {formatCountdown(remaining)}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-4 bg-black px-6 pt-5 pb-[max(env(safe-area-inset-bottom),20px)]">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="inline-flex min-h-11 min-w-11 items-center gap-2 rounded-md px-3 text-[14px] font-semibold text-white outline-none focus-visible:ring-3 focus-visible:ring-white"
            >
              <X aria-hidden="true" className="size-[18px]" />
              Cancelar
            </button>

            <button
              type="button"
              onClick={toggleRecording}
              disabled={phase !== 'ready' && !recording}
              aria-label={
                recording ? 'Detener la grabación' : 'Empezar a grabar'
              }
              className="grid size-[72px] place-content-center rounded-full border-[4px] border-white outline-none focus-visible:ring-3 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black disabled:opacity-40"
            >
              {recording ? (
                <Square
                  aria-hidden="true"
                  className="size-6 fill-danger text-danger"
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="block size-[52px] rounded-full bg-danger"
                />
              )}
            </button>

            {/* Mismo ancho que «Cancelar», para que el botón de grabar quede centrado. */}
            <span aria-hidden="true" className="min-w-[96px]" />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
