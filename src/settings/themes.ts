/**
 * Theme / Skin definitions for the UI.
 *
 * Each theme overrides the CSS custom properties defined in :root across all HTML files.
 * The `default` theme is null (no overrides — uses the original hardcoded values).
 */

export interface ThemePalette {
  'bg-primary': string;
  'bg-secondary': string;
  'bg-tertiary': string;
  border: string;
  'text-primary': string;
  'text-secondary': string;
  'text-muted': string;
  accent: string;
  'accent-secondary': string;
  'accent-hover': string;
  error: string;
  success: string;
  warning: string;
  orange: string;
  'user-bubble': string;
  'user-bubble-solid': string;
  'assistant-bubble': string;
}

export interface ThemeDefinition {
  id: string;
  name: string;
  palette: ThemePalette | null; // null = default (no overrides)
}

export const THEMES: Record<string, ThemeDefinition> = {
  // Dracula is the default — CSS variables.css matches these values,
  // so null palette works. Explicit palette kept for completeness.
  dracula: {
    id: 'dracula',
    name: 'Dracula',
    palette: null,
  },

  // ── Light themes ──────────────────────────────────────────────

  light: {
    id: 'light',
    name: 'Light',
    palette: {
      'bg-primary': '#ffffff',
      'bg-secondary': '#f9f9f9',
      'bg-tertiary': '#f2f2f7',
      border: '#e5e5ea',
      'text-primary': '#1c1c1e',
      'text-secondary': '#6c6c70',
      'text-muted': '#aeaeb2',
      accent: '#007aff',
      'accent-secondary': '#5856d6',
      'accent-hover': '#0055d4',
      error: '#ff3b30',
      success: '#34c759',
      warning: '#ff9500',
      orange: '#ff9500',
      'user-bubble': '#007aff',
      'user-bubble-solid': '#007aff',
      'assistant-bubble': '#f2f2f7',
    },
  },

  // Rosé Pine Dawn — canonical palette from rosepinetheme.com
  dawn: {
    id: 'dawn',
    name: 'Rosé Pine Dawn',
    palette: {
      'bg-primary': '#faf4ed',
      'bg-secondary': '#fffaf3',
      'bg-tertiary': '#f2e9e1',
      border: '#dfdad9',
      'text-primary': '#575279',
      'text-secondary': '#797593',
      'text-muted': '#9893a5',
      accent: '#907aa9',
      'accent-secondary': '#56949f',
      'accent-hover': '#7a6491',
      error: '#b4637a',
      success: '#286983',
      warning: '#ea9d34',
      orange: '#ea9d34',
      'user-bubble': '#907aa9',
      'user-bubble-solid': '#907aa9',
      'assistant-bubble': '#f2e9e1',
    },
  },

  // ── Dark themes ───────────────────────────────────────────────

  // GitHub Dark — github.com color scheme
  midnight: {
    id: 'midnight',
    name: 'Midnight',
    palette: {
      'bg-primary': '#0d1117',
      'bg-secondary': '#161b22',
      'bg-tertiary': '#1c2128',
      border: '#30363d',
      'text-primary': '#e6edf3',
      'text-secondary': '#8b949e',
      'text-muted': '#484f58',
      accent: '#58a6ff',
      'accent-secondary': '#79c0ff',
      'accent-hover': '#388bfd',
      error: '#f85149',
      success: '#3fb950',
      warning: '#d29922',
      orange: '#d29922',
      'user-bubble': '#388bfd',
      'user-bubble-solid': '#388bfd',
      'assistant-bubble': '#1c2128',
    },
  },

  // Nord — canonical palette from nordtheme.com
  nord: {
    id: 'nord',
    name: 'Nord',
    palette: {
      'bg-primary': '#2e3440',
      'bg-secondary': '#3b4252',
      'bg-tertiary': '#434c5e',
      border: '#4c566a',
      'text-primary': '#eceff4',
      'text-secondary': '#d8dee9',
      'text-muted': '#7b88a1',
      accent: '#88c0d0',
      'accent-secondary': '#81a1c1',
      'accent-hover': '#8fbcbb',
      error: '#bf616a',
      success: '#a3be8c',
      warning: '#ebcb8b',
      orange: '#d08770',
      'user-bubble': '#5e81ac',
      'user-bubble-solid': '#5e81ac',
      'assistant-bubble': '#434c5e',
    },
  },

  // Catppuccin Mocha — canonical palette from github.com/catppuccin
  mocha: {
    id: 'mocha',
    name: 'Catppuccin Mocha',
    palette: {
      'bg-primary': '#1e1e2e',
      'bg-secondary': '#181825',
      'bg-tertiary': '#313244',
      border: '#45475a',
      'text-primary': '#cdd6f4',
      'text-secondary': '#bac2de',
      'text-muted': '#6c7086',
      accent: '#89b4fa',
      'accent-secondary': '#cba6f7',
      'accent-hover': '#74c7ec',
      error: '#f38ba8',
      success: '#a6e3a1',
      warning: '#f9e2af',
      orange: '#fab387',
      'user-bubble': '#585b70',
      'user-bubble-solid': '#585b70',
      'assistant-bubble': '#313244',
    },
  },

  // Rosé Pine — canonical palette from rosepinetheme.com
  rosepine: {
    id: 'rosepine',
    name: 'Rosé Pine',
    palette: {
      'bg-primary': '#191724',
      'bg-secondary': '#1f1d2e',
      'bg-tertiary': '#26233a',
      border: '#403d52',
      'text-primary': '#e0def4',
      'text-secondary': '#908caa',
      'text-muted': '#6e6a86',
      accent: '#c4a7e7',
      'accent-secondary': '#9ccfd8',
      'accent-hover': '#ebbcba',
      error: '#eb6f92',
      success: '#9ccfd8',
      warning: '#f6c177',
      orange: '#f6c177',
      'user-bubble': '#403d52',
      'user-bubble-solid': '#403d52',
      'assistant-bubble': '#26233a',
    },
  },

  // Gruvbox Dark — canonical palette from github.com/morhetz/gruvbox
  gruvbox: {
    id: 'gruvbox',
    name: 'Gruvbox',
    palette: {
      'bg-primary': '#282828',
      'bg-secondary': '#1d2021',
      'bg-tertiary': '#3c3836',
      border: '#504945',
      'text-primary': '#ebdbb2',
      'text-secondary': '#d5c4a1',
      'text-muted': '#928374',
      accent: '#fabd2f',
      'accent-secondary': '#fe8019',
      'accent-hover': '#d79921',
      error: '#fb4934',
      success: '#b8bb26',
      warning: '#fabd2f',
      orange: '#fe8019',
      'user-bubble': '#504945',
      'user-bubble-solid': '#504945',
      'assistant-bubble': '#3c3836',
    },
  },

  // Solarized Dark — canonical palette from ethanschoonover.com/solarized
  solarized: {
    id: 'solarized',
    name: 'Solarized Dark',
    palette: {
      'bg-primary': '#002b36',
      'bg-secondary': '#073642',
      'bg-tertiary': '#073642',
      border: '#586e75',
      'text-primary': '#fdf6e3',
      'text-secondary': '#93a1a1',
      'text-muted': '#657b83',
      accent: '#268bd2',
      'accent-secondary': '#2aa198',
      'accent-hover': '#6c71c4',
      error: '#dc322f',
      success: '#859900',
      warning: '#b58900',
      orange: '#cb4b16',
      'user-bubble': '#073642',
      'user-bubble-solid': '#073642',
      'assistant-bubble': '#073642',
    },
  },

  // One Dark — Atom editor theme
  onedark: {
    id: 'onedark',
    name: 'One Dark',
    palette: {
      'bg-primary': '#282c34',
      'bg-secondary': '#21252b',
      'bg-tertiary': '#2c313a',
      border: '#3e4451',
      'text-primary': '#abb2bf',
      'text-secondary': '#9da5b4',
      'text-muted': '#5c6370',
      accent: '#61afef',
      'accent-secondary': '#c678dd',
      'accent-hover': '#528bff',
      error: '#e06c75',
      success: '#98c379',
      warning: '#e5c07b',
      orange: '#d19a66',
      'user-bubble': '#3e4451',
      'user-bubble-solid': '#3e4451',
      'assistant-bubble': '#2c313a',
    },
  },
};
