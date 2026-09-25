import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CalendarClock, CalendarRange } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { EmptyState } from '@/components/EmptyState'
import { Field, FieldLabel } from '@/components/ui/field'
import { MonthPicker } from '@/components/MonthPicker'
import { isApiError } from '@/api/errors'
import type { GenerateShiftsResult } from '@/api/shifts'
import { useAuth } from '@/features/auth/AuthProvider'
import { useHolidaysQuery } from '@/features/settings/queries'
import { canGenerateShifts } from '@/features/shifts/permissions'
import {
  useActiveServicesCountForMonthQuery,
  useGenerateShiftsMutation,
} from '@/features/shifts/queries'

/**
 * ADM-09 "Generar turnos del mes" (SHIFT-009, `05` línea 43): selector de
 * mes, resumen previo (servicios activos y feriados del mes) y resultado
 * (creados, ya existentes, omitidos por feriado). `06_API.md` sección 6:
 * `generate_shifts`, capacidad `generate_shifts`.
 *
 * "Regenerar" solo crea los turnos que faltan -- el aviso de abajo se lo
 * deja bien claro a quien usa la pantalla, tal como pide el encargo.
 */
export default function ShiftsGeneratePage() {
  const auth = useAuth()
  const canGenerate = canGenerateShifts({
    roles: auth.roles,
    capabilities: auth.capabilities,
  })

  const now = useMemo(() => new Date(), [])
  const [month, setMonth] = useState(() => ({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  }))
  const [result, setResult] = useState<GenerateShiftsResult | null>(null)

  const activeServicesQuery = useActiveServicesCountForMonthQuery(
    month.year,
    month.month,
  )
  const holidaysQuery = useHolidaysQuery(month.year)
  const holidaysInMonthCount = (holidaysQuery.data ?? []).filter(
    (holiday) =>
      !holiday.deletedAt &&
      holiday.holidayDate.slice(0, 7) ===
        `${month.year}-${String(month.month).padStart(2, '0')}`,
  ).length

  const generateShifts = useGenerateShiftsMutation()

  function handleMonthChange(date: Date) {
    setMonth({ year: date.getFullYear(), month: date.getMonth() + 1 })
    setResult(null)
  }

  async function handleGenerate() {
    setResult(null)
    try {
      const generated = await generateShifts.mutateAsync(month)
      setResult(generated)
      toast.success('Terminamos de generar los turnos del mes.')
    } catch (error) {
      toast.error(
        isApiError(error) ? error.message : 'No pudimos generar los turnos.',
      )
    }
  }

  if (!canGenerate) {
    return (
      <EmptyState
        icon={CalendarRange}
        title="No tenés permiso para generar turnos"
        description="Pedile a la dueña o a un administrador con esa capacidad que lo haga."
      />
    )
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-5">
        <Field>
          <FieldLabel>Mes a generar</FieldLabel>
          <MonthPicker
            aria-label="Mes a generar"
            value={new Date(month.year, month.month - 1, 1)}
            onValueChange={handleMonthChange}
          />
        </Field>

        <dl className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-[12.5px]">
          <div>
            <dt className="text-text-3">Servicios activos vigentes</dt>
            <dd className="font-semibold text-text">
              {activeServicesQuery.isLoading
                ? '—'
                : (activeServicesQuery.data ?? 0)}
            </dd>
          </div>
          <div>
            <dt className="text-text-3">Feriados del mes</dt>
            <dd className="font-semibold text-text">
              {holidaysQuery.isLoading ? '—' : holidaysInMonthCount}
            </dd>
          </div>
        </dl>
      </div>

      <Alert variant="info">
        <CalendarClock />
        <AlertDescription>
          Regenerar solo crea los turnos que todavía no existen para ese mes:
          nunca borra ni modifica un turno ya generado.
        </AlertDescription>
      </Alert>

      <Button
        type="button"
        onClick={() => void handleGenerate()}
        loading={generateShifts.isPending}
      >
        Generar turnos del mes
      </Button>

      {result && (
        <Alert variant="info">
          <CalendarClock />
          <div>
            <AlertTitle>Generación terminada</AlertTitle>
            <AlertDescription>
              Se crearon {result.created} turno
              {result.created === 1 ? '' : 's'}, se omitieron {result.skipped}{' '}
              por ya existir y {result.holidaysSkipped} por caer en feriado.
            </AlertDescription>
          </div>
        </Alert>
      )}
    </div>
  )
}
