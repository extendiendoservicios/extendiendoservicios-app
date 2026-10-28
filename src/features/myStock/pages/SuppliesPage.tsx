import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { BellRing, PackageMinus, WifiOff, type LucideIcon } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/components/EmptyState'
import { SegmentedControl } from '@/components/SegmentedControl'
import type { MyShortageReport, MyWithdrawal } from '@/api/myStock'
import { useOnlineStatus } from '@/features/employee/useOnlineStatus'
import { CatalogBrowser } from '../components/CatalogBrowser'
import { formatPlace, formatShiftWhen, formatStamp } from '../format'
import { stockBasePath, supplyLabel } from '../logic'
import {
  useMyShortageReportsQuery,
  useMyWithdrawalsQuery,
  useSupplyCatalogQuery,
  useSupplyImageUrls,
} from '../queries'

type View = 'catalogo' | 'retiros' | 'avisos'

/**
 * Insumos (P25.4, IS-20, IS-28, IS-29, IS-33): la pestaña de Insumos del
 * empleado (`/app/insumos`) y del coordinador (`/sup/insumos`), la misma
 * pantalla para los dos. Catálogo con imagen, código, nombre y presentación
 * (sin cantidades ni precios), los botones «Retirar insumos» y «Avisar
 * faltante», y las listas «Mis retiros» y «Mis avisos».
 */
