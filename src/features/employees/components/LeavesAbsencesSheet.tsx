import { useMemo } from 'react'
import type { PersonName } from '@/api/attendance'
import { PrintSheet } from '@/features/print/PrintSheet'
import { PrintableLetterhead } from '@/features/print/PrintableLetterhead'
import {
  PrintFacts,
  PrintSignatures,
  PrintTable,
} from '@/features/print/PrintTable'
import {
  useEmployeeAttendanceHistoryQuery,
  usePeopleNamesQuery,
} from '@/features/attendance/queries'
import { useEmployeeLeavesQuery } from '@/features/employees/queries'
import { todayInBuenosAires } from '@/features/employees/employeeLeaveStatus'
import {
  absenceRowsOf,
  buildLeavesAbsencesSheet,
  LEAVES_ABSENCES_TITLE,
  type LeavesAbsencesPerson,
} from '@/features/employees/leavesAbsencesSheet'

interface LeavesAbsencesSheetProps {
  profileId: string
  person: LeavesAbsencesPerson
  from: string
  to: string
  onClose: () => void
  /** Inyectable para los tests; por defecto el momento de abrir la hoja. */
  issuedAt?: Date
}

/**
 * Hoja membretada «Licencias y ausencias» (P19.11d): licencias del empleado
 * (desde, hasta o «Abierta», motivo, días) y sus ausencias a turnos (fecha,
 * cliente y sede, horario, motivo, con o sin certificado y quién la cargó), en
 * el período elegido, con los mismos datos de la persona y el mismo bloque de
 * conformidad y firmas que el «Detalle de asistencia». Usa la misma vista
 * previa que los demás imprimibles
 * (logo, «Editar texto», imprimir o guardar como PDF).
 */
function LeavesAbsencesSheet({
  profileId,
  person,
  from,
  to,
  onClose,
  issuedAt,
}: LeavesAbsencesSheetProps) {
  const leavesQuery = useEmployeeLeavesQuery(profileId)
  const attendanceQuery = useEmployeeAttendanceHistoryQuery(profileId, from, to)
  const attendance = useMemo(
    () => attendanceQuery.data ?? [],
    [attendanceQuery.data],
  )
  const reportedByIds = useMemo(
    () =>
      absenceRowsOf(attendance)
        .filter((row) => row.lastNoticeSource === 'admin')
        .map((row) => row.lastNoticeReportedBy)
        .filter((id): id is string => id != null),
    [attendance],
  )
  const namesQuery = usePeopleNamesQuery(reportedByIds)

  const isLoading =
    leavesQuery.isLoading ||
    attendanceQuery.isLoading ||
    (reportedByIds.length > 0 && namesQuery.isLoading)
  const hasError = leavesQuery.isError || attendanceQuery.isError

  const sheet = useMemo(
    () =>
      buildLeavesAbsencesSheet({
        person,
        from,
        to,
        leaves: leavesQuery.data ?? [],
        attendance,
        names: namesQuery.data ?? new Map<string, PersonName>(),
        today: todayInBuenosAires(),
      }),
    [person, from, to, leavesQuery.data, attendance, namesQuery.data],
  )
  const emittedAt = useMemo(() => issuedAt ?? new Date(), [issuedAt])

  return (
    <PrintSheet documentTitle={sheet.documentTitle} onClose={onClose}>
      <PrintableLetterhead title={LEAVES_ABSENCES_TITLE} issuedAt={emittedAt} />
      {isLoading ? (
        <p role="status">Cargando los datos del período…</p>
      ) : hasError ? (
        <p role="alert">
          No pudimos cargar los datos del período. Cerrá esta vista y probá de
          nuevo.
        </p>
      ) : (
        <>
          <PrintFacts facts={sheet.facts} />
          <h2 className="mb-1 text-[13px] font-bold">Licencias</h2>
          <PrintTable
            columns={sheet.leaveColumns}
            rows={sheet.leaveRows}
            footer={sheet.leavesFooter}
            emptyText="No hay licencias en este período."
          />
          <h2 className="mt-6 mb-1 text-[13px] font-bold">
            Ausencias a turnos
          </h2>
          <PrintTable
            columns={sheet.absenceColumns}
            rows={sheet.absenceRows}
            emptyText="No hay ausencias avisadas en este período."
          />
          <PrintSignatures intro={sheet.consentText} signers={sheet.signers} />
        </>
      )}
    </PrintSheet>
  )
}

export { LeavesAbsencesSheet }
