import type { StockCountLine } from '@/api/stock'
import { supplyLabel } from '@/features/stock/filters'
import { formatQty } from '@/features/stock/money'
import { formatSignedQty } from '@/features/stock/labels'

/**
 * Tabla de un control (IS-31): por artículo, el stock del sistema a la hora
 * del control, lo contado y la diferencia (con signo; en rojo si falta y en
 * amarillo si sobra, además del signo, para no depender solo del color).
 */
function CountLinesTable({
  lines,
  caption,
}: {
  lines: readonly StockCountLine[]
  caption: string
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border text-left text-[10px] tracking-wide text-text-3 uppercase">
            <th scope="col" className="py-2 pr-3 font-semibold">
              Artículo
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-semibold">
              Stock del sistema
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-semibold">
              Contado
            </th>
            <th scope="col" className="py-2 text-right font-semibold">
              Diferencia
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
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
                {formatQty(line.systemQty)}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {formatQty(line.countedQty)}
              </td>
              <td
                className={
                  line.difference < 0
                    ? 'py-2 text-right font-semibold tabular-nums text-danger-800'
                    : line.difference > 0
                      ? 'py-2 text-right font-semibold tabular-nums text-warning-800'
                      : 'py-2 text-right tabular-nums text-text-3'
                }
              >
                {formatSignedQty(line.difference)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export { CountLinesTable }
