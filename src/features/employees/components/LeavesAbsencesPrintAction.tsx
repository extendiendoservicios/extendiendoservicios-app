import { useState } from 'react'
import { FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/DatePicker'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { localDateToIsoDate } from '@/features/settings/dateOnly'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'
import {
  currentYearRange,
  type LeavesAbsencesPerson,
} from '@/features/employees/leavesAbsencesSheet'
import { LeavesAbsencesSheet } from './LeavesAbsencesSheet'

function isoDateToDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00`)
}

/**
 * Botón «Imprimir licencias y ausencias» de la ficha del empleado (P19.11d):
 * pide el período (por omisión el año en curso) y abre la hoja imprimible.
 */
function LeavesAbsencesPrintAction({
  profileId,
  person,
}: {
  profileId: string
  person: LeavesAbsencesPerson
}) {
  const [isDialogOpen, setDialogOpen] = useState(false)
  const [period, setPeriod] = useState(() =>
    currentYearRange(todayInBuenosAires()),
  )
  const [printing, setPrinting] = useState<{ from: string; to: string } | null>(
    null,
  )
  const invalid = period.from > period.to

  function openDialog() {
    setPeriod(currentYearRange(todayInBuenosAires()))
    setDialogOpen(true)
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        icon={FileText}
        onClick={openDialog}
      >
        Imprimir licencias y ausencias
      </Button>

      <Dialog open={isDialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Licencias y ausencias</DialogTitle>
            <DialogDescription>
              Elegí el período del informe de {person.name}. Por omisión es el
              año en curso.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel>Desde</FieldLabel>
              <DatePicker
                aria-label="Desde"
                value={isoDateToDate(period.from)}
                onValueChange={(next) =>
                  next &&
                  setPeriod((current) => ({
                    ...current,
                    from: localDateToIsoDate(next),
                  }))
                }
              />
            </Field>
            <Field data-invalid={invalid || undefined}>
              <FieldLabel>Hasta</FieldLabel>
              <DatePicker
                aria-label="Hasta"
                value={isoDateToDate(period.to)}
                onValueChange={(next) =>
                  next &&
                  setPeriod((current) => ({
                    ...current,
                    to: localDateToIsoDate(next),
                  }))
                }
              />
              {invalid && (
                <FieldError>
                  La fecha «hasta» no puede ser anterior a «desde».
                </FieldError>
              )}
            </Field>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={invalid}
              onClick={() => {
                setPrinting(period)
                setDialogOpen(false)
              }}
            >
              Ver hoja
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {printing && (
        <LeavesAbsencesSheet
          profileId={profileId}
          person={person}
          from={printing.from}
          to={printing.to}
          onClose={() => setPrinting(null)}
        />
      )}
    </>
  )
}

export { LeavesAbsencesPrintAction }
