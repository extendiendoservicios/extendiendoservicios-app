import { formatShortDate, formatTime } from '@/lib/format'
import type { AttendanceCorrection } from '@/api/geo'
import { describeCorrection } from '../corrections'

interface CorrectionsHistoryProps {
  corrections: AttendanceCorrection[]
  /** Tipo (inicio o fin) de cada fichaje, para nombrar la corrección. */
  recordKinds: Map<string, 'check_in' | 'check_out'>
}

/**
 * Historial de correcciones de una asignación (B-41, solo administración):
 * quién, cuándo, qué cambió y el motivo. Nada se borra: el valor original
 * queda guardado en la corrección.
 */
function CorrectionsHistory({
  corrections,
  recordKinds,
}: CorrectionsHistoryProps) {
  if (corrections.length === 0) {
    return null
  }
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-[11.5px] font-semibold text-text-2">
        Historial de correcciones
      </h4>
      <ul className="flex flex-col gap-1 text-[11.5px] text-text-3">
        {corrections.map((correction) => {
          const who = correction.correctedByName
            ? `${correction.correctedByName.firstName} ${correction.correctedByName.lastName}`
            : 'administración'
          return (
            <li key={correction.id}>
              <span className="font-medium text-text-2">
                {describeCorrection(correction, recordKinds)}
              </span>{' '}
              · {who} · {formatShortDate(correction.createdAt)}{' '}
              {formatTime(correction.createdAt)} · Motivo: {correction.reason}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export { CorrectionsHistory }
