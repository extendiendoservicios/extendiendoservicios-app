import { useMemo } from 'react'
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

interface AttendanceDetailSheetProps {
  person: AttendanceSheetPerson
  from: string
  to: string
  entries: AttendanceDetailEntry[]
  onClose: () => void
  /** Inyectable para los tests; por defecto el momento de abrir la hoja. */
  issuedAt?: Date
}

/**
 * Hoja membretada «Detalle de asistencia» (AJ-06): logo y nombre de la
 * empresa, datos de la persona y del período, tabla de horas, total del
 * período y dos espacios de firma con aclaración (responsable de
 * administración y la persona). Se imprime o se guarda como PDF desde el
 * diálogo del navegador y se archiva en el legajo.
 */
function AttendanceDetailSheet({
  person,
  from,
  to,
  entries,
  onClose,
  issuedAt,
}: AttendanceDetailSheetProps) {
  const sheet = useMemo(
    () => buildAttendanceSheet({ person, from, to, entries }),
    [person, from, to, entries],
  )
  // La fecha de emisión se fija al abrir la hoja.
  const emittedAt = useMemo(() => issuedAt ?? new Date(), [issuedAt])

  return (
    <PrintSheet documentTitle={sheet.documentTitle} onClose={onClose}>
      <PrintableLetterhead title={sheet.title} issuedAt={emittedAt} />
      <PrintFacts facts={sheet.facts} />
      <PrintTable
        columns={sheet.columns}
        rows={sheet.rows}
        footer={sheet.footer}
        emptyText="No hay horas registradas en este período."
      />
      <PrintSignatures intro={sheet.consentText} signers={sheet.signers} />
    </PrintSheet>
  )
}

export { AttendanceDetailSheet }
