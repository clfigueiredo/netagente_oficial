import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useAuthStore = create(
    persist(
        (set) => ({
            token: null,
            user: null,
            tenantSlug: null,

            login: (token, user, tenantSlug) => set({ token, user, tenantSlug }),
            logout: () => set({ token: null, user: null, tenantSlug: null }),
            updateUser: (user) => set({ user }),
        }),
        {
            name: 'netagent-auth',
            partialize: (state) => ({ token: state.token, user: state.user, tenantSlug: state.tenantSlug }),
        }
    )
)
