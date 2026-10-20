import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Timeline, type TimelineItem } from '@/components/Timeline'
import { formatMinutes, formatTime } from '@/lib/format'
import { absenceReasonLabel, certificateLabel } from '@/lib/absenceReasons'
import type { AttendanceEvent, AttendanceBoardRow } from '@/api/attendance'
import type { PersonName } from '@/api/attendance'
import {
  ATTENDANCE_KIND_LABELS,
  NOTICE_KIND_LABELS,
} from '@/features/attendance/reasonLabels'
import { getAvailableAttendanceActions } from '@/features/attendance/derive'
import { CorrectionsHistory } from '@/features/geo/components/CorrectionsHistory'
import { RecordGeoDetail } from '@/features/geo/components/RecordGeoDetail'
import { useAttendanceCorrectionsQuery } from '@/features/geo/queries'
import { AbsenceCertificateDialog } from './AbsenceCertificateDialog'
import { MarkAbsentDialog } from './MarkAbsentDialog'
import { RecordAttendanceSheet } from './RecordAttendanceSheet'

/**
 * Inicio y fin reales, quién y cómo se registraron, y la línea de tiempo de
 * avisos de una asignación (ADM-06, ATT-014, ABS-006: "asignaciones ...
 * inicio y fin reales, avisos"). Se muestra dentro de cada fila de
 * "Asignaciones" de `ShiftDetail` (`src/features/planning/components/`),
 * junto con "Registrar en nombre" (ADM-11, ATT-010) cuando hay alguna
 * acción disponible y quien mira tiene `manage_attendance`.
 */
interface AssignmentAttendanceDetailProps {
  assignmentId: string
  employeeName: string
  shiftDate: string
  attendance: AttendanceBoardRow | undefined
  events: AttendanceEvent[]
  peopleNames: Map<string, PersonName>
  canManage: boolean
}

function whoRecorded(
  source: 'employee_app' | 'admin',
  recordedBy: string | null,
  peopleNames: Map<string, PersonName>,
  what: 'record' | 'notice' = 'record',
): string {
  if (source === 'employee_app') {
    return what === 'notice' ? 'avisó desde la app' : 'marcó desde la app'
  }
  const person = recordedBy ? peopleNames.get(recordedBy) : undefined
  return person
    ? `lo cargó ${person.firstName} ${person.lastName}`
    : 'lo cargó administración'
}

/** Minutos o motivo del aviso y el texto libre, si lo hay ("Otro" muestra solo el texto). */
function noticeDetail(event: AttendanceEvent): string[] {
  const text = event.reasonText?.trim()
  const quoted = text ? `"${text}"` : null
  if (event.kind === 'delay') {
    return [
      event.minutesLate != null
        ? `${formatMinutes(event.minutesLate)} de demora`
        : null,
      quoted,
    ].filter((part): part is string => Boolean(part))
  }
  const certificate =
    event.kind === 'absence' ? certificateLabel(event.hasCertificate) : null
  if (event.reasonCode === 'other' && quoted) {
    return [quoted, certificate].filter((part): part is string => Boolean(part))
  }
  return [
    event.reasonCode ? absenceReasonLabel(event.reasonCode) : null,
    quoted,
    certificate,
  ].filter((part): part is string => Boolean(part))
}

