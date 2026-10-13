import { useMemo } from 'react'
import { toast } from 'sonner'
import { MediaViewer, type MediaItem } from '@/components/media'
import { isApiError } from '@/api/errors'
import {
  createOriginalSignedUrl,
  type ShiftMediaRow,
  type SignedUrlMap,
} from '@/api/mediaAdmin'
import { mediaErrorMessage } from '@/lib/media/errors'
import { extensionOfPath } from '@/api/mediaShared'
import { toMediaItem } from '@/features/media/items'
import { useSetMediaKeepMutation } from '@/features/media/queries'

/**
 * Visor de evidencia para administración (ADM-32, ADM-06, ADM-15): arma los
 * `MediaItem` desde las filas de `v_shift_media`, pide la URL firmada del
 * original al llegar a cada archivo y ofrece «Conservar» y «Descargar».
 * «Quitar» no está: lo que subió cada persona solo lo quita su autor (H-15).
 *
 * Los archivos vencidos no se abren (queda la constancia gris en la grilla).
 */
interface EvidenceViewerHostProps {
  rows: readonly ShiftMediaRow[]
  thumbUrls: SignedUrlMap
  /** `id` del archivo abierto; `null` = visor cerrado. */
  openId: string | null
  onOpenIdChange: (id: string | null) => void
}

function EvidenceViewerHost({
  rows,
  thumbUrls,
  openId,
  onOpenIdChange,
}: EvidenceViewerHostProps) {
  const setKeep = useSetMediaKeepMutation()

  const { items, byId } = useMemo(() => {
    const available = rows.filter((row) => row.hasFile)
    return {
      items: available.map((row) => toMediaItem(row, thumbUrls)),
      byId: new Map(available.map((row) => [row.id, row])),
    }
  }, [rows, thumbUrls])

  const index = openId ? items.findIndex((item) => item.id === openId) : -1

  async function resolveUrl(item: MediaItem): Promise<string> {
    const row = byId.get(item.id)
    if (!row) throw new Error('Archivo desconocido')
    return createOriginalSignedUrl(row.storagePath)
  }

  async function handleDownload(item: MediaItem) {
    const row = byId.get(item.id)
    if (!row) return
    try {
      const [url, { downloadFile, buildMediaFileName }] = await Promise.all([
        createOriginalSignedUrl(row.storagePath),
        import('@/lib/media/download'),
      ])
      const name = buildMediaFileName(
        {
          date: row.shiftDate,
          client: row.clientName,
          site: row.siteName,
          person: row.uploaderName,
          extension: extensionOfPath(row.storagePath),
        },
        1,
      )
      await downloadFile(url, name)
    } catch (error) {
      toast.error(isApiError(error) ? error.message : mediaErrorMessage(error))
    }
  }

  async function handleToggleKeep(item: MediaItem, keep: boolean) {
    try {
      await setKeep.mutateAsync({ mediaId: item.id, keep })
      toast.success(
        keep
          ? 'Lo marcamos para conservar: ya no vence.'
          : 'Dejamos de conservarlo: vuelve a vencer con el plazo normal.',
      )
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos cambiar la marca.',
      )
    }
  }

  return (
    <MediaViewer
      open={index >= 0}
      onOpenChange={(open) => {
        if (!open) onOpenIdChange(null)
      }}
      items={items}
      index={Math.max(index, 0)}
      onIndexChange={(next) => onOpenIdChange(items[next]?.id ?? null)}
      resolveUrl={resolveUrl}
      onToggleKeep={(item, keep) => void handleToggleKeep(item, keep)}
      onDownload={(item) => void handleDownload(item)}
      busy={setKeep.isPending}
    />
  )
}

export { EvidenceViewerHost }
