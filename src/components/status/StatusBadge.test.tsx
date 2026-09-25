import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StatusBadge, type StatusBadgeInput } from '.'

/**
 * Cubre cada estado de cada dominio de `07_Design_System.md` sección 3:
 * la etiqueta y la variante tienen que coincidir exactamente con la tabla
 * del plan, incluidos los derivados (`uncovered`, `upcoming`, `no_record`,
 * `early_leave`).
 */
const cases: Array<[StatusBadgeInput, string, string]> = [
  // Turno
  [{ domain: 'shift', status: 'scheduled' }, 'Programado', 'neutral'],
  [{ domain: 'shift', status: 'assigned' }, 'Asignado', 'primary'],
  [{ domain: 'shift', status: 'in_progress' }, 'En curso', 'success'],
  [{ domain: 'shift', status: 'completed' }, 'Finalizado', 'dark'],
  [{ domain: 'shift', status: 'cancelled' }, 'Cancelado', 'neutral-strike'],
  [{ domain: 'shift', status: 'uncovered' }, 'Sin cubrir', 'danger'],
  [{ domain: 'shift', status: 'upcoming' }, 'Próximo', 'info'],
  // Asignación
  [{ domain: 'assignment', status: 'expected' }, 'Esperado', 'neutral'],
  [
    { domain: 'assignment', status: 'delay_notified' },
    'Demora avisada',
    'warning',
  ],
  [
    { domain: 'assignment', status: 'absence_notified' },
    'Ausencia avisada',
    'danger',
  ],
  [{ domain: 'assignment', status: 'present' }, 'Presente', 'success'],
  [{ domain: 'assignment', status: 'finished' }, 'Finalizado', 'dark'],
  [{ domain: 'assignment', status: 'no_record' }, 'Sin registro', 'danger'],
  [
    { domain: 'assignment', status: 'early_leave' },
    'Salida anticipada',
    'warning',
  ],
  // Tarea
  [{ domain: 'task', status: 'pending' }, 'Pendiente', 'neutral'],
  [{ domain: 'task', status: 'in_progress' }, 'En curso', 'primary'],
  [{ domain: 'task', status: 'done' }, 'Completada', 'success'],
  [{ domain: 'task', status: 'not_done' }, 'No realizada', 'danger'],
  // Supervisión
  [{ domain: 'supervision', status: 'assigned' }, 'Asignada', 'neutral'],
  [{ domain: 'supervision', status: 'in_progress' }, 'En curso', 'primary'],
  [{ domain: 'supervision', status: 'completed' }, 'Completada', 'success'],
  [{ domain: 'supervision', status: 'not_done' }, 'No realizada', 'danger'],
  [
    { domain: 'supervision', status: 'cancelled' },
    'Cancelada',
    'neutral-strike',
  ],
  // Empleado
  [{ domain: 'employee', status: 'active' }, 'Activo', 'success'],
  [{ domain: 'employee', status: 'on_leave' }, 'De licencia', 'warning'],
  [{ domain: 'employee', status: 'terminated' }, 'Baja', 'neutral'],
  // Cliente
  [{ domain: 'client', status: 'active' }, 'Activo', 'success'],
  [{ domain: 'client', status: 'suspended' }, 'Suspendido', 'warning'],
  [{ domain: 'client', status: 'closed' }, 'Baja', 'neutral'],
  // Sede
  [{ domain: 'site', status: 'active' }, 'Activa', 'success'],
  [{ domain: 'site', status: 'inactive' }, 'Inactiva', 'neutral'],
  // Servicio
  [{ domain: 'service', status: 'active' }, 'Activo', 'success'],
  [{ domain: 'service', status: 'paused' }, 'Pausado', 'warning'],
  [{ domain: 'service', status: 'ended' }, 'Finalizado', 'neutral'],
  // Usuario
  [{ domain: 'user', status: 'activo' }, 'Activo', 'success'],
  [{ domain: 'user', status: 'desactivado' }, 'Desactivado', 'neutral'],
]

describe('StatusBadge', () => {
  it.each(cases)('%o → "%s" (%s)', (input, label, variant) => {
    render(<StatusBadge {...input} />)

    const badge = screen.getByText(label).closest('[data-slot="badge"]')
    expect(badge).toHaveAttribute('data-variant', variant)
  })

  it('agrega el sufijo "· n min" en demora avisada con minutos', () => {
    render(
      <StatusBadge domain="assignment" status="delay_notified" minutes={12} />,
    )

    expect(screen.getByText('Demora avisada · 12 min')).toBeInTheDocument()
  })

  it('agrega el sufijo "· n min" en salida anticipada con minutos', () => {
    render(<StatusBadge domain="assignment" status="early_leave" minutes={7} />)

    expect(screen.getByText('Salida anticipada · 7 min')).toBeInTheDocument()
  })

  it('sin minutos no agrega el sufijo', () => {
    render(<StatusBadge domain="assignment" status="delay_notified" />)

    expect(screen.getByText('Demora avisada')).toBeInTheDocument()
  })
})
