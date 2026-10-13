import * as React from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  MediaCapture,
  MediaGrid,
  MediaViewer,
  type MediaGridGroup,
  type MediaItem,
} from '@/components/media'
import type { MediaUploadFn } from '@/lib/media/types'

/**
 * Contenido de la sección «Evidencia fotográfica» de `/dev/design` (P21.2):
 * `MediaCapture`, `MediaGrid` y `MediaViewer` con datos simulados. La
 * compresión y la grabación son las de verdad (probalas con tu cámara y tu
 * galería); lo único simulado es la subida y las fotos de la grilla.
 */

/** Imagen de relleno (SVG en un data URL): sin red y sin archivos binarios. */
function placeholder(hue: number, label: string, width = 320, height = 320) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="hsl(${hue} 35% 45%)"/><text x="50%" y="50%" fill="white" font-family="Inter, sans-serif" font-size="${Math.round(width / 10)}" font-weight="600" text-anchor="middle" dominant-baseline="middle">${label}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function demoPhoto(
  id: string,
  hue: number,
  author: string,
  extra: Partial<MediaItem> = {},
): MediaItem {
  return {
    id,
    kind: 'photo',
    label: `Foto de ${author}`,
    thumbUrl: placeholder(hue, `Foto ${id}`),
    url: placeholder(hue, `Foto ${id}`, 1280, 960),
    authorName: author,
    takenAt: '2026-10-13T11:20:00Z',
    expiresOn: '2026-12-12',
    ...extra,
  }
}

const INITIAL_GROUPS: MediaGridGroup[] = [
  {
    id: 'turno-1',
    title: 'Edificio Central · Hall y escaleras',
    subtitle: 'mar 13 oct · 08:00 a 12:00',
    items: [
      demoPhoto('1', 190, 'Ana Pérez'),
      demoPhoto('2', 210, 'Ana Pérez', { keep: true }),
      {
        id: '3',
        kind: 'video',
        label: 'Video de Ana Pérez',
        thumbUrl: placeholder(280, 'Video 3'),
        url: null,
        authorName: 'Ana Pérez',
        takenAt: '2026-10-13T12:05:00Z',
        expiresOn: '2026-11-12',
        durationSeconds: 24,
      },
      demoPhoto('4', 30, 'Luis Gómez'),
    ],
  },
  {
    id: 'turno-2',
    title: 'Clínica del Sur · Consultorios',
    subtitle: 'lun 12 oct · 14:00 a 18:00',
    items: [
      demoPhoto('5', 150, 'Luis Gómez'),
      demoPhoto('6', 100, 'Luis Gómez', {
        thumbUrl: null,
        url: null,
        unavailable: 'expired',
      }),
      demoPhoto('7', 330, 'Luis Gómez', {
        thumbUrl: null,
        url: null,
        unavailable: 'removed',
      }),
    ],
  },
]

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new Error('Se canceló la subida.'))
    })
  })
}

