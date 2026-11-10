import React, { useState, useEffect } from 'react';
import { Checkmark, TextFont, View } from '@carbon/icons-react';
import { useTheme } from '../context/ThemeContext';

// v1.11.0: Google Fonts selection
const GOOGLE_FONTS = [
  { id: 'inter', name: 'Inter', family: 'Inter', weight: '400;500;600;700' },
  { id: 'roboto', name: 'Roboto', family: 'Roboto', weight: '400;500;700' },
  { id: 'opensans', name: 'Open Sans', family: 'Open+Sans', weight: '400;500;600;700' },
  { id: 'lato', name: 'Lato', family: 'Lato', weight: '400;700' },
  { id: 'montserrat', name: 'Montserrat', family: 'Montserrat', weight: '400;500;600;700' },
  { id: 'poppins', name: 'Poppins', family: 'Poppins', weight: '400;500;600;700' },
  { id: 'sourcesans', name: 'Source Sans 3', family: 'Source+Sans+3', weight: '400;500;600;700' },
  { id: 'raleway', name: 'Raleway', family: 'Raleway', weight: '400;500;600;700' },
  { id: 'ubuntu', name: 'Ubuntu', family: 'Ubuntu', weight: '400;500;700' },
  { id: 'nunito', name: 'Nunito', family: 'Nunito', weight: '400;500;600;700' },
  { id: 'firacode', name: 'Fira Code', family: 'Fira+Code', weight: '400;500;600;700' },
  { id: 'jetbrains', name: 'JetBrains Mono', family: 'JetBrains+Mono', weight: '400;500;600;700' },
];

// Load Google Font dynamically
export const loadGoogleFont = (fontId) => {
  const font = GOOGLE_FONTS.find(f => f.id === fontId);
  if (!font) return;

  const existingLink = document.getElementById('google-font-link');
  if (existingLink) {
    existingLink.remove();
  }

  const link = document.createElement('link');
  link.id = 'google-font-link';
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${font.family}:wght@${font.weight}&display=swap`;
  document.head.appendChild(link);

  // Apply font to body
  document.body.style.fontFamily = `"${font.name}", system-ui, -apple-system, sans-serif`;
};

// Get current font from localStorage
export const getCurrentFont = () => {
  return localStorage.getItem('app.fontFamily') || 'inter';
};

// Apply saved font on app load
export const applySavedFont = () => {
  const savedFont = getCurrentFont();
  loadGoogleFont(savedFont);
};

function FontSettings() {
  const { currentTheme } = useTheme();
  const c = currentTheme.colors;
  const [selectedFont, setSelectedFont] = useState(getCurrentFont());
  const [previewText, setPreviewText] = useState('Dies ist ein Beispieltext zur Vorschau der Schriftart.');

  useEffect(() => {
    // Load all fonts for preview (skip if already injected)
    GOOGLE_FONTS.forEach(font => {
      const id = `google-font-preview-${font.id}`;
      if (document.getElementById(id)) return;
      const link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?family=${font.family}:wght@400;500;600;700&display=swap`;
      document.head.appendChild(link);
    });
  }, []);

  const handleFontChange = (fontId) => {
    setSelectedFont(fontId);
    localStorage.setItem('app.fontFamily', fontId);
    loadGoogleFont(fontId);
  };

  const getSelectedFontName = () => {
    const font = GOOGLE_FONTS.find(f => f.id === selectedFont);
    return font ? font.name : 'Inter';
  };

  return (
    <div className="space-y-6">
      {/* Current Font Info */}
      <div className={`${c.card} ${c.border} border rounded-xl p-6`}>
        <div className="flex items-center gap-3 mb-4">
          <TextFont size={24} className={c.accent} />
          <div>
            <h3 className={`text-lg font-semibold ${c.text}`}>Schriftart</h3>
            <p className={`text-sm ${c.textSecondary}`}>
              Aktuelle Schriftart: <span className={c.accent}>{getSelectedFontName()}</span>
            </p>
          </div>
        </div>

        {/* Font Grid */}
        <div className="grid grid-cols-2 gap-3">
          {GOOGLE_FONTS.map(font => (
            <button
              key={font.id}
              onClick={() => handleFontChange(font.id)}
              className={`p-4 rounded-xl border-2 text-left transition-all ${
                selectedFont === font.id
                  ? 'border-accent ring-2 ring-accent/30'
                  : `${c.border} hover:border-gray-500`
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span 
                  className={`text-lg ${c.text}`}
                  style={{ fontFamily: `"${font.name}", sans-serif` }}
                >
                  {font.name}
                </span>
                {selectedFont === font.id && (
                  <Checkmark size={20} className="text-accent" />
                )}
              </div>
              <p 
                className={`text-sm ${c.textSecondary}`}
                style={{ fontFamily: `"${font.name}", sans-serif` }}
              >
                Aa Bb Cc 123
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Live Preview */}
      <div className={`${c.card} ${c.border} border rounded-xl p-6`}>
        <div className="flex items-center gap-3 mb-4">
          <View size={20} className={c.accent} />
          <h3 className={`text-lg font-semibold ${c.text}`}>Vorschau</h3>
        </div>
        
        <div className={`p-4 ${c.bgSecondary} rounded-lg mb-4`}>
          <input
            type="text"
            value={previewText}
            onChange={(e) => setPreviewText(e.target.value)}
            className={`w-full px-3 py-2 ${c.bgTertiary} ${c.text} ${c.border} border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent`}
            placeholder="Gib einen Text ein..."
          />
        </div>

        <div className={`space-y-3 ${c.bgSecondary} rounded-lg p-4`}>
          <p 
            className={c.text}
            style={{ fontFamily: `"${getSelectedFontName()}", sans-serif`, fontSize: '24px', fontWeight: 700 }}
          >
            {previewText}
          </p>
          <p 
            className={c.text}
            style={{ fontFamily: `"${getSelectedFontName()}", sans-serif`, fontSize: '18px', fontWeight: 600 }}
          >
            {previewText}
          </p>
          <p 
            className={c.text}
            style={{ fontFamily: `"${getSelectedFontName()}", sans-serif`, fontSize: '16px', fontWeight: 500 }}
          >
            {previewText}
          </p>
          <p 
            className={c.textSecondary}
            style={{ fontFamily: `"${getSelectedFontName()}", sans-serif`, fontSize: '14px', fontWeight: 400 }}
          >
            {previewText}
          </p>
        </div>
      </div>

      {/* Tips */}
      <div className={`${c.bgSecondary} ${c.border} border rounded-xl p-6`}>
        <h4 className={`font-medium ${c.text} mb-3`}>💡 Tipps</h4>
        <ul className={`text-sm ${c.textSecondary} space-y-2`}>
          <li>• Die Schriftart wird sofort auf die gesamte App angewendet</li>
          <li>• Inter ist die Standard-Schriftart für optimale Lesbarkeit</li>
          <li>• Fira Code und JetBrains Mono sind für Code optimiert</li>
          <li>• Die Einstellung wird automatisch gespeichert</li>
        </ul>
      </div>
    </div>
  );
}

export default FontSettings;
