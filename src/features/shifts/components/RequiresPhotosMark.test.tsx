import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RequiresPhotosMark } from './RequiresPhotosMark'

describe('RequiresPhotosMark', () => {
  it('se anuncia como «Pide fotos» y tiene tooltip', () => {
    render(<RequiresPhotosMark />)
    const mark = screen.getByRole('img', { name: 'Pide fotos' })
    expect(mark).toHaveAttribute('title', 'Pide fotos')
  })
})
