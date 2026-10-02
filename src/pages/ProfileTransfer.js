import React, { useState, useEffect, useRef } from 'react';
import {
  DocumentExport, DocumentImport, Copy, Checkmark, Time, WarningAlt, Locked, InProgress
} from '@carbon/icons-react';
import { useTheme } from '../context/ThemeContext';
import { useAccounts } from '../context/AccountContext';

// v7.3.0: Profil (Konten + Kategorien + Signaturen) exportieren/importieren,
// um CoreMail auf einem neuen Rechner ohne erneute Erfassung einzurichten.
// Datei + Einmal-Passwort sind nur 5 Minuten gültig; Krypto liegt im Main-Prozess.

// Sekündlich tickende Restzeit bis `until` (ms) — null, wenn kein Ziel gesetzt
function useRemaining(until) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return undefined;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  if (!until) return null;
  return Math.max(0, until - now);
}

const formatRemaining = (ms) => {
  const s = Math.ceil(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function ProfileTransfer() {
  const { currentTheme } = useTheme();
  const { refreshAccounts } = useAccounts();
  const c = currentTheme.colors;

  // ── Export ──
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState(null); // { password, expiresAt, filePath, accountCount, categoryCount }
  const [exportError, setExportError] = useState(null);
  const [copied, setCopied] = useState(false);
  const exportRemaining = useRemaining(exportResult?.expiresAt);
  const exportExpired = exportResult && exportRemaining === 0;

  // ── Import ──
  const [importFile, setImportFile] = useState(null); // { fileName, createdAt, expiresAt }
  const [password, setPassword] = useState('');
  const [deleteFile, setDeleteFile] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const importRemaining = useRemaining(importFile?.expiresAt);
  const importExpired = importFile && importRemaining === 0;
  const passwordRef = useRef(null);

  // Passwort nicht länger als nötig im Speicher/auf dem Bildschirm halten
  useEffect(() => {
    if (exportExpired) setCopied(false);
  }, [exportExpired]);
  useEffect(() => () => { window.electronAPI?.cancelProfileImport?.(); }, []);

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    setExportResult(null);
    setCopied(false);
    try {
      const res = await window.electronAPI.exportProfile();
      if (res?.success) setExportResult(res);
      else if (!res?.canceled) setExportError(res?.error || 'Export fehlgeschlagen');
    } catch (e) {
      setExportError(e.message);
    }
    setExporting(false);
  };

  const copyPassword = async () => {
    if (!exportResult?.password) return;
    try {
      await navigator.clipboard.writeText(exportResult.password);
      setCopied(true);
    } catch (_) { /* Zwischenablage nicht verfügbar — Passwort bleibt sichtbar */ }
  };

  const handleSelectFile = async () => {
    setImportError(null);
    setImportResult(null);
    setPassword('');
    const res = await window.electronAPI.selectProfileImportFile();
    if (res?.success) {
      setImportFile(res);
      setTimeout(() => passwordRef.current?.focus(), 0);
    } else {
      setImportFile(null);
      if (!res?.canceled) setImportError(res?.error || 'Datei konnte nicht gelesen werden');
    }
  };

  const handleImport = async () => {
    if (!password.trim() || importing) return;
    setImporting(true);
    setImportError(null);
    try {
      const res = await window.electronAPI.importProfile({ password, deleteFile });
      if (res?.success) {
        setImportResult(res);
        setImportFile(null);
        setPassword('');
        await refreshAccounts();
      } else {
        setImportError(res?.error || 'Import fehlgeschlagen');
        if (res?.code === 'EXPIRED' || res?.code === 'ALREADY_USED' || res?.code === 'INVALID_TIME') {
          setImportFile(null);
          setPassword('');
        }
      }
    } catch (e) {
      setImportError(e.message);
    }
    setImporting(false);
  };

  return (
    <div className="space-y-6">
      {/* Erklärung */}
      <div className={`${c.card} ${c.border} border rounded-xl p-6`}>
        <h3 className={`text-lg font-semibold ${c.text} mb-2 flex items-center gap-2`}><Locked size={20} /> So funktioniert's</h3>
        <ul className={`space-y-1.5 text-sm ${c.textSecondary}`}>
          <li>• Das Profil enthält alle <span className={c.text}>Konten inkl. Zugangsdaten</span>, die <span className={c.text}>Aufteilung in Kategorien</span> und die <span className={c.text}>Signaturen</span>.</li>
          <li>• Beim Export wird ein <span className={c.text}>Einmal-Passwort</span> erzeugt. Es wird nirgends gespeichert und nur jetzt angezeigt.</li>
          <li>• Datei und Passwort sind nur <span className={c.text}>5 Minuten gültig</span> und können nur <span className={c.text}>ein einziges Mal</span> importiert werden. Danach sind sie nutzlos.</li>
          <li>• Bestehende Konten auf dem neuen Rechner bleiben erhalten; gleiche Konten werden aktualisiert.</li>
        </ul>
      </div>

      {/* Export */}
      <div className={`${c.card} ${c.border} border rounded-xl p-6`}>
        <h3 className={`text-lg font-semibold ${c.text} mb-2 flex items-center gap-2`}><DocumentExport size={20} /> Profil exportieren</h3>
        <p className={`text-sm ${c.textSecondary} mb-4`}>
          Auf dem <span className={c.text}>alten Rechner</span>: Datei speichern (z.B. auf einen USB-Stick) und das angezeigte Passwort notieren.
        </p>

        {!exportResult && (
          <button
            onClick={handleExport}
            disabled={exporting}
            className={`px-4 py-2 ${c.accentBg} ${c.accentHover} text-white rounded-lg text-sm flex items-center gap-2 disabled:opacity-50`}
          >
            {exporting ? <><InProgress size={16} className="animate-spin" /> Exportiere…</> : <><DocumentExport size={16} /> Profil exportieren…</>}
          </button>
        )}
        {exportError && <p className="mt-3 text-sm text-red-400 flex items-center gap-1.5"><WarningAlt size={16} /> {exportError}</p>}

        {exportResult && !exportExpired && (
          <div className="mt-2 p-4 rounded-xl border border-amber-500/50 bg-amber-500/10 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-sm font-semibold text-amber-400">Einmal-Passwort</span>
              <span className="text-sm text-amber-400 flex items-center gap-1.5 font-mono">
                <Time size={16} /> noch {formatRemaining(exportRemaining)} gültig
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <code className={`text-xl md:text-2xl font-mono font-bold tracking-wider ${c.text} select-all break-all`}>
                {exportResult.password}
              </code>
              <button
                onClick={copyPassword}
                className={`px-3 py-1.5 ${c.bgTertiary} ${c.hover} ${c.text} rounded-lg text-xs flex items-center gap-1.5`}
              >
                {copied ? <><Checkmark size={16} className="text-green-400" /> Kopiert</> : <><Copy size={16} /> Kopieren</>}
              </button>
            </div>
            <p className={`text-xs ${c.textSecondary} break-all`}>
              {exportResult.accountCount} Konto/Konten und {exportResult.categoryCount} Kategorien gespeichert in: {exportResult.filePath}
            </p>
            <p className={`text-xs ${c.textSecondary}`}>
              Das Passwort wird nach Ablauf ausgeblendet und kann nicht wiederhergestellt werden.
            </p>
            <button
              onClick={() => { setExportResult(null); setCopied(false); }}
              className={`px-3 py-1.5 ${c.bgTertiary} ${c.hover} ${c.text} rounded-lg text-xs`}
            >
              Fertig — Passwort ausblenden
            </button>
          </div>
        )}

        {exportExpired && (
          <div className={`mt-2 p-4 rounded-xl border ${c.border} ${c.bgTertiary} space-y-3`}>
            <p className={`text-sm ${c.textSecondary} flex items-center gap-1.5`}>
              <Time size={16} /> Die exportierte Datei ist abgelaufen und nicht mehr verwendbar. Du kannst sie löschen.
            </p>
            <button
              onClick={handleExport}
              className={`px-3 py-1.5 ${c.accentBg} ${c.accentHover} text-white rounded-lg text-xs flex items-center gap-1.5`}
            >
              <DocumentExport size={16} /> Neu exportieren…
            </button>
          </div>
        )}
      </div>

      {/* Import */}
      <div className={`${c.card} ${c.border} border rounded-xl p-6`}>
        <h3 className={`text-lg font-semibold ${c.text} mb-2 flex items-center gap-2`}><DocumentImport size={20} /> Profil importieren</h3>
        <p className={`text-sm ${c.textSecondary} mb-4`}>
          Auf dem <span className={c.text}>neuen Rechner</span>: Profildatei auswählen und das Einmal-Passwort eingeben.
        </p>

        {!importFile && (
          <button
            onClick={handleSelectFile}
            className={`px-4 py-2 ${c.accentBg} ${c.accentHover} text-white rounded-lg text-sm flex items-center gap-2`}
          >
            <DocumentImport size={16} /> Profildatei auswählen…
          </button>
        )}

        {importFile && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap text-sm">
              <span className={`${c.text} break-all`}>{importFile.fileName}</span>
              <span className={`font-mono flex items-center gap-1.5 ${importExpired ? 'text-red-400' : 'text-amber-400'}`}>
                <Time size={16} /> {importExpired ? 'abgelaufen' : `noch ${formatRemaining(importRemaining)} gültig`}
              </span>
            </div>
            <input
              ref={passwordRef}
              type="text"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleImport(); }}
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
              autoComplete="off"
              spellCheck={false}
              disabled={importExpired || importing}
              className={`w-full px-3 py-2 rounded-lg ${c.input} font-mono tracking-wider uppercase focus:outline-none focus:ring-2 focus:ring-cyan-500 disabled:opacity-50`}
            />
            <label className={`flex items-center gap-2 text-sm ${c.textSecondary} cursor-pointer`}>
              <input type="checkbox" checked={deleteFile} onChange={e => setDeleteFile(e.target.checked)} className="accent-cyan-500" />
              Profildatei nach erfolgreichem Import löschen
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={handleImport}
                disabled={!password.trim() || importing || importExpired}
                className={`px-4 py-2 ${c.accentBg} ${c.accentHover} text-white rounded-lg text-sm flex items-center gap-2 disabled:opacity-50`}
              >
                {importing ? <><InProgress size={16} className="animate-spin" /> Importiere…</> : <><DocumentImport size={16} /> Importieren</>}
              </button>
              <button
                onClick={() => { setImportFile(null); setPassword(''); setImportError(null); window.electronAPI.cancelProfileImport(); }}
                className={`px-4 py-2 ${c.bgTertiary} ${c.hover} ${c.text} rounded-lg text-sm`}
              >
                Abbrechen
              </button>
            </div>
          </div>
        )}

        {importError && <p className="mt-3 text-sm text-red-400 flex items-center gap-1.5"><WarningAlt size={16} /> {importError}</p>}

        {importResult && (
          <div className="mt-3 p-4 rounded-xl border border-green-500/50 bg-green-500/10 text-sm space-y-1">
            <p className="text-green-400 font-semibold flex items-center gap-1.5"><Checkmark size={16} /> Profil importiert</p>
            <p className={c.textSecondary}>
              {importResult.added} Konto/Konten hinzugefügt, {importResult.updated} aktualisiert, {importResult.categories} Kategorien übernommen.
            </p>
            <p className={c.textSecondary}>
              {importResult.fileDeleted
                ? 'Die Profildatei wurde gelöscht.'
                : 'Die Profildatei ist jetzt verbraucht — du kannst sie löschen.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default ProfileTransfer;
