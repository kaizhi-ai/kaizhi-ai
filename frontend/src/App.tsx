import { Route, Routes } from "react-router-dom"

import RequireAuth from "@/components/require-auth"
import ChatPage from "@/pages/chat"
import HomePage from "@/pages/home"
import LoginPage from "@/pages/login"
import SettingsPage from "@/pages/settings"
import SettingsAPIKeysPage from "@/pages/settings-api-keys"

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/chat/:id" element={<ChatPage />} />
        <Route path="/settings" element={<SettingsPage />}>
          <Route path="api-keys" element={<SettingsAPIKeysPage />} />
        </Route>
      </Route>
    </Routes>
  )
}

export default App
