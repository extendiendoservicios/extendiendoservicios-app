import { describe, expect, it } from 'vitest'
import { ApiError } from '@/api/errors'
import { coordinatorErrorMessage, COORDINATOR_ERROR_MESSAGES } from './errors'
import { pauseWorkdaySchema } from './schemas'

describe('coordinatorErrorMessage', () => {
  it('usa el mensaje fijo del código conocido', () => {
    expect(
      coordinatorErrorMessage(
        new ApiError('texto del servidor', 'WORKDAY_PAUSED'),
        'respaldo',
      ),
    ).toBe(COORDINATOR_ERROR_MESSAGES.WORKDAY_PAUSED)
  })

  it('con un código sin traducción usa el mensaje del servidor', () => {
    expect(
      coordinatorErrorMessage(
        new ApiError('Mensaje del servidor.', 'CODIGO_NUEVO'),
        'respaldo',
      ),
    ).toBe('Mensaje del servidor.')
  })

  it('si el error no viene de la API (red caída) usa el texto de respaldo', () => {
    expect(
      coordinatorErrorMessage(new TypeError('fetch failed'), 'respaldo'),
    ).toBe('respaldo')
  })

  it('ya no traduce los códigos que P27 quitó (OD-09, OD-10)', () => {
    expect(COORDINATOR_ERROR_MESSAGES.ALREADY_SUPERVISED).toBeUndefined()
    expect(COORDINATOR_ERROR_MESSAGES.RATINGS_PENDING).toBeUndefined()
  })

  it('traduce los códigos de la jornada y de la supervisión', () => {
    for (const hint of [
      'ON_LEAVE',
      'WORKDAY_NOT_STARTED',
      'WORKDAY_ENDED',
      'SUPERVISION_OPEN',
      'SUPERVISION_ALREADY_OPEN',
      'SUPERVISION_HAS_RATINGS',
      'NOT_TODAY',
    ]) {
      expect(COORDINATOR_ERROR_MESSAGES[hint]).toBeTruthy()
    }
  })
})

describe('pauseWorkdaySchema (CJ-16)', () => {
  it('el motivo es opcional', () => {
    expect(pauseWorkdaySchema.safeParse({ reason: '' }).success).toBe(true)
    expect(
      pauseWorkdaySchema.safeParse({ reason: '  Almuerzo ' }),
    ).toMatchObject({ success: true, data: { reason: 'Almuerzo' } })
  })

  it('no puede pasar de 300 caracteres', () => {
    const result = pauseWorkdaySchema.safeParse({ reason: 'a'.repeat(301) })
    expect(result.success).toBe(false)
  })
})
