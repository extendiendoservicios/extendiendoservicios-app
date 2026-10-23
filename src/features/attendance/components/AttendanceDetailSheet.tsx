import { useMemo } from 'react'
import type { EmployeeLeave } from '@/api/employees'
import { PrintSheet } from '@/features/print/PrintSheet'
import { PrintableLetterhead } from '@/features/print/PrintableLetterhead'
import {
  PrintFacts,
  PrintSignatures,
  PrintTable,
} from '@/features/print/PrintTable'
import {
  buildAttendanceSheet,
  type AttendanceDetailEntry,
  type AttendanceSheetPerson,
} from '@/features/attendance/detailSheet'
import type { SupervisorWorkday } from '@/features/attendance/workdaysAdmin'

interface AttendanceDetailSheetProps {
  person: AttendanceSheetPerson
  from: string
  to: string
  entries: AttendanceDetailEntry[]
  /** Licencias de la persona: las del período se intercalan en la tabla. */
  leaves?: EmployeeLeave[]
  /**
   * Jornadas del período de un coordinador (CJ-19). Si viene, la hoja lleva
   * la sección de jornadas; con los dos roles, una sección por rol (CJ-34).
   */
  workdays?: SupervisorWorkday[]
  /** Si lleva la sección de turnos como empleado. Por omisión, sí. */
  includeServices?: boolean
  onClose: () => void
  /** Inyectable para los tests; por defecto el momento de abrir la hoja. */
  issuedAt?: Date
}

/**
 * Hoja membretada de asistencia (AJ-06, CJ-19, CJ-34): logo y nombre de la
 * empresa, datos de la persona y del período, y una tabla por rol: los turnos
 * como empleado (con las licencias intercaladas, sin horas) y las jornadas
 * como coordinador (inicio, fin, pausas, horas netas y, debajo de cada día,
 * sus supervisiones con duración informativa). Cada sección lleva su total;
 * con las dos, va la suma al final, y después los dos espacios de firma con
 * aclaración (responsable de administración y la persona). Se imprime o se
 * guarda como PDF desde el diálogo del navegador y se archiva en el legajo.
 */
function AttendanceDetailSheet({
  person,
  from,
  to,
  entries,
  leaves,
  workdays,
  includeServices,
  onClose,
  issuedAt,
}: AttendanceDetailSheetProps) {
  const sheet = useMemo(
    () =>
      buildAttendanceSheet({
        person,
        from,
        to,
        entries,
        leaves,
        workdays,
        includeServices,
      }),
    [person, from, to, entries, leaves, workdays, includeServices],
  )
  // La fecha de emisión se fija al abrir la hoja.
  const emittedAt = useMemo(() => issuedAt ?? new Date(), [issuedAt])

  return (
    <PrintSheet documentTitle={sheet.documentTitle} onClose={onClose}>
      <PrintableLetterhead title={sheet.title} issuedAt={emittedAt} />
      <PrintFacts facts={sheet.facts} />
      {sheet.sections.map((section) => (
        <div key={section.key} className="mb-4">
          {section.heading && (
            <h2 className="print-keep-together mb-1 text-[12.5px] font-semibold">
              {section.heading}
            </h2>
          )}
          <PrintTable
            columns={section.columns}
            rows={section.rows}
            spans={section.spans}
            footer={section.footer}
            emptyText={section.emptyText}
          />
        </div>
      ))}
      {sheet.grandTotal && (
        <p className="print-keep-together mb-4 flex justify-end gap-3 border border-neutral-400 bg-neutral-100 px-1.5 py-1 text-[11px] font-semibold">
          <span>{sheet.grandTotal.label}</span>
          <span className="tabular-nums">{sheet.grandTotal.value}</span>
        </p>
      )}
      <PrintSignatures intro={sheet.consentText} signers={sheet.signers} />
    </PrintSheet>
  )
}

export { AttendanceDetailSheet }
