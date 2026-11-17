import type { Config } from 'tailwindcss';
const config: Config = { content: ['./src/**/*.{ts,tsx}'], theme: { extend: { colors: { ink: '#0d0b12', panel: '#17131e', muted: '#9791a2', pink: '#ff3f9b', violet: '#a47bff' }, boxShadow: { glow: '0 0 36px rgba(255,63,155,.18)' } } }, plugins: [] };
export default config;
