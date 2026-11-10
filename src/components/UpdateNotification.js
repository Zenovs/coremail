/**
 * UpdateNotification.js - Update-Benachrichtigungs-Komponente (v1.16.0)
 * 
 * Zeigt eine Benachrichtigung an, wenn ein Update verfügbar ist.
 * Features:
 * - Banner-Anzeige bei verfügbarem Update
 * - Ein-Klick-Update
 * - Fortschrittsbalken
 * - "Später" und "Nicht mehr anzeigen" Optionen
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Download, Close, Renew, Checkmark, WarningAlt, InProgress } from '@carbon/icons-react';
import { useTheme } from '../context/ThemeContext';
import UpdateManager, { 
  UpdateStatus, 
  formatBytes, 
  loadUpdateSettings,
  dismissVersion 
} from '../utils/UpdateManager';

function UpdateNotification({ onOpenSettings }) {
  const { currentTheme } = useTheme();
  const c = currentTheme.colors;

  const [state, setState] = useState({
    status: UpdateStatus.IDLE,
    updateInfo: null,
    progress: 0,
    error: null
  });
  const [dismissed, setDismissed] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [restartRequired, setRestartRequired] = useState(false);

  useEffect(() => {
    if (window.electronAPI?.onUpdateRestartRequired) {
      window.electronAPI.onUpdateRestartRequired(() => setRestartRequired(true));
    }
    // Listener beim Unmount entfernen — sonst akkumuliert jeder Remount
    // einen weiteren IPC-Listener (setState auf unmounted Component)
    return () => {
      window.electronAPI?.removeUpdateListeners?.();
    };
  }, []);

  useEffect(() => {
    // Subscribe to UpdateManager
    const unsubscribe = UpdateManager.subscribe((newState) => {
      setState(newState);
    });

    // Start auto-check
    const settings = loadUpdateSettings();
    if (settings.autoCheckUpdates) {
      UpdateManager.startAutoCheck();
    }

    return () => {
      unsubscribe();
    };
  }, []);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  const handleDismissForever = useCallback(() => {
    if (state.updateInfo?.latestVersion) {
      dismissVersion(state.updateInfo.latestVersion);
    }
    setDismissed(true);
  }, [state.updateInfo?.latestVersion]);

  const handleDownload = useCallback(() => {
    UpdateManager.downloadUpdate();
  }, []);

  const handleInstall = useCallback(() => {
    UpdateManager.installUpdate();
  }, []);

  // Update installiert — Neustart erforderlich
  if (restartRequired) {
    return (
      <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
        <div className={`${c.bgSecondary} ${c.border} border rounded-xl p-8 shadow-2xl max-w-sm w-full mx-4 text-center`}>
          <Checkmark size={48} className="mx-auto mb-4 text-green-400" />
          <h3 className={`font-semibold ${c.text} text-lg mb-2`}>Update installiert!</h3>
          <p className={`text-sm ${c.textSecondary} mb-1`}>CoreMail wird gleich beendet.</p>
          <p className={`text-sm ${c.textSecondary}`}>Bitte CoreMail danach manuell neu starten.</p>
        </div>
      </div>
    );
  }

  // Nicht anzeigen wenn dismissed oder kein Update
  if (dismissed || state.status === UpdateStatus.IDLE || state.status === UpdateStatus.UP_TO_DATE) {
    return null;
  }

  // Checking Status - kleiner Indikator
  if (state.status === UpdateStatus.CHECKING) {
    return null; // Silent check
  }

  // Error Status
  if (state.status === UpdateStatus.ERROR) {
    return (
      <div className="fixed bottom-4 right-4 z-50 animate-slide-up">
        <div className={`${c.card} ${c.border} border rounded-xl p-4 shadow-lg max-w-sm`}>
          <div className="flex items-start gap-3">
            <WarningAlt size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className={`font-medium ${c.text}`}>Update-Fehler</p>
              <p className={`text-sm ${c.textSecondary} mt-1`}>{state.error}</p>
            </div>
            <button 
              onClick={handleDismiss}
              className={`${c.textSecondary} hover:${c.text} p-1`}
            >
              <Close size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Update Available
  if (state.status === UpdateStatus.UPDATE_AVAILABLE) {
    return (
      <div className="fixed bottom-4 right-4 z-50 animate-slide-up">
        <div className={`${c.card} border border-accent/30 rounded-xl p-4 shadow-lg max-w-md`}>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-accent/15 flex items-center justify-center flex-shrink-0">
              <Download size={20} className="text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className={`font-semibold ${c.text}`}>Update verfügbar</p>
                <span className="px-2 py-0.5 text-xs bg-accent/15 text-accent rounded-full">
                  v{state.updateInfo?.latestVersion}
                </span>
              </div>
              
              {showDetails && state.updateInfo?.releaseNotes && (
                <div className={`text-sm ${c.textSecondary} mt-2 max-h-32 overflow-auto whitespace-pre-wrap`}>
                  {state.updateInfo.releaseNotes}
                </div>
              )}
              
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={handleDownload}
                  className="px-4 py-1.5 bg-accentbg hover:bg-accentbghover text-white text-sm rounded-lg transition-colors flex items-center gap-2"
                >
                  <Download size={16} />
                  Jetzt updaten
                </button>
                <button
                  onClick={() => setShowDetails(!showDetails)}
                  className={`px-3 py-1.5 ${c.bgTertiary} ${c.hover} ${c.text} text-sm rounded-lg transition-colors`}
                >
                  {showDetails ? 'Weniger' : 'Details'}
                </button>
              </div>
              
              <div className="flex items-center gap-3 mt-2">
                <button
                  onClick={handleDismiss}
                  className={`text-xs ${c.textSecondary} hover:${c.text}`}
                >
                  Später
                </button>
                <button
                  onClick={handleDismissForever}
                  className={`text-xs ${c.textSecondary} hover:${c.text}`}
                >
                  Nicht mehr anzeigen
                </button>
              </div>
            </div>
            <button 
              onClick={handleDismiss}
              className={`${c.textSecondary} hover:${c.text} p-1`}
            >
              <Close size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Downloading
  if (state.status === UpdateStatus.DOWNLOADING) {
    return (
      <div className="fixed bottom-4 right-4 z-50 animate-slide-up">
        <div className={`${c.card} ${c.border} border rounded-xl p-4 shadow-lg max-w-sm`}>
          <div className="flex items-start gap-3">
            <InProgress size={20} className="text-accent animate-spin flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className={`font-medium ${c.text}`}>Update wird heruntergeladen...</p>
              <div className="mt-2">
                <div className={`w-full h-2 ${c.bgTertiary} rounded-full overflow-hidden`}>
                  <div 
                    className="h-full bg-accentbg transition-all duration-300"
                    style={{ width: `${Math.min(state.progress, 100)}%` }}
                  />
                </div>
                <p className={`text-xs ${c.textSecondary} mt-1`}>
                  {state.progress}% abgeschlossen
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Downloaded - Ready to Install
  if (state.status === UpdateStatus.DOWNLOADED) {
    return (
      <div className="fixed bottom-4 right-4 z-50 animate-slide-up">
        <div className={`${c.card} border border-green-500/50 rounded-xl p-4 shadow-lg max-w-sm`}>
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
              <Checkmark size={20} className="text-green-400" />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`font-semibold ${c.text}`}>Update bereit</p>
              <p className={`text-sm ${c.textSecondary} mt-1`}>
                v{state.updateInfo?.latestVersion} wurde heruntergeladen
              </p>
              <div className="flex items-center gap-2 mt-3">
                <button
                  onClick={handleInstall}
                  className="px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm rounded-lg transition-colors flex items-center gap-2"
                >
                  <Renew size={16} />
                  Jetzt installieren
                </button>
                <button
                  onClick={handleDismiss}
                  className={`px-3 py-1.5 ${c.bgTertiary} ${c.hover} ${c.text} text-sm rounded-lg transition-colors`}
                >
                  Später
                </button>
              </div>
              <p className={`text-xs ${c.textSecondary} mt-2`}>
                Die App wird nach der Installation neu gestartet
              </p>
            </div>
            <button 
              onClick={handleDismiss}
              className={`${c.textSecondary} hover:${c.text} p-1`}
            >
              <Close size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Installing
  if (state.status === UpdateStatus.INSTALLING) {
    return (
      <div className="fixed bottom-4 right-4 z-50 animate-slide-up">
        <div className={`${c.card} ${c.border} border rounded-xl p-4 shadow-lg max-w-sm`}>
          <div className="flex items-center gap-3">
            <InProgress size={20} className="text-green-400 animate-spin" />
            <div>
              <p className={`font-medium ${c.text}`}>Update wird installiert...</p>
              <p className={`text-sm ${c.textSecondary}`}>App wird gleich neu gestartet</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// CSS für Animation
const styles = `
@keyframes slide-up {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.animate-slide-up {
  animation: slide-up 0.3s ease-out;
}
`;

// Styles ins Dokument einfügen (einmalig, verhindert Duplikate bei Hot-Reload)
if (typeof document !== 'undefined' && !document.getElementById('update-notification-styles')) {
  const styleSheet = document.createElement('style');
  styleSheet.id = 'update-notification-styles';
  styleSheet.textContent = styles;
  document.head.appendChild(styleSheet);
}

export default UpdateNotification;