function eventToTimelineItem(
  event: AttendanceEvent,
  peopleNames: Map<string, PersonName>,
): TimelineItem {
  if (event.kind === 'check_in' || event.kind === 'check_out') {
    return {
      id: event.id,
      title: `${ATTENDANCE_KIND_LABELS[event.kind]} — ${whoRecorded(event.source, event.reportedBy, peopleNames)}`,
      description: [
        event.recordedAt ? formatTime(event.recordedAt) : null,
        event.adminReason ? `Motivo: ${event.adminReason}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
      variant: 'ok',
    }
  }
  const label = NOTICE_KIND_LABELS[event.kind]
  return {
    id: event.id,
    title: `Aviso de ${label.toLowerCase()} — ${whoRecorded(event.source, event.reportedBy, peopleNames, 'notice')}`,
    description: [formatTime(event.createdAt), ...noticeDetail(event)].join(
      ' · ',
    ),
    variant: event.kind === 'absence' ? 'crit' : 'on',
  }
}

function AssignmentAttendanceDetail({
  assignmentId,
  employeeName,
  shiftDate,
  attendance,
  events,
  peopleNames,
  canManage,
}: AssignmentAttendanceDetailProps) {
  const [isRecordOpen, setRecordOpen] = useState(false)
  const [isAbsentOpen, setAbsentOpen] = useState(false)
  const [isCertificateOpen, setCertificateOpen] = useState(false)

  // B1: validación por ubicación del inicio y del fin, y su historial de correcciones.
  const checkInGeo = attendance?.checkInAt ? attendance.checkInGeo : null
  const checkOutGeo = attendance?.checkOutAt ? attendance.checkOutGeo : null
  const recordIds = [checkInGeo?.recordId, checkOutGeo?.recordId].filter(
    (id): id is string => Boolean(id),
  )
  const correctionsQuery = useAttendanceCorrectionsQuery(recordIds)
  const recordKinds = new Map<string, 'check_in' | 'check_out'>()
  if (checkInGeo) recordKinds.set(checkInGeo.recordId, 'check_in')
  if (checkOutGeo) recordKinds.set(checkOutGeo.recordId, 'check_out')

  const availableActions = attendance
    ? getAvailableAttendanceActions({
        shiftStatus: attendance.shiftStatus,
        status: attendance.status,
        checkInAt: attendance.checkInAt,
        checkOutAt: attendance.checkOutAt,
        startsAt: attendance.startsAt,
      })
    : []

  // P19.11d: «Ausente» (sin ausencia avisada) o su estado con el certificado.
  const absenceNotice =
    attendance?.status === 'absence_notified' &&
    attendance.lastNoticeKind === 'absence'
  const canMarkAbsent = availableActions.includes('absence')

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-2">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11.5px] text-text-3">
        <div>
          <dt className="font-semibold text-text-2">Inicio real</dt>
          <dd>
            {attendance?.checkInAt
              ? `${formatTime(attendance.checkInAt)} · ${whoRecorded(
                  attendance.checkInSource ?? 'employee_app',
                  attendance.checkInRecordedBy,
                  peopleNames,
                )}`
              : 'Sin registro'}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-text-2">Fin real</dt>
          <dd>
            {attendance?.checkOutAt
              ? `${formatTime(attendance.checkOutAt)} · ${whoRecorded(
                  attendance.checkOutSource ?? 'employee_app',
                  attendance.checkOutRecordedBy,
                  peopleNames,
                )}`
              : 'Sin registro'}
          </dd>
        </div>
      </dl>

      {attendance && checkInGeo && attendance.checkInAt && (
        <RecordGeoDetail
          recordType="attendance"
          kind="check_in"
          recordedAt={attendance.checkInAt}
          shiftDate={shiftDate}
          geo={checkInGeo}
          canManage={canManage}
        />
      )}
      {attendance && checkOutGeo && attendance.checkOutAt && (
        <RecordGeoDetail
          recordType="attendance"
          kind="check_out"
          recordedAt={attendance.checkOutAt}
          shiftDate={shiftDate}
          geo={checkOutGeo}
          canManage={canManage}
        />
      )}
      <CorrectionsHistory
        corrections={correctionsQuery.data ?? []}
        recordKinds={recordKinds}
      />

      {events.length > 0 && (
        <Timeline
          items={events.map((event) => eventToTimelineItem(event, peopleNames))}
        />
      )}

      {absenceNotice && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-semibold text-danger">
            Ausente · {certificateLabel(attendance.lastNoticeHasCertificate)}
          </span>
          {canManage && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCertificateOpen(true)}
            >
              {attendance.lastNoticeHasCertificate == null
                ? 'Marcar certificado'
                : 'Cambiar'}
            </Button>
          )}
        </div>
      )}

      {canManage && (
        <div className="flex flex-wrap gap-2">
          {availableActions.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRecordOpen(true)}
            >
              Registrar en nombre
            </Button>
          )}
          {canMarkAbsent && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAbsentOpen(true)}
            >
              Ausente
            </Button>
          )}
        </div>
      )}

      {canManage && isAbsentOpen && (
        <MarkAbsentDialog
          assignmentId={assignmentId}
          employeeName={employeeName}
          open
          onOpenChange={setAbsentOpen}
        />
      )}
      {canManage && isCertificateOpen && absenceNotice && (
        <AbsenceCertificateDialog
          assignmentId={assignmentId}
          employeeName={employeeName}
          current={attendance.lastNoticeHasCertificate ?? null}
          open
          onOpenChange={setCertificateOpen}
        />
      )}

      {canManage && (
        <RecordAttendanceSheet
          assignmentId={assignmentId}
          employeeName={employeeName}
          shiftDate={shiftDate}
          actions={availableActions}
          open={isRecordOpen}
          onOpenChange={setRecordOpen}
        />
      )}
    </div>
  )
}

export { AssignmentAttendanceDetail }
