import { describe, expect, it } from 'vitest'
import {
  employeeAvailabilitySlotFormValuesToInput,
  employeeAvailabilitySlotSchema,
  employeeCreateFormValuesToInput,
  employeeCreateSchema,
  employeeEditFormValuesToInput,
  employeeEditSchema,
  employeeLeaveFormValuesToInput,
  employeeLeaveSchema,
  employeeRolesEditSchema,
  employeeRolesFromCheckboxes,
  nextEmployeeRoles,
  onlyDigits,
} from './schemas'

/**
 * EMP-001, EMP-003, EMP-004: esquemas zod de ADM-18, replican las
 * restricciones de `0016_hardening.sql` (DNI solo dígitos, CUIL de 11
 * dígitos) y de la Edge Function `admin-users` (email válido, contraseña de
 * al menos 8 caracteres).
 */

const baseCreateValues = {
  firstName: 'Ana',
  lastName: 'Gómez',
  dni: '30111222',
  cuil: '',
  employeeNumber: '5',
  phone: '',
  address: '',
  birthDate: '',
  hireDate: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  emergencyContactRelationship: '',
  notes: '',
  isEmployeeRole: true,
  isSupervisorRole: false,
  email: 'ana@extendiendoservicios.example',
  password: 'contraseña-larga',
}

describe('employeeCreateSchema', () => {
  it('acepta un alta completa con el rol empleado', () => {
    const result = employeeCreateSchema.safeParse(baseCreateValues)
    expect(result.success).toBe(true)
  })

  it('rechaza el DNI con letras', () => {
    const result = employeeCreateSchema.safeParse({
      ...baseCreateValues,
      dni: '30A11222',
    })
    expect(result.success).toBe(false)
  })

  it('acepta el DNI con puntos y el CUIL con guiones (se limpian al guardar)', () => {
    const result = employeeCreateSchema.safeParse({
      ...baseCreateValues,
      dni: '30.111.222',
      cuil: '20-30111222-3',
    })
    expect(result.success).toBe(true)
    expect(onlyDigits('30.111.222')).toBe('30111222')
    expect(onlyDigits('20-30111222-3')).toBe('20301112223')
  })

  it('rechaza un CUIL que no tenga 11 dígitos', () => {
    const result = employeeCreateSchema.safeParse({
      ...baseCreateValues,
      cuil: '2030111222',
    })
    expect(result.success).toBe(false)
  })

  it('acepta un CUIL de 11 dígitos', () => {
    const result = employeeCreateSchema.safeParse({
      ...baseCreateValues,
      cuil: '20301112223',
    })
    expect(result.success).toBe(true)
  })

  it('rechaza si no se elige ningún rol', () => {
    const result = employeeCreateSchema.safeParse({
      ...baseCreateValues,
      isEmployeeRole: false,
      isSupervisorRole: false,
    })
    expect(result.success).toBe(false)
  })

  it('acepta si se eligen los dos roles', () => {
    const result = employeeCreateSchema.safeParse({
      ...baseCreateValues,
      isEmployeeRole: true,
      isSupervisorRole: true,
    })
    expect(result.success).toBe(true)
  })

  it('rechaza una contraseña de menos de 8 caracteres', () => {
    const result = employeeCreateSchema.safeParse({
      ...baseCreateValues,
      password: '1234567',
    })
    expect(result.success).toBe(false)
  })

  it('rechaza un legajo que no sea un número entero positivo', () => {
    const result = employeeCreateSchema.safeParse({
      ...baseCreateValues,
      employeeNumber: '0',
    })
    expect(result.success).toBe(false)
  })
})

describe('employeeRolesFromCheckboxes', () => {
  it('arma el arreglo de roles según los checkboxes marcados', () => {
    expect(
      employeeRolesFromCheckboxes({
        isEmployeeRole: true,
        isSupervisorRole: false,
      }),
    ).toEqual(['employee'])
    expect(
      employeeRolesFromCheckboxes({
        isEmployeeRole: false,
        isSupervisorRole: true,
      }),
    ).toEqual(['supervisor'])
    expect(
      employeeRolesFromCheckboxes({
        isEmployeeRole: true,
        isSupervisorRole: true,
      }),
    ).toEqual(['employee', 'supervisor'])
  })
})

describe('employeeCreateFormValuesToInput', () => {
  it('normaliza los campos vacíos a null y convierte el legajo a número', () => {
    const input = employeeCreateFormValuesToInput(baseCreateValues)
    expect(input.employeeNumber).toBe(5)
    expect(input.cuil).toBeNull()
    expect(input.roles).toEqual(['employee'])
    expect(input.dni).toBe('30111222')
  })
})

