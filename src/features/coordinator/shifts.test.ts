import { describe, expect, it } from 'vitest'
import {
  effectiveShiftState,
  matchesShiftSearch,
  sortShifts,
  splitTodayShifts,
  supervisorsLabels,
  takeSupervisionBlock,
} from './shifts'
import { makeTodayShift, makeWorkday, makeWorkdaySupervision } from './fixtures'

describe('sortShifts (CJ-25)', () => {
  it('pone primero los turnos en curso, después los que faltan y al final los terminados', () => {
    const sorted = sortShifts(
      [
        makeTodayShift({
          shiftId: 'fin',
          displayState: 'finished',
          startTime: '06:00:00',
        }),
        makeTodayShift({
          shiftId: 'pend',
          displayState: 'pending',
          startTime: '14:00:00',
        }),
        makeTodayShift({
          shiftId: 'curso',
          displayState: 'in_progress',
          startTime: '10:00:00',
        }),
        makeTodayShift({
          shiftId: 'pend2',
          displayState: 'pending',
          startTime: '09:00:00',
        }),
      ],
      Date.parse('2026-10-23T10:00:00Z'),
    )
    expect(sorted.map((s) => s.shiftId)).toEqual([
      'curso',
      'pend2',
      'pend',
      'fin',
    ])
  })
})

describe('splitTodayShifts (CJ-04, CJ-25)', () => {
  const shifts = [
    makeTodayShift({ shiftId: 'a', isPriority: true, siteName: 'Torre Norte' }),
    makeTodayShift({
      shiftId: 'b',
      clientName: 'Óptica Ñandú',
      siteName: 'Local 1',
    }),
    makeTodayShift({
      shiftId: 'c',
      clientName: 'Banco',
      siteName: 'Sucursal Sur',
    }),
  ]

  it('«Mis sedes» son las prioritarias y «Otras sedes» el resto', () => {
    const { mine, others } = splitTodayShifts(shifts)
    expect(mine.map((s) => s.shiftId)).toEqual(['a'])
    expect(others.map((s) => s.shiftId).sort()).toEqual(['b', 'c'])
  })

  it('el buscador filtra «Otras sedes» por cliente o sede, sin acentos ni mayúsculas, y no toca «Mis sedes»', () => {
    const { mine, others } = splitTodayShifts(shifts, 'optica NANDU')
    expect(mine.map((s) => s.shiftId)).toEqual(['a'])
    expect(others.map((s) => s.shiftId)).toEqual(['b'])
    expect(
      splitTodayShifts(shifts, 'sur').others.map((s) => s.shiftId),
    ).toEqual(['c'])
  })

  it('matchesShiftSearch acepta búsqueda vacía', () => {
    expect(matchesShiftSearch(shifts[0]!, '   ')).toBe(true)
  })
})

describe('supervisorsLabels (CJ-25)', () => {
  const sup = (over: Record<string, unknown>) => ({
    supervisionId: 's',
    supervisorId: 'u',
    firstName: 'Ana',
    lastName: 'Ruiz',
    status: 'in_progress' as const,
    checkInAt: '2026-10-23T11:00:00Z',
    checkOutAt: null,
    isMe: false,
    ...over,
  })

  it('sin supervisores no devuelve nada', () => {
    expect(supervisorsLabels(makeTodayShift())).toEqual([])
  })

  it('«Supervisando: Ana» para el que sigue abierto y «Supervisó» para los cerrados', () => {
    const shift = makeTodayShift({
      supervisors: [
        sup({}),
        sup({
          supervisionId: 't',
          firstName: 'Luis',
          status: 'completed',
          checkOutAt: '2026-10-23T12:00:00Z',
        }),
      ],
    })
    expect(supervisorsLabels(shift)).toEqual([
      'Supervisando: Ana',
      'Supervisó: Luis',
    ])
  })

  it('el propio coordinador figura como «Vos» y con nombre completo si se pide', () => {
    const shift = makeTodayShift({
      supervisors: [
        sup({ isMe: true }),
        sup({ supervisionId: 'x', firstName: 'Bea', lastName: 'Paz' }),
      ],
    })
    expect(supervisorsLabels(shift)).toEqual(['Supervisando: Vos, Bea'])
    expect(supervisorsLabels(shift, true)).toEqual([
      'Supervisando: Vos, Bea Paz',
    ])
  })
})

