import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { isApiError } from '@/api/errors'
import type { GenerateShiftsResult } from '@/api/shifts'
import {
  formatGenerationMonth,
  generationMonthFor,
} from '@/features/services/generationMonth'
import { useGenerateShiftsMutation } from '@/features/shifts/queries'

/**
 * OD-27: al guardar un servicio nuevo o al volver a activarlo, pregunta
 * «¿Generar los turnos de este mes ahora?». Si se acepta, llama a
 * `generate_shifts` limitada a ese servicio (mes en curso, o el mes de la fecha
 * de inicio si es futura) e informa cuántos turnos se crearon. `onFinish` se
 * llama al cerrar, con o sin generar. Solo se monta si el usuario tiene la
 * capacidad de generar turnos.
 */
function GenerateServiceShiftsDialog({
  serviceId,
  validFrom,
  onFinish,
}: {
  serviceId: string
  validFrom: string | null
  onFinish: () => void
}) {
  const target = generationMonthFor(validFrom)
  const [result, setResult] = useState<GenerateShiftsResult | null>(null)
  const generate = useGenerateShiftsMutation()
  const monthLabel = formatGenerationMonth(target)
  const isCurrentMonth = generationMonthFor(null).month === target.month

  async function handleGenerate() {
    try {
      setResult(await generate.mutateAsync({ ...target, serviceId }))
    } catch {
      // El mensaje del servidor se muestra debajo.
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onFinish()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {result
              ? 'Turnos generados'
              : isCurrentMonth
                ? '¿Generar los turnos de este mes ahora?'
                : `¿Generar los turnos de ${monthLabel} ahora?`}
          </DialogTitle>
          <DialogDescription>
            {result
              ? result.created === 0
                ? 'No hacía falta crear turnos: ya estaban todos.'
                : `Creamos ${result.created} ${
                    result.created === 1 ? 'turno' : 'turnos'
                  } de ${monthLabel}.`
              : 'Se crean los turnos de este servicio según sus días y su vigencia. Si ya existen, no se duplican.'}
          </DialogDescription>
        </DialogHeader>

        {generate.error && !result && (
          <p role="alert" className="text-[12.5px] text-danger">
            {isApiError(generate.error)
              ? generate.error.message
              : 'No pudimos generar los turnos.'}
          </p>
        )}

        <DialogFooter>
          {result ? (
            <Button type="button" onClick={onFinish}>
              Listo
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={onFinish}
                disabled={generate.isPending}
              >
                Ahora no
              </Button>
              <Button
                type="button"
                loading={generate.isPending}
                onClick={() => void handleGenerate()}
              >
                Generar turnos
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { GenerateServiceShiftsDialog }
