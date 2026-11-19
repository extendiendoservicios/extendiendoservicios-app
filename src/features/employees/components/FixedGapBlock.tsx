import { Link } from 'react-router'
import type { FixedGap } from '@/api/employeeFixed'
import { AssignEmployeeSheet } from '@/features/planning/components/AssignEmployeeSheet'
import { useShiftDetailQuery } from '@/features/planning/queries'
import { canAssignGap, describeGap } from '@/features/employees/fixedGaps'
import { formatDateOnly } from '@/features/settings/dateOnly'
import { gapBlockColors } from './blockParts'

/**
 * Bloque de un fijo sin asignar (OH-06, P30.4b): el mismo formato de tres
 * casillas que un turno del calendario, pero con borde punteado y fondo
 * atenuado, más una línea con el motivo. No se arrastra ni se imprime.
 * «Reemplazar» abre la asignación de ese turno para otra persona; «Asignar»
 * lo asigna a esta persona cuando el motivo no lo impide (la base vuelve a
 * validar y, si lo rechaza, se muestra su mensaje).
 */
function FixedGapBlock({
  gap,
  personName,
  busy,
  onReplace,
  onAssign,
}: {
  gap: FixedGap
  personName: string
  busy: boolean
  onReplace: (gap: FixedGap) => void
  onAssign: (gap: FixedGap) => void
}) {
  const description = describeGap(gap)
  const siteLabel = gap.siteName.toUpperCase()
  const end = gap.openEnded ? 'A terminar' : gap.endTime.slice(0, 5)
  return (
    <div
      data-testid="hueco"
      data-reason={gap.reason}
      data-shift-id={gap.shiftId}
      className="flex min-w-0 flex-col overflow-hidden rounded-sm border select-none print:hidden"
      style={gapBlockColors(gap.calendarColor)}
    >
      <div className="grid grid-cols-2 gap-px">
        <span className="border border-neutral-500 px-0.5 text-center text-[11px] leading-4 tabular-nums">
          {gap.startTime.slice(0, 5)}
        </span>
        <span className="border border-neutral-500 px-0.5 text-center text-[11px] leading-4 tabular-nums">
          {end}
        </span>
      </div>
      <div className="border-t border-inherit px-0.5 text-center text-[10px] leading-[14px] font-bold [overflow-wrap:anywhere]">
        {siteLabel}
      </div>
      <p
        data-testid="hueco-motivo"
        className="border-t border-inherit px-0.5 text-center text-[10px] leading-[13px] italic [overflow-wrap:anywhere]"
      >
        {description.conflictShiftId ? (
          <Link
            to={`/admin/turnos/${description.conflictShiftId}`}
            className="underline"
          >
            {description.text}
          </Link>
        ) : (
          description.text
        )}
      </p>
      <div className="flex min-w-0 flex-col border-t border-inherit">
        <button
          type="button"
          disabled={busy}
          aria-label={`Reemplazar a ${personName} en el turno de ${siteLabel} del ${formatDateOnly(gap.shiftDate)}`}
          className="w-full min-w-0 px-0.5 text-[10px] leading-[16px] font-semibold hover:bg-black/10 disabled:opacity-50 max-md:min-h-6"
          onClick={() => onReplace(gap)}
        >
          Reemplazar
        </button>
        {canAssignGap(gap) && (
          <button
            type="button"
            disabled={busy}
            aria-label={`Asignar a ${personName} al turno de ${siteLabel} del ${formatDateOnly(gap.shiftDate)}`}
            className="w-full min-w-0 border-t border-inherit px-0.5 text-[10px] leading-[16px] font-semibold hover:bg-black/10 disabled:opacity-50 max-md:min-h-6"
            onClick={() => onAssign(gap)}
          >
            Asignar
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * «Reemplazar»: abre la asignación del turno con los disponibles primero. No
 * se ofrece a esta persona ni a quienes ya están asignados al turno (se
 * espera el detalle del turno para saber quiénes son).
 */
function GapReplaceSheet({
  gap,
  profileId,
  onClose,
}: {
  gap: FixedGap
  profileId: string
  onClose: () => void
}) {
  const detailQuery = useShiftDetailQuery(gap.shiftId)
  if (detailQuery.isLoading) {
    return null
  }
  const assigned = detailQuery.data?.assignments.map((a) => a.employeeId) ?? []
  return (
    <AssignEmployeeSheet
      shiftId={gap.shiftId}
      clientId={gap.clientId}
      shiftDate={gap.shiftDate}
      shiftStartTime={gap.startTime}
      shiftEndTime={gap.endTime}
      shiftOpenEnded={gap.openEnded}
      excludeEmployeeIds={[profileId, ...assigned]}
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
    />
  )
}

export { FixedGapBlock, GapReplaceSheet }
