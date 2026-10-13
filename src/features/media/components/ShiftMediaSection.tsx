import { useState } from 'react'
import { Camera } from 'lucide-react'
import { MediaGrid } from '@/components/media'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import type { ShiftMediaRow } from '@/api/mediaAdmin'
import { groupRowsByPerson } from '@/features/media/items'
import { useThumbUrls } from '@/features/media/queries'
import { EvidenceViewerHost } from './EvidenceViewerHost'

/**
 * Sección «Fotos y videos» de ADM-06 (por persona) y de ADM-15 (lo que subió
 * el supervisor): miniaturas agrupadas por persona y visor. Solo lectura más
 * «Conservar» y «Descargar» desde el visor.
 */
interface ShiftMediaSectionProps {
  rows: readonly ShiftMediaRow[] | undefined
  isLoading: boolean
  isError?: boolean
  /** ADM-06: el turno pide fotos. */
  requiresPhotos?: boolean
  /** El turno pide fotos, ya empezó y no hay ninguna: muestra «Sin fotos». */
  missingPhotos?: boolean
  emptyMessage: string
}

function ShiftMediaSection({
  rows,
  isLoading,
  isError = false,
  requiresPhotos = false,
  missingPhotos = false,
  emptyMessage,
}: ShiftMediaSectionProps) {
  const [openId, setOpenId] = useState<string | null>(null)
  const safeRows = rows ?? []
  const thumbUrls = useThumbUrls(safeRows)

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold text-text">
          <Camera aria-hidden="true" className="size-4 text-text-3" />
          Fotos y videos
        </h3>
        {requiresPhotos && <Badge variant="primary">Pide fotos</Badge>}
        {missingPhotos && <Badge variant="warning">Sin fotos</Badge>}
      </div>

      {isLoading ? (
        <Skeleton className="h-24" />
      ) : isError ? (
        <p role="alert" className="text-[12px] text-danger">
          No pudimos cargar las fotos y videos. Probá de nuevo en un momento.
        </p>
      ) : (
        <MediaGrid
          groups={groupRowsByPerson(safeRows, thumbUrls)}
          emptyMessage={emptyMessage}
          onOpen={(item) => setOpenId(item.id)}
        />
      )}

      <EvidenceViewerHost
        rows={safeRows}
        thumbUrls={thumbUrls}
        openId={openId}
        onOpenIdChange={setOpenId}
      />
    </section>
  )
}

export { ShiftMediaSection }
