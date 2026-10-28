import { useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'
import { CircleCheck, WifiOff } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Stepper } from '@/components/Stepper'
import { ActionBar } from '@/app/shells/ActionBar'
import { isApiError } from '@/api/errors'
import type { SupplyCatalogItem, WithdrawalResult } from '@/api/myStock'
import { useOnlineStatus } from '@/features/employee/useOnlineStatus'
import { CatalogBrowser } from '../components/CatalogBrowser'
import {
  DestinationPicker,
  type DestinationMode,
} from '../components/DestinationPicker'
import { formatPlace, formatShiftWhen, formatStamp } from '../format'
import {
  cartAdd,
  cartLines,
  cartRemove,
  cartSetQty,
  cartTotal,
  isSelectableForWithdrawal,
  stockBasePath,
  supplyLabel,
  type Cart,
} from '../logic'
import {
  useRegisterWithdrawalMutation,
  useSupplyCatalogQuery,
  useSupplyImageUrls,
  useWithdrawalShiftOptionsQuery,
  useWithdrawalSiteOptionsQuery,
} from '../queries'
import {
  MAX_WITHDRAWAL_QTY,
  WITHDRAWAL_NOTE_MAX,
  withdrawalSchema,
  withdrawalTargetSchema,
} from '../schemas'

type Step = 'destino' | 'articulos' | 'revisar' | 'resultado'

/**
 * Retirar insumos (P25.4, IS-11, IS-12, IS-13, IS-28): elegir el turno (o una
 * sede con observación), agregar artículos y cantidades, revisar y confirmar.
 * Al terminar muestra el resumen con la hora que devolvió el servidor. Lo usan
 * el empleado (`/app/insumos/retirar`) y el coordinador
 * (`/sup/insumos/retirar`).
 *
 * `?turno=<id>` (el botón «Retirar insumos» del detalle del servicio y de
 * SUP-03) entra con ese turno ya elegido, directo a los artículos. Si el turno
 * no está entre las opciones permitidas, se queda en el primer paso.
 *
 * Los pasos viven en un único componente con un `step` local (mismo criterio
 * que EMP-12). El retiro descuenta el stock en el momento y necesita
 * conexión: sin señal, «Confirmar» queda deshabilitado y no hay cola (es del
 * módulo C).
 */
