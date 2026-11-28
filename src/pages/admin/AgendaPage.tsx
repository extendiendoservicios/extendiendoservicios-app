import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { IconButton, IconButtonGroup } from '@/components/IconButton'
import { Skeleton } from '@/components/ui/skeleton'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { useSearchParamState } from '@/hooks/useSearchParamState'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'
import { useHolidaysQuery } from '@/features/settings/queries'
import { addMonthsToYearMonth } from '@/features/planning/planningDates'
import { UpdatedAgo } from '@/features/shifts/components/UpdatedAgo'
import { AgendaCalculator } from '@/features/agenda/components/AgendaCalculator'
import { AgendaCalendar } from '@/features/agenda/components/AgendaCalendar'
import { AgendaDayDialog } from '@/features/agenda/components/AgendaDayDialog'
import { AgendaEmployeeList } from '@/features/agenda/components/AgendaEmployeeList'
import { AgendaMobileCalendar } from '@/features/agenda/components/AgendaMobileCalendar'
import { AgendaNewSection } from '@/features/agenda/components/AgendaNewSection'
import { AgendaNotes } from '@/features/agenda/components/AgendaNotes'
import { AgendaPrintButton } from '@/features/agenda/components/AgendaPrintButton'
import { buildAgendaGrid, monthStartIso } from '@/features/agenda/agendaMonth'
import { useAgendaItemsQuery } from '@/features/agenda/queries'
import { useAgendaSuggestions } from '@/features/agenda/useAgendaSuggestions'

const MONTH_KEY = {
  parse: (raw: string) =>
    /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : undefined,
}

/**
 * `/admin/agenda` (P37, AG-01 a AG-20): la pizarra mensual de dueños y
 * administradores. A la izquierda el calendario del mes y «Nuevos»; a la
 * derecha la lista de empleados del día, las notas y la calculadora. Por
 * debajo de 768 px los bloques se apilan y el calendario pasa a lista de días.
 * El mes vive en la dirección (`?mes=2026-11`).
 */
export default function AgendaPage() {
  const today = todayInBuenosAires()
  const [monthKey, setMonthKey] = useSearchParamState(
    'mes',
    today.slice(0, 7),
    MONTH_KEY,
  )
  const year = Number(monthKey.slice(0, 4))
  const month = Number(monthKey.slice(5, 7))
  const monthStart = monthStartIso(year, month)

  const isMobile = useMediaQuery('(max-width: 767px)')
  const isWide = useMediaQuery('(min-width: 1024px)')

  const itemsQuery = useAgendaItemsQuery(monthStart)
  const holidaysQuery = useHolidaysQuery(year)
  const suggestions = useAgendaSuggestions()
  const [openDate, setOpenDate] = useState<string | null>(null)

  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data])
  const holidays = useMemo(
    () =>
      new Map(
        (holidaysQuery.data ?? [])
          .filter((holiday) => !holiday.deletedAt)
          .map(
            (holiday) =>
              [holiday.holidayDate, holiday.name ?? 'Feriado'] as const,
          ),
      ),
    [holidaysQuery.data],
  )
  const weeks = useMemo(
    () => buildAgendaGrid(year, month, items, holidays),
    [year, month, items, holidays],
  )

  const monthLabel = format(new Date(year, month - 1, 1), 'LLLL yyyy', {
    locale: es,
  })

  function stepMonth(step: 1 | -1) {
    setMonthKey((current) => {
      const target = addMonthsToYearMonth(
        Number(current.slice(0, 4)),
        Number(current.slice(5, 7)),
        step,
      )
      return `${target.year}-${String(target.month).padStart(2, '0')}`
    })
  }

  const openDay = openDate
    ? weeks.flat().find((day) => day.date === openDate)
    : undefined
  // Un día de otro mes no trae eventos en esta grilla: se abre vacío para agregar.
  const openEvents = openDay?.events ?? []

  const calendar = isMobile ? (
    <AgendaMobileCalendar weeks={weeks} today={today} onOpenDay={setOpenDate} />
  ) : (
    <AgendaCalendar weeks={weeks} today={today} onOpenDay={setOpenDate} />
  )

  const newSection = (
    <AgendaNewSection
      items={items}
      month={monthStart}
      suggestions={suggestions}
    />
  )
  const notes = <AgendaNotes items={items} month={monthStart} />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <IconButtonGroup>
            <IconButton
              icon={ChevronLeft}
              aria-label="Mes anterior"
              onClick={() => stepMonth(-1)}
            />
            <IconButton
              icon={ChevronRight}
              aria-label="Mes siguiente"
              onClick={() => stepMonth(1)}
            />
          </IconButtonGroup>
          <h2 className="text-[20px] font-bold text-text capitalize">
            {monthLabel}
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <UpdatedAgo dataUpdatedAt={itemsQuery.dataUpdatedAt} />
          <AgendaPrintButton
            monthLabel={monthLabel}
            weeks={weeks}
            items={items}
          />
        </div>
      </div>

      {itemsQuery.isError && (
        <p role="alert" className="text-[13px] text-danger">
          {itemsQuery.error instanceof Error
            ? itemsQuery.error.message
            : 'No pudimos cargar la agenda.'}
        </p>
      )}

      {itemsQuery.isLoading ? (
        <Skeleton className="h-96" />
      ) : isWide ? (
        <div className="grid grid-cols-[minmax(0,1fr)_20rem] items-start gap-4">
          <div className="flex min-w-0 flex-col gap-4">
            {calendar}
            {newSection}
          </div>
          <div className="flex flex-col gap-4">
            <AgendaEmployeeList />
            {notes}
            <AgendaCalculator />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {calendar}
          {newSection}
          {notes}
          <AgendaEmployeeList />
          <AgendaCalculator />
        </div>
      )}

      <AgendaDayDialog
        date={openDate}
        events={openEvents}
        holidayName={openDay?.holidayName}
        suggestions={suggestions}
        onOpenChange={(open) => {
          if (!open) {
            setOpenDate(null)
          }
        }}
      />
    </div>
  )
}
