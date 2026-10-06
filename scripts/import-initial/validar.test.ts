// @vitest-environment node
// DATA-005: pruebas de la lectura y la validación con planillas ficticias armadas en el test.
// Cada decisión del 6 oct 2026 tiene su caso.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { leerPlantilla } from './leer-plantilla.ts'
import { validar } from './validar.ts'
import { informeTexto, resumir } from './informe.ts'
import {
  crearPlanilla,
  cuitValido,
  datosValidos,
  fechaExcel,
  horaExcel,
  type DatosPlanilla,
  type OpcionesPlanilla,
} from './pruebas/planilla-ficticia.ts'
import type {
  Incidencia,
  Nivel,
  NombreHoja,
  ResultadoValidacion,
} from './tipos.ts'

async function validarDatos(
  datos: DatosPlanilla,
  opciones?: OpcionesPlanilla,
): Promise<ResultadoValidacion> {
  return validar(await leerPlantilla(await crearPlanilla(datos, opciones)))
}

function de(
  res: ResultadoValidacion,
  nivel: Nivel,
  hoja?: NombreHoja,
): Incidencia[] {
  return res.incidencias.filter(
    (i) => i.nivel === nivel && (!hoja || i.hoja === hoja),
  )
}

function codigos(res: ResultadoValidacion, nivel: Nivel): string[] {
  return de(res, nivel).map((i) => i.codigo)
}

describe('la plantilla oficial', () => {
  it('sin completar: no tiene errores y se ignoran todas sus filas de ejemplo', async () => {
    const ruta = fileURLToPath(
      new URL('../../docs/plantilla-carga-inicial.xlsx', import.meta.url),
    )
    const res = validar(await leerPlantilla(ruta))
    expect(de(res, 'error')).toEqual([])
    // Clientes trae dos ejemplos; las otras ocho hojas de datos, uno cada una.
    expect(de(res, 'ignorada')).toHaveLength(10)
    expect(res.plan.clientes).toHaveLength(0)
    expect(res.plan.personas).toHaveLength(0)
    // El archivo se lee igual desde un buffer en memoria.
    const desdeBuffer = validar(await leerPlantilla(readFileSync(ruta)))
    expect(de(desdeBuffer, 'ignorada')).toHaveLength(10)
  })
})

describe('una planilla ficticia válida', () => {
  it('no tiene errores y arma el plan completo', async () => {
    const res = await validarDatos(datosValidos())
    expect(de(res, 'error')).toEqual([])
    const { plan } = res
    expect(plan.clientes).toHaveLength(3)
    expect(plan.contactos).toHaveLength(1)
    // Planta Uno (explícita) + la Principal automática de los otros dos clientes con dirección
    // (el cliente B tiene su sede; A y C tienen dirección administrativa).
    expect(plan.sedes.map((s) => s.nombre).sort()).toEqual([
      'Planta Uno',
      'Principal',
      'Principal',
    ])
    // Tres personas con usuario: una de ellas con los dos roles.
    expect(plan.personas).toHaveLength(3)
    expect(
      plan.personas.find((p) => p.dni === '40333444')?.roles.sort(),
    ).toEqual(['employee', 'supervisor'])
    expect(plan.servicios).toHaveLength(2)
    expect(plan.habilitaciones).toHaveLength(2)
    expect(plan.feriados).toHaveLength(2)
    expect(plan.criterios).toHaveLength(2)
  })

  it('convierte teléfonos numéricos, fechas y horas de Excel', async () => {
    const { plan } = await validarDatos(datosValidos())
    expect(plan.contactos[0].telefono).toBe('1144445555')
    const ana = plan.personas.find((p) => p.dni === '40111222')
    expect(ana?.telefono).toBe('1155551111')
    expect(ana?.nacimiento).toBe('1990-03-15')
    expect(ana?.ingreso).toBe('2024-02-01')
    const manana = plan.servicios.find((s) => s.nombre === 'Limpieza mañana')
    expect(manana?.inicio).toBe('07:00')
    expect(manana?.fin).toBe('15:30')
    expect(manana?.dias).toEqual([1, 2, 5])
    expect(manana?.dotacion).toBe(2)
    expect(manana?.seTrabajaFeriados).toBe(false)
    const tarde = plan.servicios.find((s) => s.nombre === 'Limpieza tarde')
    expect(tarde?.dias).toEqual([6])
    expect(tarde?.dotacion).toBe(1)
    expect(tarde?.seTrabajaFeriados).toBe(true)
  })

  it('el informe cuenta lo que se cargaría', async () => {
    const res = await validarDatos(datosValidos())
    const resumen = resumir(res)
    expect(resumen.errores).toBe(0)
    expect(resumen.cantidades.sedesAutomaticas).toBe(2)
    expect(resumen.cantidades.conAmbosRoles).toBe(1)
    const texto = informeTexto(res, {
      archivo: 'prueba.xlsx',
      modo: 'simulacion',
      entorno: null,
      fecha: new Date(2026, 9, 6, 12, 0),
    })
    expect(texto).toContain('RESULTADO: sin errores')
    expect(texto).toContain('FILAS IGNORADAS')
  })
})

