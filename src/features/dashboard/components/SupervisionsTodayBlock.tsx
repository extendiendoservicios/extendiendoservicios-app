import { Link } from 'react-router'
import { StatusBadge } from '@/components/status'
import type { SupervisionListRow } from '@/api/supervisions'

/**
 * Supervisiones de hoy (DASH-007): bloque secundario de solo lectura, con
 * enlace al detalle (ADM-15). Las canceladas no se listan: no son trabajo
 * del día.
 */
function SupervisionsTodayBlock({
  rows,
  isLoading,
}: {
  rows: SupervisionListRow[]
  isLoading: boolean
}) {
  const visible = rows.filter((row) => row.status !== 'cancelled')
  return (
    <section
      aria-label="Supervisiones de hoy"
      className="rounded-lg border border-border bg-surface p-4 shadow-card"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-text">
          Supervisiones de hoy
        </h2>
        <Link
          to="/admin/supervisiones"
          className="inline-flex items-center text-[12.5px] font-medium text-primary-800 hover:underline max-md:min-h-11"
        >
          Ver todas
        </Link>
      </div>
      {isLoading ? (
        <p className="text-[12.5px] text-text-3">Cargando…</p>
      ) : visible.length === 0 ? (
        <p className="text-[12.5px] text-text-3">
          No hay supervisiones para hoy.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {visible.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2"
            >
              <Link
                to={`/admin/supervisiones/${row.id}`}
                className="min-w-0 text-[13px] text-text hover:text-primary-800 max-md:flex max-md:min-h-11 max-md:items-center"
              >
                <span className="min-w-0">
                  <span className="font-semibold">
                    {row.startTime.slice(0, 5)}
                  </span>{' '}
                  {row.clientName} · {row.siteName}
                  <span className="block text-[12px] text-text-3">
                    {row.supervisorFirstName} {row.supervisorLastName}
                  </span>
                </span>
              </Link>
              <StatusBadge domain="supervision" status={row.status} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export { SupervisionsTodayBlock }
