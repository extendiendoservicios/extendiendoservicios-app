import { describe, expect, it } from 'vitest'
import {
  employeeCreateFormValuesToInput,
  employeeCreateSchema,
  employeeEditFormValuesToInput,
  employeeEditSchema,
  employeeRolesFromCheckboxes,
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
