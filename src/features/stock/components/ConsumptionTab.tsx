import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Download, PackageSearch } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DatePicker } from '@/components/DatePicker'
import { EmptyState } from '@/components/EmptyState'
import { isApiError } from '@/api/errors'
import { UpdatedAgo } from '@/features/attendance/components/UpdatedAgo'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'
import { localDateToIsoDate } from '@/features/settings/dateOnly'
import {
  useStockClientOptionsQuery,
  useSupplyConsumptionQuery,
  useWithdrawalSiteOptionsQuery,
} from '@/features/stock/queries'
import {
  buildConsumptionReport,
  monthPeriod,
  type ConsumptionClient,
  type ConsumptionSite,
} from '@/features/stock/consumption'
import { downloadExcel } from '@/features/stock/excel'
import {
  CONSUMPTION_EXCEL_COLUMNS,
  excelFileName,
} from '@/features/stock/exportSheets'
import { supplyLabel } from '@/features/stock/filters'
import { formatMoney, formatQty } from '@/features/stock/money'
import { isoDateToDate } from './MovementFilters'

/**
 * Pestaña «Consumo por cliente» de Insumos (IS-24): lo que se retiró en un
 * período (por defecto, el mes en curso), por cliente y por sede, a costo y a
 * venta, con el detalle por artículo. Los precios son los guardados en cada
 * retiro; los retiros anulados no cuentan. «Exportar a Excel» baja las filas
 * del período filtrado.
 */
