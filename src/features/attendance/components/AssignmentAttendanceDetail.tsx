import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Timeline, type TimelineItem } from '@/components/Timeline'
import { formatMinutes, formatTime } from '@/lib/format'
import type { AttendanceEvent, AttendanceBoardRow } from '@/api/attendance'
import type { PersonName } from '@/api/attendance'
import {
  ATTENDANCE_KIND_LABELS,
  NOTICE_KIND_LABELS,
} from '@/features/attendance/reasonLabels'
import { getAvailableAttendanceActions } from '@/features/attendance/derive'
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
): string {
  if (source === 'employee_app') {
    return 'marcó desde la app'
  }
  const person = recordedBy ? peopleNames.get(recordedBy) : undefined
  return person
    ? `lo cargó ${person.firstName} ${person.lastName}`
    : 'lo cargó administración'
}

function eventToTimelineItem(
  event: AttendanceEvent,
  peopleNames: Map<string, PersonName>,
): TimelineItem {
  if (event.kind === 'check_in' || event.kind === 'check_out') {
    return {
      id: event.id,
      title: `${ATTENDANCE_KIND_LABELS[event.kind]} — ${whoRecorded(event.source, event.reportedBy, peopleNames)}`,
      description: event.recordedAt ? formatTime(event.recordedAt) : undefined,
      variant: 'ok',
    }
  }
  const label = NOTICE_KIND_LABELS[event.kind]
  const detail =
    event.kind === 'delay'
      ? event.minutesLate != null
        ? `${formatMinutes(event.minutesLate)} de demora`
        : undefined
      : (event.reasonText ?? undefined)
  return {
    id: event.id,
    title: `Aviso de ${label.toLowerCase()} — ${whoRecorded(event.source, event.reportedBy, peopleNames)}`,
    description: detail ?? formatTime(event.createdAt),
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

  const availableActions = attendance
    ? getAvailableAttendanceActions({
        shiftStatus: attendance.shiftStatus,
        status: attendance.status,
        checkInAt: attendance.checkInAt,
        checkOutAt: attendance.checkOutAt,
        startsAt: attendance.startsAt,
      })
    : []

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

      {events.length > 0 && (
        <Timeline
          items={events.map((event) => eventToTimelineItem(event, peopleNames))}
        />
      )}

      {canManage && availableActions.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => setRecordOpen(true)}
        >
          Registrar en nombre
        </Button>
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