describe('filas de ejemplo', () => {
  it('se ignoran con aviso, por la palabra "Ejemplo" o por el fondo amarillo', async () => {
    const res = await validarDatos(datosValidos())
    const ignoradas = de(res, 'ignorada')
    expect(ignoradas.every((i) => i.codigo === 'FILA_DE_EJEMPLO')).toBe(true)
    // Habilitaciones, Feriados y Criterios no dicen "Ejemplo": se reconocen por el relleno.
    for (const hoja of ['Habilitaciones', 'Feriados', 'Criterios'] as const) {
      expect(de(res, 'ignorada', hoja)).toHaveLength(1)
    }
    expect(de(res, 'ignorada', 'Clientes')).toHaveLength(2)
  })

  it('una fila real que dice "Ejemplo" también se ignora, y el aviso trae el número de fila', async () => {
    const res = await validarDatos({
      Clientes: [{ razonSocial: 'Cliente de Ejemplo Real' }],
    })
    const ignorada = de(res, 'ignorada', 'Clientes').find((i) => i.fila === 7)
    expect(ignorada).toBeDefined()
    expect(res.plan.clientes).toHaveLength(0)
  })
})

describe('clientes y CUIT', () => {
  it('CUIT de largo distinto de 11: error con hoja, fila y columna', async () => {
    const res = await validarDatos({
      Clientes: [{ cuit: '123456', razonSocial: 'Test Corto' }],
    })
    const errores = de(res, 'error')
    expect(errores).toHaveLength(1)
    expect(errores[0]).toMatchObject({
      hoja: 'Clientes',
      fila: 7,
      columna: 'CUIT',
      codigo: 'CUIT_LARGO',
    })
    expect(errores[0].mensaje).toContain('6 dígitos')
  })

  it('CUIT con letras: error que sugiere dejar la celda vacía', async () => {
    const res = await validarDatos({
      Clientes: [{ cuit: 'EN TRAMITE', razonSocial: 'Test Tramite' }],
    })
    expect(codigos(res, 'error')).toEqual(['CUIT_FORMATO'])
    expect(de(res, 'error')[0].mensaje).toContain('dejá la celda vacía')
  })

  it('CUIT repetido: error en las dos filas', async () => {
    const cuit = cuitValido('3071234567')
    const res = await validarDatos({
      Clientes: [
        { cuit, razonSocial: 'Test Uno' },
        { cuit, razonSocial: 'Test Dos' },
      ],
    })
    const errores = de(res, 'error', 'Clientes')
    expect(errores.map((e) => [e.fila, e.codigo])).toEqual([
      [7, 'CUIT_REPETIDO'],
      [8, 'CUIT_REPETIDO'],
    ])
  })

  it('un CUIT repetido con guiones y otro sin guiones es el mismo CUIT', async () => {
    const cuit = cuitValido('3071234567')
    const conGuiones = `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`
    const res = await validarDatos({
      Clientes: [
        { cuit, razonSocial: 'Test Uno' },
        { cuit: conGuiones, razonSocial: 'Test Dos' },
      ],
    })
    expect(codigos(res, 'error')).toEqual(['CUIT_REPETIDO', 'CUIT_REPETIDO'])
    expect(codigos(res, 'advertencia')).toContain('CUIT_LIMPIADO')
  })

  it('dígito verificador inválido: solo advertencia, el cliente se carga', async () => {
    const bueno = cuitValido('3071234567')
    const malo = bueno.slice(0, 10) + String((Number(bueno[10]) + 1) % 10)
    const res = await validarDatos({
      Clientes: [{ cuit: malo, razonSocial: 'Test Verificador' }],
    })
    expect(de(res, 'error')).toEqual([])
    expect(codigos(res, 'advertencia')).toContain('CUIT_VERIFICADOR')
    expect(res.plan.clientes[0].cuit).toBe(malo)
  })

  it('el CUIT es opcional: un cliente sin CUIT es válido', async () => {
    const res = await validarDatos({
      Clientes: [{ razonSocial: 'Test Sin Cuit' }],
    })
    expect(de(res, 'error')).toEqual([])
    expect(res.plan.clientes[0].cuit).toBeNull()
  })

  it('razón social repetida con CUIT distinto: advertencia', async () => {
    const res = await validarDatos({
      Clientes: [
        { cuit: cuitValido('3071234567'), razonSocial: 'Test Repetida' },
        { cuit: cuitValido('3079876543'), razonSocial: 'test  REPETIDA' },
      ],
    })
    expect(de(res, 'error')).toEqual([])
    expect(
      codigos(res, 'advertencia').filter((c) => c === 'RAZON_SOCIAL_REPETIDA'),
    ).toHaveLength(2)
  })

  it('estado inválido y coordenadas fuera de rango', async () => {
    const res = await validarDatos({
      Clientes: [
        { razonSocial: 'Test Estado', estado: 'Dudoso' },
        { razonSocial: 'Test Mapa', latitud: 123, longitud: -58.4 },
        { razonSocial: 'Test Enorme', latitud: 5000, longitud: -58.4 },
      ],
    })
    expect(codigos(res, 'error')).toEqual([
      'OPCION_INVALIDA',
      'NUMERO_FUERA_DE_RANGO',
    ])
    expect(codigos(res, 'advertencia')).toContain('COORDENADA_FUERA_DE_RANGO')
    const mapa = res.plan.clientes.find((c) => c.razonSocial === 'Test Mapa')
    expect(mapa?.latitud).toBeNull()
    expect(mapa?.longitud).toBeNull()
  })
})

