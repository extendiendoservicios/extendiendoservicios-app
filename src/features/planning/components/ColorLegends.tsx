import { cn } from 'cn'
import { clientChipColors } from '@/features/planning/clientColors'
import { StatusDot } from '@/features/planning/components/ShiftChip'

export interface LegendClient {
  id: string
  name: string
  calendarColor: number | null
}

interface ClientLegendProps {
  title: string
  clients: LegendClient[]
  /** Cliente por el que está filtrando el calendario, si hay. */
  selectedId: string | null
  /** Clic en una ficha: filtra; otro clic sobre la misma, limpia (recibe `null`). */
  onSelect: (id: string | null) => void
}

/** Fichas «Clientes del mes»: color + nombre; filtran el calendario por cliente. */
function ClientLegend({
  title,
  clients,
  selectedId,
  onSelect,
}: ClientLegendProps) {
  if (clients.length === 0) {
    return null
  }
  return (
    <section aria-label={title} className="flex flex-wrap items-center gap-1.5">
      <h3 className="mr-1 text-[12px] font-semibold text-text-3">{title}</h3>
      {clients.map((client) => {
        const colors = clientChipColors(client.calendarColor)
        const selected = selectedId === client.id
        return (
          <button
            key={client.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(selected ? null : client.id)}
            style={
              colors
                ? { background: colors.background, color: colors.color }
                : undefined
            }
            className={cn(
              'inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px] font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring',
              selected
                ? 'border-current ring-2 ring-current'
                : 'border-transparent',
            )}
          >
            <span
              aria-hidden="true"
              className="inline-block size-2.5 rounded-full"
              style={{ background: colors?.dot ?? 'currentColor' }}
            />
            {client.name}
          </button>
        )
      })}
    </section>
  )
}

const STATUS_LEGEND: { status: string; label: string }[] = [
  { status: 'scheduled', label: 'Programado' },
  { status: 'assigned', label: 'Asignado / En curso' },
  { status: 'completed', label: 'Finalizado' },
  { status: 'uncovered', label: 'Sin cubrir' },
  { status: 'cancelled', label: 'Cancelado' },
]

/** Leyenda «Estado (puntito)» de debajo del calendario, solo en modo Cliente. */
function StatusDotLegend() {
  return (
    <ul
      aria-label="Estado (puntito)"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-text-3"
    >
      <li className="font-semibold">Estado (puntito)</li>
      {STATUS_LEGEND.map((item) => (
        <li key={item.status} className="inline-flex items-center gap-1.5">
          <StatusDot status={item.status} />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

export { ClientLegend, StatusDotLegend }
