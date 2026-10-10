import { useMemo } from 'react'
import { CalendarPlus } from 'lucide-react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { isApiError } from '@/api/errors'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'
import {
  describeNationalHolidaysLoad,
  nextYearOf,
  shouldRemindNextYearHolidays,
} from '@/features/settings/holidayReminder'
import {
  useHolidaysQuery,
  useLoadNationalHolidaysMutation,
} from '@/features/settings/queries'

/**
 * AJ2-13: aviso discreto en Configuración → Feriados cuando, desde el 1 de
 * octubre, el año siguiente todavía no tiene feriados cargados. Ofrece el
 * mismo botón de «Cargar feriados nacionales de <año>» y aclara que los
 * feriados puente o turísticos por decreto se agregan a mano.
 */
function NextYearHolidaysNotice({
  userId,
  selectedYear,
  today = todayInBuenosAires(),
}: {
  userId: string
  /** Año que se está mirando: si ya es el siguiente, el botón de la página alcanza. */
  selectedYear: number
  today?: string
}) {
  const nextYear = nextYearOf(today)
  const holidaysQuery = useHolidaysQuery(nextYear)
  const loadNationalHolidays = useLoadNationalHolidaysMutation(nextYear)

  const activeCount = useMemo(
    () =>
      holidaysQuery.data
        ? holidaysQuery.data.filter((holiday) => holiday.deletedAt == null)
            .length
        : undefined,
    [holidaysQuery.data],
  )

  if (
    selectedYear === nextYear ||
    !shouldRemindNextYearHolidays(today, activeCount)
  ) {
    return null
  }

  async function handleLoad() {
    try {
      const result = await loadNationalHolidays.mutateAsync({
        createdBy: userId,
      })
      toast.success(describeNationalHolidaysLoad(nextYear, result))
    } catch (error) {
      toast.error(
        isApiError(error)
          ? error.message
          : 'No pudimos cargar los feriados nacionales.',
      )
    }
  }

  return (
    <Alert variant="info">
      <CalendarPlus />
      <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
        <span>
          {nextYear} todavía no tiene feriados cargados. Los feriados puente o
          turísticos que se decretan aparte se agregan a mano.
        </span>
        <Button
          variant="ghost"
          size="sm"
          loading={loadNationalHolidays.isPending}
          onClick={() => void handleLoad()}
        >
          Cargar feriados nacionales de {nextYear}
        </Button>
      </AlertDescription>
    </Alert>
  )
}

export { NextYearHolidaysNotice }
