import { Link } from 'react-router'
import { MessageSquareWarning, PackageMinus } from 'lucide-react'
import { KpiCard } from '@/components/KpiCard'
import { useStockSummaryQuery } from '@/features/stock/queries'
import { lowStockCard, shortagesCard, type StockCardData } from '../stockCards'

/**
 * Las dos tarjetas de Insumos de ADM-02 (IS-30): «Faltantes avisados» y
 * «Stock bajo». Cada una lleva a Insumos con el filtro puesto. Si el
 * contador no se pudo leer, no se muestran: el Resumen no se rompe por esto.
 */
function StockCards() {
  const summaryQuery = useStockSummaryQuery()
  if (summaryQuery.isError) {
    return null
  }
  const summary = summaryQuery.data
  const shortages = summary ? shortagesCard(summary) : null
  const low = summary ? lowStockCard(summary) : null

  return (
    <section
      aria-label="Insumos"
      className="grid grid-cols-2 gap-3 lg:grid-cols-5"
    >
      <StockCardLink
        data={shortages}
        label="Faltantes avisados"
        icon={MessageSquareWarning}
      />
      <StockCardLink data={low} label="Stock bajo" icon={PackageMinus} />
    </section>
  )
}

function StockCardLink({
  data,
  label,
  icon,
}: {
  data: StockCardData | null
  label: string
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <Link
      to={data?.to ?? '/admin/insumos'}
      className="block rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring"
    >
      <KpiCard
        className="h-full transition-colors hover:border-primary-200"
        variant={data?.variant ?? 'default'}
        icon={icon}
        label={label}
        value={data ? data.value : '—'}
        detail={data?.detail}
      />
    </Link>
  )
}

export { StockCards }
