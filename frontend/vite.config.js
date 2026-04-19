import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
    plugins: [react()],
    server: {
        port: 3000,
        proxy: {
            '/api': {
                target: 'http://localhost:4000',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api/, '')
            },
            '/socket.io': {
                target: 'http://localhost:4000',
                ws: true,
                changeOrigin: true
            }
        }
    },
    build: {
        outDir: 'dist',
        rollupOptions: {
            output: {
                manualChunks: {
                    'react-vendor': ['react', 'react-dom', 'react-router-dom'],
                    'ui-vendor': ['recharts', 'lucide-react'],
                    'state-vendor': ['zustand', '@tanstack/react-query']
                }
            }
        }
    }
})
