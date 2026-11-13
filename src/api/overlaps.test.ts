import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: rpcMock } }))

const { fetchShiftOverlapsForDates, OVERLAP_PARALLEL_LIMIT } =
  await import('./overlaps')

const ROW = {
  shift_id: 's1',
  service_name: 'X',
  shift_date: '2026-11-18',
  start_time: '08:00:00',
  end_time: '12:00:00',
  open_ended: false,
}

beforeEach(() => rpcMock.mockReset())

describe('fetchShiftOverlapsForDates (OF-21)', () => {
  it('consulta cada fecha y devuelve solo las que tienen coincidencias, en orden', async () => {
    rpcMock.mockImplementation((...call: unknown[]) => {
      const args = call[1] as { p_date: string } | undefined
      return Promise.resolve({
        data: args?.p_date === '2026-11-18' ? [ROW] : [],
        error: null,
      })
    })
    const result = await fetchShiftOverlapsForDates({
      siteId: 'site',
      dates: ['2026-11-11', '2026-11-18', '2026-11-25'],
      start: '08:00',
      end: '12:00',
    })
    expect(rpcMock).toHaveBeenCalledTimes(3)
    expect(result.map((item) => item.date)).toEqual(['2026-11-18'])
  })

  it('no supera el límite de consultas en paralelo', async () => {
    let active = 0
    let max = 0
    rpcMock.mockImplementation(async () => {
      active += 1
      max = Math.max(max, active)
      await new Promise((resolve) => setTimeout(resolve, 1))
      active -= 1
      return { data: [], error: null }
    })
    const dates = Array.from(
      { length: 20 },
      (_, i) => `2026-11-${String(i + 1).padStart(2, '0')}`,
    )
    await fetchShiftOverlapsForDates({
      siteId: 'site',
      dates,
      start: '08:00',
      end: null,
    })
    expect(rpcMock).toHaveBeenCalledTimes(20)
    expect(max).toBeLessThanOrEqual(OVERLAP_PARALLEL_LIMIT)
  })

  it('si una consulta falla, esa fecha cuenta como sin coincidencias', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const result = await fetchShiftOverlapsForDates({
      siteId: 'site',
      dates: ['2026-11-18'],
      start: '08:00',
      end: '12:00',
    })
    expect(result).toEqual([])
  })
})
