import { describe, expect, it } from 'vitest'
import { deriveEmployeeLeaveStatus } from './employeeLeaveStatus'

/**
 * EMP-008: estado derivado de una licencia (vigente, futura, terminada),
 * mismo criterio que `v_employees.effective_status` (`0011_views.sql`):
 * `starts_on <= hoy <= coalesce(ends_on, hoy)` es "vigente".
 */
describe('deriveEmployeeLeaveStatus', () => {
  const today = '2026-06-15'

  it('una licencia que ya empezó y no tiene fecha de fin está vigente', () => {
    expect(
      deriveEmployeeLeaveStatus(
        { startsOn: '2026-06-01', endsOn: null },
        today,
      ),
    ).toBe('current')
  })

  it('una licencia que empieza y termina cubriendo hoy está vigente', () => {
    expect(
      deriveEmployeeLeaveStatus(
        { startsOn: '2026-06-10', endsOn: '2026-06-20' },
        today,
      ),
    ).toBe('current')
  })

  it('una licencia que empieza hoy mismo está vigente', () => {
    expect(
      deriveEmployeeLeaveStatus({ startsOn: today, endsOn: null }, today),
    ).toBe('current')
  })

  it('una licencia que termina hoy mismo está vigente', () => {
    expect(
      deriveEmployeeLeaveStatus(
        { startsOn: '2026-06-01', endsOn: today },
        today,
      ),
    ).toBe('current')
  })

  it('una licencia que todavía no empezó está futura', () => {
    expect(
      deriveEmployeeLeaveStatus(
        { startsOn: '2026-07-01', endsOn: null },
        today,
      ),
    ).toBe('upcoming')
  })

  it('una licencia que ya terminó está terminada', () => {
    expect(
      deriveEmployeeLeaveStatus(
        { startsOn: '2026-05-01', endsOn: '2026-05-31' },
        today,
      ),
    ).toBe('ended')
  })
})
