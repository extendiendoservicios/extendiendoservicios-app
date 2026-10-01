import type { RatingCriterion } from '@/api/mySupervisions'

/**
 * `RatingCriteriaGuide` (parte móvil de `src/features/supervisions/`, P15.5):
 * la guía de criterios vigentes o del `criteria_snapshot` (P-080, P-087) que
 * usan SUP-03 (detalle, antes de calificar) y SUP-05 (calificar empleado) --
 * un `<details>` nativo por criterio (accesible por teclado y con lector de
 * pantalla sin nada aparte, el design system no define un componente de
 * acordeón propio, `07_Design_System.md` sección 4 solo define `StarRating`
 * para SUP-05).
 */
export function RatingCriteriaGuide({
  criteria,
}: {
  criteria: RatingCriterion[]
}) {
  if (criteria.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {criteria.map((criterion) => (
        <details key={criterion.id} className="rounded-lg border border-border">
          <summary className="flex min-h-11 cursor-pointer list-none items-center px-3 py-[9px] text-[13px] font-semibold text-text">
            {criterion.title}
          </summary>
          {criterion.description && (
            <p className="border-t border-border px-3 py-[9px] text-[12px] text-text-2">
              {criterion.description}
            </p>
          )}
        </details>
      ))}
    </div>
  )
}
