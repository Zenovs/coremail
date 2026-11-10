import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';

const ThemeContext = createContext();

// ─── v8.0: Design-Tokens ─────────────────────────────────────────────────────
//
// Jedes Theme liefert dieselben Schlüssel. Neue Schlüssel (v8) für die
// Outlook-artige Aufteilung:
//   rail      – schmale App-Leiste ganz links
//   pane      – Ordner-/Konten-Spalte
//   paneHover – Hover-Farbe für Zeilen in Rail und Ordner-Spalte
//   list      – Hintergrund der Mail-Liste
//   selected  – ausgewählte Zeile (Mail-Liste, Ordner)
//   unread    – Textfarbe für ungelesene Betreffzeilen
//   mode      – 'light' | 'dark' (steuert Scrollbars, Badges, Fokus-Ring)
//
// Themes, die einzelne Schlüssel nicht setzen, werden in normalizeTheme()
// aus den vorhandenen Werten ergänzt — so bleiben die Spezial-Themes
// (Glas, Retro, …) ohne Pflegeaufwand lauffähig.

export const themes = {
  light: {
    name: 'Hell',
    description: 'Aufgeräumt und hell im Outlook-Stil (Standard)',
    mode: 'light',
    colors: {
      bg: 'bg-white',
      bgSecondary: 'bg-ms-50',
      bgTertiary: 'bg-ms-100',
      popover: 'bg-white',
      border: 'border-ms-200',
      text: 'text-ms-text',
      textSecondary: 'text-ms-500',
      accent: 'text-ms-blue',
      accentBg: 'bg-ms-blue',
      accentHover: 'hover:bg-ms-blue-dark',
      sidebar: 'bg-ms-100',
      card: 'bg-white',
      input: 'bg-white border-ms-300 text-ms-text placeholder-ms-400',
      hover: 'hover:bg-ms-100',
      rail: 'bg-ms-100',
      pane: 'bg-ms-100',
      paneHover: 'hover:bg-ms-150',
      list: 'bg-white',
      selected: 'bg-ms-tint',
      unread: 'text-ms-blue'
    }
  },
  dark: {
    name: 'Dunkel',
    description: 'Ruhiges Dunkelgrau mit blauem Akzent',
    mode: 'dark',
    colors: {
      bg: 'bg-ms-700',
      bgSecondary: 'bg-ms-800',
      bgTertiary: 'bg-ms-650',
      popover: 'bg-ms-700',
      border: 'border-white/10',
      text: 'text-ms-100',
      textSecondary: 'text-ms-400',
      accent: 'text-ms-blue-light',
      accentBg: 'bg-ms-blue',
      accentHover: 'hover:bg-ms-blue-dark',
      sidebar: 'bg-ms-800',
      card: 'bg-ms-800',
      input: 'bg-ms-650 border-white/10 text-ms-100 placeholder-ms-400',
      hover: 'hover:bg-white/5',
      rail: 'bg-ms-800',
      pane: 'bg-ms-800',
      paneHover: 'hover:bg-white/5',
      list: 'bg-ms-700',
      selected: 'bg-ms-tint-dark',
      unread: 'text-ms-blue-light'
    }
  },
  minimal: {
    name: 'Minimal',
    description: 'Minimalistisch in Schwarz-Weiss',
    mode: 'light',
    colors: {
      bg: 'bg-white',
      bgSecondary: 'bg-gray-50',
      bgTertiary: 'bg-gray-100',
      popover: 'bg-white',
      border: 'border-gray-200',
      text: 'text-black',
      textSecondary: 'text-gray-500',
      accent: 'text-black',
      accentBg: 'bg-black',
      accentHover: 'hover:bg-gray-800',
      sidebar: 'bg-gray-50',
      card: 'bg-white',
      input: 'bg-white border-gray-200 text-black',
      hover: 'hover:bg-gray-100',
      rail: 'bg-gray-50',
      pane: 'bg-gray-50',
      paneHover: 'hover:bg-gray-200',
      list: 'bg-white',
      selected: 'bg-gray-200',
      unread: 'text-black'
    }
  },
  morphism: {
    name: 'Morphismus',
    description: 'Glasmorphismus mit weichen Schatten',
    mode: 'dark',
    colors: {
      bg: 'bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900',
      bgSecondary: 'bg-white/10 backdrop-blur-xl',
      bgTertiary: 'bg-white/5 backdrop-blur-lg',
      popover: 'bg-slate-900',
      border: 'border-white/20',
      text: 'text-white',
      textSecondary: 'text-purple-200',
      accent: 'text-cyan-300',
      accentBg: 'bg-gradient-to-r from-cyan-500 to-purple-600',
      accentHover: 'hover:from-cyan-400 hover:to-purple-500',
      sidebar: 'bg-white/10 backdrop-blur-xl',
      card: 'bg-white/10 backdrop-blur-xl shadow-xl shadow-purple-500/10',
      input: 'bg-white/10 backdrop-blur border-white/20 text-white placeholder-purple-200',
      hover: 'hover:bg-white/20',
      selected: 'bg-white/20'
    },
    customStyles: {
      cardShadow: 'shadow-xl shadow-purple-500/10',
      glowEffect: 'shadow-lg shadow-cyan-500/20',
      gradientText: 'bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-purple-400'
    }
  },
  glass: {
    name: 'Glas',
    description: 'Transparente Glaseffekte',
    mode: 'dark',
    colors: {
      bg: 'bg-gradient-to-br from-blue-950 via-slate-900 to-indigo-950',
      bgSecondary: 'bg-white/5 backdrop-blur-2xl',
      bgTertiary: 'bg-white/[0.03] backdrop-blur-xl',
      popover: 'bg-slate-900',
      border: 'border-white/10',
      text: 'text-white/90',
      textSecondary: 'text-blue-200/70',
      accent: 'text-sky-400',
      accentBg: 'bg-sky-500/80 backdrop-blur',
      accentHover: 'hover:bg-sky-400/90',
      sidebar: 'bg-white/[0.03] backdrop-blur-2xl',
      card: 'bg-white/[0.05] backdrop-blur-2xl border border-white/10',
      input: 'bg-white/5 backdrop-blur border-white/10 text-white placeholder-blue-200/50',
      hover: 'hover:bg-white/10',
      selected: 'bg-white/15'
    },
    customStyles: {
      glassSurface: 'bg-white/5 backdrop-blur-2xl border border-white/10 shadow-2xl',
      frostEffect: 'backdrop-blur-3xl bg-gradient-to-br from-white/10 to-white/5',
      innerGlow: 'shadow-inner shadow-white/5'
    }
  },
  retro: {
    name: 'Retro',
    description: '80er/90er Neon-Stil',
    mode: 'dark',
    colors: {
      bg: 'bg-gray-950',
      bgSecondary: 'bg-gray-900',
      bgTertiary: 'bg-gray-800',
      popover: 'bg-gray-900',
      border: 'border-pink-500/30',
      text: 'text-cyan-300',
      textSecondary: 'text-pink-300',
      accent: 'text-yellow-400',
      accentBg: 'bg-gradient-to-r from-pink-600 to-purple-600',
      accentHover: 'hover:from-pink-500 hover:to-purple-500',
      sidebar: 'bg-gray-900 border-r-2 border-cyan-500/30',
      card: 'bg-gray-900 border-2 border-pink-500/30 shadow-lg shadow-pink-500/20',
      input: 'bg-gray-800 border-2 border-cyan-500/40 text-cyan-300 placeholder-pink-300/50',
      hover: 'hover:bg-gray-800 hover:border-cyan-500/50',
      selected: 'bg-pink-500/20'
    },
    customStyles: {
      neonGlow: 'shadow-lg shadow-pink-500/50',
      neonText: 'text-shadow-neon',
      scanlines: 'bg-scanlines',
      gridPattern: 'bg-grid-pattern',
      borderNeon: 'border-2 border-cyan-500 shadow-lg shadow-cyan-500/50'
    }
  },
  lollipop: {
    name: 'Lollipop',
    description: 'Farbenfrohes Candy-Design mit bunten Akzenten',
    mode: 'light',
    colors: {
      bg: 'bg-lollipop-bg',
      bgSecondary: 'bg-white',
      bgTertiary: 'bg-lollipop-surface2',
      popover: 'bg-white',
      border: 'border-lollipop-border',
      text: 'text-lollipop-text',
      textSecondary: 'text-lollipop-text-secondary',
      accent: 'text-lollipop-pink',
      accentBg: 'bg-gradient-to-r from-lollipop-pink to-lollipop-purple',
      accentHover: 'hover:from-lollipop-pink-light hover:to-lollipop-purple-light',
      sidebar: 'lollipop-sidebar',
      card: 'bg-white border border-lollipop-border shadow-lollipop',
      input: 'bg-white border-lollipop-border text-lollipop-text placeholder-lollipop-text-secondary',
      hover: 'hover:bg-lollipop-pink/10',
      list: 'bg-white',
      selected: 'bg-lollipop-pink/15'
    },
    customStyles: {
      rainbowGradient: 'bg-gradient-to-r from-lollipop-pink via-lollipop-purple via-lollipop-blue to-lollipop-teal',
      candyText: 'lollipop-rainbow-text',
      glowPink: 'shadow-lollipop-pink',
      glowPurple: 'shadow-lollipop-purple'
    }
  },
  nerd: {
    name: 'Nerd',
    description: 'VS Code Dark+ Stil',
    mode: 'dark',
    colors: {
      bg: 'bg-nerd-900',
      bgSecondary: 'bg-nerd-800',
      bgTertiary: 'bg-nerd-700',
      popover: 'bg-nerd-800',
      border: 'border-nerd-600',
      text: 'text-nerd-text',
      textSecondary: 'text-nerd-text-dim',
      accent: 'text-nerd-blue',
      accentBg: 'bg-nerd-blue-accent',
      accentHover: 'hover:bg-nerd-blue/80',
      sidebar: 'bg-nerd-800 border-r border-nerd-600',
      card: 'bg-nerd-800 border border-nerd-600',
      input: 'bg-nerd-700 border-nerd-600 text-nerd-text placeholder-nerd-text-dim',
      hover: 'hover:bg-nerd-700',
      selected: 'bg-nerd-600'
    },
    customStyles: {
      keyword: 'text-nerd-blue',
      variable: 'text-nerd-blue-light',
      type: 'text-nerd-teal',
      symbol: 'text-nerd-yellow'
    }
  },
  colorful: {
    name: 'Colorful',
    description: 'Leuchtende Farben & Rainbow-Effekte',
    mode: 'dark',
    colors: {
      bg: 'bg-gray-950',
      bgSecondary: 'bg-gray-900',
      bgTertiary: 'bg-gray-800',
      popover: 'bg-gray-900',
      border: 'border-purple-500/40',
      text: 'text-white',
      textSecondary: 'text-gray-300',
      accent: 'text-yellow-400',
      accentBg: 'bg-gradient-to-r from-pink-500 via-yellow-400 to-cyan-500',
      accentHover: 'hover:from-pink-400 hover:via-yellow-300 hover:to-cyan-400',
      sidebar: 'bg-gray-900 border-r border-purple-500/30',
      card: 'bg-gray-900 border border-purple-500/30',
      input: 'bg-gray-800 border-purple-500/40 text-white placeholder-gray-400',
      hover: 'hover:bg-gray-800',
      selected: 'bg-purple-500/20'
    },
    customStyles: {
      rainbowGradient: 'bg-gradient-to-r from-pink-500 via-yellow-400 via-green-400 to-cyan-500',
      colorfulAccent: 'bg-gradient-to-r from-violet-500 via-pink-500 to-orange-400'
    }
  },
  indie: {
    name: 'Indie',
    description: 'Warme Erdtöne im Vintage-Stil',
    mode: 'dark',
    colors: {
      bg: 'bg-indie-950',
      bgSecondary: 'bg-indie-900',
      bgTertiary: 'bg-indie-800',
      popover: 'bg-indie-900',
      border: 'border-indie-600',
      text: 'text-indie-cream',
      textSecondary: 'text-indie-cream-dark',
      accent: 'text-indie-rose',
      accentBg: 'bg-indie-rose-dark',
      accentHover: 'hover:bg-indie-rose',
      sidebar: 'bg-indie-900 border-r border-indie-600',
      card: 'bg-indie-900 border border-indie-600',
      input: 'bg-indie-800 border-indie-600 text-indie-cream placeholder-indie-cream-dark',
      hover: 'hover:bg-indie-800',
      selected: 'bg-indie-700'
    },
    customStyles: {
      warmGlow: 'shadow-lg shadow-indie-rose/20',
      vintageAccent: 'text-indie-amber'
    }
  },
  foundations: {
    name: 'Foundations',
    description: 'Professionelles Design-System mit Orange & Grün',
    mode: 'dark',
    colors: {
      bg: 'bg-foundations-900',
      bgSecondary: 'bg-foundations-800',
      bgTertiary: 'bg-foundations-700',
      popover: 'bg-foundations-800',
      border: 'border-foundations-600',
      text: 'text-gray-100',
      textSecondary: 'text-gray-400',
      accent: 'text-foundations-orange',
      accentBg: 'bg-foundations-orange',
      accentHover: 'hover:bg-foundations-orange-light',
      sidebar: 'bg-foundations-800',
      card: 'bg-foundations-800 shadow-foundations-raised',
      input: 'bg-foundations-700 border-foundations-600 text-gray-100 placeholder-gray-500',
      hover: 'hover:bg-foundations-700',
      selected: 'bg-foundations-600'
    },
    customStyles: {
      surfaceBase: 'bg-foundations-800',
      surfaceRaised: 'bg-foundations-700 shadow-foundations-raised',
      surfaceInset: 'bg-foundations-900 shadow-foundations-inset',
      surfacePressed: 'bg-foundations-950 shadow-foundations-pressed',
      buttonPrimary: 'bg-foundations-orange text-white border-2 border-foundations-orange-dark hover:bg-foundations-orange-light rounded-foundations-full',
      buttonSecondary: 'bg-foundations-600 text-white border border-foundations-500 hover:bg-foundations-500 rounded-foundations-md',
      buttonSubtle: 'bg-transparent text-gray-300 border border-foundations-600 hover:bg-foundations-700 rounded-foundations-md',
      buttonSuccess: 'bg-foundations-green text-white border-2 border-foundations-green-dark hover:bg-foundations-green-light rounded-foundations-full',
      accentOrange: 'text-foundations-orange',
      accentGreen: 'text-foundations-green',
      shadowRaised: 'shadow-foundations-raised',
      shadowInset: 'shadow-foundations-inset',
      shadowPressed: 'shadow-foundations-pressed',
      radiusSm: 'rounded-foundations-sm',
      radiusMd: 'rounded-foundations-md',
      radiusLg: 'rounded-foundations-lg',
      radiusFull: 'rounded-foundations-full'
    }
  }
};

