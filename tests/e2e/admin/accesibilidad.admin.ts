import { expect, test } from '@playwright/test'
import { readId, storageStatePath } from '../../fixtures/sessions.ts'
import {
  auditarEnAmbosTamanos,
  esperarPantallaLista,
} from '../../fixtures/axe.ts'
import { MISSING_ENV_MESSAGE, readE2eEnv } from '../../fixtures/env.ts'
import { Scenario } from '../../fixtures/scenario.ts'
import { cubre } from '../../fixtures/trace.ts'

// TEST-023 (P18.4): accesibilidad con axe-core en las pantallas principales de administración,
// en escritorio (1280 px) y en celular (390 px). Criterio: cero violaciones critical y serious
// (el contraste de los tokens del Design System se informa aparte: ver `fixtures/axe.ts`).
// Rastro: RB-X01 (diseño responsive y accesible, `03` sección 15).
// Cuenta propia: `empleado5` (asignado a un turno de hoy de 05:10 a 05:40, que ningún otro
// archivo usa) para que el tablero y las listas tengan filas reales.

test.skip(!readE2eEnv(), MISSING_ENV_MESSAGE)

test.describe('axe: login', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test(
    'COM-01 Ingreso, sin sesión',
    cubre('RB-X01', 'RB-A01'),
    async ({ page }, testInfo) => {
      await page.goto('/ingresar')
      await auditarEnAmbosTamanos(
        page,
        testInfo,
        'COM-01 Ingreso',
        async () => {
          await expect(
            page.getByRole('button', { name: 'Ingresar' }),
          ).toBeVisible()
        },
      )
      await page.goto('/recuperar')
      await auditarEnAmbosTamanos(
        page,
        testInfo,
        'COM-02 Recuperar contraseña',
        () => esperarPantallaLista(page),
      )
    },
  )
})

test.describe('axe: administrador', () => {
  test.use({ storageState: storageStatePath('admin') })

  test(
    'ADM-02 a ADM-26: tablero, cronograma, turno, asistencia, listas y fichas',
    cubre('RB-X01', 'RB-A06', 'RB-A07', 'RB-A03', 'RB-A02'),
    async ({ page }, testInfo) => {
      test.setTimeout(240_000)
      const sc = new Scenario()
      try {
        const cliente = await sc.client('axe')
        const sede = await sc.site(cliente.id, 'axe', {
          lat: -34.6037,
          lng: -58.3816,
        })
        const turno = await sc.shift(cliente.id, sede.id, sc.today, {
          start: '05:10',
          end: '05:40',
        })
        await sc.assign(turno, 'empleado5')

        const pantallas: Array<[nombre: string, ruta: string]> = [
          ['ADM-02 Resumen', '/admin'],
          ['ADM-03 Planificación mes', '/admin/planificacion?vista=mes'],
          ['ADM-04 Planificación semana', '/admin/planificacion?vista=semana'],
          [
            'ADM-05 Planificación día',
            `/admin/planificacion?vista=dia&fecha=${sc.today}`,
          ],
          ['ADM-06 Detalle del turno', `/admin/turnos/${turno}`],
          ['ADM-07 Nuevo turno', '/admin/turnos/nuevo'],
          ['ADM-07 Editar turno', `/admin/turnos/${turno}/editar`],
          ['ADM-09 Generar turnos', '/admin/turnos/generar'],
          ['ADM-10 Asistencia de hoy', '/admin/asistencia'],
          ['ADM-13 Supervisiones', '/admin/supervisiones'],
          ['ADM-14 Nueva supervisión', '/admin/supervisiones/nueva'],
          ['ADM-16 Empleados', '/admin/empleados'],
          [
            'ADM-17 Ficha del empleado',
            `/admin/empleados/${readId('empleado5')}`,
          ],
          ['ADM-19 Clientes', '/admin/clientes'],
          ['ADM-21 Detalle del cliente', `/admin/clientes/${cliente.id}`],
          ['ADM-22 Detalle de la sede', `/admin/sedes/${sede.id}`],
          [
            'ADM-26 Plantillas de tareas',
            `/admin/tareas?cliente=${cliente.id}`,
          ],
        ]

        for (const [nombre, ruta] of pantallas) {
          await test.step(nombre, async () => {
            await page.goto(ruta)
            await auditarEnAmbosTamanos(page, testInfo, nombre, () =>
              esperarPantallaLista(page),
            )
          })
        }
      } finally {
        expect(await sc.cleanup(), 'limpieza').toEqual([])
      }
    },
  )
})

test.describe('axe: perfil propio', () => {
  test.use({ storageState: storageStatePath('admin') })

  // DEF-A01 (nuevo, TEST-023): el `<input type="file">` de la foto de perfil (COM-04) no tiene
  // etiqueta accesible (axe `label`, impacto critical). Es la misma pantalla para los tres roles,
  // por eso se prueba una sola vez acá. Corregido en P18.6.
  test(
    'COM-04 Perfil propio',
    cubre('RB-X01', 'RB-A01', 'RB-E01', 'RB-S01'),
    async ({ page }, testInfo) => {
      await page.goto('/perfil')
      await auditarEnAmbosTamanos(page, testInfo, 'COM-04 Perfil propio', () =>
        esperarPantallaLista(page),
      )
    },
  )
})

test.describe('axe: dueño', () => {
  test.use({ storageState: storageStatePath('owner') })

  test(
    'configuración: usuarios, empresa, feriados, criterios y eventos de seguridad',
    cubre('RB-X01', 'RB-A01'),
    async ({ page }, testInfo) => {
      test.setTimeout(180_000)
      const pantallas: Array<[string, string]> = [
        ['ADM-27 Usuarios y roles', '/admin/configuracion/usuarios'],
        ['ADM-28 Empresa', '/admin/configuracion/empresa'],
        ['ADM-29 Feriados', '/admin/configuracion/feriados'],
        ['ADM-30 Criterios de calificación', '/admin/configuracion/criterios'],
        ['ADM-31 Eventos de seguridad', '/admin/configuracion/seguridad'],
      ]
      for (const [nombre, ruta] of pantallas) {
        await test.step(nombre, async () => {
          await page.goto(ruta)
          await auditarEnAmbosTamanos(page, testInfo, nombre, () =>
            esperarPantallaLista(page),
          )
        })
      }
    },
  )
})
