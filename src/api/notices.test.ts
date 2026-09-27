import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * `src/api/notices.ts` (ABS-004): mismo patrón sin red que
 * `src/api/attendance.test.ts` — se mockea `@/lib/supabase` entero.
 */

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: rpcMock },
}))

const { notifyDelay, notifyAbsence } = await import('./notices')

beforeEach(() => {
  rpcMock.mockReset()
})

const DELAY_ROW = {
  id: 'n1',
  assignment_id: 'a1',
  kind: 'delay' as const,
  minutes_late: 15,
  reason_code: null,
  reason_text: null,
  reported_by: 'e1',
  source: 'employee_app' as const,
  created_at: '2026-09-26T10:45:00Z',
}

const ABSENCE_ROW = {
  id: 'n2',
  assignment_id: 'a1',
  kind: 'absence' as const,
  minutes_late: null,
  reason_code: 'illness' as const,
  reason_text: null,
  reported_by: 'e1',
  source: 'employee_app' as const,
  created_at: '2026-09-26T10:45:00Z',
}

describe('notifyDelay', () => {
  it('manda los minutos y el motivo opcional', async () => {
    rpcMock.mockResolvedValue({ data: DELAY_ROW, error: null })

    const result = await notifyDelay('a1', 15, '  Corte de calle  ')

    expect(rpcMock).toHaveBeenCalledWith('notify_delay', {
      p_assignment_id: 'a1',
      p_minutes: 15,
      p_reason_text: 'Corte de calle',
    })
    expect(result).toEqual({
      id: 'n1',
      assignmentId: 'a1',
      kind: 'delay',
      minutesLate: 15,
      reasonCode: null,
      reasonText: null,
      reportedBy: 'e1',
      source: 'employee_app',
      createdAt: '2026-09-26T10:45:00Z',
    })
  })

  it('manda undefined cuando no hay motivo', async () => {
    rpcMock.mockResolvedValue({ data: DELAY_ROW, error: null })

    await notifyDelay('a1', 15)

    expect(rpcMock).toHaveBeenCalledWith('notify_delay', {
      p_assignment_id: 'a1',
      p_minutes: 15,
      p_reason_text: undefined,
    })
  })

  it('propaga TOO_LATE_TO_NOTIFY', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: 'El aviso tiene que hacerse antes de la hora de inicio.',
        hint: 'TOO_LATE_TO_NOTIFY',
      },
    })

    await expect(notifyDelay('a1', 15)).rejects.toMatchObject({
      message: 'El aviso tiene que hacerse antes de la hora de inicio.',
      hint: 'TOO_LATE_TO_NOTIFY',
    })
  })

  it('propaga MINUTES_REQUIRED', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: 'Indicá los minutos de demora estimados.',
        hint: 'MINUTES_REQUIRED',
      },
    })

    await expect(notifyDelay('a1', 0)).rejects.toMatchObject({
      hint: 'MINUTES_REQUIRED',
    })
  })
})

describe('notifyAbsence', () => {
  it('manda el motivo de la lista sin texto libre', async () => {
    rpcMock.mockResolvedValue({ data: ABSENCE_ROW, error: null })

    const result = await notifyAbsence('a1', 'illness')

    expect(rpcMock).toHaveBeenCalledWith('notify_absence', {
      p_assignment_id: 'a1',
      p_reason_code: 'illness',
      p_reason_text: undefined,
    })
    expect(result.reasonCode).toBe('illness')
  })

  it('manda el texto libre cuando el motivo es "otro"', async () => {
    rpcMock.mockResolvedValue({
      data: { ...ABSENCE_ROW, reason_code: 'other', reason_text: 'Mudanza' },
      error: null,
    })

    await notifyAbsence('a1', 'other', 'Mudanza')

    expect(rpcMock).toHaveBeenCalledWith('notify_absence', {
      p_assignment_id: 'a1',
      p_reason_code: 'other',
      p_reason_text: 'Mudanza',
    })
  })

  it('propaga REASON_REQUIRED', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        message: 'Indicá el motivo de la ausencia.',
        hint: 'REASON_REQUIRED',
      },
    })

    await expect(notifyAbsence('a1', 'other')).rejects.toMatchObject({
      hint: 'REASON_REQUIRED',
    })
  })
})
