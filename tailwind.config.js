/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html"
  ],
  theme: {
    extend: {
      colors: {
        // v8.0: Akzentfarbe über CSS-Variablen (hell: #0f6cbd, dunkel: #479ef5)
        accent: 'rgb(var(--cm-accent-rgb) / <alpha-value>)',
        accentbg: 'rgb(var(--cm-accent-bg-rgb) / <alpha-value>)',
        accentbghover: 'rgb(var(--cm-accent-bg-hover-rgb) / <alpha-value>)',
        // v8.0: Neutrale Office-Palette (Hell/Dunkel) für das Outlook-artige Layout
        ms: {
          50: '#faf9f8',
          100: '#f3f2f1',
          150: '#edebe9',
          200: '#e1dfdd',
          300: '#d1d1d1',
          400: '#a19f9d',
          500: '#616161',
          600: '#424242',
          650: '#383838',
          700: '#292929',
          750: '#242424',
          800: '#1f1f1f',
          900: '#141414',
          text: '#242424',
          blue: '#0f6cbd',
          'blue-dark': '#115ea3',
          'blue-light': '#479ef5',
          'blue-lighter': '#96c6fa',
          tint: '#e3eefa',
          'tint-dark': '#2c3d55',
          red: '#c50f1f',
          'red-light': '#f1707b'
        },
        dark: {
          950: '#050505',
          900: '#0a0a0a',
          800: '#121212',
          700: '#1a1a1a',
          600: '#2a2a2a',
          500: '#3a3a3a',
          400: '#4a4a4a',
          300: '#5a5a5a'
        },
        cyan: {
          400: '#22d3ee',
          500: '#06b6d4',
          600: '#0891b2'
        },
        neon: {
          pink: '#ff00ff',
          cyan: '#00ffff',
          yellow: '#ffff00',
          green: '#00ff00'
        },
        // Lollipop Theme Farben (v2.7.0)
        lollipop: {
          bg: '#FFF0F7',
          surface: '#FFFFFF',
          surface2: '#FFF5FB',
          border: '#FFB3D9',
          pink: '#FF4D8B',
          'pink-light': '#FF80B0',
          'pink-dark': '#E0005A',
          purple: '#BD4CFF',
          'purple-light': '#D480FF',
          'purple-dark': '#9400E6',
          yellow: '#FFD60A',
          'yellow-light': '#FFE566',
          green: '#00CC88',
          'green-light': '#00E5A0',
          orange: '#FF7F50',
          'orange-light': '#FFA080',
          blue: '#4DAFFF',
          'blue-light': '#80C8FF',
          teal: '#00D4C8',
          text: '#2D1B3D',
          'text-secondary': '#7B5A8A'
        },
        // Nerd Theme Farben (VS Code Dark+)
        nerd: {
          950: '#141414',
          900: '#1e1e1e',
          800: '#252526',
          700: '#2d2d2d',
          600: '#3c3c3c',
          500: '#454545',
          blue: '#569cd6',
          'blue-light': '#9cdcfe',
          'blue-accent': '#007acc',
          yellow: '#dcdcaa',
          teal: '#4ec9b0',
          text: '#d4d4d4',
          'text-dim': '#858585'
        },
        // Indie Theme Farben
        indie: {
          950: '#1a1210',
          900: '#2a1f1a',
          800: '#3a2d26',
          700: '#4a3d34',
          600: '#5c4d42',
          rose: '#c4837a',
          'rose-light': '#d9a09a',
          'rose-dark': '#a35f56',
          amber: '#c4953a',
          'amber-light': '#d4a84d',
          sage: '#7a9e7e',
          cream: '#f0e6d8',
          'cream-dark': '#d4c4b0'
        },
        // Foundations Design-System Farben
        foundations: {
          // Hintergrundfarben (dunkel)
          950: '#0f0f0f',
          900: '#1a1a1a',
          800: '#242424',
          700: '#2e2e2e',
          600: '#3a3a3a',
          500: '#4a4a4a',
          // Primäre Akzentfarbe: Orange
          orange: '#d97706',
          'orange-light': '#f59e0b',
          'orange-dark': '#b45309',
          // Sekundäre Akzentfarbe: Grün
          green: '#10b981',
          'green-light': '#34d399',
          'green-dark': '#059669'
        }
      },
      // Foundations Border-Radius
      borderRadius: {
        'foundations-sm': '4px',
        'foundations-md': '8px',
        'foundations-lg': '12px',
        'foundations-full': '999px'
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'monospace'],
        retro: ['VT323', 'Press Start 2P', 'monospace']
      },
      transitionTimingFunction: {
        'spring':   'cubic-bezier(0.34, 1.56, 0.64, 1)',
        'smooth':   'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'ios':      'cubic-bezier(0.42, 0, 0.58, 1)',
      },
      transitionDuration: {
        '80':  '80ms',
        '120': '120ms',
        '180': '180ms',
        '250': '250ms',
      },
      animation: {
        'pulse-cyan':  'pulseCyan 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'glow':        'glow 2s ease-in-out infinite alternate',
        'neon-flicker':'neonFlicker 1.5s ease-in-out infinite alternate',
        'scanline':    'scanline 8s linear infinite',
        'float':       'float 3s ease-in-out infinite',
        'shimmer':     'shimmer 1.4s ease-in-out infinite',
        'fade-up':     'fadeUp 280ms cubic-bezier(0.16,1,0.3,1) both',
        'scale-in':    'scaleIn 200ms cubic-bezier(0.34,1.56,0.64,1) both',
        'fade-in':     'fadeIn 180ms ease-out both',
      },
      keyframes: {
        pulseCyan: {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.5 }
        },
        glow: {
          '0%': { boxShadow: '0 0 5px currentColor, 0 0 10px currentColor' },
          '100%': { boxShadow: '0 0 10px currentColor, 0 0 20px currentColor, 0 0 30px currentColor' }
        },
        neonFlicker: {
          '0%, 19%, 21%, 23%, 25%, 54%, 56%, 100%': {
            textShadow: '0 0 4px #fff, 0 0 11px #fff, 0 0 19px #fff, 0 0 40px #0ff, 0 0 80px #0ff'
          },
          '20%, 24%, 55%': {
            textShadow: 'none'
          }
        },
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' }
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%':      { transform: 'translateY(-10px)' }
        },
        shimmer: {
          '0%':   { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition:  '400px 0' }
        },
        fadeUp: {
          from: { opacity: '0', transform: 'translateY(8px) scale(0.98)' },
          to:   { opacity: '1', transform: 'translateY(0) scale(1)' }
        },
        scaleIn: {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to:   { opacity: '1', transform: 'scale(1)' }
        },
        fadeIn: {
          from: { opacity: '0' },
          to:   { opacity: '1' }
        },
      },
      backdropBlur: {
        '3xl': '64px'
      },
      boxShadow: {
        'neon-pink': '0 0 5px #ff00ff, 0 0 10px #ff00ff, 0 0 20px #ff00ff',
        'neon-cyan': '0 0 5px #00ffff, 0 0 10px #00ffff, 0 0 20px #00ffff',
        'neon-yellow': '0 0 5px #ffff00, 0 0 10px #ffff00, 0 0 20px #ffff00',
        'glass': '0 8px 32px 0 rgba(31, 38, 135, 0.37)',
        'inner-light': 'inset 0 1px 0 0 rgba(255, 255, 255, 0.1)',
        // Foundations Design-System Schatten
        'foundations-raised': '0 2px 8px rgba(0, 0, 0, 0.4), 0 4px 16px rgba(0, 0, 0, 0.2)',
        'foundations-inset': 'inset 0 2px 4px rgba(0, 0, 0, 0.4)',
        'foundations-pressed': 'inset 0 1px 3px rgba(0, 0, 0, 0.6)',
        'foundations-subtle': '0 1px 2px rgba(0, 0, 0, 0.2)'
      },
      backgroundImage: {
        'grid-pattern': 'linear-gradient(rgba(0, 255, 255, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 255, 255, 0.1) 1px, transparent 1px)',
        'scanlines': 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 0, 0, 0.3) 2px, rgba(0, 0, 0, 0.3) 4px)',
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic': 'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))'
      },
      backgroundSize: {
        'grid': '40px 40px'
      }
    }
  },
  plugins: []
}
