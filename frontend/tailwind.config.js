/** @type {import('tailwindcss').Config} */
export default {
    content: ['./index.html', './src/**/*.{js,jsx}'],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                bg: {
                    base: '#0A0A0F',
                    surface: '#111117',
                    elevated: '#18181F',
                    overlay: '#1E1E2E',
                },
                primary: {
                    DEFAULT: '#3B82F6',
                    hover: '#2563EB',
                    muted: '#1E3A5F',
                },
                accent: {
                    DEFAULT: '#F97316',
                    hover: '#EA6C0B',
                },
                border: { DEFAULT: '#1E1E2E', subtle: '#2A2A3E' },
                text: { DEFAULT: '#E2E8F0', muted: '#64748B', dim: '#94A3B8' },
                success: '#22C55E',
                warning: '#F59E0B',
                danger: '#EF4444',
                info: '#38BDF8',
            },
            fontFamily: {
                mono: ['"Fira Code"', 'monospace'],
                sans: ['"Fira Sans"', 'sans-serif'],
            },
            animation: {
                'fade-in': 'fadeIn 0.2s ease-out',
                'slide-up': 'slideUp 0.25s ease-out',
                'pulse-slow': 'pulse 3s infinite',
            },
            keyframes: {
                fadeIn: { from: { opacity: 0 }, to: { opacity: 1 } },
                slideUp: { from: { opacity: 0, transform: 'translateY(8px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
            },
        },
    },
    plugins: [],
}
