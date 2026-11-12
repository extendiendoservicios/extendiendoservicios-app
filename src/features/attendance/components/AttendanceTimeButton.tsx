import { useState } from 'react'
import { Button } from '@/components/ui/button'
import type { AttendanceBoardRow } from '@/api/attendance'
import { CorrectTimeDialog } from '@/features/geo/components/CorrectTimeDialog'
import {
  getAvailableAttendanceActions,
  type AttendanceAction,
} from '@/features/attendance/derive'
import { RecordAttendanceSheet } from './RecordAttendanceSheet'

/**
 * Botón junto a la hora de inicio o de fin (OF-06, OF-07): «Corregir» si hay
 * fichaje (abre `CorrectTimeDialog`, `correct_attendance_time`) o «Registrar»
 * si falta (abre `RecordAttendanceSheet` con esa acción elegida de entrada,
 * `admin_record_attendance`). Solo para quien tiene `manage_attendance` (la
 * dirección siempre; lo decide quien lo usa con `canManage`). No cambia las
 * reglas del servidor: sin fichaje y sin acción disponible (turno cancelado,
 * fin sin inicio), no se ofrece nada.
 */
interface AttendanceTimeButtonProps {
  row: AttendanceBoardRow
  kind: 'check_in' | 'check_out'
  canManage: boolean
}

function AttendanceTimeButton({
  row,
  kind,
  canManage,
}: AttendanceTimeButtonProps) {
  const [isCorrectOpen, setCorrectOpen] = useState(false)
  const [isRecordOpen, setRecordOpen] = useState(false)

  if (!canManage) {
    return null
  }

  const label = kind === 'check_in' ? 'inicio' : 'fin'
  const at = kind === 'check_in' ? row.checkInAt : row.checkOutAt
  const geo = kind === 'check_in' ? row.checkInGeo : row.checkOutGeo
  const employeeName = `${row.employeeFirstName} ${row.employeeLastName}`

  if (at) {
    // Sin el id del fichaje no hay a qué aplicar la corrección.
    if (!geo?.recordId) {
      return null
    }
    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Corregir ${label} de ${employeeName}`}
          onClick={() => setCorrectOpen(true)}
        >
          Corregir
        </Button>
        {isCorrectOpen && (
          <CorrectTimeDialog
            recordId={geo.recordId}
            kind={kind}
            currentTime={at}
            shiftDate={row.shiftDate}
            open
            onOpenChange={setCorrectOpen}
          />
        )}
      </>
    )
  }

  const available = getAvailableAttendanceActions({
    shiftStatus: row.shiftStatus,
    status: row.status,
    checkInAt: row.checkInAt,
    checkOutAt: row.checkOutAt,
    startsAt: row.startsAt,
  })
  if (!available.includes(kind)) {
    return null
  }
  // La acción pedida va primera: el panel arranca con ella elegida.
  const actions: AttendanceAction[] = [
    kind,
    ...available.filter((action) => action !== kind),
  ]
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Registrar ${label} de ${employeeName}`}
        onClick={() => setRecordOpen(true)}
      >
        Registrar
      </Button>
      {isRecordOpen && (
        <RecordAttendanceSheet
          assignmentId={row.id}
          employeeName={employeeName}
          shiftDate={row.shiftDate}
          actions={actions}
          open
          onOpenChange={setRecordOpen}
        />
      )}
    </>
  )
}

export { AttendanceTimeButton }
