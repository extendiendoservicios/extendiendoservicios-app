import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `src/api/attendance.ts` (ATT-005): mismo patrón sin red que
 * `src/api/assignments.test.ts` — se mockea `@/lib/supabase` entero.
 */

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: rpcMock },
}))

const { recordCheckIn, recordCheckOut, setAssignmentNotes } =
  await import('./attendance')

beforeEach(() => {
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
