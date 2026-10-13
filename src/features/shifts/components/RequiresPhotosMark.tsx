import { Camera } from 'lucide-react'

/**
 * Módulo H: marca discreta «Pide fotos» para filas y encabezados de turno
 * (ADM-03, ADM-05). Solo ícono con texto accesible y tooltip nativo.
 */
function RequiresPhotosMark() {
  return (
    <span
      role="img"
      aria-label="Pide fotos"
      title="Pide fotos"
      className="ml-1.5 inline-flex align-middle text-text-3"
    >
      <Camera aria-hidden="true" className="size-3.5" />
    </span>
  )
}

export { RequiresPhotosMark }