describe('vínculo con el cliente en las hojas hijas', () => {
  it('un cliente sin CUIT se vincula por razón social, sin distinguir mayúsculas ni espacios de más', async () => {
    const res = await validarDatos({
      Clientes: [{ razonSocial: 'Test Sin Cuit', direccion: 'Calle 1' }],
      Contactos: [{ cliente: '  TEST   sin cuit ', nombre: 'Test Contacto' }],
      Sedes: [
        { cliente: 'test sin cuit', nombre: 'Anexo', direccion: 'Calle 2' },
      ],
    })
    expect(de(res, 'error')).toEqual([])
    expect(res.plan.contactos[0].clienteId).toBe(res.plan.clientes[0].id)
    expect(res.plan.sedes.map((s) => s.nombre)).toEqual(['Anexo'])
  })

  it('un cliente con CUIT también se puede nombrar por su razón social si es única', async () => {
    const res = await validarDatos({
      Clientes: [
        { cuit: cuitValido('3071234567'), razonSocial: 'Test Con Cuit' },
      ],
      Contactos: [{ cliente: 'Test Con Cuit', nombre: 'Test Contacto' }],
    })
    expect(de(res, 'error')).toEqual([])
  })

  it('dos clientes sin CUIT con la misma razón social: error en los dos', async () => {
    const res = await validarDatos({
      Clientes: [
        { razonSocial: 'Test Gemelo' },
        { razonSocial: 'TEST gemelo ' },
      ],
    })
    expect(de(res, 'error', 'Clientes').map((e) => [e.fila, e.codigo])).toEqual(
      [
        [7, 'CLIENTE_SIN_CUIT_REPETIDO'],
        [8, 'CLIENTE_SIN_CUIT_REPETIDO'],
      ],
    )
  })

  it('una referencia ambigua por razón social es error; por CUIT se distingue', async () => {
    const cuit = cuitValido('3071234567')
    const res = await validarDatos({
      Clientes: [
        { cuit, razonSocial: 'Test Doble' },
        { cuit: cuitValido('3079876543'), razonSocial: 'Test Doble' },
      ],
      Contactos: [
        { cliente: 'Test Doble', nombre: 'Test Ambiguo' },
        { cliente: cuit, nombre: 'Test Preciso' },
      ],
    })
    const errores = de(res, 'error', 'Contactos')
    expect(errores).toHaveLength(1)
    expect(errores[0]).toMatchObject({
      fila: 6,
      columna: 'CUIT del cliente',
      codigo: 'CLIENTE_AMBIGUO',
    })
    expect(res.plan.contactos.map((c) => c.nombre)).toEqual(['Test Preciso'])
  })

  it('con un cliente con CUIT y otro sin CUIT de igual razón social, el nombre elige al que no tiene CUIT', async () => {
    const res = await validarDatos({
      Clientes: [
        { cuit: cuitValido('3071234567'), razonSocial: 'Test Mixto' },
        { razonSocial: 'Test Mixto' },
      ],
      Contactos: [{ cliente: 'Test Mixto', nombre: 'Test Contacto' }],
    })
    expect(de(res, 'error')).toEqual([])
    const sinCuit = res.plan.clientes.find((c) => c.cuit === null)
    expect(res.plan.contactos[0].clienteId).toBe(sinCuit?.id)
  })

  it('un cliente inexistente es error, por CUIT y por razón social', async () => {
    const res = await validarDatos({
      Clientes: [{ razonSocial: 'Test Real' }],
      Contactos: [
        { cliente: '30000000000', nombre: 'Test Uno' },
        { cliente: 'Test Fantasma', nombre: 'Test Dos' },
      ],
    })
    expect(codigos(res, 'error')).toEqual([
      'CLIENTE_NO_ENCONTRADO',
      'CLIENTE_NO_ENCONTRADO',
    ])
  })
})

