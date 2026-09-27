import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `src/api/attendance.ts` (ATT-005, y desde P14.3 también ATT-010 a
 * ATT-014): mismo patrón sin red que `src/api/assignments.test.ts` — se
 * mockea `@/lib/supabase` entero.
 */

interface PostgrestResult<T> {
  data: T | null
  error: { message: string; code?: string; hint?: string } | null
}

function makeChainable<T>(result: PostgrestResult<T>) {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    gte: () => chain,
    lte: () => chain,
    in: () => chain,
    order: () => chain,
    then: (
      resolve: (value: PostgrestResult<T>) => void,
      reject?: (reason: unknown) => void,
    ) => Promise.resolve(result).then(resolve, reject),
  }
  return chain
}

const { fromMock, rpcMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { from: fromMock, rpc: rpcMock },
}))

const {
  recordCheckIn,
  recordCheckOut,
  setAssignmentNotes,
  adminRecordAttendance,
  closeAssignment,
  fetchAttendanceBoardByDate,
  fetchEmployeeAttendanceHistory,
  fetchAssignmentsAttendance,
  fetchEmployeePhonesByIds,
  fetchPeopleNamesByIds,
  fetchAttendanceTimeline,
} = await import('./attendance')

beforeEach(() => {
  fromMock.mockReset()
  rpcMock.mockReset()
})

const ATTENDANCE_ROW = {
  id: 'att1',
  assignment_id: 'a1',
  kind: 'check_in' as const,
  recorded_at: '2026-09-26T11:03:00Z',
  // El servidor sí devuelve coordenadas: acá se verifica que el mapeo las
  // deja afuera del tipo expuesto (ADR-009, "no se muestran en ninguna
  // pantalla").
  latitude: -34.6,
  longitude: -58.4,
  accuracy_m: 15,
  reason: null,
  recorded_by: 'a1',
  source: 'self' as const,
  created_at: '2026-09-26T11:03:00Z',
}

describe('recordCheckIn', () => {
  it('manda las coordenadas cuando hay ubicación', async () => {
    rpcMock.mockResolvedValue({ data: ATTENDANCE_ROW, error: null })

    const result = await recordCheckIn('a1', {
      lat: -34.6,
      lng: -58.4,
      accuracyM: 15,
    })

    expect(rpcMock).toHaveBeenCalledWith('record_check_in', {
      p_assignment_id: 'a1',
      p_lat: -34.6,
      p_lng: -58.4,
      p_accuracy: 15,
    })
    expect(result).toEqual({
      id: 'att1',
      assignmentId: 'a1',
      kind: 'check_in',
      recordedAt: '2026-09-26T11:03:00Z',
    })
    expect(result).not.toHaveProperty('lat')
    expect(result).not.toHaveProperty('latitude')
  })

  it('manda las tres coordenadas vacías cuando no hay ubicación (nunca bloquea, ADR-009)', async () => {
    rpcMock.mockResolvedValue({ data: ATTENDANCE_ROW, error: null })

    await recordCheckIn('a1', null)

    expect(rpcMock).toHaveBeenCalledWith('record_check_in', {
      p_assignment_id: 'a1',
      p_lat: undefined,
      p_lng: undefined,
      p_accuracy: undefined,
    })
  })

  it('propaga el mensaje en español que arma la RPC (por ejemplo NOT_TODAY)', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: 'El turno de esa asignación no es de hoy.',
        hint: 'NOT_TODAY',
      },
    })

    await expect(recordCheckIn('a1', null)).rejects.toMatchObject({
      message: 'El turno de esa asignación no es de hoy.',
      hint: 'NOT_TODAY',
    })
  })
})

describe('recordCheckOut', () => {
  it('llama a record_check_out con las coordenadas dadas', async () => {
    rpcMock.mockResolvedValue({
      data: { ...ATTENDANCE_ROW, kind: 'check_out' },
      error: null,
    })

    const result = await recordCheckOut('a1', null)

    expect(rpcMock).toHaveBeenCalledWith('record_check_out', {
      p_assignment_id: 'a1',
      p_lat: undefined,
      p_lng: undefined,
      p_accuracy: undefined,
    })
    expect(result.kind).toBe('check_out')
  })
})

