import { useSearchParams } from 'react-router'

/**
 * OH-03: varios textos de pantalla en la dirección, que se cambian juntos en
 * una sola navegación (un período «desde/hasta», un cliente y su sede).
 *
 * Con dos llamadas seguidas a `useSearchParamState` la segunda parte de la
 * dirección vieja y pisa a la primera; acá `update(patch)` aplica todos los
 * cambios sobre la dirección vigente y con `replace`. Los parámetros que
 * valen lo mismo que su valor por defecto se quitan de la dirección, y los
 * demás parámetros se conservan.
 */
export function useSearchParamsPatch<K extends string>(
  defaults: Record<K, string>,
): [Record<K, string>, (patch: Partial<Record<K, string>>) => void] {
  const [searchParams, setSearchParams] = useSearchParams()

  const values = {} as Record<K, string>
  for (const key of Object.keys(defaults) as K[]) {
    values[key] = searchParams.get(key) ?? defaults[key]
  }

  function update(patch: Partial<Record<K, string>>) {
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous)
        for (const key of Object.keys(patch) as K[]) {
          const value = patch[key]
          if (value === undefined || value === defaults[key]) {
            params.delete(key)
          } else {
            params.set(key, value)
          }
        }
        return params
      },
      { replace: true },
    )
  }

  return [values, update]
}