describe('sede automática', () => {
  it('un cliente sin sedes y con dirección recibe la sede Principal, activa y sin coordenadas', async () => {
    const res = await validarDatos({
      Clientes: [
        {
          razonSocial: 'Test Uno',
          direccion: 'Calle 1',
          latitud: -34.6,
          longitud: -58.4,
        },
      ],
    })
    expect(de(res, 'error')).toEqual([])
    expect(res.plan.sedes).toHaveLength(1)
    expect(res.plan.sedes[0]).toMatchObject({
      nombre: 'Principal',
      direccion: 'Calle 1',
      estado: 'active',
      latitud: null,
      longitud: null,
      automatica: true,
      fila: null,
    })
  })

  it('sin dirección no se crea sede y queda como advertencia, no como error', async () => {
    const res = await validarDatos({
      Clientes: [{ razonSocial: 'Test Sin Dirección' }],
    })
    expect(de(res, 'error')).toEqual([])
    expect(res.plan.sedes).toHaveLength(0)
    expect(de(res, 'advertencia', 'Clientes')).toMatchObject([
      { fila: 7, codigo: 'CLIENTE_SIN_SEDE' },
    ])
  })

  it('un cliente con filas en Sedes no recibe sede automática', async () => {
    const res = await validarDatos({
      Clientes: [{ razonSocial: 'Test Uno', direccion: 'Calle 1' }],
      Sedes: [{ cliente: 'Test Uno', nombre: 'Planta', direccion: 'Calle 9' }],
    })
    expect(res.plan.sedes.map((s) => [s.nombre, s.automatica])).toEqual([
      ['Planta', false],
    ])
  })

  it('un servicio puede apuntar a la sede Principal automática', async () => {
    const res = await validarDatos({
      Clientes: [{ razonSocial: 'Test Uno', direccion: 'Calle 1' }],
      Servicios: [
        {
          cliente: 'Test Uno',
          sede: 'principal',
          nombre: 'Test Servicio',
          lunes: 'Sí',
          inicio: horaExcel(8),
          fin: horaExcel(12),
          desde: fechaExcel(2026, 3, 1),
        },
      ],
    })
    expect(de(res, 'error')).toEqual([])
    expect(res.plan.servicios).toHaveLength(1)
  })

  it('un servicio que apunta a "Principal" de un cliente sin dirección ni sedes es error', async () => {
    const res = await validarDatos({
      Clientes: [{ razonSocial: 'Test Uno' }],
      Servicios: [
        {
          cliente: 'Test Uno',
          sede: 'Principal',
          nombre: 'Test Servicio',
          lunes: 'Sí',
          inicio: horaExcel(8),
          fin: horaExcel(12),
          desde: fechaExcel(2026, 3, 1),
        },
      ],
    })
    expect(codigos(res, 'error')).toEqual(['SEDE_NO_ENCONTRADA'])
  })
})

