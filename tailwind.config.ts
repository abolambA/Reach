import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        paper: {
          DEFAULT: '#F4EEE3',
          50: '#FBF7F0',
          100: '#F4EEE3',
          200: '#ECE3D2',
          300: '#E2D6BF',
        },
        ink: {
          DEFAULT: '#1C1E26',
          50: '#9CA3AF',
          100: '#6B7280',
          200: '#3A3F4B',
          300: '#1C1E26',
        },
        accent: '#B85450',
        gold: '#B58339',
        success: '#5C7D4F',
      },
      fontFamily: {
        serif: ['Fraunces', 'Georgia', 'serif'],
        sans: ['Geist', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