export function MediaDemo() {
  const [counts, setCounts] = React.useState({ photos: 3, videos: 1 })
  const [failUpload, setFailUpload] = React.useState(false)
  const failRef = React.useRef(false)
  const [groups, setGroups] = React.useState(INITIAL_GROUPS)
  const [selected, setSelected] = React.useState<string[]>([])
  const [viewerIndex, setViewerIndex] = React.useState<number | null>(null)

  React.useEffect(() => {
    failRef.current = failUpload
  }, [failUpload])

  const flat = groups.flatMap((group) => group.items)

  /** Sube de mentira: avance en 5 pasos y, si se pidió, falla la primera vez. */
  const upload: MediaUploadFn = async (media, { signal, onProgress }) => {
    for (let step = 1; step <= 5; step++) {
      await wait(250, signal)
      onProgress(step / 5)
      if (failRef.current && step === 3) {
        throw new Error('No hay conexión. Revisá tu internet y reintentá.')
      }
    }
    toast.success(
      `Simulado: ${media.kind === 'photo' ? 'foto' : 'video'} de ${Math.round(media.totalBytes / 1024)} KB`,
    )
    return { id: crypto.randomUUID() }
  }

  function bump(kind: 'photo' | 'video') {
    setCounts((current) =>
      kind === 'photo'
        ? { ...current, photos: current.photos + 1 }
        : { ...current, videos: current.videos + 1 },
    )
  }

  function updateItem(id: string, changes: Partial<MediaItem>) {
    setGroups((current) =>
      current.map((group) => ({
        ...group,
        items: group.items.map((item) =>
          item.id === id ? { ...item, ...changes } : item,
        ),
      })),
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[11.5px] text-text-3">
        Módulo H (P21.2). La compresión de fotos, la grabación y la recompresión
        de videos de la galería son las reales: probalas con la cámara y la
        galería de tu teléfono (en <code>localhost</code> hace falta HTTPS o{' '}
        <code>localhost</code> para la cámara). La subida es simulada.
      </p>

      <div className="flex flex-col gap-2">
        <p className="text-[11px] font-semibold text-text-3">
          MediaCapture a 390 px, con contadores y cola
        </p>
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex w-[390px] max-w-full flex-col gap-3 rounded-lg border border-border bg-bg p-4">
            <MediaCapture
              upload={upload}
              counts={counts}
              onUploaded={(_uploaded, media) => bump(media.kind)}
            />
            <div className="flex items-center gap-2">
              <Switch
                id="media-demo-fail"
                checked={failUpload}
                onCheckedChange={setFailUpload}
              />
              <Label htmlFor="media-demo-fail" className="text-[12px]">
                Simular fallo de conexión al subir
              </Label>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCounts({ photos: 3, videos: 1 })}
            >
              Reiniciar contadores
            </Button>
          </div>

          <div className="flex w-[390px] max-w-full flex-col gap-4 rounded-lg border border-border bg-bg p-4">
            <p className="text-[11px] font-semibold text-text-3">
              Topes llenos (10 de 10 fotos, 2 de 2 videos)
            </p>
            <MediaCapture upload={upload} counts={{ photos: 10, videos: 2 }} />
            <p className="text-[11px] font-semibold text-text-3">
              Deshabilitado (ventana cerrada)
            </p>
            <MediaCapture
              upload={upload}
              counts={{ photos: 4, videos: 0 }}
              disabled
              disabledReason="Ya pasó el plazo para subir fotos de este turno."
            />
            <p className="text-[11px] font-semibold text-text-3">
              Sede sin fotos
            </p>
            <MediaCapture
              upload={upload}
              counts={{ photos: 0, videos: 0 }}
              photosNotAllowed
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-[11px] font-semibold text-text-3">
          MediaGrid agrupada, con selección múltiple (tocá una miniatura para
          abrir el visor)
        </p>
        <MediaGrid
          groups={groups}
          selectable
          selectedIds={selected}
          onSelectedIdsChange={setSelected}
          onOpen={(_item, index) => setViewerIndex(index)}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            disabled={selected.length === 0}
            onClick={() =>
              toast.info(
                `Simulado: ZIP con ${selected.length} ${selected.length === 1 ? 'archivo' : 'archivos'}`,
              )
            }
          >
            Descargar ZIP ({selected.length})
          </Button>
          <span className="text-[12px] text-text-2">
            {selected.length} seleccionados
          </span>
        </div>
      </div>

      <MediaViewer
        open={viewerIndex !== null}
        onOpenChange={(open) => !open && setViewerIndex(null)}
        items={flat}
        index={viewerIndex ?? 0}
        onIndexChange={setViewerIndex}
        resolveUrl={() =>
          Promise.reject(new Error('El video de la demo no tiene archivo.'))
        }
        onDownload={(item) => toast.info(`Simulado: descargar ${item.label}`)}
        onToggleKeep={(item, keep) => updateItem(item.id, { keep })}
        onRemove={(item) => {
          updateItem(item.id, {
            unavailable: 'removed',
            thumbUrl: null,
            url: null,
          })
          toast.success('Simulado: archivo quitado')
        }}
      />
    </div>
  )
}