// v8.0: Standard-Theme ist «Hell». Wer in den Einstellungen bewusst ein
// anderes Theme gewählt hat (localStorage), behält es.
export const DEFAULT_THEME = 'light';

// Fehlende v8-Schlüssel aus den klassischen Tokens ableiten
function normalizeTheme(t) {
  const col = t.colors;
  return {
    ...t,
    mode: t.mode || 'dark',
    colors: {
      ...col,
      rail: col.rail || col.sidebar,
      pane: col.pane || col.sidebar,
      paneHover: col.paneHover || col.hover,
      list: col.list || col.bgSecondary,
      selected: col.selected || col.bgTertiary,
      unread: col.unread || col.accent
    }
  };
}
Object.keys(themes).forEach(k => { themes[k] = normalizeTheme(themes[k]); });

// ─── v8.0: «Lese-Blatt» ──────────────────────────────────────────────────────
// Der Mailinhalt (Vorschau + Vollansicht) liegt in jedem Theme auf einem
// weissen Blatt — so bleibt jede Mail so lesbar, wie der Absender sie gesetzt
// hat. Komponenten innerhalb des Blatts beziehen ihre Farben über <SheetTheme>.
export const SHEET_COLORS = {
  bg: 'bg-white',
  bgSecondary: 'bg-ms-50',
  bgTertiary: 'bg-ms-100',
  popover: 'bg-white',
  border: 'border-ms-200',
  text: 'text-ms-text',
  textSecondary: 'text-ms-500',
  accent: 'text-ms-blue',
  accentBg: 'bg-ms-blue',
  accentHover: 'hover:bg-ms-blue-dark',
  sidebar: 'bg-ms-100',
  card: 'bg-white',
  input: 'bg-white border-ms-300 text-ms-text placeholder-ms-400',
  hover: 'hover:bg-ms-100',
  rail: 'bg-ms-100',
  pane: 'bg-ms-100',
  paneHover: 'hover:bg-ms-150',
  list: 'bg-white',
  selected: 'bg-ms-tint',
  unread: 'text-ms-blue'
};
const SHEET_THEME = { name: 'Sheet', description: '', mode: 'light', colors: SHEET_COLORS };

