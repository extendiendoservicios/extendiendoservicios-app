import { describe, expect, it } from 'vitest'
import type { CalendarNote } from '@/api/employeeCalendarNotes'
import { checkNoteBody, groupNotesByDate } from './calendarNotes'

function note(over: Partial<CalendarNote>): CalendarNote {
  return {
    id: 'n1',
    employeeId: 'p1',
    date: '2026-11-04',
    body: 'Texto',
    color: null,
    createdAt: '2026-11-20T10:00:00Z',
    createdByName: 'Laura Gómez',
    updatedAt: '2026-11-20T10:00:00Z',
    updatedByName: 'Laura Gómez',
    ...over,
  }
}

describe('groupNotesByDate (D-08)', () => {
  it('agrupa por día y respeta el orden de carga dentro de cada día', () => {
    const grouped = groupNotesByDate([
      note({ id: 'b', createdAt: '2026-11-20T12:00:00Z' }),
      note({ id: 'a', createdAt: '2026-11-20T10:00:00Z' }),
      note({ id: 'c', date: '2026-11-09' }),
    ])
    expect(grouped.get('2026-11-04')?.map((item) => item.id)).toEqual([
      'a',
      'b',
    ])
    expect(grouped.get('2026-11-09')?.map((item) => item.id)).toEqual(['c'])
  })
})

describe('checkNoteBody (D-08)', () => {
  it('recorta los espacios de los bordes', () => {
    expect(checkNoteBody('  Sin turnos  ')).toEqual({
      ok: true,
      body: 'Sin turnos',
    })
  })

  it('rechaza el texto vacío', () => {
    expect(checkNoteBody('   ')).toEqual({
      ok: false,
      message: 'Escribí la observación.',
    })
  })

  it('acepta hasta 500 caracteres y rechaza más', () => {
    expect(checkNoteBody('a'.repeat(500)).ok).toBe(true)
    expect(checkNoteBody('a'.repeat(501)).ok).toBe(false)
  })
})