export default function SuppliesPage() {
  const { pathname } = useLocation()
  const base = stockBasePath(pathname)
  const online = useOnlineStatus()
  const [view, setView] = useState<View>('catalogo')

  return (
    <div className="flex flex-col gap-4">
      {!online && (
        <Alert variant="warn">
          <WifiOff aria-hidden="true" />
          <AlertDescription>
            Estás sin conexión. Podés mirar el catálogo, pero para retirar o
            avisar necesitás señal.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-3">
        <ActionLink
          to={`${base}/insumos/retirar`}
          online={online}
          icon={PackageMinus}
          label="Retirar insumos"
        />
        <ActionLink
          to={`${base}/insumos/faltante`}
          online={online}
          icon={BellRing}
          label="Avisar faltante"
          variant="ghost"
        />
      </div>

      <SegmentedControl
        mobile
        aria-label="Qué querés ver"
        value={view}
        onValueChange={setView}
        options={[
          { value: 'catalogo', label: 'Catálogo' },
          { value: 'retiros', label: 'Mis retiros' },
          { value: 'avisos', label: 'Mis avisos' },
        ]}
      />

      {view === 'catalogo' && <CatalogView />}
      {view === 'retiros' && <WithdrawalsView />}
      {view === 'avisos' && <ShortagesView />}
    </div>
  )
}

/** Botón grande que navega; sin conexión queda deshabilitado (retirar y avisar llaman a la base). */
function ActionLink({
  to,
  online,
  icon: Icon,
  label,
  variant = 'primary',
}: {
  to: string
  online: boolean
  icon: LucideIcon
  label: string
  variant?: 'primary' | 'ghost'
}) {
  if (!online) {
    return (
      <Button size="mobile" variant={variant} disabled>
        <Icon aria-hidden="true" />
        {label}
      </Button>
    )
  }
  return (
    <Button asChild size="mobile" variant={variant}>
      <Link to={to}>
        <Icon aria-hidden="true" />
        {label}
      </Link>
    </Button>
  )
}

function Loading() {
  return <p className="p-4 text-center text-[12.5px] text-text-3">Cargando…</p>
}

function LoadError({ what }: { what: string }) {
  return (
    <Alert variant="crit">
      <AlertDescription>
        No pudimos cargar {what}. Probá de nuevo en un momento.
      </AlertDescription>
    </Alert>
  )
}

function CatalogView() {
  const { data, isLoading, isError } = useSupplyCatalogQuery()
  const images = useSupplyImageUrls(data ?? [])

  if (isLoading) return <Loading />
  if (isError || !data) return <LoadError what="el catálogo" />
  return <CatalogBrowser items={data} imageUrls={images.data} />
}

function WithdrawalsView() {
  const { data, isLoading, isError } = useMyWithdrawalsQuery()

  if (isLoading) return <Loading />
  if (isError || !data) return <LoadError what="tus retiros" />
  if (data.length === 0) {
    return (
      <EmptyState
        icon={PackageMinus}
        title="Todavía no retiraste insumos"
        description="Cuando registres un retiro, lo vas a ver acá."
        className="py-6"
      />
    )
  }
  return (
    <ul className="flex flex-col gap-3" aria-label="Mis retiros">
      {data.map((withdrawal) => (
        <WithdrawalCard key={withdrawal.movementId} withdrawal={withdrawal} />
      ))}
    </ul>
  )
}

function WithdrawalCard({ withdrawal }: { withdrawal: MyWithdrawal }) {
  const voided = withdrawal.voidedAt != null
  const place = formatPlace(withdrawal.clientName, withdrawal.siteName)
  return (
    <li>
      <Card>
        <CardContent className="flex flex-col gap-[6px] py-[13px]">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[13px] font-semibold text-text">
              {formatStamp(withdrawal.recordedAt)}
            </p>
            {voided && <Badge variant="neutral-strike">Anulado</Badge>}
          </div>
          <p className="text-[13px] text-text-2">
            {withdrawal.shiftId && withdrawal.shiftDate && withdrawal.startTime
              ? `Turno: ${place} · ${formatShiftWhen(withdrawal.shiftDate, withdrawal.startTime)}`
              : `Sede: ${place}`}
          </p>
          <ul className="flex flex-col gap-[2px]">
            {withdrawal.lines.map((line) => (
              <li key={line.supplyId} className="text-[13px] text-text">
                <span className="font-semibold tabular-nums">{line.qty}</span> ×{' '}
                {supplyLabel(line)}
              </li>
            ))}
          </ul>
          {withdrawal.note && (
            <p className="text-[12px] text-text-3">“{withdrawal.note}”</p>
          )}
          {withdrawal.onBehalf && (
            <p className="text-[12px] text-text-3">
              Lo cargó la oficina
              {withdrawal.registeredByName
                ? ` (${withdrawal.registeredByName})`
                : ''}
              .
            </p>
          )}
          {voided && withdrawal.voidReason && (
            <p className="text-[12px] text-danger-800">
              Motivo de la anulación: {withdrawal.voidReason}
            </p>
          )}
        </CardContent>
      </Card>
    </li>
  )
}

function ShortagesView() {
  const { data, isLoading, isError } = useMyShortageReportsQuery()

  if (isLoading) return <Loading />
  if (isError || !data) return <LoadError what="tus avisos" />
  if (data.length === 0) {
    return (
      <EmptyState
        icon={BellRing}
        title="No avisaste faltantes"
        description="Si te falta un insumo, tocá «Avisar faltante»."
        className="py-6"
      />
    )
  }
  return (
    <ul className="flex flex-col gap-3" aria-label="Mis avisos">
      {data.map((report) => (
        <ShortageCard key={report.id} report={report} />
      ))}
    </ul>
  )
}

function ShortageCard({ report }: { report: MyShortageReport }) {
  const resolved = report.status === 'resolved'
  const place = formatPlace(report.clientName, report.siteName)
  return (
    <li>
      <Card>
        <CardContent className="flex flex-col gap-[6px] py-[13px]">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[14px] font-semibold text-text">
              {report.supplyName ?? report.description}
            </p>
            <Badge variant={resolved ? 'success' : 'warning'} dot>
              {resolved ? 'Resuelto' : 'Abierto'}
            </Badge>
          </div>
          <p className="text-[12px] text-text-3">
            Avisaste el {formatStamp(report.createdAt)}
            {place ? ` · ${place}` : ''}
          </p>
          {report.comment && (
            <p className="text-[13px] text-text-2">“{report.comment}”</p>
          )}
          {resolved && (
            <p className="text-[13px] text-text-2">
              {report.resolutionNote
                ? `Respuesta: ${report.resolutionNote}`
                : 'Resuelto por la oficina.'}
              {report.resolvedByName ? ` (${report.resolvedByName})` : ''}
            </p>
          )}
        </CardContent>
      </Card>
    </li>
  )
}
