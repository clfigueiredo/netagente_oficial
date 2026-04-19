import axios from 'axios'
import { useAuthStore } from '../store/authStore'

const api = axios.create({
    baseURL: '/api',
    timeout: 30_000,
})

// Inject JWT + tenant slug on every request
api.interceptors.request.use((config) => {
    const { token, tenantSlug } = useAuthStore.getState()
    if (token) config.headers.Authorization = `Bearer ${token}`
    if (tenantSlug) config.headers['X-Tenant-Slug'] = tenantSlug
    return config
})

// Handle 401 globally — clear auth and redirect to login
api.interceptors.response.use(
    (res) => res,
    (err) => {
        if (err.response?.status === 401) {
            useAuthStore.getState().logout()
            window.location.href = '/login'
        }
        return Promise.reject(err)
    }
)

export default api
