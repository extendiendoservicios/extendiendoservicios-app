import { unavailableOf } from '@/features/media/items'
import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router'
import { Camera } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { MediaCapture, MediaGrid, MediaViewer } from '@/components/media'
import type { MediaItem } from '@/components/media'
import { formatTime } from '@/lib/format'
import {
  mediaApiErrorMessage,
  MEDIA_REMOVE_FAILED_MESSAGE,
  signMediaUrl,
  type MyShiftMedia,
} from '@/api/media'
import { useAuth } from '@/features/auth/AuthProvider'
import {
  useMyShiftMediaQuery,
  useRefreshMyMedia,
  useRemoveShiftMediaMutation,
  useShiftMediaUpload,
} from '../mediaQueries'
import { mediaWindowMessage, mediaWindowState } from '../mediaWindow'
import { useNow } from '../useNow'
import { useOnlineStatus } from '../useOnlineStatus'

/** La ventana se mira cada medio minuto: no hace falta más fino. */
const WINDOW_TICK_MS = 30_000

export interface ShiftMediaSectionProps {
  /** Turno al que se suben los archivos. */
  shiftId: string
  /** Fotos y videos propios ya confirmados (`my_photos_count`/`my_videos_count`). */
  counts: { photos: number; videos: number }
  /** El servicio pide fotos (H-07): se avisa arriba de los botones. */
  requiresPhotos: boolean
  /** La sede no permite fotos (H-13): sin botones. */
  photosNotAllowed: boolean
  /** Inicio y fin del turno (instantes ISO) para la ventana de H-12. */
  startsAt: string | null
  endsAt: string | null
  /** Motivo fijo para no subir (por ejemplo, turno cancelado). Apaga los botones. */
  blockedReason?: string
  /** `id` del elemento, para llevar a la persona hasta el bloque (EMP-10 a EMP-07). */
  anchorId?: string
}

/**
 * Bloque «Fotos y videos» del celular (módulo H, §4): lo comparten EMP-07,
 * EMP-11 (empleado) y SUP-03, SUP-04 (supervisor). Reúne la captura
 * (`MediaCapture`), la grilla de lo propio (`MediaGrid`), el visor
 * (`MediaViewer`) y «Quitar» con su confirmación.
 *
 * Estados:
 * - sede sin fotos: solo el texto, sin botones ni grilla;
 * - antes de la ventana de H-12, sin conexión o con motivo fijo: botones
 *   apagados y el motivo debajo; lo ya subido se sigue viendo;
 * - con la ventana ya cerrada (AJ4-06, turnos pasados): sin botones, solo el
 *   aviso del plazo y lo ya subido;
 * - «Quitar» solo mientras la ventana esté abierta y haya conexión (H-15).
 *
 * El código de compresión no se baja con la pantalla: `MediaCapture` lo
 * importa recién al elegir el primer archivo.
 */
