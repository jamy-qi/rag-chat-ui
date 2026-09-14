import { useEffect, useState } from 'react'
import { Routes, Route } from 'react-router'
import { Toaster } from '@/components/ui/sonner'
import { THEME_CHANGED, loadTheme, type Theme } from '@/lib/theme'
import Home from './pages/Home'

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => loadTheme())

  useEffect(() => {
    const onThemeChanged = (e: Event) => setTheme((e as CustomEvent<Theme>).detail)
    window.addEventListener(THEME_CHANGED, onThemeChanged)
    return () => window.removeEventListener(THEME_CHANGED, onThemeChanged)
  }, [])

  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
      <Toaster position="top-center" richColors closeButton theme={theme} />
    </>
  )
}
