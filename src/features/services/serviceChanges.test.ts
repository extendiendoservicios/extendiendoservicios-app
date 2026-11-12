import { describe, expect, it } from 'vitest'
import type { ServiceDetail, ServiceFormInput } from '@/api/services'
import {
  buildServicePrevious,
  describeServiceOverlap,
  describeShiftOverlap,
  isServiceChangesEmpty,
  pluralWeekdays,
  serviceChangesAffectShifts,
  serviceOverlapsMessage,
  shiftOverlapsMessage,
  shouldCheckServiceOverlaps,
  summarizeServiceChanges,
} from './serviceChanges'

const BEFORE: ServiceDetail = {
  id: 's1',
  clientId: 'c1',
  clientName: 'Cliente',
  siteId: 'site1',
  siteName: 'Sede',
  name: 'Tarde',
  weekdays: [1, 2],
  weeksOfMonth: null,
  startTime: '15:00:00',
  endTime: '17:00:00',
  openEnded: false,
  requiredStaff: 1,
  validFrom: '2026-01-01',
  validTo: null,
  worksOnHolidays: true,
  requiresPhotos: false,
  minHoursMonth: null,
  maxHoursMonth: null,
  status: 'active',
  notes: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: null,
}

const SAME: ServiceFormInput = {
  clientId: 'c1',
  siteId: 'site1',
  name: 'Tarde',
  weekdays: [2, 1],
  weeksOfMonth: null,
  startTime: '15:00',
  endTime: '17:00',
  openEnded: false,
  requiredStaff: 1,
  validFrom: '2026-01-01',
  validTo: null,
  worksOnHolidays: true,
  requiresPhotos: false,
  minHoursMonth: null,
  maxHoursMonth: null,
  status: 'active',
  notes: null,
}

describe('buildServicePrevious (p_previous de OF-05)', () => {
  it('toma los valores guardados antes del cambio, con los nombres del servidor', () => {
    expect(buildServicePrevious(BEFORE)).toEqual({
      start_time: '15:00:00',
      end_time: '17:00:00',
      open_ended: false,
      required_staff: 1,
      requires_photos: false,
    })
  })
})

describe('serviceChangesAffectShifts', () => {
  it('sin cambios (mismos días en otro orden, horas con o sin segundos) no pregunta', () => {
    expect(serviceChangesAffectShifts(BEFORE, SAME)).toBe(false)
  })

  it('cambiar nombre, notas u horas mensuales no toca los turnos', () => {
    expect(
      serviceChangesAffectShifts(BEFORE, {
        ...SAME,
        name: 'Otro',
        notes: 'x',
        minHoursMonth: 10,
      }),
    ).toBe(false)
  })

  it.each<[string, Partial<ServiceFormInput>]>([
    ['días', { weekdays: [1, 2, 3] }],
    ['semanas del mes', { weeksOfMonth: [1, 3] }],
    ['hora de inicio', { startTime: '15:30' }],
    ['hora de fin', { endTime: '18:00' }],
    ['A terminar', { openEnded: true, endTime: null }],
    ['dotación', { requiredStaff: 3 }],
    ['trabaja feriados', { worksOnHolidays: false }],
    ['vigencia desde', { validFrom: '2026-03-01' }],
    ['vigencia hasta', { validTo: '2026-12-31' }],
    ['fotos', { requiresPhotos: true }],
  ])('cambiar %s pregunta', (_label, change) => {
    expect(serviceChangesAffectShifts(BEFORE, { ...SAME, ...change })).toBe(
      true,
    )
  })

  it('semanas del mes: [] y null son lo mismo (todas)', () => {
    expect(
      serviceChangesAffectShifts(BEFORE, { ...SAME, weeksOfMonth: [] }),
    ).toBe(false)
  })
})

describe('shouldCheckServiceOverlaps (OF-02)', () => {
  it('en el alta de un servicio activo siempre', () => {
    expect(shouldCheckServiceOverlaps(undefined, SAME)).toBe(true)
  })

  it('un servicio pausado o finalizado no se revisa', () => {
    expect(
      shouldCheckServiceOverlaps(undefined, { ...SAME, status: 'paused' }),
    ).toBe(false)
  })

  it('en la edición solo si cambió sede, días u horario, o se reactiva', () => {
    expect(shouldCheckServiceOverlaps(BEFORE, SAME)).toBe(false)
    expect(shouldCheckServiceOverlaps(BEFORE, { ...SAME, name: 'X' })).toBe(
      false,
    )
    expect(shouldCheckServiceOverlaps(BEFORE, { ...SAME, weekdays: [1] })).toBe(
      true,
    )
    expect(
      shouldCheckServiceOverlaps(BEFORE, { ...SAME, startTime: '16:00' }),
    ).toBe(true)
    expect(
      shouldCheckServiceOverlaps(BEFORE, { ...SAME, siteId: 'otra' }),
    ).toBe(true)
    expect(
      shouldCheckServiceOverlaps({ ...BEFORE, status: 'paused' }, SAME),
    ).toBe(true)
  })
})

