import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { CircleCheck, WifiOff } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { SegmentedControl } from '@/components/SegmentedControl'
import { ActionBar } from '@/app/shells/ActionBar'
import { isApiError } from '@/api/errors'
import type { SupplyCatalogItem } from '@/api/myStock'
import { useOnlineStatus } from '@/features/employee/useOnlineStatus'
import { CatalogBrowser } from '../components/CatalogBrowser'
import {
  DestinationPicker,
  type DestinationMode,
} from '../components/DestinationPicker'
import { stockBasePath, supplyLabel } from '../logic'
import {
  useReportShortageMutation,
  useSupplyCatalogQuery,
  useSupplyImageUrls,
} from '../queries'
import { shortageSchema } from '../schemas'

type Kind = 'catalogo' | 'libre'

/**
 * Avisar faltante (P25.4, IS-14, IS-29): se elige un artículo del catálogo
 * **o** se escribe cuál es (si no está cargado): uno de los dos. El turno o la
 * sede y el comentario son opcionales. El aviso queda «Abierto» hasta que la
 * administración lo resuelve; se sigue desde «Mis avisos». Necesita conexión.
 */
export default function ShortagePage() {
  const { pathname } = useLocation()
  const base = stockBasePath(pathname)
  const navigate = useNavigate()
  const online = useOnlineStatus()

  const catalog = useSupplyCatalogQuery()
  const images = useSupplyImageUrls(catalog.data ?? [])
  const report = useReportShortageMutation()

  const [kind, setKind] = useState<Kind>('catalogo')
  const [supply, setSupply] = useState<SupplyCatalogItem | null>(null)
  const [description, setDescription] = useState('')
  const [mode, setMode] = useState<DestinationMode>('none')
  const [shiftId, setShiftId] = useState<string | null>(null)
  const [siteId, setSiteId] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sentLabel, setSentLabel] = useState<string | null>(null)

  async function handleSubmit() {
    if ((mode === 'shift' && !shiftId) || (mode === 'site' && !siteId)) {
      setError(
        mode === 'shift'
          ? 'Elegí el turno o dejá «Ninguno».'
          : 'Elegí la sede o dejá «Ninguno».',
      )
      return
    }
    const values = {
      supplyId: kind === 'catalogo' ? (supply?.id ?? '') : '',
      description: kind === 'libre' ? description : '',
      shiftId: mode === 'shift' ? (shiftId ?? '') : '',
      siteId: mode === 'site' ? (siteId ?? '') : '',
      comment,
    }
    const parsed = shortageSchema.safeParse(values)
    if (!parsed.success) {
      setError(
        kind === 'catalogo' && !supply
          ? 'Elegí el artículo que falta.'
          : (parsed.error.issues[0]?.message ?? null),
      )
      return
    }
    setError(null)
    try {
      await report.mutateAsync(parsed.data)
      setSentLabel(
        kind === 'catalogo' && supply
          ? supplyLabel(supply)
          : description.trim(),
      )
    } catch (mutationError) {
      setError(
        isApiError(mutationError)
          ? mutationError.message
          : 'No pudimos enviar el aviso. Probá de nuevo.',
      )
    }
  }

  if (sentLabel !== null) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        <Alert variant="info">
          <CircleCheck aria-hidden="true" />
          <AlertDescription>
            Avisaste que falta: {sentLabel}. Queda como «Abierto» hasta que la
            oficina lo resuelva; lo vas a ver en «Mis avisos».
          </AlertDescription>
        </Alert>
        <ActionBar>
          <Button
            size="mobile"
            onClick={() => void navigate(`${base}/insumos`, { replace: true })}
          >
            Volver a Insumos
          </Button>
        </ActionBar>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      {!online && (
        <Alert variant="warn">
          <WifiOff aria-hidden="true" />
          <AlertDescription>
            Estás sin conexión: no podés enviar el aviso hasta que vuelvas a
            tener señal.
          </AlertDescription>
        </Alert>
      )}

      <p className="text-[12.5px] text-text-3">
        ¿Qué insumo falta? Elegilo del catálogo o escribilo si no está.
      </p>
      <SegmentedControl
        mobile
        aria-label="Cómo querés indicar el insumo"
        value={kind}
        onValueChange={(next) => {
          setKind(next)
          setError(null)
        }}
        options={[
          { value: 'catalogo', label: 'Del catálogo' },
          { value: 'libre', label: 'Otro insumo' },
        ]}
      />

      {kind === 'catalogo' &&
        (supply ? (
          <Card>
            <CardContent className="flex items-center justify-between gap-3 py-[13px]">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-text-3">
                  {supply.code}
                </p>
                <p className="text-[14px] font-semibold text-text">
                  {supplyLabel(supply)}
                </p>
              </div>
              <Button size="md" variant="ghost" onClick={() => setSupply(null)}>
                Cambiar
              </Button>
            </CardContent>
          </Card>
        ) : catalog.isLoading ? (
          <p className="p-4 text-center text-[12.5px] text-text-3">Cargando…</p>
        ) : catalog.isError || !catalog.data ? (
          <Alert variant="crit">
            <AlertDescription>
              No pudimos cargar el catálogo. Podés escribir el insumo en «Otro
              insumo».
            </AlertDescription>
          </Alert>
        ) : (
          <CatalogBrowser
            items={catalog.data}
            imageUrls={images.data}
            onSelect={setSupply}
            selectedId={null}
          />
        ))}

      {kind === 'libre' && (
        <Input
          mobile
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Por ejemplo: bolsas de residuos de 120 L"
          aria-label="Qué insumo falta"
          maxLength={200}
        />
      )}

      <div className="flex flex-col gap-2">
        <p className="text-[11px] font-semibold tracking-[0.4px] text-text-3 uppercase">
          ¿Dónde falta? (opcional)
        </p>
        <DestinationPicker
          allowNone
          mode={mode}
          onModeChange={setMode}
          shiftId={shiftId}
          onShiftChange={setShiftId}
          siteId={siteId}
          onSiteChange={setSiteId}
        />
      </div>

      <Textarea
        mobile
        rows={2}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        placeholder="Comentario (opcional)"
        aria-label="Comentario"
      />

      {error && (
        <Alert variant="crit">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <ActionBar>
        <Button
          size="mobile"
          loading={report.isPending}
          disabled={!online || report.isPending}
          onClick={() => void handleSubmit()}
        >
          Enviar aviso
        </Button>
      </ActionBar>
    </div>
  )
}
