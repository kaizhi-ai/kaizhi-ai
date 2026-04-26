import { Route, Routes } from "react-router-dom"

import RequireAdmin from "@/components/require-admin"
import RequireAuth from "@/components/require-auth"
import AdminPage from "@/pages/admin"
import AdminAPIKeyProviderPage from "@/pages/admin-api-key-provider"
import AdminOAuthProvidersPage from "@/pages/admin-oauth-providers"
import AdminOpenAICompatibilityProviderPage from "@/pages/admin-openai-compatibility-provider"
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
        <Route element={<RequireAdmin />}>
          <Route path="/admin" element={<AdminPage />}>
            <Route
              path="api-key-provider"
              element={<AdminAPIKeyProviderPage />}
            />
            <Route
              path="openai-compatibility-provider"
              element={<AdminOpenAICompatibilityProviderPage />}
            />
            <Route
              path="oauth-providers"
              element={<AdminOAuthProvidersPage />}
            />
          </Route>
        </Route>
      </Route>
    </Routes>
  )
}

export default App
