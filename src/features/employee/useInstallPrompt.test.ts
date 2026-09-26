import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useInstallPrompt } from './useInstallPrompt'
import {
  resetInstallPromptForTests,
  startInstallPromptCapture,
} from '@/lib/installPrompt'

function makeBeforeInstallPromptEvent() {
  const event = new Event('beforeinstallprompt', {
    cancelable: true,
  }) as Event & {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
  }
  event.prompt = vi.fn().mockResolvedValue(undefined)
  event.userChoice = Promise.resolve({ outcome: 'accepted' as const })
  return event
}

describe('useInstallPrompt', () => {
  beforeEach(() => {
    startInstallPromptCapture()
  })
  afterEach(() => {
    resetInstallPromptForTests()
  })

  it('ve el aviso aunque haya llegado antes de montar el componente', () => {
    act(() => {
      window.dispatchEvent(makeBeforeInstallPromptEvent())
    })
    const { result } = renderHook(() => useInstallPrompt())
    expect(result.current.available).toBe(true)
  })

  it('empieza sin disponibilidad, hasta que el navegador dispara beforeinstallprompt', () => {
    const { result } = renderHook(() => useInstallPrompt())
    expect(result.current.available).toBe(false)

    act(() => {
      window.dispatchEvent(makeBeforeInstallPromptEvent())
    })

    expect(result.current.available).toBe(true)
  })

  it('promptInstall llama al evento capturado y después vuelve a available=false', async () => {
    const { result } = renderHook(() => useInstallPrompt())
    const event = makeBeforeInstallPromptEvent()

    act(() => {
      window.dispatchEvent(event)
    })
    expect(result.current.available).toBe(true)

    await act(async () => {
      await result.current.promptInstall()
    })

    expect(event.prompt).toHaveBeenCalledTimes(1)
    expect(result.current.available).toBe(false)
  })

  it('vuelve a available=false cuando el navegador dispara appinstalled', () => {
    const { result } = renderHook(() => useInstallPrompt())

    act(() => {
      window.dispatchEvent(makeBeforeInstallPromptEvent())
    })
    expect(result.current.available).toBe(true)

    act(() => {
      window.dispatchEvent(new Event('appinstalled'))
    })

    expect(result.current.available).toBe(false)
  })
})
