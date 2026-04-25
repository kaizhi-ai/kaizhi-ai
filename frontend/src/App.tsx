import { Route, Routes } from "react-router-dom"

import RequireAuth from "@/components/require-auth"
import HomePage from "@/pages/home"
import LoginPage from "@/pages/login"

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<HomePage />} />
      </Route>
    </Routes>
  )
}

export default App
