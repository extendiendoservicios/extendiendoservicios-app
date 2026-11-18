import { useState } from 'react'

/**
 * Bandera booleana recordada en el navegador (por ejemplo «panel oculto»).
 * Si el almacenamiento no está disponible, funciona igual sin recordarla.
 */
export function useLocalStorageFlag(
  key: string,
): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(key) === '1'
    } catch {
      return false
    }
  })
  function update(next: boolean) {
    setValue(next)
    try {
      if (next) {
        window.localStorage.setItem(key, '1')
      } else {
        window.localStorage.removeItem(key)
      }
    } catch {
      // Sin almacenamiento: queda solo para esta visita.
    }
  }
  return [value, update]
}
