import { describe, expect, it } from 'vitest'
import { getParentPath, isAdminRootPath } from './backNavigation'

describe('getParentPath (P17.8)', () => {
  it.each([
    ['/admin/empleados', '/admin', '/admin'],
    ['/admin/clientes', '/admin', '/admin'],
    ['/admin/tareas', '/admin', '/admin'],
    ['/admin/configuracion/empresa', '/admin', '/admin'],
    ['/admin/empleados/123', '/admin', '/admin/empleados'],
    ['/admin/empleados/nuevo', '/admin', '/admin/empleados'],
    ['/admin/empleados/123/editar', '/admin', '/admin/empleados/123'],
    ['/admin/turnos/9', '/admin', '/admin/planificacion'],
    ['/admin/turnos/9/editar', '/admin', '/admin/turnos/9'],
    ['/admin/sedes/4', '/admin', '/admin/clientes'],
    ['/admin/servicios/nuevo', '/admin', '/admin/clientes'],
    ['/admin/supervisiones/7', '/admin', '/admin/supervisiones'],
    ['/app/fichar/consentimiento', '/app', '/app/fichar'],
    ['/app/en-curso/5', '/app', '/app'],
    ['/app/en-curso/5/tareas', '/app', '/app/en-curso/5'],
    ['/sup/supervisiones/3/calificar/8', '/sup', '/sup/supervisiones/3'],
    ['/perfil', '/app', '/app'],
  ])('%s (%s) -> %s', (pathname, root, expected) => {
    expect(getParentPath(pathname, root)).toBe(expected)
  })

  it('reconoce las cuatro raíces de administración', () => {
    expect(isAdminRootPath('/admin')).toBe(true)
    expect(isAdminRootPath('/admin/planificacion')).toBe(true)
    expect(isAdminRootPath('/admin/empleados')).toBe(false)
  })
})