export default function WithdrawPage() {
  const { pathname } = useLocation()
  const base = stockBasePath(pathname)
  const navigate = useNavigate()
  const online = useOnlineStatus()
  const [searchParams] = useSearchParams()
  const presetShiftId = searchParams.get('turno')

  const catalog = useSupplyCatalogQuery()
  const images = useSupplyImageUrls(catalog.data ?? [])
  const shiftOptions = useWithdrawalShiftOptionsQuery()
  const siteOptions = useWithdrawalSiteOptionsQuery()
  const register = useRegisterWithdrawalMutation()

  const [step, setStep] = useState<Step>('destino')
  const [mode, setMode] = useState<DestinationMode>('shift')
  const [shiftId, setShiftId] = useState<string | null>(null)
  const [siteId, setSiteId] = useState<string | null>(null)
  const [siteNote, setSiteNote] = useState('')
  const [shiftNote, setShiftNote] = useState('')
  const [cart, setCart] = useState<Cart>(new Map())
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [result, setResult] = useState<WithdrawalResult | null>(null)

  // Turno preelegido: se resuelve una sola vez, cuando llegan las opciones
  // (patrón «ajustar estado durante el render», igual que EMP-12).
  const [presetResolved, setPresetResolved] = useState(false)
  if (!presetResolved && shiftOptions.data) {
    setPresetResolved(true)
    if (
      presetShiftId &&
      shiftOptions.data.some((option) => option.shiftId === presetShiftId)
    ) {
      setShiftId(presetShiftId)
      setStep('articulos')
    }
  }

  const note = mode === 'site' ? siteNote : shiftNote
  const chosenShift = shiftOptions.data?.find((o) => o.shiftId === shiftId)
  const chosenSite = siteOptions.data?.find((o) => o.siteId === siteId)
  const catalogById = new Map(
    (catalog.data ?? []).map((item) => [item.id, item]),
  )

  function target() {
    return mode === 'site'
      ? { kind: 'site' as const, siteId: siteId ?? '', note: siteNote }
      : { kind: 'shift' as const, shiftId: shiftId ?? '', note: shiftNote }
  }

  function handleContinueFromDestination() {
    const parsed = withdrawalTargetSchema.safeParse(target())
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? null)
      return
    }
    setFieldError(null)
    setStep('articulos')
  }

  function handleReview() {
    setSubmitError(null)
    setStep('revisar')
  }

  async function handleConfirm() {
    const parsed = withdrawalSchema.safeParse({
      target: target(),
      lines: cartLines(cart),
    })
    if (!parsed.success) {
      setSubmitError(parsed.error.issues[0]?.message ?? null)
      return
    }
    setSubmitError(null)
    try {
      const done = await register.mutateAsync({
        lines: cartLines(cart),
        shiftId: mode === 'shift' ? shiftId : null,
        siteId: mode === 'site' ? siteId : null,
        note,
      })
      setResult(done)
      setStep('resultado')
    } catch (error) {
      setSubmitError(
        isApiError(error)
          ? error.message
          : 'No pudimos registrar el retiro. Probá de nuevo.',
      )
    }
  }

  const loadingBase = catalog.isLoading || shiftOptions.isLoading
  if (loadingBase && step === 'destino') {
    return (
      <p className="p-4 text-center text-[12.5px] text-text-3">Cargando…</p>
    )
  }

  const destinationText =
    mode === 'site'
      ? chosenSite
        ? `Sede: ${formatPlace(chosenSite.clientName, chosenSite.siteName)}`
        : ''
      : chosenShift
        ? `Turno: ${formatPlace(chosenShift.clientName, chosenShift.siteName)} · ${formatShiftWhen(chosenShift.shiftDate, chosenShift.startTime)}`
        : ''

  return (
    <div className="flex flex-1 flex-col gap-4">
      {!online && step !== 'resultado' && (
        <Alert variant="warn">
          <WifiOff aria-hidden="true" />
          <AlertDescription>
            Estás sin conexión: no podés registrar el retiro hasta que vuelvas a
            tener señal. No se guarda para después.
          </AlertDescription>
        </Alert>
      )}

      {step === 'destino' && (
        <>
          <p className="text-[12.5px] text-text-3">
            ¿Para qué turno es el retiro? Si no es para un turno puntual, elegí
            una sede y contanos para qué es.
          </p>
          <DestinationPicker
            mode={mode}
            onModeChange={(next) => {
              setMode(next)
              setFieldError(null)
            }}
            shiftId={shiftId}
            onShiftChange={setShiftId}
            siteId={siteId}
            onSiteChange={setSiteId}
          />
          {mode === 'site' && (
            <Textarea
              mobile
              rows={3}
              value={siteNote}
              onChange={(event) => setSiteNote(event.target.value)}
              placeholder="Observación obligatoria: por ejemplo, reposición de la semana"
              aria-label="Observación del retiro"
              maxLength={WITHDRAWAL_NOTE_MAX}
            />
          )}
          {fieldError && (
            <Alert variant="crit">
              <AlertDescription>{fieldError}</AlertDescription>
            </Alert>
          )}
          <ActionBar>
            <Button
              size="mobile"
              disabled={mode === 'site' ? !siteId : !shiftId}
              onClick={handleContinueFromDestination}
            >
              Continuar
            </Button>
          </ActionBar>
        </>
      )}

      {step === 'articulos' && (
        <>
          <p className="text-[12.5px] font-semibold text-text-2">
            {destinationText}
          </p>
          {catalog.isLoading ? (
            <p className="p-4 text-center text-[12.5px] text-text-3">
              Cargando…
            </p>
          ) : catalog.isError || !catalog.data ? (
            <Alert variant="crit">
              <AlertDescription>
                No pudimos cargar el catálogo. Probá de nuevo en un momento.
              </AlertDescription>
            </Alert>
          ) : (
            <CatalogBrowser
              items={catalog.data}
              imageUrls={images.data}
              dimOutOfStock
              renderTrailing={(item) => (
                <AddControl
                  item={item}
                  qty={cart.get(item.id) ?? 0}
                  onAdd={() => setCart((current) => cartAdd(current, item.id))}
                  onChange={(qty) =>
                    setCart((current) =>
                      qty < 1
                        ? cartRemove(current, item.id)
                        : cartSetQty(current, item.id, qty),
                    )
                  }
                />
              )}
            />
          )}
          <ActionBar>
            <Button
              size="mobile"
              disabled={cart.size === 0}
              onClick={handleReview}
            >
              {cart.size === 0
                ? 'Elegí al menos un artículo'
                : `Revisar retiro (${cartTotal(cart)} u.)`}
            </Button>
            <Button
              size="mobile"
              variant="ghost"
              onClick={() => setStep('destino')}
            >
              Atrás
            </Button>
          </ActionBar>
        </>
      )}

      {step === 'revisar' && (
        <>
          <Card>
            <CardContent className="flex flex-col gap-[6px] py-[13px]">
              <p className="text-[11px] font-semibold tracking-[0.4px] text-text-3 uppercase">
                Para
              </p>
              <p className="text-[13px] font-semibold text-text">
                {destinationText}
              </p>
              {mode === 'site' && (
                <p className="text-[12px] text-text-3">“{siteNote.trim()}”</p>
              )}
            </CardContent>
          </Card>

          <ul className="flex flex-col gap-2" aria-label="Artículos del retiro">
            {cartLines(cart).map((line) => {
              const item = catalogById.get(line.supplyId)
              return (
                <li
                  key={line.supplyId}
                  className="flex flex-col gap-2 rounded-xl border border-border bg-surface px-3 py-[10px]"
                >
                  <p className="text-[14px] font-semibold text-text">
                    {item ? supplyLabel(item) : 'Artículo'}
                  </p>
                  <div className="flex items-center justify-between gap-2">
                    <Stepper
                      aria-label={`Cantidad de ${item ? supplyLabel(item) : 'artículo'}`}
                      decrementLabel={`Restar una unidad de ${item ? supplyLabel(item) : 'artículo'}`}
                      incrementLabel={`Sumar una unidad de ${item ? supplyLabel(item) : 'artículo'}`}
                      value={line.qty}
                      onValueChange={(qty) =>
                        setCart((current) =>
                          cartSetQty(current, line.supplyId, qty),
                        )
                      }
                      min={1}
                      max={MAX_WITHDRAWAL_QTY}
                    />
                    <Button
                      size="md"
                      variant="ghost"
                      aria-label={`Quitar ${item ? supplyLabel(item) : 'artículo'}`}
                      onClick={() =>
                        setCart((current) => cartRemove(current, line.supplyId))
                      }
                    >
                      Quitar
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>

          {cart.size === 0 && (
            <Alert variant="warn">
              <AlertDescription>
                No quedan artículos en el retiro. Volvé a elegir.
              </AlertDescription>
            </Alert>
          )}

          {mode === 'shift' && (
            <Textarea
              mobile
              rows={2}
              value={shiftNote}
              onChange={(event) => setShiftNote(event.target.value)}
              placeholder="Observación (opcional)"
              aria-label="Observación del retiro"
              maxLength={WITHDRAWAL_NOTE_MAX}
            />
          )}

          {submitError && (
            <Alert variant="crit">
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          )}

          <ActionBar note="El stock se descuenta en el momento. Si te equivocás, avisá en la oficina.">
            <Button
              size="mobile"
              loading={register.isPending}
              disabled={!online || register.isPending || cart.size === 0}
              onClick={() => void handleConfirm()}
            >
              Confirmar retiro
            </Button>
            <Button
              size="mobile"
              variant="ghost"
              disabled={register.isPending}
              onClick={() => setStep('articulos')}
            >
              Atrás
            </Button>
          </ActionBar>
        </>
      )}

      {step === 'resultado' && result && (
        <>
          <Alert variant="info">
            <CircleCheck aria-hidden="true" />
            <AlertDescription>
              Retiro registrado el {formatStamp(result.recordedAt)}.
            </AlertDescription>
          </Alert>
          <Card>
            <CardContent className="flex flex-col gap-[6px] py-[13px]">
              <p className="text-[13px] font-semibold text-text">
                {destinationText}
              </p>
              <ul className="flex flex-col gap-[2px]">
                {result.lines.map((line) => (
                  <li key={line.supplyId} className="text-[13px] text-text">
                    <span className="font-semibold tabular-nums">
                      {line.qty}
                    </span>{' '}
                    × {supplyLabel(line)}
                  </li>
                ))}
              </ul>
              {result.note && (
                <p className="text-[12px] text-text-3">“{result.note}”</p>
              )}
            </CardContent>
          </Card>
          <ActionBar>
            <Button
              size="mobile"
              onClick={() =>
                void navigate(`${base}/insumos`, { replace: true })
              }
            >
              Volver a Insumos
            </Button>
          </ActionBar>
        </>
      )}
    </div>
  )
}

/**
 * Control de cantidad a la derecha de cada artículo: «Agregar» y, una vez
 * agregado, el contador. Un artículo sin stock no tiene acción (IS-28).
 */
function AddControl({
  item,
  qty,
  onAdd,
  onChange,
}: {
  item: SupplyCatalogItem
  qty: number
  onAdd: () => void
  onChange: (qty: number) => void
}) {
  if (!isSelectableForWithdrawal(item)) return null
  if (qty < 1) {
    return (
      <Button
        size="md"
        variant="ghost"
        aria-label={`Agregar ${supplyLabel(item)}`}
        onClick={onAdd}
      >
        Agregar
      </Button>
    )
  }
  return (
    <Stepper
      aria-label={`Cantidad de ${supplyLabel(item)}`}
      decrementLabel={`Restar una unidad de ${supplyLabel(item)}`}
      incrementLabel={`Sumar una unidad de ${supplyLabel(item)}`}
      value={qty}
      onValueChange={onChange}
      min={0}
      max={MAX_WITHDRAWAL_QTY}
    />
  )
}
