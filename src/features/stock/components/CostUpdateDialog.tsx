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
import { SegmentedControl } from '@/components/SegmentedControl'
import type { CostDifference } from '@/features/stock/schemas'
import { supplyLabel } from '@/features/stock/filters'
import { formatMoney } from '@/features/stock/money'

type Answer = 'yes' | 'no'

/**
 * Pregunta de IS-23: por cada artículo cuyo costo cargado en el ingreso
 * difiere del vigente, «¿Actualizar el precio de costo de X a $ N?». Hay que
 * contestar todas («Sí» manda `update_cost`; «No» registra el costo en el
 * movimiento y deja el precio vigente como está) antes de confirmar.
 */
function CostUpdateDialog({
  differences,
  open,
  onOpenChange,
  onConfirm,
  isLoading = false,
}: {
  differences: CostDifference[]
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Recibe los ids de los artículos a los que se contestó «Sí». */
  onConfirm: (updateCostFor: Set<string>) => void
  isLoading?: boolean
}) {
  const [answers, setAnswers] = useState<Record<string, Answer>>({})
  const allAnswered = differences.every((difference) =>
    Boolean(answers[difference.supplyId]),
  )

  function handleOpenChange(next: boolean) {
    if (!next) setAnswers({})
    onOpenChange(next)
  }

  function handleConfirm() {
    const yes = new Set(
      differences
        .filter((difference) => answers[difference.supplyId] === 'yes')
        .map((difference) => difference.supplyId),
    )
    onConfirm(yes)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Costos distintos del vigente</DialogTitle>
          <DialogDescription>
            El costo que cargaste no coincide con el precio de costo actual de
            estos artículos. En todos los casos el ingreso guarda el costo que
            cargaste.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-4">
          {differences.map((difference) => (
            <li key={difference.supplyId} className="flex flex-col gap-2">
              <p className="text-[13px] text-text">
                ¿Actualizar el precio de costo de{' '}
                <strong>{supplyLabel(difference)}</strong> a{' '}
                <strong className="tabular-nums">
                  {formatMoney(difference.enteredCost)}
                </strong>
                ?
                <span className="block text-[11.5px] text-text-3">
                  Hoy figura en {formatMoney(difference.currentCost)}.
                </span>
              </p>
              <SegmentedControl<Answer>
                aria-label={`Actualizar el costo de ${supplyLabel(difference)}`}
                value={answers[difference.supplyId] ?? ('' as Answer)}
                onValueChange={(value) =>
                  setAnswers((current) => ({
                    ...current,
                    [difference.supplyId]: value,
                  }))
                }
                options={[
                  { value: 'yes', label: 'Sí, actualizar' },
                  { value: 'no', label: 'No, dejar el actual' },
                ]}
              />
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={isLoading}
          >
            Volver
          </Button>
          <Button
            type="button"
            disabled={!allAnswered}
            loading={isLoading}
            onClick={handleConfirm}
          >
            Confirmar ingreso
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { CostUpdateDialog }
