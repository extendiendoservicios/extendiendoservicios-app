import { describe, expect, it } from 'vitest'
import type { AnnouncementRecipient } from '@/api/announcements'
import {
  audienceText,
  formatDmy,
  readAtText,
  readByText,
  rolesText,
  sortRecipients,
  validityText,
} from './helpers'
import {
  filterCandidates,
  type RecipientCandidate,
} from './components/RecipientPicker'

describe('texto de destinatarios y vigencia', () => {
  it('arma el texto de destinatarios', () => {
    expect(audienceText('employees', 12)).toBe('Empleados')
    expect(audienceText('supervisors', 3)).toBe('Supervisores')
    expect(audienceText('all', 15)).toBe('Todos')
    expect(audienceText('custom', 5)).toBe('5 personas')
    expect(audienceText('custom', 1)).toBe('1 persona')
  })

  it('arma la vigencia y las lecturas', () => {
    expect(validityText('2026-11-05')).toBe('Hasta el 05/11/2026')
    expect(validityText(null)).toBe('Sin vencimiento')
    expect(formatDmy('2026-01-09')).toBe('09/01/2026')
    expect(readByText(3, 10)).toBe('Leído por 3 de 10')
  })

  it('arma el texto de lectura en hora de Buenos Aires', () => {
    expect(readAtText(null)).toBe('Todavía no')
    // 12:30 UTC = 09:30 en Buenos Aires.
    expect(readAtText('2026-10-09T12:30:00Z')).toBe('Leído el 09/10 09:30')
  })

  it('arma el rol', () => {
    expect(rolesText(['employee'])).toBe('Empleado')
    expect(rolesText(['supervisor'])).toBe('Supervisor')
    expect(rolesText(['employee', 'supervisor'])).toBe('Empleado y supervisor')
    expect(rolesText([])).toBe('—')
  })
})

function recipient(
  profileId: string,
  lastName: string,
  readAt: string | null,
): AnnouncementRecipient {
  return { profileId, firstName: 'X', lastName, roles: ['employee'], readAt }
}

describe('sortRecipients', () => {
  it('pone primero a quienes no lo leyeron, por apellido', () => {
    const sorted = sortRecipients([
      recipient('a', 'Pérez', '2026-10-09T10:00:00Z'),
      recipient('b', 'Suárez', null),
      recipient('c', 'Acosta', null),
      recipient('d', 'Gómez', '2026-10-09T15:00:00Z'),
    ])
    expect(sorted.map((item) => item.profileId)).toEqual(['c', 'b', 'd', 'a'])
  })

  it('no modifica el arreglo original', () => {
    const original = [
      recipient('a', 'B', '2026-10-09T10:00:00Z'),
      recipient('b', 'A', null),
    ]
    sortRecipients(original)
    expect(original[0]?.profileId).toBe('a')
  })
})

describe('filterCandidates', () => {
  const people: RecipientCandidate[] = [
    {
      profileId: '1',
      name: 'María Núñez',
      employeeNumber: 12,
      roles: ['employee'],
    },
    {
      profileId: '2',
      name: 'José Díaz',
      employeeNumber: null,
      roles: ['supervisor'],
    },
  ]

  it('busca sin importar tildes ni mayúsculas', () => {
    expect(filterCandidates(people, 'nunez').map((p) => p.profileId)).toEqual([
      '1',
    ])
    expect(filterCandidates(people, 'JOSE').map((p) => p.profileId)).toEqual([
      '2',
    ])
  })

  it('busca por legajo exacto y devuelve todo sin texto', () => {
    expect(filterCandidates(people, '12').map((p) => p.profileId)).toEqual([
      '1',
    ])
    expect(filterCandidates(people, '  ')).toHaveLength(2)
  })
})