describe('takeSupervisionBlock (CJ-07, CJ-08, CJ-27)', () => {
  const shift = makeTodayShift()

  it('puede supervisar con la jornada en marcha', () => {
    expect(takeSupervisionBlock(shift, makeWorkday())).toBeNull()
  })

  it('mientras carga la jornada, no', () => {
    expect(takeSupervisionBlock(shift, undefined)).toMatch(/Cargando/)
  })

  it('sin jornada iniciada, en pausa o finalizada, dice qué hacer', () => {
    expect(takeSupervisionBlock(shift, null)).toMatch(/Iniciá tu jornada/)
    expect(
      takeSupervisionBlock(shift, makeWorkday({ state: 'paused' })),
    ).toMatch(/reanudá/)
    expect(
      takeSupervisionBlock(shift, makeWorkday({ state: 'ended' })),
    ).toMatch(/reabrila/)
  })

  it('con otra supervisión abierta tiene que cerrarla o descartarla antes', () => {
    const workday = makeWorkday({ supervisions: [makeWorkdaySupervision()] })
    expect(takeSupervisionBlock(shift, workday)).toMatch(/Cerrá o descartá/)
  })

  it('un turno que ya tomó no se vuelve a tomar', () => {
    expect(
      takeSupervisionBlock(
        makeTodayShift({
          mySupervisionId: 'sv1',
          mySupervisionStatus: 'in_progress',
        }),
        makeWorkday(),
      ),
    ).toMatch(/Ya estás supervisando/)
    expect(
      takeSupervisionBlock(
        makeTodayShift({
          mySupervisionId: 'sv1',
          mySupervisionStatus: 'completed',
        }),
        makeWorkday(),
      ),
    ).toMatch(/Ya supervisaste/)
  })
})

describe('effectiveShiftState (CJ-25, estado por hora)', () => {
  // 23/10/2026 20:30 en Argentina (UTC-3).
  const now = Date.parse('2026-10-23T23:30:00Z')

  it('un turno programado cuyo fin ya pasó figura «finished»', () => {
    const shift = makeTodayShift({
      displayState: 'pending',
      startsAt: '2026-10-23T09:00:00Z',
      endsAt: '2026-10-23T13:00:00Z',
    })
    expect(effectiveShiftState(shift, now)).toBe('finished')
  })

  it('un turno que todavía no empezó figura «pending»', () => {
    const shift = makeTodayShift({
      displayState: 'pending',
      startsAt: '2026-10-24T01:00:00Z',
      endsAt: '2026-10-24T03:00:00Z',
    })
    expect(effectiveShiftState(shift, now)).toBe('pending')
  })

  it('un turno entre su inicio y su fin figura «in_progress»', () => {
    const shift = makeTodayShift({
      displayState: 'pending',
      startsAt: '2026-10-23T22:00:00Z',
      endsAt: '2026-10-24T01:00:00Z',
    })
    expect(effectiveShiftState(shift, now)).toBe('in_progress')
  })

  it('un turno que cruza la medianoche sigue en curso pasadas las 00:00', () => {
    const shift = makeTodayShift({
      displayState: 'pending',
      startsAt: '2026-10-23T23:00:00Z', // 20:00
      endsAt: '2026-10-24T05:00:00Z', // 02:00 del día siguiente
    })
    expect(effectiveShiftState(shift, Date.parse('2026-10-24T03:00:00Z'))).toBe(
      'in_progress',
    )
    expect(effectiveShiftState(shift, Date.parse('2026-10-24T05:00:00Z'))).toBe(
      'finished',
    )
  })

  it('«A terminar» (sin fin) no termina por hora: solo si está completado', () => {
    const open = makeTodayShift({
      displayState: 'pending',
      openEnded: true,
      startsAt: '2026-10-23T09:00:00Z',
      endsAt: null,
    })
    expect(effectiveShiftState(open, now)).toBe('in_progress')
    expect(
      effectiveShiftState({ ...open, displayState: 'finished' }, now),
    ).toBe('finished')
  })

  it('un turno completado queda «finished» aunque su fin sea futuro', () => {
    const shift = makeTodayShift({
      displayState: 'finished',
      endsAt: '2026-10-24T03:00:00Z',
    })
    expect(effectiveShiftState(shift, now)).toBe('finished')
  })
})

describe('sortShifts con la hora (CJ-25)', () => {
  it('ordena por el estado según la hora aunque todos vengan «pending»', () => {
    const now = Date.parse('2026-10-23T23:30:00Z')
    const sorted = sortShifts(
      [
        makeTodayShift({
          shiftId: 'manana',
          startTime: '06:00:00',
          startsAt: '2026-10-23T09:00:00Z',
          endsAt: '2026-10-23T13:00:00Z',
        }),
        makeTodayShift({
          shiftId: 'tarde',
          startTime: '15:00:00',
          startsAt: '2026-10-23T18:00:00Z',
          endsAt: '2026-10-23T22:00:00Z',
        }),
        makeTodayShift({
          shiftId: 'curso',
          startTime: '19:00:00',
          startsAt: '2026-10-23T22:00:00Z',
          endsAt: '2026-10-24T01:00:00Z',
        }),
        makeTodayShift({
          shiftId: 'noche',
          startTime: '22:00:00',
          startsAt: '2026-10-24T01:00:00Z',
          endsAt: '2026-10-24T03:00:00Z',
        }),
      ],
      now,
    )
    expect(sorted.map((s) => s.shiftId)).toEqual([
      'curso',
      'noche',
      'manana',
      'tarde',
    ])
  })
})
