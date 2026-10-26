import { act, fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router'
import { describe, expect, it } from 'vitest'
import { getParentPath, isAdminRootPath, useLeaveForm } from './backNavigation'

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
    ['/sup/turnos/5', '/sup', '/sup'],
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

describe('useLeaveForm (P19.9)', () => {
  function Screen({ name }: { name: string }) {
    const location = useLocation()
    return <p>{`${name} ${location.pathname}`}</p>
  }

  function EditForm({ mode }: { mode: 'edit' | 'create' }) {
    const leaveForm = useLeaveForm()
    return (
      <button type="button" onClick={() => leaveForm('/admin/sedes/1', mode)}>
        Guardar
      </button>
    )
  }

  function renderAt(entries: string[], mode: 'edit' | 'create') {
    const router = createMemoryRouter(
      [
        { path: '/admin/clientes/9', element: <Screen name="Cliente" /> },
        { path: '/admin/sedes/1', element: <Screen name="Sede" /> },
        { path: '/admin/sedes/1/editar', element: <EditForm mode={mode} /> },
        { path: '/admin/sedes/nueva', element: <EditForm mode={mode} /> },
      ],
      { initialEntries: entries, initialIndex: entries.length - 1 },
    )
    render(<RouterProvider router={router} />)
    return router
  }

  it('al guardar una edición vuelve a la ficha sin apilarla, y "atrás" sube al cliente', async () => {
    const router = renderAt(
      ['/admin/clientes/9', '/admin/sedes/1', '/admin/sedes/1/editar'],
      'edit',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Sede /admin/sedes/1')).toBeInTheDocument()
    await act(() => router.navigate(-1))
    expect(
      await screen.findByText('Cliente /admin/clientes/9'),
    ).toBeInTheDocument()
  })

  it('una edición abierta directo por URL reemplaza el formulario por la ficha', async () => {
    const router = renderAt(['/admin/sedes/1/editar'], 'edit')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Sede /admin/sedes/1')).toBeInTheDocument()
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it('un alta reemplaza el formulario: "atrás" desde la ficha nueva no vuelve al formulario', async () => {
    const router = renderAt(
      ['/admin/clientes/9', '/admin/sedes/nueva'],
      'create',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByText('Sede /admin/sedes/1')).toBeInTheDocument()
    await act(() => router.navigate(-1))
    expect(
      await screen.findByText('Cliente /admin/clientes/9'),
    ).toBeInTheDocument()
  })
})