function ConsumptionTab() {
  const today = todayInBuenosAires()
  const [period, setPeriod] = useState(() => monthPeriod(today, 0))
  const [clientId, setClientId] = useState('all')
  const [siteId, setSiteId] = useState('all')

  const filters = useMemo(
    () => ({
      dateFrom: period.dateFrom,
      dateTo: period.dateTo,
      clientId: clientId === 'all' ? undefined : clientId,
      siteId: siteId === 'all' ? undefined : siteId,
    }),
    [period, clientId, siteId],
  )
  const consumptionQuery = useSupplyConsumptionQuery(filters)
  const clientsQuery = useStockClientOptionsQuery()
  const sitesQuery = useWithdrawalSiteOptionsQuery()

  const rows = consumptionQuery.data
  const report = useMemo(() => buildConsumptionReport(rows ?? []), [rows])
  const sites = (sitesQuery.data ?? []).filter(
    (site) => clientId === 'all' || site.clientId === clientId,
  )

  async function handleExport() {
    if (!rows || rows.length === 0) {
      toast.info('No hay consumo para exportar en ese período.')
      return
    }
    try {
      await downloadExcel(
        excelFileName(
          'consumo-por-cliente',
          `${period.dateFrom}_a_${period.dateTo}`,
        ),
        {
          sheetName: 'Consumo por cliente',
          columns: CONSUMPTION_EXCEL_COLUMNS,
          rows,
        },
      )
    } catch (error) {
      toast.error(
        isApiError(error)
          ? error.message
          : 'No pudimos armar el Excel. Probá de nuevo.',
      )
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-40">
            <DatePicker
              aria-label="Consumo desde"
              placeholder="Desde"
              value={isoDateToDate(period.dateFrom)}
              onValueChange={(date) => {
                if (date) {
                  setPeriod({ ...period, dateFrom: localDateToIsoDate(date) })
                }
              }}
              maxDate={isoDateToDate(period.dateTo)}
            />
          </div>
          <div className="w-40">
            <DatePicker
              aria-label="Consumo hasta"
              placeholder="Hasta"
              value={isoDateToDate(period.dateTo)}
              onValueChange={(date) => {
                if (date) {
                  setPeriod({ ...period, dateTo: localDateToIsoDate(date) })
                }
              }}
              minDate={isoDateToDate(period.dateFrom)}
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPeriod(monthPeriod(today, 0))}
          >
            Este mes
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPeriod(monthPeriod(today, -1))}
          >
            Mes anterior
          </Button>
          <Select
            value={clientId}
            onValueChange={(value) => {
              setClientId(value)
              setSiteId('all')
            }}
          >
            <SelectTrigger aria-label="Filtrar por cliente">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los clientes</SelectItem>
              {(clientsQuery.data ?? []).map((client) => (
                <SelectItem key={client.id} value={client.id}>
                  {client.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={siteId} onValueChange={setSiteId}>
            <SelectTrigger aria-label="Filtrar por sede">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas las sedes</SelectItem>
              {sites.map((site) => (
                <SelectItem key={site.siteId} value={site.siteId}>
                  {clientId === 'all'
                    ? `${site.clientName} · ${site.siteName}`
                    : site.siteName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-3">
          {consumptionQuery.dataUpdatedAt > 0 && (
            <UpdatedAgo dataUpdatedAt={consumptionQuery.dataUpdatedAt} />
          )}
          <Button
            variant="ghost"
            icon={Download}
            onClick={() => void handleExport()}
          >
            Exportar a Excel
          </Button>
        </div>
      </div>

      {consumptionQuery.isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-32" />
        </div>
      ) : report.clients.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title="No hubo retiros en ese período"
          description="Probá con otras fechas, otro cliente u otra sede."
        />
      ) : (
        <>
          <div
            className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-border bg-surface px-4 py-3"
            data-testid="consumption-total"
          >
            <p className="text-[12px] text-text-3">
              Total del período · {formatQty(report.total.qty)} unidades
            </p>
            <p className="flex flex-wrap gap-x-5 text-[13px] font-semibold text-text">
              <span>
                A costo{' '}
                <span className="tabular-nums">
                  {formatMoney(report.total.cost)}
                </span>
              </span>
              <span>
                A venta{' '}
                <span className="tabular-nums">
                  {formatMoney(report.total.sale)}
                </span>
              </span>
            </p>
          </div>
          <ul className="flex flex-col gap-3" aria-label="Consumo por cliente">
            {report.clients.map((client) => (
              <ClientBlock key={client.clientId} client={client} />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function Totals({
  qty,
  cost,
  sale,
}: {
  qty: number
  cost: number
  sale: number
}) {
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12.5px] tabular-nums text-text-2">
      <span>{formatQty(qty)} u.</span>
      <span>
        Costo{' '}
        <span className="font-semibold text-text">{formatMoney(cost)}</span>
      </span>
      <span>
        Venta{' '}
        <span className="font-semibold text-text">{formatMoney(sale)}</span>
      </span>
    </span>
  )
}

function ClientBlock({ client }: { client: ConsumptionClient }) {
  return (
    <li
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      data-testid="consumption-client"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[14px] font-semibold text-text">
          {client.clientName}
        </h3>
        <Totals qty={client.qty} cost={client.cost} sale={client.sale} />
      </div>
      <ul className="flex flex-col gap-2">
        {client.sites.map((site) => (
          <SiteBlock key={site.siteId} site={site} />
        ))}
      </ul>
    </li>
  )
}

function SiteBlock({ site }: { site: ConsumptionSite }) {
  return (
    <li className="rounded-md border border-border">
      <details>
        <summary className="flex min-h-11 cursor-pointer flex-wrap items-center justify-between gap-2 px-3 py-2 text-[13px] font-semibold text-text">
          {site.siteName}
          <Totals qty={site.qty} cost={site.cost} sale={site.sale} />
        </summary>
        <ul className="flex flex-col divide-y divide-border border-t border-border">
          {site.supplies.map((supply) => (
            <li
              key={supply.supplyId}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2 text-[12.5px]"
            >
              <span className="min-w-0 text-text">
                {supplyLabel(supply)}
                <span className="ml-2 font-mono text-[11px] text-text-3">
                  {supply.code}
                </span>
              </span>
              <Totals qty={supply.qty} cost={supply.cost} sale={supply.sale} />
            </li>
          ))}
        </ul>
      </details>
    </li>
  )
}

export { ConsumptionTab }