describe('textos del aviso de duplicados', () => {
  it('pluralWeekdays usa la semana desde el lunes', () => {
    expect(pluralWeekdays([2, 1])).toBe('los lunes y martes')
    expect(pluralWeekdays([0, 1, 5])).toBe('los lunes, viernes y domingos')
    expect(pluralWeekdays([4])).toBe('los jueves')
  })

  it('servicio duplicado: el texto pedido', () => {
    const overlap = {
      serviceId: 'x',
      serviceName: 'YPF RUTA TURNO TARDE',
      commonWeekdays: [1, 2],
      startTime: '15:00:00',
      endTime: '17:00:00',
      openEnded: false,
    }
    expect(describeServiceOverlap(overlap)).toBe(
      'Ya existe “YPF RUTA TURNO TARDE” en esta sede los lunes y martes de 15:00 a 17:00.',
    )
    expect(serviceOverlapsMessage([overlap])).toBe(
      'Ya existe “YPF RUTA TURNO TARDE” en esta sede los lunes y martes de 15:00 a 17:00. ¿Guardar igual?',
    )
    expect(serviceOverlapsMessage([overlap, overlap])).toContain(
      'servicios que coinciden',
    )
  })

  it('servicio «A terminar»', () => {
    expect(
      describeServiceOverlap({
        serviceId: 'x',
        serviceName: 'Noche',
        commonWeekdays: [0],
        startTime: '22:00:00',
        endTime: '23:59:00',
        openEnded: true,
      }),
    ).toBe(
      'Ya existe “Noche” en esta sede los domingos desde las 22:00 (a terminar).',
    )
  })

  it('turno superpuesto: del servicio y manual', () => {
    const base = {
      shiftId: 's',
      shiftDate: '2026-11-16',
      startTime: '12:30:00',
      endTime: '14:30:00',
      openEnded: false,
    }
    expect(shiftOverlapsMessage([{ ...base, serviceName: 'Foster' }])).toBe(
      'Esta sede ya tiene el turno “Foster” ese día de 12:30 a 14:30. ¿Crear igual?',
    )
    expect(describeShiftOverlap({ ...base, serviceName: null })).toBe(
      'Esta sede ya tiene un turno cargado a mano ese día de 12:30 a 14:30.',
    )
  })
})

const EMPTY_RESULT = {
  preview: true,
  fromDate: '2026-11-12',
  deletedCount: 0,
  updatedCount: 0,
  createdCount: 0,
  unchangedCount: 5,
  skippedCount: 0,
  assignmentsRemoved: 0,
  assignmentsAdded: 0,
  deleted: [],
  updated: [],
  created: [],
  skipped: [],
  unassigned: [],
  months: [],
}

describe('summarizeServiceChanges', () => {
  it('cuenta lo que se borra, actualiza, crea y saltea, en presente y en pasado', () => {
    const result = {
      ...EMPTY_RESULT,
      deletedCount: 2,
      updatedCount: 1,
      createdCount: 4,
      skippedCount: 1,
    }
    expect(summarizeServiceChanges(result, false)).toBe(
      'Se borran 2 turnos; se actualiza 1 turno; se crean 4 turnos; se saltea 1 turno.',
    )
    expect(summarizeServiceChanges(result, true)).toBe(
      'Borramos 2 turnos; actualizamos 1 turno; creamos 4 turnos; salteamos 1 turno.',
    )
  })

  it('sin cambios lo dice', () => {
    expect(summarizeServiceChanges(EMPTY_RESULT, false)).toContain(
      'ya están al día',
    )
    expect(isServiceChangesEmpty(EMPTY_RESULT)).toBe(true)
    expect(
      isServiceChangesEmpty({
        ...EMPTY_RESULT,
        skipped: [
          {
            scope: 'shift',
            shiftId: 'a',
            shiftDate: '2026-11-13',
            code: 'MANUAL_SHIFT',
            message: 'x',
            wanted: 'update',
          },
        ],
      }),
    ).toBe(false)
  })
})
