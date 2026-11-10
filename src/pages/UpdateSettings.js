/**
 * UpdateSettings.js - Erweiterte Update-Einstellungen (v1.16.0)
 * 
 * Features:
 * - Automatisch nach Updates suchen (alle 24h)
 * - Automatisch herunterladen
 * - Automatisch installieren
 * - Manueller Update-Check
 * - Download und Installation
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Download,
  Renew,
  Checkmark,
  WarningAlt,
  InProgress,
  FolderOpen,
  Time,
  Settings,
  Flash
} from '@carbon/icons-react';
import { useTheme } from '../context/ThemeContext';
import UpdateManager, { 
  UpdateStatus, 
  formatBytes,
  loadUpdateSettings,
  saveUpdateSettings,
  DEFAULT_UPDATE_SETTINGS,
  resetDismissedVersion
} from '../utils/UpdateManager';

function UpdateSettings() {
  const { currentTheme } = useTheme();
  const c = currentTheme.colors;
  
  const [state, setState] = useState({
    status: UpdateStatus.IDLE,
    updateInfo: null,
    progress: 0,
    downloadedPath: null,
    error: null
  });
  const [currentVersion, setCurrentVersion] = useState('...');
  const [settings, setSettings] = useState(DEFAULT_UPDATE_SETTINGS);
  const [lastCheck, setLastCheck] = useState(null);

  useEffect(() => {
    loadCurrentVersion();
    loadSettings();
    loadLastCheckTime();
    
    // Subscribe to UpdateManager
    const unsubscribe = UpdateManager.subscribe((newState) => {
      setState(newState);
    });

    // Listen for update progress
    if (window.electronAPI?.onUpdateProgress) {
      window.electronAPI.onUpdateProgress((data) => {
        setState(prev => ({ ...prev, progress: data.progress }));
      });
    }

    return unsubscribe;
  }, []);

  const loadCurrentVersion = async () => {
    if (window.electronAPI?.getVersion) {
      const version = await window.electronAPI.getVersion();
      setCurrentVersion(version);
    }
  };

  const loadSettings = () => {
    const loaded = loadUpdateSettings();
    setSettings(loaded);
  };

  const loadLastCheckTime = () => {
    try {
      const last = localStorage.getItem('coremailLastUpdateCheck');
      if (last) {
        setLastCheck(new Date(parseInt(last, 10)));
      }
    } catch (e) {}
  };

  const handleSettingChange = useCallback((key, value) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    saveUpdateSettings(newSettings);

    // Auto-Check aktivieren/deaktivieren
    if (key === 'autoCheckUpdates') {
      if (value) {
        UpdateManager.startAutoCheck();
      } else {
        UpdateManager.stopAutoCheck();
      }
    }
  }, [settings]);

  const checkForUpdates = async () => {
    await UpdateManager.checkForUpdates(false);
    loadLastCheckTime();
  };

  const downloadUpdate = async () => {
    await UpdateManager.downloadUpdate();
  };

  const installUpdate = async () => {
    await UpdateManager.installUpdate();
  };

  const openDownloads = () => {
    window.electronAPI?.openDownloads();
  };

  const handleResetDismissed = () => {
    resetDismissedVersion();
    checkForUpdates();
  };

  const formatLastCheck = (date) => {
    if (!date) return 'Noch nie';
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) return 'Gerade eben';
    if (diff < 3600000) return `Vor ${Math.floor(diff / 60000)} Minuten`;
    if (diff < 86400000) return `Vor ${Math.floor(diff / 3600000)} Stunden`;
    return date.toLocaleDateString('de-DE', { 
      day: '2-digit', 
      month: '2-digit', 
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const isChecking = state.status === UpdateStatus.CHECKING;
  const isDownloading = state.status === UpdateStatus.DOWNLOADING;
  const isInstalling = state.status === UpdateStatus.INSTALLING;
  const hasUpdate = state.status === UpdateStatus.UPDATE_AVAILABLE;
  const isDownloaded = state.status === UpdateStatus.DOWNLOADED;
  const isUpToDate = state.status === UpdateStatus.UP_TO_DATE;
  const hasError = state.status === UpdateStatus.ERROR;

  return (
    <div className="space-y-6">
      {/* Current Version Card */}
      <div className={`${c.card} ${c.border} border rounded-xl p-6`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-accent/15 flex items-center justify-center">
              <Flash size={24} className="text-accent" />
            </div>
            <div>
              <h3 className={`text-lg font-semibold ${c.text}`}>CoreMail Desktop</h3>
              <div className="flex items-center gap-3 mt-1">
                <span className={`text-2xl font-bold ${c.accent}`}>v{currentVersion}</span>
                {isUpToDate && (
                  <span className="flex items-center gap-1 px-2 py-0.5 bg-green-500/20 text-green-400 text-sm rounded-full">
                    <Checkmark size={16} /> Aktuell
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={checkForUpdates}
            disabled={isChecking || isDownloading || isInstalling}
            className={`px-6 py-2.5 ${c.accentBg} ${c.accentHover} text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2`}
          >
            {isChecking ? (
              <>
                <InProgress size={16} className="animate-spin" />
                Prüfe...
              </>
            ) : (
              <>
                <Renew size={16} />
                Nach Updates suchen
              </>
            )}
          </button>
        </div>
        
        {lastCheck && (
          <div className={`flex items-center gap-2 mt-4 text-sm ${c.textSecondary}`}>
            <Time size={16} />
            Letzte Überprüfung: {formatLastCheck(lastCheck)}
          </div>
        )}
      </div>

      {/* Error */}
      {hasError && (
        <div className="p-4 bg-red-900/20 border border-red-600 rounded-xl flex items-start gap-3">
          <WarningAlt size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-red-400 font-medium">Fehler beim Update-Check</p>
            <p className="text-red-400/80 text-sm mt-1">{state.error}</p>
          </div>
        </div>
      )}

      {/* Update Available */}
      {hasUpdate && state.updateInfo && (
        <div className={`${c.card} border border-accent rounded-xl p-6`}>
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-full bg-accent/15 flex items-center justify-center flex-shrink-0">
              <Download size={24} className="text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3">
                <h3 className={`text-lg font-semibold ${c.text}`}>
                  Update verfügbar
                </h3>
                <span className="px-3 py-1 bg-accent/15 text-accent text-sm font-medium rounded-full">
                  v{state.updateInfo.latestVersion}
                </span>
              </div>
              
              {state.updateInfo.releaseNotes && (
                <div className={`mt-4 p-4 ${c.bgTertiary} rounded-lg`}>
                  <h4 className={`font-medium ${c.text} mb-2`}>Release Notes:</h4>
                  <div className={`text-sm ${c.textSecondary} whitespace-pre-wrap max-h-48 overflow-auto`}>
                    {state.updateInfo.releaseNotes}
                  </div>
                </div>
              )}
              
              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={downloadUpdate}
                  disabled={isDownloading}
                  className={`px-6 py-2 ${c.accentBg} ${c.accentHover} text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2`}
                >
                  <Download size={16} />
                  Jetzt herunterladen
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Downloading */}
      {isDownloading && (
        <div className={`${c.card} ${c.border} border rounded-xl p-6`}>
          <div className="flex items-center gap-4 mb-4">
            <InProgress size={24} className="text-accent animate-spin" />
            <div>
              <h3 className={`font-semibold ${c.text}`}>Download läuft...</h3>
              <p className={`text-sm ${c.textSecondary}`}>
                v{state.updateInfo?.latestVersion}
              </p>
            </div>
          </div>
          <div className={`w-full h-3 ${c.bgTertiary} rounded-full overflow-hidden`}>
            <div 
              className="h-full bg-accentbg transition-all duration-300"
              style={{ width: `${Math.min(state.progress, 100)}%` }}
            />
          </div>
          <p className={`text-sm ${c.textSecondary} mt-2`}>
            {state.progress}% abgeschlossen
          </p>
        </div>
      )}

      {/* Downloaded */}
      {isDownloaded && (
        <div className={`${c.card} border border-green-500 rounded-xl p-6`}>
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
              <Checkmark size={24} className="text-green-400" />
            </div>
            <div className="flex-1">
              <h3 className={`text-lg font-semibold ${c.text}`}>
                Update bereit zur Installation
              </h3>
              <p className={`text-sm ${c.textSecondary} mt-1`}>
                v{state.updateInfo?.latestVersion} wurde erfolgreich heruntergeladen
              </p>
              
              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={installUpdate}
                  disabled={isInstalling}
                  className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors flex items-center gap-2"
                >
                  <Renew size={16} />
                  Jetzt installieren
                </button>
                <button
                  onClick={openDownloads}
                  className={`px-4 py-2 ${c.bgTertiary} ${c.hover} ${c.text} rounded-lg transition-colors flex items-center gap-2`}
                >
                  <FolderOpen size={16} />
                  Download-Ordner
                </button>
              </div>
              
              <p className={`text-xs ${c.textSecondary} mt-3 flex items-center gap-1`}>
                <WarningAlt size={16} /> Die App wird nach der Installation automatisch neu gestartet
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Installing */}
      {isInstalling && (
        <div className={`${c.card} ${c.border} border rounded-xl p-6`}>
          <div className="flex items-center gap-4">
            <InProgress size={24} className="text-green-400 animate-spin" />
            <div>
              <h3 className={`font-semibold ${c.text}`}>Update wird installiert...</h3>
              <p className={`text-sm ${c.textSecondary}`}>
                Die App wird gleich neu gestartet
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Up to Date */}
      {isUpToDate && !hasUpdate && (
        <div className={`${c.card} ${c.border} border rounded-xl p-6`}>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
              <Checkmark size={24} className="text-green-400" />
            </div>
            <div>
              <h3 className={`text-lg font-semibold ${c.text}`}>
                Sie verwenden die neueste Version
              </h3>
              <p className={`text-sm ${c.textSecondary}`}>
                CoreMail Desktop v{currentVersion} ist aktuell
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Auto-Update Settings */}
      <div className={`${c.card} ${c.border} border rounded-xl p-6`}>
        <div className="flex items-center gap-3 mb-6">
          <Settings size={20} className="text-accent" />
          <h3 className={`text-lg font-semibold ${c.text}`}>Update-Einstellungen</h3>
        </div>
        
        <div className="space-y-4">
          {/* Auto Check */}
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.autoCheckUpdates}
              onChange={(e) => handleSettingChange('autoCheckUpdates', e.target.checked)}
              className="w-5 h-5 mt-0.5 rounded accent-accentbg"
            />
            <div>
              <span className={c.text}>Automatisch nach Updates suchen</span>
              <p className={`text-sm ${c.textSecondary}`}>
                Prüft alle 24 Stunden auf neue Versionen
              </p>
            </div>
          </label>

          {/* Auto Download */}
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.autoDownload}
              onChange={(e) => handleSettingChange('autoDownload', e.target.checked)}
              disabled={!settings.autoCheckUpdates}
              className="w-5 h-5 mt-0.5 rounded accent-accentbg disabled:opacity-50"
            />
            <div className={!settings.autoCheckUpdates ? 'opacity-50' : ''}>
              <span className={c.text}>Updates automatisch herunterladen</span>
              <p className={`text-sm ${c.textSecondary}`}>
                Lädt neue Versionen im Hintergrund herunter
              </p>
            </div>
          </label>

          {/* Auto Install */}
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.autoInstall}
              onChange={(e) => handleSettingChange('autoInstall', e.target.checked)}
              disabled={!settings.autoDownload}
              className="w-5 h-5 mt-0.5 rounded accent-accentbg disabled:opacity-50"
            />
            <div className={!settings.autoDownload ? 'opacity-50' : ''}>
              <span className={c.text}>Updates automatisch installieren</span>
              <p className={`text-sm ${c.textSecondary}`}>
                Installiert heruntergeladene Updates automatisch (Neustart erforderlich)
              </p>
            </div>
          </label>

          {/* Show Notifications */}
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.showNotifications}
              onChange={(e) => handleSettingChange('showNotifications', e.target.checked)}
              className="w-5 h-5 mt-0.5 rounded accent-accentbg"
            />
            <div>
              <span className={c.text}>Update-Benachrichtigungen anzeigen</span>
              <p className={`text-sm ${c.textSecondary}`}>
                Zeigt eine Benachrichtigung bei verfügbaren Updates
              </p>
            </div>
          </label>
        </div>

        {/* Reset Dismissed */}
        <div className={`mt-6 pt-4 border-t ${c.border}`}>
          <button
            onClick={handleResetDismissed}
            className={`text-sm ${c.textSecondary} hover:${c.text} transition-colors`}
          >
            Abgelehnte Updates zurücksetzen
          </button>
        </div>
      </div>

      {/* Info */}
      <div className={`${c.bgTertiary} rounded-xl p-4`}>
        <h4 className={`font-medium ${c.text} mb-2`}>ℹ️ Hinweise</h4>
        <ul className={`text-sm ${c.textSecondary} space-y-1 list-disc list-inside`}>
          <li>Updates werden von GitHub Releases heruntergeladen</li>
          <li>Die Integrität wird vor der Installation überprüft</li>
          <li>Ein Backup der alten Version wird automatisch erstellt</li>
          <li>Bei Problemen können Sie den Download-Ordner öffnen und manuell installieren</li>
        </ul>
      </div>
    </div>
  );
}

export default UpdateSettings;
