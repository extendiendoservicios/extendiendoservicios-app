import { useEffect, useRef, useState } from 'react'
import { useSearchParamState } from '@/hooks/useSearchParamState'

/**
 * OH-03: texto de un buscador que también vive en la dirección (`?q=limpieza`).
 *
 * El campo responde de inmediato con un estado local y la dirección se
 * actualiza con antirrebote (como en Usuarios, DEF-P29-01), así no se pierden
 * letras ni se apila una entrada del historial por tecla. Si la dirección
 * cambia desde afuera (atrás o adelante del navegador), el campo la sigue.
 * Devuelve `[texto, setTexto]`; el texto es el del campo, sin antirrebote.
 */
export function useUrlSearchText(
  key = 'q',
  delayMs = 300,
): [string, (next: string) => void] {
  const [urlText, setUrlText] = useSearchParamState(key, '')
  const [text, setText] = useState(urlText)
  // Último valor que escribió este hook: distingue un cambio externo de la
  // dirección (atrás/adelante) del eco de la propia escritura.
  const lastWritten = useRef(urlText)

  useEffect(() => {
    if (urlText !== lastWritten.current) {
      lastWritten.current = urlText
      setText(urlText)
    }
  }, [urlText])

  // El setter de `useSearchParamState` cambia en cada render: se lo guarda en
  // una referencia para no reiniciar el antirrebote.
  const setUrlTextRef = useRef(setUrlText)
  useEffect(() => {
    setUrlTextRef.current = setUrlText
  })

  useEffect(() => {
    if (text === lastWritten.current) {
      return
    }
    const timeoutId = setTimeout(() => {
      lastWritten.current = text
      setUrlTextRef.current(text)
    }, delayMs)
    return () => clearTimeout(timeoutId)
  }, [text, delayMs])

  return [text, setText]
}
