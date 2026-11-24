import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isApiError } from './errors'
import {
  deleteEmployeeCalendarNote,
  fetchEmployeeCalendarNotes,
  saveEmployeeCalendarNote,
} from './employeeCalendarNotes'

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: rpcMock } }))

beforeEach(() => {
  rpcMock.mockReset()
})

describe('employeeCalendarNotes (D-08)', () => {
  it('lista las observaciones del mes con quién las cargó', async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          id: 'n1',
          employee_id: 'p1',
          note_date: '2026-11-04',
          body: 'Sin turnos',
          color: 3,
          created_at: '2026-11-20T10:00:00Z',
          created_by: 'u1',
          created_by_name: 'Laura Gómez',
          updated_at: '2026-11-21T10:00:00Z',
          updated_by: 'u2',
          updated_by_name: 'Ana Ruiz',
        },
      ],
      error: null,
    })
    const notes = await fetchEmployeeCalendarNotes(
      'p1',
      '2026-11-01',
      '2026-11-30',
    )
    expect(rpcMock).toHaveBeenCalledWith('list_employee_calendar_notes', {
      p_employee_id: 'p1',
      p_from: '2026-11-01',
      p_to: '2026-11-30',
    })
    expect(notes).toEqual([
      {
        id: 'n1',
        employeeId: 'p1',
        date: '2026-11-04',
        body: 'Sin turnos',
        color: 3,
        createdAt: '2026-11-20T10:00:00Z',
        createdByName: 'Laura Gómez',
        updatedAt: '2026-11-21T10:00:00Z',
        updatedByName: 'Ana Ruiz',
      },
    ])
  })

  it('el alta manda p_note_id nulo y omite el color si no tiene', async () => {
    rpcMock.mockResolvedValue({ data: {}, error: null })
    await saveEmployeeCalendarNote({
      noteId: null,
      employeeId: 'p1',
      date: '2026-11-04',
      body: 'Sin turnos',
      color: null,
    })
    expect(rpcMock).toHaveBeenCalledWith('save_employee_calendar_note', {
      p_note_id: null,
      p_employee_id: 'p1',
      p_date: '2026-11-04',
      p_body: 'Sin turnos',
    })
  })

  it('la edición manda el id y el color', async () => {
    rpcMock.mockResolvedValue({ data: {}, error: null })
    await saveEmployeeCalendarNote({
      noteId: 'n1',
      employeeId: 'p1',
      date: '2026-11-04',
      body: 'Otro',
      color: 0,
    })
    expect(rpcMock).toHaveBeenCalledWith('save_employee_calendar_note', {
      p_note_id: 'n1',
      p_employee_id: 'p1',
      p_date: '2026-11-04',
      p_body: 'Otro',
      p_color: 0,
    })
  })

  it('el borrado llama a delete_employee_calendar_note', async () => {
    rpcMock.mockResolvedValue({ data: {}, error: null })
    await deleteEmployeeCalendarNote('n1')
    expect(rpcMock).toHaveBeenCalledWith('delete_employee_calendar_note', {
      p_note_id: 'n1',
    })
  })

  it('los errores del servidor llegan tipados, con el hint', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: {
        code: 'P0001',
        message: 'La observación no puede estar vacía.',
        details: null,
        hint: 'INVALID_NOTE_BODY',
      },
    })
    const error = await saveEmployeeCalendarNote({
      noteId: null,
      employeeId: 'p1',
      date: '2026-11-04',
      body: '',
      color: null,
    }).catch((caught: unknown) => caught)
    expect(isApiError(error)).toBe(true)
    expect(isApiError(error) && error.hint).toBe('INVALID_NOTE_BODY')
  })
})
