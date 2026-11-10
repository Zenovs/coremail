import React, { useState, useEffect } from 'react';
import { Email, Cursor_1, Renew, Time, DataBase, View, TrashCan, Information } from '@carbon/icons-react';
import { useTheme } from '../context/ThemeContext';

const MARK_AS_READ_OPTIONS = [
  { id: 'onClick', name: 'Beim Klick', desc: 'E-Mail wird beim Auswählen als gelesen markiert', Icon: Cursor_1 },
  { id: 'onOpen', name: 'Beim Öffnen', desc: 'E-Mail wird beim Öffnen in Vollansicht als gelesen markiert', Icon: Email },
  { id: 'iconOnly', name: 'Nur durch Icon', desc: 'E-Mail wird nur durch Klick auf das Gelesen-Icon markiert', Icon: Email },
  { id: 'never', name: 'Nie automatisch', desc: 'E-Mails bleiben ungelesen, bis du sie manuell markierst', Icon: View },
];

// v1.8.2: Refresh interval options
const REFRESH_INTERVAL_OPTIONS = [
  { id: '1', name: '1 Minute', value: 60000 },
  { id: '5', name: '5 Minuten', value: 300000 },
  { id: '10', name: '10 Minuten', value: 600000 },
  { id: '15', name: '15 Minuten', value: 900000 },
  { id: '30', name: '30 Minuten', value: 1800000 },
  { id: 'manual', name: 'Manuell', value: 0 },
];

