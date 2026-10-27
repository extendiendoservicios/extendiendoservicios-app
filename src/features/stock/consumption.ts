import type { ConsumptionRow } from '@/api/stock'

/**
 * Lógica pura de «Consumo por cliente» (IS-24): totales a costo y a venta por
 * cliente y por sede, y el detalle por artículo. Los precios son los que
 * quedaron guardados en cada línea de retiro (IS-22); los retiros anulados ya
 * vienen descontados de la vista. Todo se suma en centavos.
 */

export interface ConsumptionTotals {
  qty: number
  cost: number
  sale: number
}

export interface ConsumptionSupply extends ConsumptionTotals {
  supplyId: string
  code: string
  name: string
  presentation: string | null
}

export interface ConsumptionSite extends ConsumptionTotals {
  siteId: string
  siteName: string
  supplies: ConsumptionSupply[]
}

export interface ConsumptionClient extends ConsumptionTotals {
  clientId: string
  clientName: string
  sites: ConsumptionSite[]
}

export interface ConsumptionReport {
  total: ConsumptionTotals
  clients: ConsumptionClient[]
}

interface CentTotals {
  qty: number
  cost: number
  sale: number
}

function addRow(target: CentTotals, row: ConsumptionRow) {
  target.qty += row.qty
  target.cost += Math.round(row.costTotal * 100)
  target.sale += Math.round(row.saleTotal * 100)
}

function toTotals(cents: CentTotals): ConsumptionTotals {
  return { qty: cents.qty, cost: cents.cost / 100, sale: cents.sale / 100 }
}

const collator = new Intl.Collator('es')

/** Agrupa las filas por cliente, sede y artículo, ordenados por nombre. */
export function buildConsumptionReport(
  rows: readonly ConsumptionRow[],
): ConsumptionReport {
  const total: CentTotals = { qty: 0, cost: 0, sale: 0 }
  const clients = new Map<
    string,
    {
      name: string
      cents: CentTotals
      sites: Map<
        string,
        {
          name: string
          cents: CentTotals
          supplies: Map<string, { row: ConsumptionRow; cents: CentTotals }>
        }
      >
    }
  >()

  for (const row of rows) {
    addRow(total, row)
    let client = clients.get(row.clientId)
    if (!client) {
      client = {
        name: row.clientName,
        cents: { qty: 0, cost: 0, sale: 0 },
        sites: new Map(),
      }
      clients.set(row.clientId, client)
    }
    addRow(client.cents, row)
    let site = client.sites.get(row.siteId)
    if (!site) {
      site = {
        name: row.siteName,
        cents: { qty: 0, cost: 0, sale: 0 },
        supplies: new Map(),
      }
      client.sites.set(row.siteId, site)
    }
    addRow(site.cents, row)
    let supply = site.supplies.get(row.supplyId)
    if (!supply) {
      supply = { row, cents: { qty: 0, cost: 0, sale: 0 } }
      site.supplies.set(row.supplyId, supply)
    }
    addRow(supply.cents, row)
  }

  return {
    total: toTotals(total),
    clients: Array.from(clients, ([clientId, client]) => ({
      clientId,
      clientName: client.name,
      ...toTotals(client.cents),
      sites: Array.from(client.sites, ([siteId, site]) => ({
        siteId,
        siteName: site.name,
        ...toTotals(site.cents),
        supplies: Array.from(site.supplies.values())
          .map(({ row, cents }) => ({
            supplyId: row.supplyId,
            code: row.supplyCode,
            name: row.supplyName,
            presentation: row.supplyPresentation,
            ...toTotals(cents),
          }))
          .sort(
            (a, b) =>
              collator.compare(a.name, b.name) ||
              collator.compare(a.presentation ?? '', b.presentation ?? ''),
          ),
      })).sort((a, b) => collator.compare(a.siteName, b.siteName)),
    })).sort((a, b) => collator.compare(a.clientName, b.clientName)),
  }
}

/** Último día (`YYYY-MM-DD`) del mes de `isoDay`. */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * Período de un mes: `offset` 0 es el mes de `today` (hasta hoy, no hasta fin
 * de mes) y -1 el mes anterior completo. `today` es una fecha de Argentina.
 */
export function monthPeriod(
  today: string,
  offset: 0 | -1,
): { dateFrom: string; dateTo: string } {
  const [year = 0, month = 1] = today.split('-').map(Number)
  if (offset === 0) {
    return { dateFrom: `${today.slice(0, 7)}-01`, dateTo: today }
  }
  const previousMonth = month === 1 ? 12 : month - 1
  const previousYear = month === 1 ? year - 1 : year
  const mm = String(previousMonth).padStart(2, '0')
  return {
    dateFrom: `${previousYear}-${mm}-01`,
    dateTo: `${previousYear}-${mm}-${lastDayOfMonth(previousYear, previousMonth)}`,
  }
}
