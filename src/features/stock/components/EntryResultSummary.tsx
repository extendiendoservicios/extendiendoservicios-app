import { Link } from 'react-router'
import { CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { StockPostResult } from '@/api/stock'
import { supplyLabel } from '@/features/stock/filters'
import { formatMoney, formatQty } from '@/features/stock/money'
import { MOVEMENT_KIND_LABELS, formatSignedQty } from '@/features/stock/labels'

/**
 * Resumen que se muestra al confirmar un ingreso o una devolución (IS-09):
 * cada artículo con la cantidad registrada y el stock que quedó.
 */
function EntryResultSummary({
  result,
  onAnother,
}: {
  result: StockPostResult
  onAnother: () => void
}) {
  const kindLabel = MOVEMENT_KIND_LABELS[result.kind]
  return (
    <div
      className="flex max-w-3xl flex-col gap-4 rounded-lg border border-border bg-surface p-5"
      data-testid="entry-summary"
    >
      <div className="flex items-center gap-2">
        <CheckCircle2 aria-hidden="true" className="size-5 text-success-800" />
        <h2 className="text-[15px] font-semibold text-text">
          {kindLabel} registrado
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <caption className="sr-only">
            Artículos del movimiento y stock resultante
          </caption>
          <thead>
            <tr className="border-b border-border text-left text-[10px] tracking-wide text-text-3 uppercase">
              <th scope="col" className="py-2 pr-3 font-semibold">
                Artículo
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">
                Cantidad
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-semibold">
                Costo unitario
              </th>
              <th scope="col" className="py-2 text-right font-semibold">
                Stock resultante
              </th>
            </tr>
          </thead>
          <tbody>
            {result.lines.map((line) => (
              <tr key={line.supplyId} className="border-b border-border">
                <td className="py-2 pr-3">
                  <span className="font-semibold text-text">
                    {supplyLabel(line)}
                  </span>
                  <span className="block font-mono text-[11px] text-text-3">
                    {line.code}
                  </span>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {formatSignedQty(line.qtyDelta)}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {formatMoney(line.unitCost)}
                </td>
                <td className="py-2 text-right font-semibold tabular-nums">
                  {formatQty(line.stockAfter)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onAnother}>
          Cargar otro
        </Button>
        <Button asChild>
          <Link to="/admin/insumos">Volver a Stock</Link>
        </Button>
      </div>
    </div>
  )
}

export { EntryResultSummary }
