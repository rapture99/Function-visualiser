import { useEffect, useState } from 'react'
import { LAYERS, type Layer } from '../../schema/kinds.js'

export interface Palette {
  layer: Record<Layer, string>
  grid: string
  canvas: string
  text: string
  faint: string
  accent: string
  danger: string
  dark: boolean
}

/**
 * The scene reads its colours from the same CSS custom properties the rest of the app uses,
 * so the 3D view follows the light/dark theme automatically and there is exactly one place
 * a colour is defined.
 */
function read(): Palette {
  const style = getComputedStyle(document.documentElement)
  const value = (name: string, fallback: string) =>
    style.getPropertyValue(name).trim() || fallback

  const layer = {} as Record<Layer, string>
  const fallbacks: Record<Layer, string> = {
    actor: '#7c5cd6',
    interface: '#2f6fed',
    logic: '#c07a10',
    data: '#1f8a5c',
    external: '#6b7482',
  }
  for (const name of LAYERS) layer[name] = value(`--layer-${name}`, fallbacks[name])

  return {
    layer,
    grid: value('--grid', '#e9ecf1'),
    canvas: value('--canvas', '#fdfdfe'),
    text: value('--text', '#1b1f27'),
    faint: value('--text-faint', '#98a1b0'),
    accent: value('--accent', '#2f6fed'),
    danger: value('--danger', '#c8322b'),
    dark: matchMedia('(prefers-color-scheme: dark)').matches,
  }
}

export function usePalette(): Palette {
  const [palette, setPalette] = useState<Palette>(read)

  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setPalette(read())
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return palette
}