describe('sedes', () => {
  it('nombre repetido dentro del mismo cliente: error; en clientes distintos no', async () => {
    const res = await validarDatos({
      Clientes: [
        { razonSocial: 'Test Uno', direccion: 'Calle 1' },
        { razonSocial: 'Test Dos', direccion: 'Calle 2' },
      ],
      Sedes: [
        { cliente: 'Test Uno', nombre: 'Centro', direccion: 'A' },
        { cliente: 'Test Uno', nombre: ' centro ', direccion: 'B' },
        { cliente: 'Test Dos', nombre: 'Centro', direccion: 'C' },
      ],
    })
    expect(de(res, 'error', 'Sedes').map((e) => [e.fila, e.codigo])).toEqual([
      [6, 'SEDE_REPETIDA'],
      [7, 'SEDE_REPETIDA'],
    ])
  })

  it('faltan la dirección y el nombre: error por cada dato obligatorio', async () => {
    const res = await validarDatos({
      Clientes: [{ razonSocial: 'Test Uno' }],
      Sedes: [{ cliente: 'Test Uno' }],
    })
    const columnas = de(res, 'error', 'Sedes').map((e) => e.columna)
    expect(columnas).toEqual(['Nombre de la sede', 'Dirección'])
  })
})

describe('contactos', () => {
  it('dos contactos principales en el mismo cliente: error (la base lo rechaza)', async () => {
    const res = await validarDatos({
      Clientes: [{ razonSocial: 'Test Uno' }],
      Contactos: [
        { cliente: 'Test Uno', nombre: 'A', principal: 'Sí' },
        { cliente: 'Test Uno', nombre: 'B', principal: 'Sí' },
        { cliente: 'Test Uno', nombre: 'C', principal: 'No' },
      ],
    })
    expect(codigos(res, 'error')).toEqual([
      'CONTACTO_PRINCIPAL_REPETIDO',
      'CONTACTO_PRINCIPAL_REPETIDO',
    ])
  })

  it('un email sin dominio es solo una advertencia', async () => {
    const res = await validarDatos({
      Clientes: [{ razonSocial: 'Test Uno' }],
      Contactos: [{ cliente: 'Test Uno', nombre: 'A', email: 'sin-dominio' }],
    })
    expect(de(res, 'error')).toEqual([])
    expect(codigos(res, 'advertencia')).toContain('EMAIL_CONTACTO')
  })
})

