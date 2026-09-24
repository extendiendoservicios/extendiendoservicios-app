import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Coordinates } from './coordinates'
import { useCoordinateFields } from './useCoordinateFields'

/** Envoltorio para poder controlar `value` desde afuera, como haría react-hook-form. */
function setup(initial: Coordinates | null) {
  const onChange = vi.fn()
  const { result, rerender } = renderHook(
    ({ value }) => useCoordinateFields(value, onChange),
    { initialProps: { value: initial } },
  )
  return { result, rerender, onChange }
}

describe('useCoordinateFields', () => {
  it('arranca con los campos vacíos cuando el valor es null', () => {
    const { result } = setup(null)
    expect(result.current.latText).toBe('')
    expect(result.current.lngText).toBe('')
  })

  it('arranca con los campos formateados cuando hay un valor', () => {
    const { result } = setup({ lat: -34.6037, lng: -58.3816 })
    expect(result.current.latText).toBe('-34.603700')
    expect(result.current.lngText).toBe('-58.381600')
  })

  it('llama a onChange con el valor numérico cuando los dos campos son válidos', () => {
    const { result, onChange } = setup(null)

    act(() => result.current.handleLatChange('-34.6'))
    expect(onChange).not.toHaveBeenCalled() // falta la longitud todavía

    act(() => result.current.handleLngChange('-58.4'))
    expect(onChange).toHaveBeenLastCalledWith({ lat: -34.6, lng: -58.4 })
  })

  it('no llama a onChange con un valor fuera de rango, y muestra el error', () => {
    const { result, onChange } = setup(null)

    act(() => result.current.handleLatChange('120'))
    act(() => result.current.handleLngChange('-58.4'))

    expect(onChange).not.toHaveBeenCalled()
    expect(result.current.latError).toMatch(/-90 y 90/)
    expect(result.current.lngError).toBeUndefined()
  })

  it('no llama a onChange con texto no numérico, y muestra el error', () => {
    const { result, onChange } = setup(null)

    act(() => result.current.handleLatChange('abc'))
    act(() => result.current.handleLngChange('-58.4'))

    expect(onChange).not.toHaveBeenCalled()
    expect(result.current.latError).toBeTruthy()
  })

  it('llama a onChange(null) cuando se borran los dos campos', () => {
    const { result, onChange } = setup({ lat: -34.6, lng: -58.4 })

    act(() => result.current.handleLatChange(''))
    act(() => result.current.handleLngChange(''))

    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('clear() borra los dos campos y llama a onChange(null)', () => {
    const { result, onChange } = setup({ lat: -34.6, lng: -58.4 })

    act(() => result.current.clear())

    expect(result.current.latText).toBe('')
    expect(result.current.lngText).toBe('')
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('setCoordinates() pisa los dos campos a la vez (clic o arrastre en el mapa)', () => {
    const { result, onChange } = setup(null)

    act(() => result.current.setCoordinates({ lat: -33.5, lng: -70.6 }))

    expect(result.current.latText).toBe('-33.500000')
    expect(result.current.lngText).toBe('-70.600000')
    expect(onChange).toHaveBeenLastCalledWith({ lat: -33.5, lng: -70.6 })
  })

  it('sincroniza los campos cuando el valor cambia desde afuera', () => {
    const { result, rerender } = setup({ lat: -34.6, lng: -58.4 })

    rerender({ value: { lat: -31.4, lng: -64.2 } })

    expect(result.current.latText).toBe('-31.400000')
    expect(result.current.lngText).toBe('-64.200000')
  })

  it('un reset externo a null vacía los campos', () => {
    const { result, rerender } = setup({ lat: -34.6, lng: -58.4 })

    rerender({ value: null })

    expect(result.current.latText).toBe('')
    expect(result.current.lngText).toBe('')
  })
})
