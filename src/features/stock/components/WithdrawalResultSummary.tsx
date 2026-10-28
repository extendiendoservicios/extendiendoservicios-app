import { Link } from 'react-router'
import { CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { WithdrawalResult } from '@/api/stock'
import { supplyLabel } from '@/features/stock/filters'
import { formatDateTime } from '@/features/stock/labels'
import { formatQty } from '@/features/stock/money'

export interface WithdrawalSummaryData {
  result: WithdrawalResult
  personName: string
  /** Turno o sede elegidos, como se mostraron en el selector. */
  place: string
  note: string | null
}

/**
 * Resumen que se muestra al terminar un retiro en nombre de otra persona
 * (IS-11): quién retiró, para qué y qué artículos y cantidades salieron. El
 * servidor no devuelve el stock resultante en un retiro, y acá tampoco se
 * muestra.
 */
function WithdrawalResultSummary({
  data,
  onAnother,
}: {
  data: WithdrawalSummaryData
  onAnother: () => void
}) {
  const { result } = data
  return (
    <div
      className="flex max-w-3xl flex-col gap-4 rounded-lg border border-border bg-surface p-5"
      data-testid="withdrawal-summary"
    >
      <div className="flex items-center gap-2">
        <CheckCircle2 aria-hidden="true" className="size-5 text-success-800" />
        <h2 className="text-[15px] font-semibold text-text">
          Retiro registrado
        </h2>
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-2">
        <div className="flex gap-1.5">
          <dt className="text-text-3">Retira:</dt>
          <dd className="font-semibold text-text">{data.personName}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-text-3">Cuándo:</dt>
          <dd className="text-text">{formatDateTime(result.recordedAt)}</dd>
        </div>
        <div className="flex gap-1.5 sm:col-span-2">
          <dt className="text-text-3">Para:</dt>
          <dd className="text-text">{data.place}</dd>
        </div>
        {data.note && (
          <div className="flex gap-1.5 sm:col-span-2">
            <dt className="text-text-3">Observación:</dt>
            <dd className="text-text">{data.note}</dd>
          </div>
        )}
      </dl>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <caption className="sr-only">Artículos retirados</caption>
          <thead>
            <tr className="border-b border-border text-left text-[10px] tracking-wide text-text-3 uppercase">
              <th scope="col" className="py-2 pr-3 font-semibold">
                Artículo
              </th>
              <th scope="col" className="py-2 text-right font-semibold">
                Cantidad
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
                <td className="py-2 text-right font-semibold tabular-nums">
                  {formatQty(line.qty)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onAnother}>
          Cargar otro retiro
        </Button>
        <Button asChild>
          <Link to="/admin/insumos?pestana=movimientos">Ver movimientos</Link>
        </Button>
      </div>
    </div>
  )
}

export { WithdrawalResultSummary }
