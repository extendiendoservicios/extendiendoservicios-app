/**
 * Evidencia fotográfica (módulo H, P21.2): captura, compresión y descarga.
 *
 * `compressImage`, `compressVideo` y `downloadZip` cargan sus dependencias
 * pesadas (Mediabunny, fflate) en diferido: importar este índice no las suma
 * a la entrada. Aun así, desde pantallas conviene `await import('@/lib/media')`
 * al momento de usarlas.
 */

export * from './constants'
export * from './errors'
export * from './types'
export { compressImage, type CompressImageOptions } from './compressImage'
export {
  compressVideo,
  assertVideoDuration,
  type CompressVideoMode,
  type CompressVideoOptions,
  type CompressVideoProgress,
} from './compressVideo'
export {
  recordVideo,
  type RecordVideoOptions,
  type VideoRecorderSession,
} from './recordVideo'
export {
  pickRecorderFormat,
  isIosDevice,
  type RecorderFormat,
} from './mimeTypes'
export {
  assignFileNames,
  buildMediaFileName,
  downloadFile,
  downloadZip,
  sanitizeNamePart,
  saveBlob,
  type DownloadItem,
  type DownloadZipOptions,
} from './download'
