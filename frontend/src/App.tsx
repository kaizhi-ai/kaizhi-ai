import { Navigate, Route, Routes } from "react-router-dom"

import { Toaster } from "@/components/ui/sonner"
import RequireAdmin from "@/components/require-admin"
import RequireAuth from "@/components/require-auth"
import AdminPage from "@/pages/admin"
import AdminAPIKeyProviderPage from "@/pages/admin-api-key-provider"
import AdminModelPricesPage from "@/pages/admin-model-prices"
import AdminOAuthProvidersPage from "@/pages/admin-oauth-providers"
import AdminOpenAICompatibilityProviderPage from "@/pages/admin-openai-compatibility-provider"
import AdminUsagePage from "@/pages/admin-usage"
import AdminUsersPage from "@/pages/admin-users"
import ChatPage from "@/pages/chat"
import LoginPage from "@/pages/login"
import SettingsPage from "@/pages/settings"
import SettingsAPIKeysPage from "@/pages/settings-api-keys"
import SettingsGeneralPage from "@/pages/settings-general"
import SettingsUsagePage from "@/pages/settings-usage"

function App() {
  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/chat/:id" element={<ChatPage />} />
          <Route path="/settings" element={<SettingsPage />}>
            <Route path="general" element={<SettingsGeneralPage />} />
            <Route path="usage" element={<SettingsUsagePage />} />
            <Route path="api-keys" element={<SettingsAPIKeysPage />} />
          </Route>
          <Route element={<RequireAdmin />}>
            <Route path="/admin" element={<AdminPage />}>
              <Route path="usage" element={<AdminUsagePage />} />
              <Route path="users" element={<AdminUsersPage />} />
              <Route
                path="api-key-provider"
                element={<AdminAPIKeyProviderPage />}
              />
              <Route
                path="openai-compatibility-provider"
                element={<AdminOpenAICompatibilityProviderPage />}
              />
              <Route path="model-prices" element={<AdminModelPricesPage />} />
              <Route
                path="oauth-providers"
                element={<AdminOAuthProvidersPage />}
              />
            </Route>
          </Route>
        </Route>
      </Routes>
      <Toaster />
    </>
  )
}

export default App