describe('empleados y supervisores', () => {
  it('el email es obligatorio: la fila sin email se rechaza con su fila y columna', async () => {
    const res = await validarDatos({
      Empleados: [
        { dni: '40111222', nombre: 'Test', apellido: 'Uno' },
        {
          dni: '40222333',
          nombre: 'Test',
          apellido: 'Dos',
          email: 'dos@prueba.test',
        },
      ],
    })
    const errores = de(res, 'error')
    expect(errores).toHaveLength(1)
    expect(errores[0]).toMatchObject({
      hoja: 'Empleados',
      fila: 6,
      columna: 'Email',
      codigo: 'EMAIL_FALTA',
    })
    expect(res.plan.personas.map((p) => p.dni)).toEqual(['40222333'])
  })

  it('un email mal escrito es error', async () => {
    const res = await validarDatos({
      Supervisores: [
        {
          dni: '40111222',
          nombre: 'A',
          apellido: 'B',
          email: 'sin arroba.com',
        },
      ],
    })
    expect(codigos(res, 'error')).toEqual(['EMAIL_INVALIDO'])
  })

  it('DNI repetido dentro de la hoja: error en las dos filas, aunque falte el email', async () => {
    const res = await validarDatos({
      Empleados: [
        { dni: '40111222', nombre: 'A', apellido: 'Uno' },
        {
          dni: '40111222',
          nombre: 'B',
          apellido: 'Dos',
          email: 'dos@prueba.test',
        },
      ],
    })
    expect(
      de(res, 'error')
        .filter((e) => e.codigo === 'DNI_REPETIDO')
        .map((e) => e.fila),
    ).toEqual([6, 7])
  })

  it('sin DNI: error', async () => {
    const res = await validarDatos({
      Empleados: [{ nombre: 'A', apellido: 'B', email: 'a@prueba.test' }],
    })
    expect(de(res, 'error')[0]).toMatchObject({
      columna: 'DNI',
      codigo: 'FALTA_DATO',
    })
  })

  it('el DNI con puntos se limpia con aviso; el de largo raro es solo advertencia', async () => {
    const res = await validarDatos({
      Empleados: [
        {
          dni: '40.111.222',
          nombre: 'A',
          apellido: 'B',
          email: 'a@prueba.test',
        },
        { dni: '12345', nombre: 'C', apellido: 'D', email: 'c@prueba.test' },
      ],
    })
    expect(de(res, 'error')).toEqual([])
    expect(res.plan.personas.map((p) => p.dni)).toEqual(['40111222', '12345'])
    expect(codigos(res, 'advertencia')).toEqual(['DNI_LIMPIADO', 'DNI_LARGO'])
  })

  it('el CUIL con verificador inválido es advertencia; con largo distinto de 11 es error', async () => {
    const bueno = cuitValido('2740111222')
    const malo = bueno.slice(0, 10) + String((Number(bueno[10]) + 1) % 10)
    const res = await validarDatos({
      Empleados: [
        {
          dni: '40111222',
          nombre: 'A',
          apellido: 'B',
          email: 'a@prueba.test',
          cuil: malo,
        },
        {
          dni: '40222333',
          nombre: 'C',
          apellido: 'D',
          email: 'c@prueba.test',
          cuil: '2740',
        },
      ],
    })
    expect(codigos(res, 'error')).toEqual(['CUIL_LARGO'])
    expect(codigos(res, 'advertencia')).toEqual(['CUIL_VERIFICADOR'])
  })

  it('la misma persona en las dos hojas es una sola cuenta con dos roles', async () => {
    const fila = {
      dni: '40111222',
      nombre: 'A',
      apellido: 'B',
      email: 'A@Prueba.test',
    }
    const res = await validarDatos({
      Empleados: [fila],
      Supervisores: [{ ...fila, email: 'a@prueba.test' }],
    })
    expect(de(res, 'error')).toEqual([])
    expect(res.plan.personas).toHaveLength(1)
    expect(res.plan.personas[0].roles.sort()).toEqual([
      'employee',
      'supervisor',
    ])
    expect(res.plan.personas[0].email).toBe('a@prueba.test')
  })

  it('la misma persona en las dos hojas con emails distintos: error', async () => {
    const res = await validarDatos({
      Empleados: [
        {
          dni: '40111222',
          nombre: 'A',
          apellido: 'B',
          email: 'uno@prueba.test',
        },
      ],
      Supervisores: [
        {
          dni: '40111222',
          nombre: 'A',
          apellido: 'B',
          email: 'otro@prueba.test',
        },
      ],
    })
    expect(de(res, 'error')).toMatchObject([
      { hoja: 'Supervisores', fila: 6, codigo: 'EMAIL_DISTINTO_ENTRE_HOJAS' },
    ])
  })

  it('un email usado por dos personas distintas: error en las dos', async () => {
    const res = await validarDatos({
      Empleados: [
        {
          dni: '40111222',
          nombre: 'A',
          apellido: 'B',
          email: 'igual@prueba.test',
        },
        {
          dni: '40222333',
          nombre: 'C',
          apellido: 'D',
          email: 'IGUAL@prueba.test',
        },
      ],
    })
    expect(codigos(res, 'error')).toEqual(['EMAIL_REPETIDO', 'EMAIL_REPETIDO'])
  })

  it('legajo repetido: error; fechas inválidas: error', async () => {
    const res = await validarDatos({
      Empleados: [
        {
          dni: '40111222',
          nombre: 'A',
          apellido: 'B',
          email: 'a@prueba.test',
          legajo: 5,
        },
        {
          dni: '40222333',
          nombre: 'C',
          apellido: 'D',
          email: 'c@prueba.test',
          legajo: 5,
          nacimiento: '31/02/1990',
        },
      ],
    })
    expect(codigos(res, 'error').sort()).toEqual([
      'FECHA_INVALIDA',
      'LEGAJO_REPETIDO',
      'LEGAJO_REPETIDO',
    ])
  })

  it('una persona de Baja se carga con advertencia', async () => {
    const res = await validarDatos({
      Empleados: [
        {
          dni: '40111222',
          nombre: 'A',
          apellido: 'B',
          email: 'a@prueba.test',
          estado: 'Baja',
        },
      ],
    })
    expect(de(res, 'error')).toEqual([])
    expect(res.plan.personas[0].estado).toBe('terminated')
    expect(codigos(res, 'advertencia')).toEqual(['PERSONA_DE_BAJA'])
  })
})

