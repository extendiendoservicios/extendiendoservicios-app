import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Combobox } from '@/components/Combobox'
import { DatePicker } from '@/components/DatePicker'
import { localDateToIsoDate } from '@/features/settings/dateOnly'
import { supplyLabel } from '@/features/stock/filters'
import { MOVEMENT_KIND_LABELS } from '@/features/stock/labels'
import {
  DEFAULT_MOVEMENT_FILTERS,
  hasMovementFilters,
  type MovementFiltersState,
} from '@/features/stock/movements'
import type { StockMovementKind } from '@/api/stock'

export interface FilterOption {
  value: string
  label: string
}

/** `"YYYY-MM-DD"` -> `Date` para `DatePicker` (sin correr el día por la zona). */
export function isoDateToDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00`)
}

const KIND_OPTIONS = Object.entries(MOVEMENT_KIND_LABELS) as Array<
  [StockMovementKind, string]
>

interface MovementFiltersProps {
  value: MovementFiltersState
  onChange: (next: MovementFiltersState) => void
  people: FilterOption[]
  supplies: Array<{
    id: string
    code: string
    name: string
    presentation: string | null
  }>
  clients: FilterOption[]
  /** Sedes con su cliente, para acotar el selector al cliente elegido. */
  sites: Array<{ id: string; name: string; clientId: string }>
}

/**
 * Filtros de Movimientos (IS-18): fechas, tipo, persona, artículo, cliente y
 * sede. Los aplica el servidor (`v_stock_movements_admin`); acá solo se
 * eligen. Al cambiar de cliente, la sede elegida se limpia si no es de él.
 */
function MovementFilters({
  value,
  onChange,
  people,
  supplies,
  clients,
  sites,
}: MovementFiltersProps) {
  const visibleSites =
    value.clientId === 'all'
      ? sites
      : sites.filter((site) => site.clientId === value.clientId)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-full sm:w-60">
        <DatePicker
          aria-label="Movimientos desde"
          placeholder="Desde"
          value={value.dateFrom ? isoDateToDate(value.dateFrom) : undefined}
          onValueChange={(date) =>
            onChange({
              ...value,
              dateFrom: date ? localDateToIsoDate(date) : '',
            })
          }
          maxDate={value.dateTo ? isoDateToDate(value.dateTo) : undefined}
        />
      </div>
      <div className="w-full sm:w-60">
        <DatePicker
          aria-label="Movimientos hasta"
          placeholder="Hasta"
          value={value.dateTo ? isoDateToDate(value.dateTo) : undefined}
          onValueChange={(date) =>
            onChange({
              ...value,
              dateTo: date ? localDateToIsoDate(date) : '',
            })
          }
          minDate={value.dateFrom ? isoDateToDate(value.dateFrom) : undefined}
        />
      </div>
      <Select
        value={value.kind}
        onValueChange={(kind) =>
          onChange({ ...value, kind: kind as MovementFiltersState['kind'] })
        }
      >
        <SelectTrigger aria-label="Filtrar por tipo">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos los tipos</SelectItem>
          {KIND_OPTIONS.map(([kind, label]) => (
            <SelectItem key={kind} value={kind}>
              {label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Combobox
        aria-label="Filtrar por persona"
        className="w-52"
        options={[{ value: 'all', label: 'Todas las personas' }, ...people]}
        value={value.personId}
        onValueChange={(personId) => onChange({ ...value, personId })}
        searchPlaceholder="Buscar persona…"
        emptyText="No encontramos a nadie con ese nombre."
      />
      <Combobox
        aria-label="Filtrar por artículo"
        className="w-56"
        options={[
          { value: 'all', label: 'Todos los artículos' },
          ...supplies.map((supply) => ({
            value: supply.id,
            label: `${supply.code} · ${supplyLabel(supply)}`,
          })),
        ]}
        value={value.supplyId}
        onValueChange={(supplyId) => onChange({ ...value, supplyId })}
        searchPlaceholder="Buscar por código o nombre…"
        emptyText="No encontramos artículos con ese texto."
      />
      <Select
        value={value.clientId}
        onValueChange={(clientId) =>
          onChange({
            ...value,
            clientId,
            siteId:
              clientId === 'all' ||
              sites.some(
                (site) =>
                  site.id === value.siteId && site.clientId === clientId,
              )
                ? value.siteId
                : 'all',
          })
        }
      >
        <SelectTrigger aria-label="Filtrar por cliente">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todos los clientes</SelectItem>
          {clients.map((client) => (
            <SelectItem key={client.value} value={client.value}>
              {client.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={value.siteId}
        onValueChange={(siteId) => onChange({ ...value, siteId })}
      >
        <SelectTrigger aria-label="Filtrar por sede">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Todas las sedes</SelectItem>
          {visibleSites.map((site) => (
            <SelectItem key={site.id} value={site.id}>
              {site.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hasMovementFilters(value) && (
        <Button
          variant="ghost"
          size="sm"
          icon={X}
          onClick={() => onChange(DEFAULT_MOVEMENT_FILTERS)}
        >
          Limpiar filtros
        </Button>
      )}
    </div>
  )
}

export { MovementFilters }