export function ShiftMediaSection({
  shiftId,
  counts,
  requiresPhotos,
  photosNotAllowed,
  startsAt,
  endsAt,
  blockedReason,
  anchorId,
}: ShiftMediaSectionProps) {
  const auth = useAuth()
  const location = useLocation()
  const online = useOnlineStatus()
  const now = useNow(WINDOW_TICK_MS)
  const upload = useShiftMediaUpload(shiftId)
  const refresh = useRefreshMyMedia()
  const { data: media } = useMyShiftMediaQuery(shiftId, auth.userId)
  const removeMutation = useRemoveShiftMediaMutation()

  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  const [toRemove, setToRemove] = useState<MyShiftMedia | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)

  const windowState = mediaWindowState(now, startsAt, endsAt)
  const windowOpen = windowState === 'open'
  const disabledReason = blockedReason
    ? blockedReason
    : !windowOpen
      ? mediaWindowMessage(windowState)
      : !online
        ? 'Estás sin conexión. Conectate para subir fotos y videos.'
        : undefined
  const canRemove = windowOpen && online && !blockedReason

  const rows = useMemo(() => media ?? [], [media])
  const items = useMemo<MediaItem[]>(
    () =>
      rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        thumbUrl: row.thumbUrl,
        url: null,
        label: `${row.kind === 'photo' ? 'Foto' : 'Video'} de las ${formatTime(row.takenAt)}`,
        takenAt: row.takenAt,
        expiresOn: row.keep ? null : row.expiresOn,
        keep: row.keep,
        durationSeconds: row.durationSeconds,
        ...unavailableOf(row),
        canRemove: canRemove && row.hasFile,
      })),
    [rows, canRemove],
  )

  // «Sacar foto» de EMP-10 llega con `#fotos`: el bloque se carga en diferido,
  // así que el desplazamiento se hace recién cuando ya está en pantalla.
  useEffect(() => {
    if (anchorId && location.hash === `#${anchorId}`) {
      document.getElementById(anchorId)?.scrollIntoView?.({ block: 'start' })
    }
  }, [anchorId, location.hash])

  function openRemove(item: MediaItem) {
    const row = rows.find((candidate) => candidate.id === item.id)
    if (!row) return
    // El visor se cierra antes de abrir la confirmación: dos diálogos
    // encimados se pisan el foco.
    setViewerIndex(null)
    setRemoveError(null)
    setToRemove(row)
  }

  async function confirmRemove() {
    if (!toRemove) return
    try {
      await removeMutation.mutateAsync(toRemove)
      setToRemove(null)
    } catch (error) {
      setRemoveError(mediaApiErrorMessage(error, MEDIA_REMOVE_FAILED_MESSAGE))
    }
  }

  return (
    <Card id={anchorId} className="scroll-mt-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Camera aria-hidden="true" className="size-4 text-primary" />
          Fotos y videos
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {photosNotAllowed ? (
          <p className="text-[13px] text-text-2">
            En esta sede no se permiten fotos.
          </p>
        ) : (
          <>
            {requiresPhotos && (
              <Alert variant="info">
                <AlertDescription>Este servicio pide fotos.</AlertDescription>
              </Alert>
            )}

            {windowState === 'after' && !blockedReason ? (
              <p className="text-[12px] text-text-3">{disabledReason}</p>
            ) : (
              <MediaCapture
                upload={upload}
                counts={counts}
                onUploaded={refresh}
                disabled={disabledReason !== undefined}
                disabledReason={disabledReason}
              />
            )}

            {items.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-[11px] font-semibold text-text-3">
                  Lo que subiste
                </p>
                <MediaGrid
                  items={items}
                  onOpen={(_item, index) => setViewerIndex(index)}
                />
              </div>
            )}
          </>
        )}
      </CardContent>

      <MediaViewer
        open={viewerIndex !== null}
        onOpenChange={(open) => {
          if (!open) setViewerIndex(null)
        }}
        items={items}
        index={viewerIndex ?? 0}
        onIndexChange={setViewerIndex}
        resolveUrl={(item) => {
          const row = rows.find((candidate) => candidate.id === item.id)
          return row
            ? signMediaUrl(row.storagePath)
            : Promise.reject(new Error('No encontramos el archivo.'))
        }}
        onRemove={canRemove ? openRemove : undefined}
      />

      <Dialog
        open={toRemove !== null}
        onOpenChange={(open) => {
          if (!open && !removeMutation.isPending) setToRemove(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {toRemove?.kind === 'video'
                ? '¿Quitar este video?'
                : '¿Quitar esta foto?'}
            </DialogTitle>
            <DialogDescription>
              Se borra del servicio y no se puede recuperar. Si te equivocaste
              de archivo, podés subir otro.
            </DialogDescription>
          </DialogHeader>
          {removeError && (
            <Alert variant="crit">
              <AlertDescription>{removeError}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setToRemove(null)}
              disabled={removeMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void confirmRemove()}
              loading={removeMutation.isPending}
              disabled={removeMutation.isPending || !online}
            >
              Quitar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
