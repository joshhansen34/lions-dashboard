import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/attendance/members': 'http://localhost:8765',
    },
  },
  base: '/attendance/',
})
