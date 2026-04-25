import { useState } from 'react'
import { Button } from '@/components/ui/button'

function App() {
  const [count, setCount] = useState(0)

  return (
    <main className="min-h-svh flex flex-col items-center justify-center gap-6 bg-background text-foreground">
      <h1 className="text-4xl font-semibold tracking-tight">kaizhi2 frontend</h1>
      <p className="text-muted-foreground">React + Vite + Tailwind v4 + shadcn/ui</p>
      <Button onClick={() => setCount((c) => c + 1)}>Count is {count}</Button>
    </main>
  )
}

export default App