describe('servicios', () => {
  const base = {
    cliente: 'Test Uno',
    sede: 'Principal',
    nombre: 'Test Servicio',
    lunes: 'Sí',
    inicio: horaExcel(8),
    fin: horaExcel(12),
    desde: fechaExcel(2026, 3, 1),
  }
  const clientes = [{ razonSocial: 'Test Uno', direccion: 'Calle 1' }]

  it('sin ningún día marcado: error (la base exige al menos uno)', async () => {
    const res = await validarDatos({
      Clientes: clientes,
      Servicios: [{ ...base, lunes: 'No' }],
    })
    expect(codigos(res, 'error')).toEqual(['SERVICIO_SIN_DIAS'])
  })

  it('la hora de fin igual o anterior a la de inicio: error (no cruza la medianoche)', async () => {
    const res = await validarDatos({
      Clientes: clientes,
      Servicios: [
        { ...base, inicio: horaExcel(22), fin: horaExcel(2), nombre: 'Noche' },
        { ...base, inicio: horaExcel(8), fin: horaExcel(8), nombre: 'Cero' },
      ],
    })
    expect(codigos(res, 'error')).toEqual([
      'HORA_FIN_ANTERIOR',
      'HORA_FIN_ANTERIOR',
    ])
  })

  it('dotación fuera de 1 a 10: error; horas con texto inválido: error', async () => {
    const res = await validarDatos({
      Clientes: clientes,
      Servicios: [
        { ...base, dotacion: 11, nombre: 'A' },
        { ...base, dotacion: 0, nombre: 'B' },
        { ...base, inicio: 'mediodía', nombre: 'C' },
      ],
    })
    expect(codigos(res, 'error').sort()).toEqual([
      'HORA_INVALIDA',
      'NUMERO_FUERA_DE_RANGO',
      'NUMERO_FUERA_DE_RANGO',
    ])
  })

  it('dotación de 1 y de 10 son válidas', async () => {
    const res = await validarDatos({
      Clientes: clientes,
      Servicios: [
        { ...base, dotacion: 1, nombre: 'A' },
        { ...base, dotacion: 10, nombre: 'B' },
      ],
    })
    expect(de(res, 'error')).toEqual([])
  })

  it('una sede que no existe para ese cliente: error', async () => {
    const res = await validarDatos({
      Clientes: clientes,
      Servicios: [{ ...base, sede: 'Inexistente' }],
    })
    expect(de(res, 'error')[0]).toMatchObject({
      hoja: 'Servicios',
      columna: 'Nombre de la sede',
      codigo: 'SEDE_NO_ENCONTRADA',
    })
  })

  it('dos servicios con el mismo nombre en la misma sede: error (hace falta para reintentar)', async () => {
    const res = await validarDatos({
      Clientes: clientes,
      Servicios: [base, { ...base, nombre: ' test SERVICIO' }],
    })
    expect(codigos(res, 'error')).toEqual([
      'SERVICIO_REPETIDO',
      'SERVICIO_REPETIDO',
    ])
  })

  it('"Vigente hasta" anterior a "desde": advertencia', async () => {
    const res = await validarDatos({
      Clientes: clientes,
      Servicios: [{ ...base, hasta: fechaExcel(2025, 1, 1) }],
    })
    expect(de(res, 'error')).toEqual([])
    expect(codigos(res, 'advertencia')).toEqual(['VIGENCIA_INVERTIDA'])
  })
})

