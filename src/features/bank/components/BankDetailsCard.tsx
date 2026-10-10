import { isBankDetailsEmpty, type BankDetails } from '@/api/bankDetails'
import { formatCbu } from '@/features/bank/schemas'

interface BankDetailsCardProps {
  details: BankDetails | null | undefined
  isLoading?: boolean
  className?: string
}

/**
 * AJ2-04: sección «Datos bancarios» de la ficha de un cliente o de un
 * empleado (solo dueño y administrador), en lectura.
 */
function BankDetailsCard({
  details,
  isLoading = false,
  className,
}: BankDetailsCardProps) {
  return (
    <section
      className={`rounded-lg border border-border bg-surface p-5 ${className ?? ''}`}
    >
      <h3 className="mb-2 text-[13px] font-semibold text-text">
        Datos bancarios
      </h3>
      {isLoading ? (
        <p className="text-[12px] text-text-3">Cargando…</p>
      ) : isBankDetailsEmpty(details) ? (
        <p className="text-[12px] text-text-3">Sin datos bancarios cargados.</p>
      ) : (
        <BankDetailsList details={details as BankDetails} />
      )}
    </section>
  )
}

function BankDetailsList({ details }: { details: BankDetails }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-[12px] text-text-2 sm:grid-cols-3">
      <div>
        <dt className="inline font-semibold">Banco: </dt>
        <dd className="inline">{details.bankName ?? '—'}</dd>
      </div>
      <div>
        <dt className="inline font-semibold">CBU: </dt>
        <dd className="inline tabular-nums">{formatCbu(details.cbu) || '—'}</dd>
      </div>
      <div>
        <dt className="inline font-semibold">Alias: </dt>
        <dd className="inline">{details.alias ?? '—'}</dd>
      </div>
    </dl>
  )
}

export { BankDetailsCard, BankDetailsList }
