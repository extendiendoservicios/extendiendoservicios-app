import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `src/api/adminNotices.ts` (ATT-010, ABS-008): mismo patrón sin red que
 * `src/api/attendance.test.ts` — se mockea `@/lib/supabase` entero.
 */

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: rpcMock },
}))

const { notifyDelayOnBehalf, notifyAbsenceOnBehalf } =
  await import('./adminNotices')

beforeEach(() => {
  rpcMock.mockReset()
})

const NOTICE_ROW = {
  id: 'n1',
  assignment_id: 'a1',
  kind: 'delay' as const,
  minutes_late: 15,
  reason_code: null,
  reason_text: 'Colectivo demorado',
  reported_by: 'admin1',
  source: 'admin' as const,
  created_at: '2026-09-26T10:30:00Z',
}

describe('notifyDelayOnBehalf', () => {
  it('llama notify_delay con los minutos y el motivo', async () => {
    rpcMock.mockResolvedValue({ data: NOTICE_ROW, error: null })

    const result = await notifyDelayOnBehalf('a1', 15, 'Colectivo demorado')

    expect(rpcMock).toHaveBeenCalledWith('notify_delay', {
      p_assignment_id: 'a1',
      p_minutes: 15,
      p_reason_text: 'Colectivo demorado',
    })
    expect(result).toEqual({
      id: 'n1',
      assignmentId: 'a1',
      kind: 'delay',
      minutesLate: 15,
      reasonCode: null,
      reasonText: 'Colectivo demorado',
      createdAt: '2026-09-26T10:30:00Z',
    })
  })

  it('propaga ASSIGNMENT_STARTED (ya empezó, no se puede avisar demora)', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: 'La asignación ya empezó.',
        hint: 'ASSIGNMENT_STARTED',
      },
    })

    await expect(notifyDelayOnBehalf('a1', 15)).rejects.toMatchObject({
      hint: 'ASSIGNMENT_STARTED',
    })
  })
})

describe('notifyAbsenceOnBehalf', () => {
  it('llama notify_absence con el motivo', async () => {
    rpcMock.mockResolvedValue({
      data: {
        ...NOTICE_ROW,
        kind: 'absence',
        reason_code: 'illness',
        minutes_late: null,
      },
      error: null,
    })

    const result = await notifyAbsenceOnBehalf('a1', 'illness')

    expect(rpcMock).toHaveBeenCalledWith('notify_absence', {
      p_assignment_id: 'a1',
      p_reason_code: 'illness',
      p_reason_text: undefined,
    })
    expect(result.kind).toBe('absence')
    expect(result.reasonCode).toBe('illness')
  })

  it('propaga REASON_REQUIRED', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: 'Indicá el motivo de la ausencia.',
        hint: 'REASON_REQUIRED',
      },
    })

    await expect(notifyAbsenceOnBehalf('a1', 'other')).rejects.toMatchObject({
      hint: 'REASON_REQUIRED',
    })
  })
})
