import { useState } from 'react'
import { CalendarX, MapPinOff, Search } from 'lucide-react'
import type { WithdrawalShiftOption, WithdrawalSiteOption } from '@/api/myStock'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { RadioGroup } from '@/components/ui/radio-group'
import { EmptyState } from '@/components/EmptyState'
import { OptionCard } from '@/components/OptionCard'
import { SegmentedControl } from '@/components/SegmentedControl'
import { formatShiftWhen } from '../format'
import {
  filterShiftOptions,
  filterSiteOptions,
  SEARCH_THRESHOLD,
  splitByPriority,
} from '../logic'
import {
  useWithdrawalShiftOptionsQuery,
  useWithdrawalSiteOptionsQuery,
} from '../queries'

export type DestinationMode = 'none' | 'shift' | 'site'

/**
 * Para qué es el retiro o dónde falta el insumo (IS-12, IS-28, IS-29): un
 * turno de `v_withdrawal_shift_options` o una sede de
 * `v_withdrawal_site_options`. El coordinador ve primero «Mis sedes»
 * (`is_priority`) y después el resto, con buscador por cliente o sede; el
 * empleado ve solo lo suyo (la base ya lo acota). Con `allowNone` (aviso de
 * faltante) se puede no elegir ninguno.
 */
export function DestinationPicker({
  mode,
  onModeChange,
  shiftId,
  onShiftChange,
  siteId,
  onSiteChange,
  allowNone = false,
}: {
  mode: DestinationMode
  onModeChange: (mode: DestinationMode) => void
  shiftId: string | null
  onShiftChange: (shiftId: string) => void
  siteId: string | null
  onSiteChange: (siteId: string) => void
  allowNone?: boolean
}) {
  const options: { value: DestinationMode; label: string }[] = [
    ...(allowNone ? [{ value: 'none' as const, label: 'Ninguno' }] : []),
    { value: 'shift', label: 'Un turno' },
    { value: 'site', label: 'Una sede' },
  ]

  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl
        mobile
        aria-label={
          allowNone ? 'Dónde falta (opcional)' : 'Para qué es el retiro'
        }
        value={mode}
        onValueChange={onModeChange}
        options={options}
      />
      {mode === 'shift' && (
        <ShiftList selectedId={shiftId} onSelect={onShiftChange} />
      )}
      {mode === 'site' && (
        <SiteList selectedId={siteId} onSelect={onSiteChange} />
      )}
    </div>
  )
}

function SearchField({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <Input
      mobile
      type="search"
      icon={Search}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder="Buscar por cliente o sede…"
      aria-label="Buscar por cliente o sede"
    />
  )
}

function Heading({ children }: { children: string }) {
  return (
    <p className="text-[11px] font-semibold tracking-[0.4px] text-text-3 uppercase">
      {children}
    </p>
  )
}

function Loading() {
  return <p className="p-4 text-center text-[12.5px] text-text-3">Cargando…</p>
}

function LoadError({ what }: { what: string }) {
  return (
    <Alert variant="crit">
      <AlertDescription>
        No pudimos cargar {what}. Probá de nuevo en un momento.
      </AlertDescription>
    </Alert>
  )
}

function ShiftList({
  selectedId,
  onSelect,
}: {
  selectedId: string | null
  onSelect: (shiftId: string) => void
}) {
  const { data, isLoading, isError } = useWithdrawalShiftOptionsQuery()
  const [search, setSearch] = useState('')

  if (isLoading) return <Loading />
  if (isError || !data) return <LoadError what="tus turnos" />
  if (data.length === 0) {
    return (
      <EmptyState
        icon={CalendarX}
        title="No tenés turnos para elegir"
        description="Se muestran los turnos de hoy y de los próximos 7 días. Podés retirar para una sede."
        className="py-6"
      />
    )
  }

  const filtered = filterShiftOptions(data, search)
  const { mine, others } = splitByPriority(filtered)
  const grouped = data.some((option) => option.isPriority)

  return (
    <div className="flex flex-col gap-3">
      {data.length >= SEARCH_THRESHOLD && (
        <SearchField value={search} onChange={setSearch} />
      )}
      {filtered.length === 0 ? (
        <p className="py-2 text-center text-[12.5px] text-text-3">
          No encontramos turnos con esa búsqueda.
        </p>
      ) : (
        <RadioGroup
          value={selectedId ?? ''}
          onValueChange={onSelect}
          aria-label="Turno"
        >
          {grouped ? (
            <>
              {mine.length > 0 && (
                <ShiftBlock title="Mis sedes" options={mine} />
              )}
              {others.length > 0 && (
                <ShiftBlock title="Otras sedes" options={others} />
              )}
            </>
          ) : (
            <ShiftBlock options={filtered} />
          )}
        </RadioGroup>
      )}
    </div>
  )
}

function ShiftBlock({
  title,
  options,
}: {
  title?: string
  options: WithdrawalShiftOption[]
}) {
  return (
    <div className="flex flex-col gap-2">
      {title && <Heading>{title}</Heading>}
      {options.map((option) => (
        <OptionCard
          key={option.shiftId}
          value={option.shiftId}
          title={`${option.clientName} · ${option.siteName}`}
          description={formatShiftWhen(option.shiftDate, option.startTime)}
          className="min-h-11"
        />
      ))}
    </div>
  )
}

function SiteList({
  selectedId,
  onSelect,
}: {
  selectedId: string | null
  onSelect: (siteId: string) => void
}) {
  const { data, isLoading, isError } = useWithdrawalSiteOptionsQuery()
  const [search, setSearch] = useState('')

  if (isLoading) return <Loading />
  if (isError || !data) return <LoadError what="las sedes" />
  if (data.length === 0) {
    return (
      <EmptyState
        icon={MapPinOff}
        title="No hay sedes para elegir"
        description="Consultá en la oficina."
        className="py-6"
      />
    )
  }

  const filtered = filterSiteOptions(data, search)
  const { mine, others } = splitByPriority(filtered)
  const grouped = data.some((option) => option.isPriority)

  return (
    <div className="flex flex-col gap-3">
      {data.length >= SEARCH_THRESHOLD && (
        <SearchField value={search} onChange={setSearch} />
      )}
      {filtered.length === 0 ? (
        <p className="py-2 text-center text-[12.5px] text-text-3">
          No encontramos sedes con esa búsqueda.
        </p>
      ) : (
        <RadioGroup
          value={selectedId ?? ''}
          onValueChange={onSelect}
          aria-label="Sede"
        >
          {grouped ? (
            <>
              {mine.length > 0 && (
                <SiteBlock title="Mis sedes" options={mine} />
              )}
              {others.length > 0 && (
                <SiteBlock title="Otras sedes" options={others} />
              )}
            </>
          ) : (
            <SiteBlock options={filtered} />
          )}
        </RadioGroup>
      )}
    </div>
  )
}

function SiteBlock({
  title,
  options,
}: {
  title?: string
  options: WithdrawalSiteOption[]
}) {
  return (
    <div className="flex flex-col gap-2">
      {title && <Heading>{title}</Heading>}
      {options.map((option) => (
        <OptionCard
          key={option.siteId}
          value={option.siteId}
          title={option.siteName}
          description={option.clientName}
          className="min-h-11"
        />
      ))}
    </div>
  )
}