describe('habilitaciones, feriados y criterios', () => {
  it('habilitación con un DNI que no está en el personal: error; repetida: advertencia', async () => {
    const res = await validarDatos({
      Clientes: [{ razonSocial: 'Test Uno' }],
      Empleados: [
        {
          dni: '40111222',
          nombre: 'A',
          apellido: 'B',
          email: 'a@prueba.test',
        },
      ],
      Habilitaciones: [
        { dni: '99999999', cliente: 'Test Uno' },
        { dni: '40111222', cliente: 'Test Uno' },
        { dni: '40111222', cliente: 'test uno' },
      ],
    })
    expect(codigos(res, 'error')).toEqual(['DNI_NO_ENCONTRADO'])
    expect(codigos(res, 'advertencia')).toContain('HABILITACION_REPETIDA')
    expect(res.plan.habilitaciones).toHaveLength(1)
  })

  it('una habilitación puede apuntar a un supervisor', async () => {
    const res = await validarDatos({
      Clientes: [{ razonSocial: 'Test Uno' }],
      Supervisores: [
        {
          dni: '40111222',
          nombre: 'A',
          apellido: 'B',
          email: 'a@prueba.test',
        },
      ],
      Habilitaciones: [{ dni: '40111222', cliente: 'Test Uno' }],
    })
    expect(de(res, 'error')).toEqual([])
  })

  it('feriado con fecha repetida: error; sin nombre: error', async () => {
    const res = await validarDatos({
      Feriados: [
        { fecha: fechaExcel(2026, 5, 25), nombre: 'Uno' },
        { fecha: fechaExcel(2026, 5, 25), nombre: 'Dos' },
        { fecha: fechaExcel(2026, 7, 9) },
      ],
    })
    expect(codigos(res, 'error').sort()).toEqual([
      'FALTA_DATO',
      'FERIADO_REPETIDO',
      'FERIADO_REPETIDO',
    ])
  })

  it('criterios: orden fuera de 1 a 99 es error; título repetido es error; orden repetido es advertencia', async () => {
    const res = await validarDatos({
      Criterios: [
        { orden: 100, titulo: 'A' },
        { orden: 2, titulo: 'B' },
        { orden: 2, titulo: 'b' },
        { orden: 3, titulo: 'C' },
      ],
    })
    expect(codigos(res, 'error').sort()).toEqual([
      'CRITERIO_REPETIDO',
      'CRITERIO_REPETIDO',
      'NUMERO_FUERA_DE_RANGO',
    ])
    expect(codigos(res, 'advertencia')).toEqual([
      'ORDEN_REPETIDO',
      'ORDEN_REPETIDO',
    ])
  })
})

describe('estructura del archivo', () => {
  it('una hoja que falta se toma como vacía, con advertencia', async () => {
    const res = await validarDatos(datosValidos(), {
      sinHojas: ['Habilitaciones'],
    })
    expect(codigos(res, 'advertencia')).toContain('HOJA_FALTA')
  })

  it('una columna opcional que falta es advertencia; una obligatoria, error', async () => {
    const res = await validarDatos(
      {},
      { sinColumnas: { Clientes: ['notas', 'razonSocial'] } },
    )
    expect(codigos(res, 'advertencia')).toContain('COLUMNA_FALTA')
    expect(de(res, 'error')[0]).toMatchObject({
      hoja: 'Clientes',
      columna: 'Razón social',
      codigo: 'COLUMNA_FALTA',
    })
  })

  it('un archivo que no es una planilla: error de lectura', async () => {
    const res = validar(await leerPlantilla(Buffer.from('esto no es un xlsx')))
    expect(codigos(res, 'error')).toContain('ARCHIVO_ILEGIBLE')
  })

  it('las incidencias salen ordenadas por hoja y fila', async () => {
    const res = await validarDatos({
      Clientes: [
        { cuit: '1', razonSocial: 'A' },
        { cuit: '2', razonSocial: 'B' },
      ],
      Empleados: [{ dni: '40111222', nombre: 'A', apellido: 'B' }],
    })
    const filasClientes = de(res, 'error', 'Clientes').map((e) => e.fila)
    expect(filasClientes).toEqual(
      [...filasClientes].sort((a, b) => (a ?? 0) - (b ?? 0)),
    )
    const hojas = de(res, 'error').map((e) => e.hoja)
    expect(hojas.indexOf('Clientes')).toBeLessThan(hojas.indexOf('Empleados'))
  })
})
