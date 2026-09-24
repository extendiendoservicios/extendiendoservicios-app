/**
 * Lógica pura del recorte y la redimensión de una foto de perfil
 * (EMP-011, `AvatarUpload.tsx`): validación del archivo elegido, geometría
 * del recorte cuadrado interactivo (arrastrar + zoom) y el paso final a un
 * `Blob` JPEG de 512×512 listo para subir al bucket `avatars`
 * (`0014_storage_buckets.sql`: `{profile_id}/{uuid}.jpg`, máximo 2 MB,
 * `allowed_mime_types = ['image/jpeg']`).
 *
 * Sin librería de recorte (`react-easy-crop` y similares no están en la
 * lista de dependencias aprobadas de `03_Plan_Maestro_Tecnico.md` sección
 * 2): el recorte se resuelve con un `<canvas>` propio, unas pocas
 * funciones de geometría 2D y eventos de puntero en `AvatarUpload.tsx`.
 * Separado de ese archivo para poder probar la geometría y la validación
 * sin montar el diálogo ni simular un `<canvas>` completo.
 */

/** Tipos de imagen que se pueden elegir como origen (`07` fila FileUpload/AvatarUpload). */
export const AVATAR_ACCEPTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

/**
 * Límite del archivo ORIGEN, antes de recortar/redimensionar (15 MB: cubre
 * una foto de celular sin procesar, con margen). No confundir con el
 * límite de 2 MB del bucket `avatars`, que aplica al JPEG YA procesado por
 * `cropAndResizeToBlob` — un cuadrado de 512×512 a esta calidad pesa muy
 * por debajo de eso, así que en la práctica nunca se llega a chocar con el
 * límite del servidor.
 */
export const AVATAR_MAX_SOURCE_BYTES = 15 * 1024 * 1024

/** Lado del cuadrado final, en píxeles (04 sección 7.3: "redimensionado a 512 px"). */
export const AVATAR_OUTPUT_SIZE = 512

/** Calidad del JPEG final (0 a 1): visualmente sólida y liviana para un avatar. */
export const AVATAR_OUTPUT_QUALITY = 0.85

/** Lado del recuadro de recorte que se ve en el diálogo (CSS px, `AvatarUpload.tsx`). */
export const AVATAR_CROP_VIEWPORT_PX = 260

/** Zoom mínimo (1 = todo el lado corto de la imagen entra en el recuadro) y máximo. */
export const AVATAR_MIN_ZOOM = 1
export const AVATAR_MAX_ZOOM = 3

/** Recorte cuadrado, en coordenadas de píxeles de la imagen ORIGINAL (no las del recuadro en pantalla). */
export interface AvatarCropRect {
  x: number
  y: number
  size: number
}

/**
 * `null` si el archivo pasa las validaciones; si no, el mensaje de error en
 * español para mostrar tal cual (nunca el mensaje del navegador/Storage).
 */
export function validateAvatarSourceFile(file: File): string | null {
  if (!(AVATAR_ACCEPTED_MIME_TYPES as readonly string[]).includes(file.type)) {
    return 'La foto tiene que ser un archivo JPG, PNG o WEBP.'
  }
  if (file.size > AVATAR_MAX_SOURCE_BYTES) {
    return 'La foto pesa demasiado. Elegí una de hasta 15 MB.'
  }
  return null
}

/** Carga un `File` como `HTMLImageElement` (para dibujarlo después en un `<canvas>`). */
export function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('No pudimos leer esa imagen. Probá con otro archivo.'))
    }
    image.src = objectUrl
  })
}

/**
 * Escala (px de pantalla por px de la imagen original) para que, con este
 * `zoom`, el lado corto de la imagen ocupe exactamente `viewportPx` a
 * `zoom` 1, y una porción más chica (más zoom) a `zoom` mayor.
 */
export function computeAvatarDisplayScale(
  naturalWidth: number,
  naturalHeight: number,
  viewportPx: number,
  zoom: number,
): number {
  const shortSide = Math.min(naturalWidth, naturalHeight)
  if (shortSide <= 0) return 0
  return (viewportPx / shortSide) * zoom
}

/**
 * Recorta un desplazamiento (posición del borde superior/izquierdo de la
 * imagen mostrada, en px de pantalla, relativo al recuadro) para que la
 * imagen siga cubriendo todo el recuadro sin dejar huecos.
 */
export function clampAvatarOffset(
  offset: number,
  displaySize: number,
  viewportPx: number,
): number {
  const min = Math.min(0, viewportPx - displaySize)
  return Math.min(0, Math.max(min, offset))
}

/**
 * Convierte la posición de arrastre/zoom en pantalla (desplazamiento del
 * borde de la imagen + escala) al recorte cuadrado en píxeles de la
 * imagen ORIGINAL, que es lo que necesita `cropAndResizeToBlob`.
 */
export function avatarOffsetToCropRect(params: {
  offsetX: number
  offsetY: number
  displayScale: number
  viewportPx: number
}): AvatarCropRect {
  const { offsetX, offsetY, displayScale, viewportPx } = params
  return {
    x: -offsetX / displayScale,
    y: -offsetY / displayScale,
    size: viewportPx / displayScale,
  }
}

/**
 * Dibuja el recorte de `image` sobre un `<canvas>` de `outputSize` ×
 * `outputSize` y lo exporta como `Blob` JPEG (`AVATAR_OUTPUT_QUALITY`) —
 * este es el archivo que se sube al bucket `avatars`.
 */
export function cropAndResizeToBlob(
  image: CanvasImageSource,
  crop: AvatarCropRect,
  outputSize: number = AVATAR_OUTPUT_SIZE,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = outputSize
  canvas.height = outputSize
  const context = canvas.getContext('2d')
  if (!context) {
    return Promise.reject(
      new Error('Este navegador no puede procesar la imagen.'),
    )
  }
  context.drawImage(
    image,
    crop.x,
    crop.y,
    crop.size,
    crop.size,
    0,
    0,
    outputSize,
    outputSize,
  )
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob)
        } else {
          reject(
            new Error(
              'No pudimos preparar la imagen para subir. Probá de nuevo.',
            ),
          )
        }
      },
      'image/jpeg',
      AVATAR_OUTPUT_QUALITY,
    )
  })
}

/** Ruta nueva en el bucket `avatars` para este perfil (`{profile_id}/{uuid}.jpg`, 04 sección 7.3). */
export function avatarStoragePath(profileId: string): string {
  return `${profileId}/${crypto.randomUUID()}.jpg`
}
