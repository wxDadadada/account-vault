import { useState } from 'react'

// Only display choices live here. Account names, filters and secrets stay in the encrypted vault.
export function useDisplayPreference<T extends string>(
  key: string,
  choices: readonly T[],
  fallback: T
) {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(`keyfolio-${key}`)
      return choices.includes(stored as T) ? (stored as T) : fallback
    } catch {
      return fallback
    }
  })
  return [
    value,
    (next: T) => {
      setValue(next)
      try {
        localStorage.setItem(`keyfolio-${key}`, next)
      } catch {
        /* private browsing */
      }
    },
  ] as const
}
