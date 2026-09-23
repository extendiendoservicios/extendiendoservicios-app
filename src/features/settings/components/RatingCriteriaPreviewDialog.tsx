import { ClipboardList } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { EmptyState } from '@/components/EmptyState'
import type { RatingCriterion } from '@/api/settings'

/**
 * "Vista de cómo lo ve el supervisor" (ADM-30, `05` línea 94): la guía de
 * texto vigente, en el mismo orden que va a ver el supervisor al calificar
 * (no se puntúa por criterio, P-080 -- son solo ayuda de lectura).
 */
function RatingCriteriaPreviewDialog({
  criteria,
  open,
  onOpenChange,
}: {
  criteria: RatingCriterion[]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const currentCriteria = criteria
    .filter(
      (criterion) =>
        criterion.validFrom <= today &&
        (!criterion.validTo || criterion.validTo >= today),
    )
    .sort((a, b) => a.position - b.position)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Guía de calificación</DialogTitle>
          <DialogDescription>
            Así la ve el supervisor al calificar a un empleado.
          </DialogDescription>
        </DialogHeader>

        {currentCriteria.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="Todavía no hay ningún criterio vigente"
          />
        ) : (
          <ol className="flex flex-col gap-3">
            {currentCriteria.map((criterion, index) => (
              <li key={criterion.id} className="flex gap-3">
                <span className="mt-[1px] flex size-5 shrink-0 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold text-text-2">
                  {index + 1}
                </span>
                <div>
                  <p className="text-[13px] font-semibold text-text">
                    {criterion.title}
                  </p>
                  {criterion.description && (
                    <p className="text-[12px] text-text-3">
                      {criterion.description}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </DialogContent>
    </Dialog>
  )
}

export { RatingCriteriaPreviewDialog }