describe('employeeEditSchema', () => {
  const baseEditValues = {
    firstName: 'Ana',
    lastName: 'Gómez',
    dni: '30111222',
    cuil: '',
    employeeNumber: '5',
    phone: '',
    address: '',
    birthDate: '',
    hireDate: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    emergencyContactRelationship: '',
    notes: '',
    contactEmail: '',
  }

  it('acepta una edición completa, sin email de login ni contraseña', () => {
    const result = employeeEditSchema.safeParse(baseEditValues)
    expect(result.success).toBe(true)
  })

  it('rechaza un email de contacto inválido', () => {
    const result = employeeEditSchema.safeParse({
      ...baseEditValues,
      contactEmail: 'no-es-un-email',
    })
    expect(result.success).toBe(false)
  })

  it('employeeEditFormValuesToInput normaliza los campos vacíos a null', () => {
    const input = employeeEditFormValuesToInput(baseEditValues)
    expect(input.contactEmail).toBeNull()
    expect(input.employeeNumber).toBe(5)
  })
})

/** EMP-007: franjas de disponibilidad (P-035, `end_time > start_time`). */
describe('employeeAvailabilitySlotSchema', () => {
  const baseSlot = { weekday: '1', startTime: '08:00', endTime: '12:00' }

  it('acepta una franja válida', () => {
    expect(employeeAvailabilitySlotSchema.safeParse(baseSlot).success).toBe(
      true,
    )
  })

  it('rechaza si la hora de fin no es posterior a la de inicio', () => {
    const result = employeeAvailabilitySlotSchema.safeParse({
      ...baseSlot,
      startTime: '12:00',
      endTime: '08:00',
    })
    expect(result.success).toBe(false)
  })

  it('rechaza horas iguales', () => {
    const result = employeeAvailabilitySlotSchema.safeParse({
      ...baseSlot,
      startTime: '08:00',
      endTime: '08:00',
    })
    expect(result.success).toBe(false)
  })

  it('employeeAvailabilitySlotFormValuesToInput convierte el día a número', () => {
    const input = employeeAvailabilitySlotFormValuesToInput(baseSlot)
    expect(input).toEqual({ weekday: 1, startTime: '08:00', endTime: '12:00' })
  })
})

/** EMP-008: licencias (P-033, "hasta" opcional, no anterior a "desde"). */
describe('employeeLeaveSchema', () => {
  it('acepta una licencia abierta (sin "hasta")', () => {
    const result = employeeLeaveSchema.safeParse({
      startsOn: '2026-01-10',
      endsOn: '',
      reason: '',
    })
    expect(result.success).toBe(true)
  })

  it('acepta "hasta" igual a "desde" (un solo día)', () => {
    const result = employeeLeaveSchema.safeParse({
      startsOn: '2026-01-10',
      endsOn: '2026-01-10',
    })
    expect(result.success).toBe(true)
  })

  it('rechaza "hasta" anterior a "desde"', () => {
    const result = employeeLeaveSchema.safeParse({
      startsOn: '2026-01-10',
      endsOn: '2026-01-01',
    })
    expect(result.success).toBe(false)
  })

  it('rechaza si falta "desde"', () => {
    const result = employeeLeaveSchema.safeParse({ startsOn: '', endsOn: '' })
    expect(result.success).toBe(false)
  })

  it('employeeLeaveFormValuesToInput normaliza "hasta" y motivo vacíos a null', () => {
    const input = employeeLeaveFormValuesToInput({
      startsOn: '2026-01-10',
      endsOn: '',
      reason: '',
    })
    expect(input).toEqual({
      startsOn: '2026-01-10',
      endsOn: null,
      reason: null,
    })
  })
})

/**
 * Decisión de Mike (24 sep 2026): roles empleado/supervisor editables desde
 * la ficha. Owner/admin no forman parte de este esquema -- se preservan
 * aparte, ver `EmployeeRolesDialog.tsx`.
 */
describe('employeeRolesEditSchema', () => {
  it('rechaza si no se elige ningún rol', () => {
    const result = employeeRolesEditSchema.safeParse({
      isEmployeeRole: false,
      isSupervisorRole: false,
    })
    expect(result.success).toBe(false)
  })

  it('acepta con al menos un rol marcado', () => {
    const result = employeeRolesEditSchema.safeParse({
      isEmployeeRole: true,
      isSupervisorRole: false,
    })
    expect(result.success).toBe(true)
  })
})

describe('nextEmployeeRoles', () => {
  it('reemplaza employee/supervisor según los checkboxes, sin roles previos de administración', () => {
    const result = nextEmployeeRoles(['employee'], {
      isEmployeeRole: false,
      isSupervisorRole: true,
    })
    expect(result).toEqual(['supervisor'])
  })

  it('preserva owner si la persona ya lo tenía, aunque el diálogo no lo muestre', () => {
    const result = nextEmployeeRoles(['owner', 'employee'], {
      isEmployeeRole: true,
      isSupervisorRole: true,
    })
    expect(result.sort()).toEqual(['employee', 'owner', 'supervisor'].sort())
  })

  it('preserva admin si la persona ya lo tenía', () => {
    const result = nextEmployeeRoles(['admin', 'supervisor'], {
      isEmployeeRole: false,
      isSupervisorRole: false,
    })
    expect(result).toEqual(['admin'])
  })
})