export function SheetTheme({ children }) {
  const parent = useContext(ThemeContext);
  const value = useMemo(() => ({ ...parent, currentTheme: SHEET_THEME }), [parent]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// Theme to Icon mapping (v2.2.0)
const THEME_ICON_MAP = {
  dark: 'dark',
  light: 'light',
  minimal: 'minimal',
  morphism: 'morphismus',
  glass: 'glas',
  retro: 'retro',
  foundations: 'foundations',
  lollipop: 'light',
  nerd: 'dark',
  colorful: 'dark',
  indie: 'dark'
};

// Update window icon based on theme (v2.2.0)
const updateThemeIcon = async (themeName) => {
  if (window.electronAPI?.setThemeIcon) {
    try {
      const iconName = THEME_ICON_MAP[themeName] || 'dark';
      await window.electronAPI.setThemeIcon(iconName);
    } catch (error) {
      console.warn('Could not update theme icon:', error);
    }
  }
};

// Hell/Dunkel-Modus ans Dokument hängen — index.css steuert darüber
// Scrollbars, Fokus-Ring, Skeletons und Badge-Farben.
const applyDocumentMode = (themeName) => {
  const t = themes[themeName] || themes[DEFAULT_THEME];
  try {
    const root = document.documentElement;
    root.setAttribute('data-theme', themeName);
    root.setAttribute('data-mode', t.mode);
    root.style.colorScheme = t.mode;
  } catch (_) {}
};

const readSavedTheme = () => {
  try {
    const saved = localStorage.getItem('coremail-theme');
    return saved && themes[saved] ? saved : DEFAULT_THEME;
  } catch (_) {
    return DEFAULT_THEME;
  }
};

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(readSavedTheme);

  useEffect(() => {
    applyDocumentMode(theme);
    updateThemeIcon(theme);
  }, [theme]);

  const changeTheme = useCallback((newTheme) => {
    if (themes[newTheme]) {
      setTheme(newTheme);
      try { localStorage.setItem('coremail-theme', newTheme); } catch (_) {}
    }
  }, []);

  const value = useMemo(
    () => ({ theme, themes, currentTheme: themes[theme], changeTheme }),
    [theme, changeTheme]
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