describe('setAssignmentNotes', () => {
  it('guarda la observación y devuelve la asignación actualizada', async () => {
    rpcMock.mockResolvedValue({
      data: { id: 'a1', notes: 'Todo en orden.' },
      error: null,
    })

    const result = await setAssignmentNotes('a1', 'Todo en orden.')

    expect(rpcMock).toHaveBeenCalledWith('set_assignment_notes', {
      p_assignment_id: 'a1',
      p_notes: 'Todo en orden.',
    })
    expect(result).toEqual({ id: 'a1', notes: 'Todo en orden.' })
  })

  it('propaga NOTES_TOO_LONG', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: 'La observación es demasiado larga.',
        hint: 'NOTES_TOO_LONG',
      },
    })

    await expect(
      setAssignmentNotes('a1', 'x'.repeat(2001)),
    ).rejects.toMatchObject({ hint: 'NOTES_TOO_LONG' })
  })
})

describe('adminRecordAttendance', () => {
  it('llama admin_record_attendance con la hora y el motivo', async () => {
    rpcMock.mockResolvedValue({
      data: { ...ATTENDANCE_ROW, kind: 'check_in', source: 'admin' },
      error: null,
    })

    const result = await adminRecordAttendance(
      'a1',
      'check_in',
      'Se olvidó de fichar',
      '2026-09-26T11:00:00-03:00',
    )

    expect(rpcMock).toHaveBeenCalledWith('admin_record_attendance', {
      p_assignment_id: 'a1',
      p_kind: 'check_in',
      p_at: '2026-09-26T11:00:00-03:00',
      p_reason: 'Se olvidó de fichar',
    })
    expect(result.kind).toBe('check_in')
  })

  it('propaga AT_OUT_OF_RANGE', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message:
          'La hora tiene que estar entre las 0:00 del día del turno y este momento.',
        hint: 'AT_OUT_OF_RANGE',
      },
    })

    await expect(
      adminRecordAttendance('a1', 'check_in', 'motivo', '2099-01-01T00:00:00Z'),
    ).rejects.toMatchObject({ hint: 'AT_OUT_OF_RANGE' })
  })
})

describe('closeAssignment', () => {
  it('llama close_assignment con el motivo obligatorio', async () => {
    rpcMock.mockResolvedValue({
      data: { ...ATTENDANCE_ROW, kind: 'check_out', source: 'admin' },
      error: null,
    })

    const result = await closeAssignment('a1', 'Se fue sin fichar la salida')

    expect(rpcMock).toHaveBeenCalledWith('close_assignment', {
      p_assignment_id: 'a1',
      p_reason: 'Se fue sin fichar la salida',
      p_at: undefined,
    })
    expect(result.kind).toBe('check_out')
  })
})

const ATTENDANCE_BOARD_ROW = {
  id: 'a1',
  shift_id: 'sh1',
  shift_date: '2026-09-26',
  shift_status: 'in_progress' as const,
  client_id: 'c1',
  client_legal_name: 'Limpiadora SRL',
  site_id: 'si1',
  site_name: 'Sede Centro',
  employee_id: 'emp1',
  employee_first_name: 'Ana',
  employee_last_name: 'Gómez',
  employee_avatar_path: null,
  effective_start_time: '08:00:00',
  effective_end_time: '12:00:00',
  effective_starts_at: '2026-09-26T11:00:00Z',
  effective_ends_at: '2026-09-26T15:00:00Z',
  status: 'present' as const,
  display_status: 'present',
  notes: null,
  check_in_at: '2026-09-26T11:05:00Z',
  check_out_at: null,
  check_in_source: 'employee_app' as const,
  check_in_recorded_by: 'emp1',
  check_out_source: null,
  check_out_recorded_by: null,
  minutes_late: 5,
  minutes_early_leave: null,
  last_notice_kind: null,
  last_notice_minutes_late: null,
  last_notice_reason_code: null,
  last_notice_reason_text: null,
  last_notice_reported_by: null,
  last_notice_source: null,
  last_notice_at: null,
}

describe('fetchAttendanceBoardByDate', () => {
  it('arma AttendanceBoardRow[] a partir de v_assignments_board filtrado por fecha', async () => {
    fromMock.mockReturnValue(
      makeChainable({ data: [ATTENDANCE_BOARD_ROW], error: null }),
    )

    const rows = await fetchAttendanceBoardByDate('2026-09-26')

    expect(fromMock).toHaveBeenCalledWith('v_assignments_board')
    expect(rows).toEqual([
      expect.objectContaining({
        id: 'a1',
        employeeFirstName: 'Ana',
        checkInAt: '2026-09-26T11:05:00Z',
        minutesLate: 5,
      }),
    ])
  })
})

