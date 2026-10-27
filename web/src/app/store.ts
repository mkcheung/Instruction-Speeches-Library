import { createAppStore } from '@/app/createAppStore'
import { installAuthSessionBrowserListeners } from '@/features/auth/authSessionBrowser'

export const store = createAppStore()

if (typeof window !== 'undefined') installAuthSessionBrowserListeners(store)

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