function EmailSettings() {
  const { currentTheme } = useTheme();
  const c = currentTheme.colors;
  const [markAsReadMode, setMarkAsReadMode] = useState('onClick');
  const [refreshInterval, setRefreshInterval] = useState('5');
  const [localStorageEnabled, setLocalStorageEnabled] = useState(true);
  const [cacheSize, setCacheSize] = useState(0);
  const [alwaysLoadImages, setAlwaysLoadImages] = useState(false);

  useEffect(() => {
    // Load settings from localStorage
    const savedReadMode = localStorage.getItem('emailSettings.markAsReadMode');
    if (savedReadMode) setMarkAsReadMode(savedReadMode);

    const savedInterval = localStorage.getItem('emailSettings.refreshInterval');
    if (savedInterval) setRefreshInterval(savedInterval);

    const savedLocalStorage = localStorage.getItem('emailSettings.localStorageEnabled');
    if (savedLocalStorage !== null) setLocalStorageEnabled(savedLocalStorage === 'true');

    const savedAlwaysLoadImages = localStorage.getItem('emailSettings.alwaysLoadImages');
    if (savedAlwaysLoadImages !== null) setAlwaysLoadImages(savedAlwaysLoadImages === 'true');

    // Calculate cache size
    calculateCacheSize();
  }, []);

  const calculateCacheSize = () => {
    try {
      let total = 0;
      for (const key in localStorage) {
        if (key.startsWith('emailCache:') || key.startsWith('email:')) {
          total += localStorage.getItem(key)?.length || 0;
        }
      }
      setCacheSize(Math.round(total / 1024)); // KB
    } catch (e) {
      setCacheSize(0);
    }
  };

  const handleReadModeChange = (mode) => {
    setMarkAsReadMode(mode);
    localStorage.setItem('emailSettings.markAsReadMode', mode);
    const label = MARK_AS_READ_OPTIONS.find(o => o.id === mode)?.name || mode;
    window.electronAPI?.logAdd('settings', `Als-gelesen-Markierung geändert: ${label}`, '').catch?.(() => {});
  };

  const handleRefreshIntervalChange = (intervalId) => {
    setRefreshInterval(intervalId);
    localStorage.setItem('emailSettings.refreshInterval', intervalId);
    const label = REFRESH_INTERVAL_OPTIONS.find(o => o.id === intervalId)?.name || intervalId;
    window.electronAPI?.logAdd('settings', `Aktualisierungsintervall geändert: ${label}`, '').catch?.(() => {});
    
    // Dispatch event so InboxSplitView can pick up the change
    window.dispatchEvent(new CustomEvent('emailSettingsChanged', { 
      detail: { refreshInterval: intervalId }
    }));
  };

  const handleLocalStorageToggle = (enabled) => {
    setLocalStorageEnabled(enabled);
    localStorage.setItem('emailSettings.localStorageEnabled', enabled.toString());
    
    window.dispatchEvent(new CustomEvent('emailSettingsChanged', { 
      detail: { localStorageEnabled: enabled }
    }));
  };

  const clearEmailCache = () => {
    try {
      const keysToRemove = [];
      for (const key in localStorage) {
        if (key.startsWith('emailCache:') || key.startsWith('email:')) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => localStorage.removeItem(key));
      setCacheSize(0);
    } catch (e) {
      console.error('Error clearing cache:', e);
    }
  };

  return (
    <div className="space-y-6">
      {/* Mark as Read Settings */}
      <div className={`${c.card} ${c.border} border rounded-xl p-6`}>
        <h3 className={`text-lg font-semibold ${c.text} mb-2`}>Als gelesen markieren</h3>
        <p className={`text-sm ${c.textSecondary} mb-4`}>
          Wann sollen E-Mails automatisch als gelesen markiert werden?
        </p>

        <div className="space-y-3">
          {MARK_AS_READ_OPTIONS.map(option => {
            const Icon = option.Icon;
            return (
              <button
                key={option.id}
                onClick={() => handleReadModeChange(option.id)}
                className={`w-full p-4 rounded-xl border-2 transition-colors flex items-start gap-4 text-left ${
                  markAsReadMode === option.id
                    ? `${c.accentBorder || 'border-accent'} ${c.bgTertiary}`
                    : `${c.border} ${c.hover}`
                }`}
              >
                <div className={`p-2 rounded-lg ${markAsReadMode === option.id ? c.accentBg : c.bgSecondary}`}>
                  <Icon size={20} className={markAsReadMode === option.id ? 'text-white' : c.textSecondary} />
                </div>
                <div className="flex-1">
                  <div className={`font-medium ${c.text}`}>{option.name}</div>
                  <div className={`text-sm ${c.textSecondary} mt-1`}>{option.desc}</div>
                </div>
                {markAsReadMode === option.id && (
                  <div className={`w-3 h-3 rounded-full ${c.accentBg} mt-2`} />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* v1.8.2: Auto-Refresh Settings */}
      <div className={`${c.card} ${c.border} border rounded-xl p-6`}>
        <div className="flex items-center gap-3 mb-2">
          <Renew size={20} className={c.accent} />
          <h3 className={`text-lg font-semibold ${c.text}`}>Automatische Aktualisierung</h3>
        </div>
        <p className={`text-sm ${c.textSecondary} mb-4`}>
          Wie oft sollen E-Mails automatisch vom Server abgerufen werden?
        </p>

        <div className="grid grid-cols-3 gap-2">
          {REFRESH_INTERVAL_OPTIONS.map(option => (
            <button
              key={option.id}
              onClick={() => handleRefreshIntervalChange(option.id)}
              className={`p-3 rounded-xl border-2 transition-colors text-center ${
                refreshInterval === option.id
                  ? `${c.accentBorder || 'border-accent'} ${c.bgTertiary}`
                  : `${c.border} ${c.hover}`
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <Time size={16} className={refreshInterval === option.id ? c.accent : c.textSecondary} />
                <span className={`text-sm font-medium ${refreshInterval === option.id ? c.accent : c.text}`}>
                  {option.name}
                </span>
              </div>
            </button>
          ))}
        </div>

        {refreshInterval !== 'manual' && (
          <p className={`text-xs ${c.textSecondary} mt-3 flex items-center gap-1`}>
            <Renew size={16} />
            E-Mails werden alle {REFRESH_INTERVAL_OPTIONS.find(o => o.id === refreshInterval)?.name.toLowerCase()} aktualisiert
          </p>
        )}
      </div>

      {/* v1.8.2: Local Storage Settings */}
      <div className={`${c.card} ${c.border} border rounded-xl p-6`}>
        <div className="flex items-center gap-3 mb-2">
          <DataBase size={20} className={c.accent} />
          <h3 className={`text-lg font-semibold ${c.text}`}>Lokale Speicherung</h3>
        </div>
        <p className={`text-sm ${c.textSecondary} mb-4`}>
          E-Mails lokal zwischenspeichern für schnellere Ladezeiten und Offline-Verfügbarkeit.
        </p>

        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <DataBase size={20} className={c.textSecondary} />
            <div>
              <div className={`font-medium ${c.text}`}>E-Mail-Cache aktiviert</div>
              <div className={`text-xs ${c.textSecondary}`}>
                Aktueller Cache: {cacheSize > 1024 ? `${(cacheSize/1024).toFixed(1)} MB` : `${cacheSize} KB`}
              </div>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={localStorageEnabled}
              onChange={(e) => handleLocalStorageToggle(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-accentbg"></div>
          </label>
        </div>

        {cacheSize > 0 && (
          <button
            onClick={clearEmailCache}
            className={`text-sm ${c.textSecondary} hover:${c.text} transition-colors flex items-center gap-1`}
          >
            <TrashCan size={16} /> Cache leeren
          </button>
        )}
      </div>

      {/* Datenschutz / Bildschutz */}
      <div className={`${c.card} ${c.border} border rounded-xl p-6`}>
        <div className="flex items-center gap-3 mb-2">
          <View size={20} className={c.accent} />
          <h3 className={`text-lg font-semibold ${c.text}`}>Datenschutz</h3>
        </div>
        <p className={`text-sm ${c.textSecondary} mb-4`}>
          Externe Bilder können dem Sender verraten, wann und wo du eine E-Mail geöffnet hast (Tracking-Pixel).
          CoreMail blockiert sie standardmässig — du kannst pro Mail einzeln freigeben.
        </p>
        <div className="flex items-center justify-between">
          <div>
            <div className={`font-medium ${c.text}`}>Externe Bilder immer laden</div>
            <div className={`text-xs ${c.textSecondary} mt-0.5`}>
              {alwaysLoadImages ? 'Tracking-Schutz deaktiviert' : 'Empfohlen: nur auf Klick'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              const next = !alwaysLoadImages;
              setAlwaysLoadImages(next);
              localStorage.setItem('emailSettings.alwaysLoadImages', String(next));
            }}
            className={`relative flex-shrink-0 w-12 h-6 rounded-full transition-colors ${alwaysLoadImages ? 'bg-yellow-500' : 'bg-gray-600'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${alwaysLoadImages ? 'translate-x-6' : 'translate-x-0'}`} />
          </button>
        </div>
      </div>

      {/* Tips */}
      <div className={`${c.bgSecondary} ${c.border} border rounded-xl p-6`}>
        <h4 className={`font-medium ${c.text} mb-3 flex items-center gap-2`}><Information size={16} /> Hinweise</h4>
        <ul className={`text-sm ${c.textSecondary} space-y-2`}>
          <li>• Automatische Aktualisierung funktioniert für alle Konten gleichzeitig</li>
          <li>• Lokale Speicherung ermöglicht schnelleren Kontowechsel</li>
          <li>• Du kannst E-Mails jederzeit manuell aktualisieren (F5 oder Refresh-Button)</li>
        </ul>
      </div>
    </div>
  );
}

export default EmailSettings;