describe('fetchEmployeeAttendanceHistory', () => {
  it('arma el historial de un empleado por rango de fechas', async () => {
    fromMock.mockReturnValue(
      makeChainable({ data: [ATTENDANCE_BOARD_ROW], error: null }),
    )

    const rows = await fetchEmployeeAttendanceHistory(
      'emp1',
      '2026-09-01',
      '2026-09-30',
    )

    expect(fromMock).toHaveBeenCalledWith('v_assignments_board')
    expect(rows).toHaveLength(1)
  })
})

describe('fetchAssignmentsAttendance', () => {
  it('devuelve una lista vacía sin consultar la base si no hay ids', async () => {
    const rows = await fetchAssignmentsAttendance([])

    expect(fromMock).not.toHaveBeenCalled()
    expect(rows).toEqual([])
  })

  it('arma la asistencia de una lista de asignaciones', async () => {
    fromMock.mockReturnValue(
      makeChainable({ data: [ATTENDANCE_BOARD_ROW], error: null }),
    )

    const rows = await fetchAssignmentsAttendance(['a1'])

    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe('a1')
  })
})

describe('fetchEmployeePhonesByIds', () => {
  it('devuelve un mapa vacío sin consultar la base si no hay ids', async () => {
    const result = await fetchEmployeePhonesByIds([])

    expect(fromMock).not.toHaveBeenCalled()
    expect(result.size).toBe(0)
  })

  it('arma un mapa de profile_id a teléfono', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [{ profile_id: 'emp1', phone: '1122334455' }],
        error: null,
      }),
    )

    const result = await fetchEmployeePhonesByIds(['emp1'])

    expect(fromMock).toHaveBeenCalledWith('v_employees')
    expect(result.get('emp1')).toBe('1122334455')
  })
})

describe('fetchPeopleNamesByIds', () => {
  it('devuelve un mapa vacío sin consultar la base si no hay ids', async () => {
    const result = await fetchPeopleNamesByIds([])

    expect(fromMock).not.toHaveBeenCalled()
    expect(result.size).toBe(0)
  })

  it('arma un mapa de profile_id a nombre y apellido', async () => {
    fromMock.mockReturnValue(
      makeChainable({
        data: [
          { profile_id: 'admin1', first_name: 'María', last_name: 'Pérez' },
        ],
        error: null,
      }),
    )

    const result = await fetchPeopleNamesByIds(['admin1'])

    expect(fromMock).toHaveBeenCalledWith('v_people_basic')
    expect(result.get('admin1')).toEqual({
      firstName: 'María',
      lastName: 'Pérez',
    })
  })
})

describe('fetchAttendanceTimeline', () => {
  it('devuelve un mapa vacío sin consultar la base si no hay ids', async () => {
    const result = await fetchAttendanceTimeline([])

    expect(fromMock).not.toHaveBeenCalled()
    expect(result.size).toBe(0)
  })

  it('combina registros y avisos de una asignación, ordenados del más antiguo al más reciente', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'attendance_records') {
        return makeChainable({
          data: [
            {
              id: 'r1',
              assignment_id: 'a1',
              kind: 'check_in',
              recorded_at: '2026-09-26T11:05:00Z',
              source: 'admin',
              recorded_by: 'admin1',
              created_at: '2026-09-26T11:05:00Z',
            },
          ],
          error: null,
        })
      }
      return makeChainable({
        data: [
          {
            id: 'n1',
            assignment_id: 'a1',
            kind: 'delay',
            minutes_late: 15,
            reason_code: null,
            reason_text: null,
            reported_by: 'emp1',
            source: 'employee_app',
            created_at: '2026-09-26T10:50:00Z',
          },
        ],
        error: null,
      })
    })

    const result = await fetchAttendanceTimeline(['a1'])

    const events = result.get('a1')
    expect(events).toHaveLength(2)
    expect(events?.[0]?.kind).toBe('delay')
    expect(events?.[1]?.kind).toBe('check_in')
  })
})
