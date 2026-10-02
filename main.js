const { app, BrowserWindow, ipcMain, Notification, shell, dialog, nativeImage, session, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const url = require('url');
const { execSync, spawn } = require('child_process');
const Store = require('electron-store');
const imapSimple = require('imap-simple');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');
const fetch = require('node-fetch');



// ============ EIO FIX (v5.0.6) ============
// When launched without a terminal (desktop icon, autostart), stdout/stderr are
// closed. Any console.log() call then throws "Error: write EIO" which Electron
// catches as an uncaught exception and shows a native error dialog.
// Fix: wrap all console methods to silently swallow EIO write errors.
['log', 'warn', 'error', 'info', 'debug'].forEach((method) => {
  const original = console[method].bind(console);
  console[method] = (...args) => {
    try {
      original(...args);
    } catch (e) {
      if (e.code !== 'EIO') throw e;
      // EIO = broken pipe / no terminal — silently ignore
    }
  };
});

// ============ SOCKET / IMAP ERROR HANDLER ============
// Catches uncaught exceptions from IMAP socket errors (writeAfterFIN, ECONNRESET,
// EPIPE) that bubble up from the connection pool when the server closes a kept-alive
// connection. These are transient network events — log them, don't crash.
const SILENT_ERRORS = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNREFUSED']);
process.on('uncaughtException', (err) => {
  const msg = err?.message || '';
  if (
    SILENT_ERRORS.has(err?.code) ||
    msg.includes('socket has been ended') ||
    msg.includes('write after end') ||
    msg.includes('writeAfterFIN') ||
    msg.includes('This socket is closed') ||
    msg.includes('read ECONNRESET')
  ) {
    console.warn('[uncaughtException] IMAP/socket error (non-fatal):', msg);
    return; // suppress — the pool will reconnect on next request
  }
  // Re-throw anything else so real bugs still surface
  console.error('[uncaughtException] Fatal:', err);
  throw err;
});

process.on('unhandledRejection', (reason) => {
  const msg = reason?.message || String(reason);
  if (
    SILENT_ERRORS.has(reason?.code) ||
    msg.includes('socket has been ended') ||
    msg.includes('write after end') ||
    msg.includes('writeAfterFIN') ||
    msg.includes('This socket is closed')
  ) {
    console.warn('[unhandledRejection] IMAP/socket error (non-fatal):', msg);
    return;
  }
  console.error('[unhandledRejection]:', reason);
});

// ============ SANDBOX FIX (v3.0.9, verengt v6.10.0) ============
// v6.10.0: Sandbox nur noch für AppImage-Läufe deaktivieren — dort fehlt der
// SUID-Helper und Ubuntu 24.04+ blockiert unprivilegierte User-Namespaces
// (App startet sonst gar nicht). deb/rpm-Installationen bringen den
// chrome-sandbox-Helper mit korrekten Rechten mit und laufen jetzt wieder
// MIT Chromium-Sandbox — ein Renderer-Kompromiss (Mail-HTML) hat es damit
// deutlich schwerer. Muss vor app.whenReady() passieren.
// Auch im Dev-Modus (npm start/dev) deaktivieren: das electron-Binary in
// node_modules hat keinen SUID-Helper — auf Ubuntu 23.10+ (User-Namespace-
// Restriktionen) würde der Start sonst crashen.
if (process.platform === 'linux' && (process.env.APPIMAGE || process.env.APPDIR || !app.isPackaged)) {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-setuid-sandbox');
}


// App Version - read from package.json
const APP_VERSION = require('./package.json').version;
const GITHUB_REPO = 'Zenovs/coremail';

// v7.0: sicherheitskritische pure Functions — extrahiert und getestet (tests/pure.test.js)
const { compareVersions, isTrustedUpdateUrl, isSafePublicHttpsUrl, matchCondition, matchRule,
        parseICalendar, isCalendarPart, normalizeAttachments, extractInvitation } = require('./lib/pure');
// v7.3.0: Profil-Export/-Import (tests/profileTransfer.test.js)
const profileTransfer = require('./lib/profileTransfer');

// Verschlüsselte Speicherung
// v4.5.6: Benutzerspezifischer Key statt hardcodiertem String.
// Der Key wird aus dem Home-Verzeichnis des Users abgeleitet — damit ist er
// pro Benutzer und Maschine einzigartig und steht nicht im Quellcode.
// Migrations-Logik: Falls die Config noch mit dem alten Key verschlüsselt ist,
// wird sie automatisch auf den neuen Key migriert.
const os = require('os');
const LEGACY_ENCRYPTION_KEY = 'coremail-secure-key-v1';
const deriveEncryptionKey = () =>
  crypto.createHash('sha256')
    .update(os.homedir() + '-coremail-v2')
    .digest('hex');

let store;
try {
  store = new Store({ encryptionKey: deriveEncryptionKey(), name: 'coremail-config' });
  // Lese-Test: prüft ob der Key korrekt ist
  store.get('accounts', []);
} catch (_) {
  // Initiale Entschlüsselung gescheitert. Mögliche Ursachen:
  //   1) Legacy-Key (alt < v4.5.6) → unten migrieren
  //   2) safeStorage-Random-Key (v6.2.0–v6.3.0) → Recovery in app.whenReady() (recoverFromSafeStorageStore)
  // Wir LÖSCHEN die Config-Datei NIE. Lieber leerer Fallback-Store als Datenverlust.
  try {
    const legacyStore = new Store({ encryptionKey: LEGACY_ENCRYPTION_KEY, name: 'coremail-config' });
    const legacyData = legacyStore.store; // Gesamten Inhalt lesen
    // Nur migrieren wenn wirklich Daten vorhanden — sonst würden wir die Config
    // mit leerem Inhalt überschreiben wenn der Legacy-Key zufällig keinen Fehler wirft
    if (!legacyData || Object.keys(legacyData).length === 0) {
      throw new Error('Legacy store leer — keine Migration');
    }
    // Neu verschlüsseln mit dem benutzerspezifischen Key
    store = new Store({ encryptionKey: deriveEncryptionKey(), name: 'coremail-config' });
    store.store = legacyData;
    console.log('[Store] Migration von Legacy-Key auf benutzerspezifischen Key erfolgreich.');
  } catch (_) {
    // Weder derived noch legacy → wahrscheinlich safeStorage-verschlüsselt
    // Recovery erfolgt in app.whenReady(). Hier nur ein Fallback-Store mit anderem Namen,
    // damit der globale `store` zumindest valide Methoden hat (set/get) und nichts überschreibt.
    console.warn('[Store] Initial-Open fehlgeschlagen — Recovery wird in app.whenReady() versucht. Config wird NICHT gelöscht.');
    store = new Store({ encryptionKey: deriveEncryptionKey(), name: 'coremail-config-pending' });
  }
}

let mainWindow;

// ============ FULL-TEXT-SEARCH-INDEX (SQLite + FTS5, v6.3.0) ============
// Lokaler Index aller bereits abgerufenen Mails. Sucht in <50ms, auch offline.
// Lazy-Loading: better-sqlite3 wird nur geladen wenn verfügbar; ohne fällt
// die Suche transparent auf den bisherigen IMAP-Server-Search zurück.
let searchDb = null;
let searchDbAvailable = false;

function initSearchIndex() {
  try {
    const Database = require('better-sqlite3');
    const dbPath = path.join(app.getPath('userData'), 'coremail-search.db');
    searchDb = new Database(dbPath);
    searchDb.pragma('journal_mode = WAL');
    searchDb.pragma('synchronous = NORMAL');

    // Haupt-Tabelle: Mail-Metadaten + Suchfelder
    searchDb.exec(`
      CREATE TABLE IF NOT EXISTS emails (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id TEXT NOT NULL,
        folder TEXT NOT NULL,
        uid TEXT NOT NULL,
        message_id TEXT,
        subject TEXT,
        from_addr TEXT,
        to_addr TEXT,
        cc_addr TEXT,
        date INTEGER,
        body TEXT,
        has_attachments INTEGER DEFAULT 0,
        seen INTEGER DEFAULT 0,
        UNIQUE(account_id, folder, uid)
      );
      CREATE INDEX IF NOT EXISTS idx_emails_date ON emails(date DESC);
      CREATE INDEX IF NOT EXISTS idx_emails_account ON emails(account_id, folder);

      CREATE VIRTUAL TABLE IF NOT EXISTS emails_fts USING fts5(
        subject, from_addr, to_addr, body,
        content='emails', content_rowid='id',
        tokenize='unicode61 remove_diacritics 2'
      );

      CREATE TRIGGER IF NOT EXISTS emails_ai AFTER INSERT ON emails BEGIN
        INSERT INTO emails_fts(rowid, subject, from_addr, to_addr, body)
        VALUES (new.id, new.subject, new.from_addr, new.to_addr, new.body);
      END;
      CREATE TRIGGER IF NOT EXISTS emails_ad AFTER DELETE ON emails BEGIN
        INSERT INTO emails_fts(emails_fts, rowid, subject, from_addr, to_addr, body)
        VALUES ('delete', old.id, old.subject, old.from_addr, old.to_addr, old.body);
      END;
      CREATE TRIGGER IF NOT EXISTS emails_au AFTER UPDATE ON emails BEGIN
        INSERT INTO emails_fts(emails_fts, rowid, subject, from_addr, to_addr, body)
        VALUES ('delete', old.id, old.subject, old.from_addr, old.to_addr, old.body);
        INSERT INTO emails_fts(rowid, subject, from_addr, to_addr, body)
        VALUES (new.id, new.subject, new.from_addr, new.to_addr, new.body);
      END;
    `);

    searchDbAvailable = true;
    console.log('[Search] FTS5-Index initialisiert:', dbPath);
  } catch (e) {
    searchDbAvailable = false;
    console.warn('[Search] better-sqlite3 nicht verfügbar — Volltextsuche fällt auf Server-Suche zurück:', e.message);
  }
}

// Stripped-down Body extrahieren für den Index (HTML → Text, Limit 50 KB pro Mail)
function htmlToSearchText(html) {
  if (!html) return '';
  const noScripts = String(html).replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  const noTags = noScripts.replace(/<[^>]+>/g, ' ');
  const decoded = noTags.replace(/&[a-z]+;/gi, ' ').replace(/&#\d+;/g, ' ');
  return decoded.replace(/\s+/g, ' ').trim().slice(0, 50000);
}

let indexEmailStmt = null; // einmal vorbereitet — prepare() pro Mail ist beim Batch-Indexieren unnötiger Parse-Aufwand

function indexEmailInSearch({ accountId, folder, uid, messageId, subject, from, to, cc, date, body, html, hasAttachments, seen }) {
  if (!searchDbAvailable || !searchDb) return false;
  try {
    const bodyText = (body && String(body).trim().length) ? String(body).slice(0, 50000) : htmlToSearchText(html);
    if (!indexEmailStmt) {
      indexEmailStmt = searchDb.prepare(`
      INSERT INTO emails (account_id, folder, uid, message_id, subject, from_addr, to_addr, cc_addr, date, body, has_attachments, seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, folder, uid) DO UPDATE SET
        subject=excluded.subject,
        from_addr=excluded.from_addr,
        to_addr=excluded.to_addr,
        cc_addr=excluded.cc_addr,
        date=excluded.date,
        body=excluded.body,
        has_attachments=excluded.has_attachments,
        seen=excluded.seen
    `);
    }
    indexEmailStmt.run(
      String(accountId), String(folder), String(uid), messageId || null,
      subject || '', from || '', to || '', cc || '',
      date ? new Date(date).getTime() : 0,
      bodyText, hasAttachments ? 1 : 0, seen ? 1 : 0
    );
    return true;
  } catch (e) {
    console.warn('[Search] indexEmail-Fehler:', e.message);
    return false;
  }
}

function searchEmailsFTS({ query, accountIds = [], limit = 50 }) {
  if (!searchDbAvailable || !searchDb) return { success: false, error: 'Search-Index nicht verfügbar' };
  try {
    // Sanitize Query für FTS5: Sonderzeichen die FTS5 als Operatoren liest in Quotes setzen.
    const safeQuery = query.trim().split(/\s+/).map(token => {
      // Numerisch oder simples Wort: belassen (erlaubt Prefix-Matches mit *)
      if (/^[a-zA-Z0-9äöüÄÖÜß]+$/.test(token)) return token + '*';
      // Sonst quoten (alles im Token wird als Phrase gesucht)
      return '"' + token.replace(/"/g, '""') + '"';
    }).join(' ');

    let sql = `
      SELECT e.account_id, e.folder, e.uid, e.message_id, e.subject, e.from_addr, e.to_addr, e.date, e.has_attachments, e.seen,
             snippet(emails_fts, 3, '<mark>', '</mark>', '…', 12) AS snippet,
             rank
      FROM emails_fts
      JOIN emails e ON e.id = emails_fts.rowid
      WHERE emails_fts MATCH ?
    `;
    const params = [safeQuery];
    if (accountIds.length > 0) {
      sql += ` AND e.account_id IN (${accountIds.map(() => '?').join(',')})`;
      params.push(...accountIds);
    }
    sql += ` ORDER BY rank LIMIT ?`;
    params.push(limit);

    const rows = searchDb.prepare(sql).all(...params);
    return {
      success: true,
      results: rows.map(r => ({
        accountId: r.account_id,
        folder: r.folder,
        uid: r.uid,
        messageId: r.message_id,
        subject: r.subject,
        from: r.from_addr,
        to: r.to_addr,
        date: r.date ? new Date(r.date).toISOString() : null,
        hasAttachments: !!r.has_attachments,
        seen: !!r.seen,
        snippet: r.snippet
      }))
    };
  } catch (e) {
    console.error('[Search] FTS-Query-Fehler:', e.message);
    return { success: false, error: e.message };
  }
}

// Security: Strict Content-Security-Policy for renderer (defense-in-depth).
// Allowed: self for scripts/styles/images/fonts, data: for inline images, https: for tracker-image opt-in.
// External fetches (Microsoft Graph, GitHub API, Google Fonts) are explicitly listed.
function setupCSP() {
  const isDev = process.env.NODE_ENV === 'development';
  // 'unsafe-eval' braucht nur der react-scripts-Dev-Server. Im Production-Build
  // wird es entfernt, damit eingeschleuster Code nicht per eval() laufen kann.
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
    : "script-src 'self' 'unsafe-inline'; ";
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
          scriptSrc +
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
          "font-src 'self' data: https://fonts.gstatic.com; " +
          "img-src 'self' data: blob: https: http:; " + // Mail-Bilder erlauben (sind in Iframe-Sandbox)
          "connect-src 'self' https://api.github.com https://graph.microsoft.com https://login.microsoftonline.com https://*.outlook.com; " +
          "frame-src 'self' data:; " + // EmailHtmlFrame nutzt srcDoc (data:)
          "object-src 'none'; " +
          "base-uri 'none'"
        ]
      }
    });
  });
}

function createWindow() {
  setupCSP();
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      // Mail-Client muss auch im Tray/minimiert weitersynchronisieren.
      // Ohne dies drosselt/friert Chromium die setInterval-Timer des
      // Renderers ein, sobald das Fenster verdeckt ist → Background-Sync
      // stoppt (App.js:syncAllAccounts läuft dann faktisch nie).
      backgroundThrottling: false
    },
    backgroundColor: '#0a0a0a',
    icon: getIconPath(),
    title: 'CoreMail Desktop'
  });

  const isDev = process.env.NODE_ENV === 'development';

  // Security: Fenster-Öffnen und Navigation absichern (defense-in-depth).
  // Ein window.open / target=_blank aus einer (bösartigen) Mail darf kein
  // Electron-Fenster mit Node-Kontext öffnen; externe Links gehen in den
  // System-Browser, In-App-Navigation bleibt auf die App beschränkt.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) || url.startsWith('mailto:')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  const allowNavigation = (event, url) => {
    const ok = isDev
      ? url.startsWith('http://localhost:3000')
      : (url.startsWith('file://') || url.startsWith('data:text/html'));
    if (!ok) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url) || url.startsWith('mailto:')) shell.openExternal(url);
    }
  };
  mainWindow.webContents.on('will-navigate', allowNavigation);
  mainWindow.webContents.on('will-redirect', allowNavigation);
  // Kein Attach von untrusted WebContents (z.B. eingebettete Frames) mit Node
  mainWindow.webContents.on('will-attach-webview', (event, webPreferences) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
  });

  // Debug logging for loading issues (v2.4.1)
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error(`[CoreMail] Failed to load: ${errorCode} - ${errorDescription}`);
    console.error(`[CoreMail] URL: ${validatedURL}`);
  });
  
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[CoreMail] Page loaded successfully');
  });
  
  // Handle render process crashes
  let crashCount = 0;
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('[CoreMail] Render process gone:', details.reason);
    crashCount++;
    // Max 3 Neustarts, danach aufgeben (verhindert Endlosschleife bei TMPDIR-Fehler)
    if (details.reason !== 'killed' && crashCount <= 3) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.reload();
        }
      }, 1000);
    } else if (crashCount > 3) {
      console.error('[CoreMail] Renderer crasht wiederholt — kein weiterer Neustart.');
    }
  });
  
  mainWindow.webContents.on('unresponsive', () => {
    console.error('[CoreMail] Window became unresponsive');
  });
  
  mainWindow.webContents.on('responsive', () => {
    console.log('[CoreMail] Window is responsive again');
  });
  
  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    // Production: Load from build directory (v2.4.1 - improved path handling)
    const indexPath = path.join(__dirname, 'build', 'index.html');
    console.log('[CoreMail] Loading production build from:', indexPath);

    // Check if file exists
    if (fs.existsSync(indexPath)) {
      mainWindow.loadFile(indexPath).catch(err => {
        console.error('[CoreMail] Error loading index.html:', err);
      });
    } else {
      console.error('[CoreMail] index.html not found at:', indexPath);
      // Show error in window
      mainWindow.loadURL(`data:text/html,<h1>Error: Build not found</h1><p>Expected: ${indexPath}</p>`);
    }
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Context menu für Kopieren/Einfügen in der gesamten App
  mainWindow.webContents.on('context-menu', (e, params) => {
    const { Menu, MenuItem } = require('electron');
    const menu = new Menu();
    if (params.selectionText) {
      menu.append(new MenuItem({ label: 'Kopieren', role: 'copy' }));
    }
    if (params.isEditable) {
      menu.append(new MenuItem({ label: 'Ausschneiden', role: 'cut' }));
      menu.append(new MenuItem({ label: 'Einfügen', role: 'paste' }));
      menu.append(new MenuItem({ label: 'Alles auswählen', role: 'selectAll' }));
    }
    if (params.linkURL) {
      const safeUrl = params.linkURL;
      const isSafeUrl = safeUrl.startsWith('https://') || safeUrl.startsWith('http://') || safeUrl.startsWith('mailto:');
      if (isSafeUrl) {
        menu.append(new MenuItem({ label: 'Link öffnen', click: () => shell.openExternal(safeUrl) }));
      }
      menu.append(new MenuItem({ label: 'Link kopieren', click: () => require('electron').clipboard.writeText(params.linkURL) }));
    }
    if (menu.items.length > 0) menu.popup();
  });

  // Auto-Update Check on startup if enabled
  const settings = store.get('appSettings', {});
  if (settings.autoCheckUpdates !== false) {
    setTimeout(() => {
      checkForUpdates(true); // Silent check
    }, 5000);
  }
}

// v5.0.8: Set app identity before window creation so Linux WM_CLASS matches
// the StartupWMClass in the .desktop file → taskbar shows the correct icon
app.setName('coremail-desktop');
app.setAppUserModelId('com.coremail.desktop');

// v6.3.1 — Rollback der safeStorage-Migration aus v6.2.0.
// Grund: wenn safeStorage später nicht mehr entschlüsseln kann (Keyring-Reset,
// neue Linux-Session, Wallet-Neuinstallation), war die Config nicht mehr lesbar
// und Konten gingen verloren.
//
// Diese Recovery-Funktion:
//   1) Falls coremail-keyring.enc existiert → safeStorage entschlüsseln, Daten lesen,
//      mit derived-key neu speichern, Keyring-Datei wegräumen.
//   2) Sollte safeStorage scheitern, aber die Config-Datei ist mit derived-key
//      lesbar (z.B. weil v6.2.0 nie wirklich migriert hat) → nichts tun.
//   3) Sind beide Pfade tot, lassen wir die Datei in Ruhe (kein destruktives Reset).
async function recoverFromSafeStorageStore() {
  const userDataPath = app.getPath('userData');
  const keyFilePath = path.join(userDataPath, 'coremail-keyring.enc');

  // Wenn keine Keyring-Datei vorhanden ist → nichts zu tun, derived-key passt
  if (!fs.existsSync(keyFilePath)) {
    return;
  }

  console.log('[Store-Recovery] Keyring-Datei gefunden — versuche Recovery der safeStorage-Daten…');

  let canUseSafeStorage = false;
  try { canUseSafeStorage = safeStorage.isEncryptionAvailable(); } catch (_) {}

  if (!canUseSafeStorage) {
    console.warn('[Store-Recovery] safeStorage nicht verfügbar — Keyring-Datei bleibt für späteren Recovery-Versuch.');
    return;
  }

  let recoveredData = null;
  try {
    const encryptedKey = fs.readFileSync(keyFilePath);
    const safeKey = safeStorage.decryptString(encryptedKey);
    const safeStore = new Store({ encryptionKey: safeKey, name: 'coremail-config' });
    recoveredData = safeStore.store;
    if (!recoveredData || (typeof recoveredData === 'object' && Object.keys(recoveredData).length === 0)) {
      throw new Error('Wiederhergestellte Daten sind leer');
    }
  } catch (e) {
    console.warn('[Store-Recovery] safeStorage-Entschlüsselung fehlgeschlagen:', e.message);
    return;
  }

  // Daten sind gerettet — jetzt mit derived-key neu speichern
  try {
    const configPath = path.join(userDataPath, 'coremail-config.json');
    const backupPath = configPath + '.safestorage-backup';

    if (fs.existsSync(configPath)) {
      fs.copyFileSync(configPath, backupPath);
    }

    try { fs.unlinkSync(configPath); } catch (_) {}

    const derivedStore = new Store({ encryptionKey: deriveEncryptionKey(), name: 'coremail-config' });
    derivedStore.store = recoveredData;

    const verifyAccounts = derivedStore.get('accounts', null);
    if (!Array.isArray(verifyAccounts)) {
      throw new Error(`Verifikation fehlgeschlagen — accounts ist kein Array`);
    }

    store = derivedStore;
    try { fs.unlinkSync(keyFilePath); } catch (_) {}
    console.log(`[Store-Recovery] ${verifyAccounts.length} Konten erfolgreich zum derived-key zurückmigriert.`);
  } catch (e) {
    console.error('[Store-Recovery] Rückmigration fehlgeschlagen:', e.message);
    const configPath = path.join(userDataPath, 'coremail-config.json');
    const backupPath = configPath + '.safestorage-backup';
    if (!fs.existsSync(configPath) && fs.existsSync(backupPath)) {
      try { fs.copyFileSync(backupPath, configPath); } catch (_) {}
    }
  }
}

// ── v6.13.0: Config-Verschlüsselung mit OS-Schlüsselbund (safeStorage v2) ────
// NUR auf macOS/Windows: Keychain bzw. DPAPI sind dort zuverlässig. Linux
// behält BEWUSST den derived-Key — die v6.2.0-Migration hat dort real Konten
// zerstört (libsecret/KWallet vergisst Sessions, siehe Postmortem v6.3.1).
// Prinzipien aus dem Postmortem:
//   - NIE destruktiv: Backup vor der Migration bleibt dauerhaft liegen,
//     neue Datei wird erst nach Read-Back-Verifikation atomar eingetauscht.
//   - Bei JEDEM Fehler: unverändert beim bisherigen Schema bleiben.
//   - Keyfile wird ZULETZT geschrieben — ein Crash mittendrin lässt die
//     alte Config unangetastet (Selbstheilung räumt Reste weg).
const SAFESTORAGE_V2_KEYFILE = 'coremail-keyring-v2.enc';

async function migrateToSafeStorageV2() {
  if (process.platform === 'linux') return;

  let available = false;
  try { available = safeStorage.isEncryptionAvailable(); } catch (_) {}
  if (!available) return;

  const userDataPath = app.getPath('userData');
  const keyFilePath = path.join(userDataPath, SAFESTORAGE_V2_KEYFILE);
  const configPath = path.join(userDataPath, 'coremail-config.json');
  const backupPath = configPath + '.pre-safestorage-v2';
  const tmpName = 'coremail-config-v2tmp';
  const tmpPath = path.join(userDataPath, tmpName + '.json');

  const derivedReadable = () => {
    try {
      const t = new Store({ encryptionKey: deriveEncryptionKey(), name: 'coremail-config' });
      return Object.keys(t.store).length > 0 ? t : null;
    } catch (_) { return null; }
  };

  // ── Fall 1: v2 bereits aktiv → Store mit Schlüsselbund-Key öffnen ──────────
  if (fs.existsSync(keyFilePath)) {
    try {
      const key = safeStorage.decryptString(fs.readFileSync(keyFilePath));
      const s = new Store({ encryptionKey: key, name: 'coremail-config' });
      s.get('accounts', []); // Lese-Test — wirft bei falschem Key
      store = s;
      invalidateAccountsCache();
      console.log('[Store] safeStorage-v2 aktiv (OS-Schlüsselbund).');
      // Das Migrations-Backup ist mit dem ableitbaren Alt-Key verschlüsselt —
      // dauerhaft neben der starken Config würde es deren Schutz aushebeln.
      // Nach 30 Tagen stabilen v2-Betriebs wird es darum entfernt.
      try {
        if (fs.existsSync(backupPath)) {
          const ageDays = (Date.now() - fs.statSync(backupPath).mtimeMs) / 86400000;
          if (ageDays > 30) {
            fs.unlinkSync(backupPath);
            console.log('[Store] Migrations-Backup nach 30 Tagen v2-Betrieb entfernt.');
          }
        }
      } catch (_) {}
      return;
    } catch (e) {
      console.error('[Store] v2-Keyfile vorhanden, aber Öffnen fehlgeschlagen:', e.message);
      // Selbstheilung: Wenn die Config in Wahrheit noch derived-lesbar ist
      // (z.B. Crash zwischen Migrationsschritten), Keyfile-Rest entfernen.
      const d = derivedReadable();
      if (d) {
        try { fs.unlinkSync(keyFilePath); } catch (_) {}
        store = d;
        invalidateAccountsCache();
        console.warn('[Store] Keyfile-Rest entfernt — derived-Store bleibt aktiv.');
        return;
      }
      // Config v2-verschlüsselt, aber Schlüsselbund gibt den Key nicht her
      // (anderes Login, Keychain-Reset): NIE Daten zerstören — die aktuelle
      // Config wird BEISEITEGELEGT (nicht überschrieben), erst dann das
      // Backup eingespielt. Der Nutzer wird sichtbar informiert, weil das
      // Backup vom Migrationstag stammen kann (Review-Befund v6.13.0).
      if (fs.existsSync(backupPath)) {
        try {
          const lockedPath = configPath + '.v2-locked-' + Date.now();
          if (fs.existsSync(configPath)) fs.renameSync(configPath, lockedPath);
          fs.copyFileSync(backupPath, configPath);
          const d2 = derivedReadable();
          if (d2) {
            try { fs.unlinkSync(keyFilePath); } catch (_) {}
            store = d2;
            invalidateAccountsCache();
            const backupDate = new Date(fs.statSync(backupPath).mtimeMs).toLocaleDateString('de-DE');
            console.warn('[Store] Aus pre-safestorage-v2-Backup wiederhergestellt (Stand: ' + backupDate + ').');
            addLogEntry('settings', 'Schlüsselbund-Zugriff fehlgeschlagen — Backup wiederhergestellt', `Stand: ${backupDate}; neuere Config gesichert als ${path.basename(lockedPath)}`);
            dialog.showMessageBox({
              type: 'warning',
              title: 'CoreMail — Konten wiederhergestellt',
              message: 'Der Zugriff auf den OS-Schlüsselbund ist fehlgeschlagen.',
              detail: `CoreMail hat deine Konten aus einem Backup vom ${backupDate} wiederhergestellt. Änderungen seit diesem Datum (neue Konten, Einstellungen) können fehlen.\n\nDie neuere, aktuell nicht lesbare Konfiguration wurde NICHT gelöscht, sondern gesichert als:\n${path.basename(lockedPath)}`,
              buttons: ['OK']
            }).catch(() => {});
            return;
          }
          // Backup selbst nicht lesbar → alles zurück wie es war
          try { fs.unlinkSync(configPath); } catch (_) {}
          if (fs.existsSync(lockedPath)) fs.renameSync(lockedPath, configPath);
        } catch (_) {}
      }
      store = new Store({ encryptionKey: deriveEncryptionKey(), name: 'coremail-config-pending' });
      console.error('[Store] v2-Recovery nicht möglich — Pending-Fallback, Config bleibt unangetastet.');
      dialog.showMessageBox({
        type: 'error',
        title: 'CoreMail — Zugangsdaten nicht verfügbar',
        message: 'Der Zugriff auf den OS-Schlüsselbund ist fehlgeschlagen.',
        detail: 'Deine verschlüsselte Konfiguration bleibt unverändert auf der Festplatte erhalten, kann aber ohne den Schlüssel nicht gelesen werden. Starte die App neu, nachdem der Schlüsselbund wieder verfügbar ist (z.B. nach erneutem Login).',
        buttons: ['OK']
      }).catch(() => {});
      return;
    }
  }

  // ── Fall 2: Migration derived → v2 ─────────────────────────────────────────
  try {
    // Nur migrieren, wenn der aktuelle Store der echte derived-Store mit
    // Daten ist (nicht der Pending-Fallback aus dem Modul-Load).
    if (!store || (store.path || '').includes('pending')) {
      // Gürtel+Hosenträger: Sollte die Config aus irgendeinem Grund
      // unlesbar sein, obwohl kein v2-Keyfile existiert, und ein Backup
      // liegt vor → Restore versuchen statt dauerhaft auf Pending zu hängen.
      if (store && (store.path || '').includes('pending') && fs.existsSync(backupPath) && !derivedReadable()) {
        try {
          fs.copyFileSync(backupPath, configPath);
          const d = derivedReadable();
          if (d) {
            store = d;
            invalidateAccountsCache();
            console.warn('[Store] Unlesbare Config aus pre-safestorage-v2-Backup wiederhergestellt.');
          }
        } catch (_) {}
      }
      return;
    }
    const currentData = store.store;
    if (!currentData || Object.keys(currentData).length === 0) return;

    // 1) Dauerhaftes Backup der bisherigen Config
    if (fs.existsSync(configPath)) fs.copyFileSync(configPath, backupPath);

    // 2) Zufalls-Key; neue Datei unter TEMPORÄREM Namen schreiben + verifizieren
    const newKey = crypto.randomBytes(32).toString('hex');
    try { fs.unlinkSync(tmpPath); } catch (_) {}
    const tmp = new Store({ encryptionKey: newKey, name: tmpName });
    tmp.store = currentData;
    const check = new Store({ encryptionKey: newKey, name: tmpName });
    const wantAccounts = JSON.stringify(currentData.accounts ?? null);
    if (JSON.stringify(check.get('accounts', null)) !== wantAccounts) {
      throw new Error('Read-Back-Verifikation fehlgeschlagen');
    }

    // 3) Keyfile VOR dem Tausch schreiben (inkl. Roundtrip-Prüfung):
    //    Crash nach diesem Schritt, aber vor dem Rename → nächster Start
    //    landet in Fall 1, Decrypt klappt, Config ist noch derived-lesbar
    //    → Selbstheilung entfernt den Keyfile-Rest. Crash NACH dem Rename
    //    → Fall 1 öffnet normal. Kein Fenster mehr, in dem die Config
    //    v2-verschlüsselt, der Key aber verloren ist (Review-Befund v6.13.0).
    fs.writeFileSync(keyFilePath, safeStorage.encryptString(newKey));
    if (safeStorage.decryptString(fs.readFileSync(keyFilePath)) !== newKey) {
      throw new Error('Keyfile-Roundtrip fehlgeschlagen');
    }

    // 4) Atomarer Tausch
    fs.renameSync(tmpPath, configPath);

    store = new Store({ encryptionKey: newKey, name: 'coremail-config' });
    invalidateAccountsCache();
    console.log('[Store] Migration auf safeStorage-v2 erfolgreich (Backup: ' + backupPath + ').');
    addLogEntry('settings', 'Zugangsdaten-Verschlüsselung auf OS-Schlüsselbund umgestellt', 'Backup: coremail-config.json.pre-safestorage-v2');
  } catch (e) {
    console.error('[Store] safeStorage-v2-Migration fehlgeschlagen — bisheriges Schema bleibt aktiv:', e.message);
    try { fs.unlinkSync(tmpPath); } catch (_) {}
    try { fs.unlinkSync(keyFilePath); } catch (_) {}
    // Sicherstellen, dass der derived-Store lesbar ist; sonst Backup zurück
    if (!derivedReadable() && fs.existsSync(backupPath)) {
      try { fs.copyFileSync(backupPath, configPath); } catch (_) {}
    }
    try {
      store = new Store({ encryptionKey: deriveEncryptionKey(), name: 'coremail-config' });
      invalidateAccountsCache();
    } catch (e2) {
      console.error('[Store] Fallback-Öffnen fehlgeschlagen:', e2.message);
    }
  }
}

// v6.13.0: Nur eine Instanz — zwei parallele Prozesse könnten sich die
// Store-Migration zerschiessen (Review-Befund), und ein Mail-Client braucht
// ohnehin nur ein Fenster. Zweitstart fokussiert die bestehende Instanz.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}
app.on('second-instance', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  await recoverFromSafeStorageStore();
  await migrateToSafeStorageV2();
  // Aufräumen: leerer Fallback-Store aus Modul-Load (falls vorhanden)
  try {
    const pendingPath = path.join(app.getPath('userData'), 'coremail-config-pending.json');
    if (fs.existsSync(pendingPath)) fs.unlinkSync(pendingPath);
  } catch (_) {}
  initSearchIndex();
  createWindow();
  // Sync system launcher icons in background (non-blocking)
  setTimeout(() => syncSystemIcons(), 3000);
  // Logbuch: App-Start protokollieren
  addLogEntry('app_start', `CoreMail v${APP_VERSION} gestartet`, `Plattform: ${process.platform}`);
  // Zeitversetzt senden: alle 30s prüfen
  const scheduledEmailInterval = setInterval(() => processScheduledEmails(), 30000);
  // v6.6.0: Snooze-Erinnerungen — gleicher Tick wie scheduledEmails
  const snoozeInterval = setInterval(() => processSnoozes(), 30000);
  app.on('before-quit', () => {
    clearInterval(scheduledEmailInterval);
    clearInterval(snoozeInterval);
  });
});

// v3.0.3: Refresh Linux system launcher icons from GitHub so the correct icon
// appears in the app drawer after an in-app update (no re-install needed).
function syncSystemIcons() {
  if (process.platform !== 'linux') return;
  try {
    const { execFile } = require('child_process');
    const os = require('os');
    const home = os.homedir();
    const ICON_BASE = 'https://raw.githubusercontent.com/Zenovs/coremail/initial-code/public/icons';
    const SIZES = [16, 32, 64, 128, 256, 512];
    const APP_VERSION = app.getVersion();
    const versionKey = `iconsVersion`;
    const storedVersion = store.get(versionKey, '0');

    // Only update if app version changed (avoids unnecessary network requests)
    if (storedVersion === APP_VERSION) return;

    const downloadFile = (url, dest) => new Promise((resolve) => {
      const file = fs.createWriteStream(dest);
      https.get(url, (res) => {
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', () => { file.close(); resolve(); });
    });

    (async () => {
      try {
        for (const sz of SIZES) {
          const dir = path.join(home, `.local/share/icons/hicolor/${sz}x${sz}/apps`);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          await downloadFile(`${ICON_BASE}/icon-${sz}.png`, path.join(dir, 'coremail.png'));
        }
        // pixmaps (used as absolute icon path in .desktop file)
        const pixDir = path.join(home, '.local/share/pixmaps');
        if (!fs.existsSync(pixDir)) fs.mkdirSync(pixDir, { recursive: true });
        const pixIconPath = path.join(pixDir, 'coremail.png');
        await downloadFile(`${ICON_BASE}/icon-256.png`, pixIconPath);

        // Rewrite .desktop file — always create/update after version change
        const desktopDir = path.join(home, '.local/share/applications');
        if (!fs.existsSync(desktopDir)) fs.mkdirSync(desktopDir, { recursive: true });
        const desktopFile = path.join(desktopDir, 'coremail.desktop');
        const appImagePath = path.join(home, '.local/bin/coremail-desktop');
        // v6.3.6: TMPDIR auf ~/.cache setzen damit AppImage-Extraktion nicht in /tmp landet.
        // t2linux/Ubuntu-Kernel blockiert ESRCH für Shared Memory aus /tmp-Prozessen.
        const extractTmpDir = path.join(home, '.cache', 'coremail-extract');
        try { fs.mkdirSync(extractTmpDir, { recursive: true }); } catch (_) {}
        const desktopContent = [
          '[Desktop Entry]',
          'Version=1.0',
          'Type=Application',
          'Name=CoreMail Desktop',
          'Comment=E-Mail Client für Linux',
          `Exec=env APPIMAGE_EXTRACT_AND_RUN=1 TMPDIR=${extractTmpDir} ${appImagePath} --no-sandbox`,
          `Icon=${pixIconPath}`,
          'Terminal=false',
          'Categories=Network;Email;Office;',
          'StartupNotify=true',
          'StartupWMClass=coremail-desktop',
          'Keywords=email;mail;imap;smtp;',
          ''
        ].join('\n');
        fs.writeFileSync(desktopFile, desktopContent);
        try { fs.chmodSync(desktopFile, 0o755); } catch (_) {}

        // Refresh caches
        execFile('gtk-update-icon-cache', ['-f', path.join(home, '.local/share/icons/hicolor')], () => {});
        execFile('update-desktop-database', [path.join(home, '.local/share/applications')], () => {});

        store.set(versionKey, APP_VERSION);
        console.log('[Icons] System launcher icons updated to v' + APP_VERSION);
      } catch (e) {
        console.warn('[Icons] Could not update system icons:', e.message);
      }
    })();
  } catch (e) {
    console.warn('[Icons] syncSystemIcons error:', e.message);
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// ============ HELPER FUNCTIONS ============

// Accounts in-memory cachen — getAccountById läuft in praktisch jedem
// IPC-Handler und entschlüsselte sonst jedes Mal die komplette Config.
let accountsCache = null;
function invalidateAccountsCache() { accountsCache = null; }
function getCachedAccounts() {
  if (!accountsCache) accountsCache = store.get('accounts', []);
  return accountsCache;
}

function getAccountById(accountId) {
  return getCachedAccounts().find(acc => acc.id === accountId);
}

// Security helper: returns rejectUnauthorized based on per-account flag.
// Default (flag not set) → true (validates certs).
// Bestehende Konten werden bei load_accounts auf allowInsecureTLS: true migriert,
// damit sich an deren Verhalten nichts ändert.
function shouldRejectUnauthorized(account) {
  return !(account?.allowInsecureTLS === true);
}

// List-Unsubscribe (RFC 2369 + RFC 8058) aus Mail-Headern extrahieren.
// Liefert { mailto, http, oneClick } — alles optional. oneClick=true bedeutet
// RFC 8058: ein POST genügt (kein Browser-Tab, keine Bestätigung), wenn der
// Server `List-Unsubscribe-Post: List-Unsubscribe=One-Click` mitsendet.
function extractListUnsubscribe(parsedMail) {
  if (!parsedMail) return null;
  let raw = null;
  try {
    if (parsedMail.headers && typeof parsedMail.headers.get === 'function') {
      raw = parsedMail.headers.get('list-unsubscribe');
    }
  } catch (_) {}
  if (!raw && parsedMail.headerLines) {
    const line = parsedMail.headerLines.find(h => h.key === 'list-unsubscribe');
    if (line) raw = line.line.replace(/^list-unsubscribe:\s*/i, '');
  }
  if (!raw || typeof raw !== 'string') return null;

  const items = raw.match(/<([^>]+)>/g) || [];
  let mailto = null, http = null;
  for (const item of items) {
    const v = item.slice(1, -1).trim();
    if (v.startsWith('mailto:')) mailto = mailto || v;
    else if (v.startsWith('http://') || v.startsWith('https://')) http = http || v;
  }
  if (!mailto && !http) return null;

  let oneClick = false;
  try {
    const post = parsedMail.headers?.get?.('list-unsubscribe-post');
    if (post && /one-click/i.test(String(post))) oneClick = true;
  } catch (_) {}

  return { mailto, http, oneClick };
}


// v2.0.0: IMAP-Konfiguration für ein Konto erstellen
function getImapConfigForAccount(account) {
  return {
    imap: {
      user: account.imap.username,
      password: account.imap.password,
      host: account.imap.host,
      port: parseInt(account.imap.port) || 993,
      tls: account.imap.tls !== false,
      authTimeout: 15000,
      connTimeout: 30000,
      tlsOptions: { rejectUnauthorized: shouldRejectUnauthorized(account) }
    }
  };
}

// ── IMAP Connection Pool ────────────────────────────────────────────────────
// Keeps one live IMAP connection per account, reconnects transparently on error.
// Avoids the TCP handshake + TLS + auth overhead (typically 1–3s) on every fetch.
const imapPool = new Map(); // accountId → { connection, busy }
const IMAP_IDLE_TTL = 5 * 60 * 1000; // close connections idle for > 5 minutes

const imapPoolSweepInterval = setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of imapPool) {
    if (!entry.busy && (now - entry.lastUsed) > IMAP_IDLE_TTL) {
      try { entry.connection.end(); } catch (_) {}
      imapPool.delete(id);
      console.log(`[IMAPPool] Closed idle connection for ${id}`);
    }
  }
}, 60_000);

async function getPooledImapConnection(account) {
  const entry = imapPool.get(account.id);
  if (entry && !entry.busy) {
    try {
      entry.busy = true;
      entry.lastUsed = Date.now();
      return entry.connection;
    } catch (_) {
      imapPool.delete(account.id);
    }
  }
  // Create a new connection and attach an error listener so socket errors
  // don't bubble up as uncaught exceptions — the pool will recreate on next use.
  const config = getImapConfigForAccount(account);
  const connection = await imapSimple.connect(config);
  connection.imap.on('error', (err) => {
    console.warn(`[IMAPPool] socket error for ${account.id}:`, err?.message);
    const e = imapPool.get(account.id);
    if (e?.connection === connection) imapPool.delete(account.id);
  });
  connection.imap.on('close', () => {
    const e = imapPool.get(account.id);
    if (e?.connection === connection) imapPool.delete(account.id);
  });
  const current = imapPool.get(account.id);
  if (current?.busy) {
    // Pool-Slot ist gerade belegt — Überlauf-Verbindung nicht registrieren,
    // sonst würde der Release des anderen Aufrufers unsere Verbindung freigeben.
    connection.__overflow = true;
  } else {
    if (current) { try { current.connection.end(); } catch (_) {} }
    imapPool.set(account.id, { connection, busy: true, lastUsed: Date.now() });
  }
  return connection;
}

function releaseImapConnection(accountId, destroy = false, connection = null) {
  if (connection?.__overflow) {
    try { connection.end(); } catch (_) {}
    return;
  }
  const entry = imapPool.get(accountId);
  if (!entry) return;
  if (connection && entry.connection !== connection) return;
  if (destroy) {
    try { entry.connection.end(); } catch (_) {}
    imapPool.delete(accountId);
  } else {
    entry.busy = false;
    entry.lastUsed = Date.now();
  }
}

// Clean up all pooled connections on quit
app.on('before-quit', () => {
  clearInterval(imapPoolSweepInterval);
  for (const [, entry] of imapPool) {
    try { entry.connection.end(); } catch (_) {}
  }
  imapPool.clear();
});

// v2.8.4: Find the Sent folder by \Sent attribute or common names
async function findSentFolderName(connection) {
  try {
    const boxes = await connection.getBoxes();
    const COMMON_SENT = ['Sent', 'Sent Items', 'Sent Mail', '[Gmail]/Sent Mail',
      'INBOX.Sent', 'Gesendet', 'INBOX.Gesendet', 'Gesendete Elemente'];

    const search = (boxes, prefix) => {
      for (const [name, box] of Object.entries(boxes)) {
        const sep = box.delimiter || '/';
        const fullName = prefix ? `${prefix}${sep}${name}` : name;
        if (box.attribs && (box.attribs.includes('\\Sent') || box.attribs.includes('\\sent')))
          return fullName;
        if (box.children) {
          const found = search(box.children, fullName);
          if (found) return found;
        }
      }
      return null;
    };

    const byAttrib = search(boxes, '');
    if (byAttrib) return byAttrib;

    // Collect all folder names and try common patterns
    const allNames = [];
    const collect = (boxes, prefix) => {
      for (const [name, box] of Object.entries(boxes)) {
        const sep = box.delimiter || '/';
        const fullName = prefix ? `${prefix}${sep}${name}` : name;
        allNames.push(fullName);
        if (box.children) collect(box.children, fullName);
      }
    };
    collect(boxes, '');

    for (const common of COMMON_SENT) {
      const found = allNames.find(n => n.toLowerCase() === common.toLowerCase());
      if (found) return found;
    }
    return null;
  } catch (e) {
    console.error('[Sent] findSentFolderName error:', e);
    return null;
  }
}

// v6.13.1: Gesendete Mail als Kopie in den IMAP-Gesendet-Ordner schreiben.
//
// Lag vorher inline in smtp:sendForAccount — mit zwei Fehlern, die vor allem
// Weiterleitungen trafen, weil nur die die Originalanhänge mitschleppen:
//   1. ein fixes 15s-Timeout über Connect + Login + getBoxes + APPEND. Eine
//      Antwort ist ein paar KB und durch, bevor der Timer läuft; eine
//      Weiterleitung mit 3 MB Anhang lief regelmässig hinein.
//   2. `newline: 'unix'` — RFC 3501 verlangt CRLF im APPEND-Literal; strenge
//      Server (Exchange, Cyrus) quittieren LF-Zeilenenden mit BAD.
// Beides scheiterte lautlos (nur console.error), darum landet ein Fehlschlag
// jetzt auch im Logbuch.
async function saveToSentFolder(account, mailOptions, context = '', messageId = null) {
  let imapConn;
  try {
    if (!account?.imap?.host) return; // Konto ohne IMAP — nichts zu tun

    const streamTransport = nodemailer.createTransport({ streamTransport: true, newline: 'windows' });
    // Message-ID der tatsächlich versendeten Mail übernehmen. Ohne das erzeugt
    // dieser zweite Build eine neue — die Kopie im Gesendet-Ordner gehörte dann
    // aus Sicht jedes Clients zu einer anderen Nachricht als die zugestellte,
    // und Threading/Undo/Snooze (Suche per Message-ID) griffen ins Leere.
    const info = await streamTransport.sendMail(messageId ? { ...mailOptions, messageId } : mailOptions);
    const chunks = [];
    await new Promise((resolve, reject) => {
      info.message.on('data', c => chunks.push(c));
      info.message.on('end', resolve);
      info.message.on('error', reject);
    });
    // Einzelne LF im Body (der Editor liefert Unix-Umbrüche) auf CRLF ziehen —
    // `newline: 'windows'` deckt nur die Struktur ab, nicht den Nutztext.
    const rawMessage = Buffer.from(
      Buffer.concat(chunks).toString('latin1').replace(/\r?\n/g, '\r\n'),
      'latin1'
    );

    // Timeout mit der Nachrichtengrösse skalieren: 30s Grundbudget für
    // Connect/Login/getBoxes, plus 20s pro MB Upload, gedeckelt bei 5 Minuten.
    const megabytes = rawMessage.length / (1024 * 1024);
    const timeoutMs = Math.min(300_000, 30_000 + Math.ceil(megabytes) * 20_000);

    let timer;
    await Promise.race([
      (async () => {
        imapConn = await imapSimple.connect(getImapConfigForAccount(account));
        const sentFolder = await findSentFolderName(imapConn);
        if (!sentFolder) throw new Error('Kein Gesendet-Ordner auf dem Server gefunden');
        await new Promise((resolve, reject) => {
          // v7.1: KEINE date-Option — node-imap prüft sie mit dem in Node 22
          // (Electron 41) entfernten util.isDate und crashte mit "isDate is
          // not a function". Seit dem Electron-Upgrade scheiterte dadurch
          // JEDE Gesendet-Ablage still (nur Logbuch-Eintrag). Ohne date
          // stempelt der Server die aktuelle Zeit — für soeben gesendete
          // Mails genau richtig.
          imapConn.imap.append(rawMessage, { mailbox: sentFolder, flags: ['\\Seen'] },
            err => err ? reject(err) : resolve());
        });
      })(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`IMAP-APPEND-Timeout nach ${Math.round(timeoutMs / 1000)}s (${megabytes.toFixed(1)} MB)`)),
          timeoutMs
        );
      })
    ]).finally(() => clearTimeout(timer));
  } catch (err) {
    console.error('[Sent] Kopie im Gesendet-Ordner fehlgeschlagen:', err.message);
    addLogEntry('error', 'Mail gesendet, aber nicht im Gesendet-Ordner gespeichert',
      `${context ? context + ' — ' : ''}${err.message}`);
  } finally {
    if (imapConn) try { await imapConn.end(); } catch (_) {}
  }
}

// v2.1.0: SMTP-Transporter für ein Konto erstellen (mit Anzeigename-Unterstützung)
function getSmtpTransporterForAccount(account) {
  const smtp = account.smtp;
  const port = parseInt(smtp.port) || 587;

  // Auto-detect secure mode: port 465 = implicit TLS, 587/25 = STARTTLS
  // If smtp.secure is explicitly set, respect it; otherwise derive from port.
  let secure;
  if (smtp.secure !== undefined && smtp.secure !== null) {
    secure = smtp.secure !== false;
  } else {
    secure = port === 465;
  }

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port,
    secure,
    auth: {
      user: smtp.username,
      pass: smtp.password
    },
    tls: { rejectUnauthorized: shouldRejectUnauthorized(account) },  // strict by default, opt-in für self-signed via account.allowInsecureTLS
    connectionTimeout: 15000,            // 15s to connect
    greetingTimeout:   10000,            // 10s for SMTP greeting
    socketTimeout:     30000,            // 30s per socket operation
  });

  const email = smtp.fromEmail || smtp.username;
  const displayName = account.displayName ? account.displayName.replace(/["\\\r\n]/g, '') : '';
  const fromEmail = displayName ? `"${displayName}" <${email}>` : email;

  return { transporter, fromEmail };
}

// v2.3.0: Improved icon path resolution
function getIconPath() {
  if (app.isPackaged) {
    // Try multiple locations for packaged app
    const locations = [
      path.join(process.resourcesPath, 'icon.png'),
      path.join(process.resourcesPath, 'app.asar', 'assets', 'icon.png'),
      path.join(__dirname, 'assets', 'icon.png')
    ];
    for (const loc of locations) {
      if (fs.existsSync(loc)) {
        return loc;
      }
    }
  }
  return path.join(__dirname, 'assets', 'icon.png');
}

// v2.3.0: Get notification icon (transparent background)
function getNotificationIconPath() {
  const iconName = 'notification.png';
  
  if (app.isPackaged) {
    const locations = [
      path.join(process.resourcesPath, iconName),
      path.join(process.resourcesPath, 'app.asar', 'assets', iconName),
      path.join(__dirname, 'assets', iconName)
    ];
    for (const loc of locations) {
      if (fs.existsSync(loc)) {
        return loc;
      }
    }
  }
  
  const devPath = path.join(__dirname, 'assets', iconName);
  if (fs.existsSync(devPath)) {
    return devPath;
  }
  
  // Fallback to regular icon if notification icon not found
  return getIconPath();
}

// ============ UPDATE FUNCTIONS ============

// v6.5.0: Plattform-spezifische Asset-Suche im GitHub Release.
// Linux  → .AppImage (Arch x86_64/arm64) — In-App-Update mit Hash-Check
// macOS  → .dmg      (Arch arm64/x64)    — wird an Finder übergeben
// Windows → .exe     (Arch x64)          — wird an NSIS-Installer übergeben
function getPlatformAssetMatcher() {
  const platform = process.platform;
  if (platform === 'linux') {
    return {
      ext: '.appimage',
      archSuffix: process.arch === 'arm64' ? 'arm64' : 'x86_64',
      kind: 'appimage'
    };
  }
  if (platform === 'darwin') {
    return {
      ext: '.dmg',
      archSuffix: process.arch === 'arm64' ? 'arm64' : 'x64',
      kind: 'dmg'
    };
  }
  if (platform === 'win32') {
    return {
      ext: '.exe',
      archSuffix: 'x64',
      kind: 'exe'
    };
  }
  return null;
}

async function checkForUpdates(silent = false) {
  // 15-second hard timeout — raw https.get has no timeout and hangs indefinitely
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { 'User-Agent': 'CoreMail-Desktop', 'Accept': 'application/vnd.github.v3+json' },
      signal: controller.signal
    });
    clearTimeout(timer);

    if (!resp.ok) throw new Error(`GitHub API HTTP ${resp.status}`);
    const release = await resp.json();

    const latestVersion = release.tag_name?.replace('v', '') || '';
    const matcher = getPlatformAssetMatcher();
    const platformAsset = matcher
      ? (release.assets || []).find(a => {
          const name = (a.name || '').toLowerCase();
          return name.endsWith(matcher.ext) &&
            name.includes(matcher.archSuffix.toLowerCase()) &&
            a.browser_download_url;
        })
      : null;
    const hasUpdate = compareVersions(latestVersion, APP_VERSION) > 0 && !!platformAsset;
    const downloadUrl = platformAsset?.browser_download_url || null;
    // Security v6.2.0: SHA256SUMS-Manifest aus dem Release fürs Update-Verify
    const sumsAsset = (release.assets || []).find(a => a.name === 'SHA256SUMS.txt');
    const sumsUrl = sumsAsset?.browser_download_url || null;
    const expectedFilename = platformAsset?.name || null;
    const releaseUrl = release.html_url || null;
    const assetKind = matcher?.kind || null;

    if (hasUpdate && !silent && mainWindow) {
      mainWindow.webContents.send('update:available', { version: latestVersion, notes: release.body || '', downloadUrl, sumsUrl, expectedFilename, releaseUrl, assetKind });
    }

    return { success: true, currentVersion: APP_VERSION, latestVersion, hasUpdate, releaseNotes: release.body || '', downloadUrl, sumsUrl, expectedFilename, releaseUrl, assetKind, publishedAt: release.published_at };
  } catch (e) {
    clearTimeout(timer);
    const msg = e.name === 'AbortError' ? 'Timeout — GitHub API nicht erreichbar (>15s)' : e.message;
    return { success: false, error: msg, currentVersion: APP_VERSION };
  }
}


// Security v6.2.0: SHA-256-Manifest des Releases laden und expected hash für eine Datei extrahieren.
// Format SHA256SUMS.txt (eine Zeile pro Datei):  <hex64>  <filename>
async function fetchExpectedSha256(sumsUrl, expectedFilename) {
  if (!sumsUrl || !expectedFilename) return null;
  try {
    const resp = await fetch(sumsUrl, {
      headers: { 'User-Agent': 'CoreMail-Desktop' }
    });
    if (!resp.ok) return null;
    const text = await resp.text();
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
      if (m && path.basename(m[2].trim()) === expectedFilename) return m[1].toLowerCase();
    }
    return null;
  } catch (e) {
    console.warn('[Update] SHA256SUMS-Fetch fehlgeschlagen:', e.message);
    return null;
  }
}

async function computeFileSha256(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  return new Promise((resolve, reject) => {
    stream.on('data', d => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// Security v6.9.2: Update-Downloads dürfen NUR von den offiziellen GitHub-
// Release-Assets kommen. Vorher hätte ein kompromittierter Renderer eine
// beliebige URL + passendes SHA256-Manifest liefern und so eine fremde Binary
// herunterladen und ausführen lassen können (Manifest war selbst vom Angreifer).

async function downloadUpdate(downloadUrl, sumsUrl = null, expectedFilename = null) {
  if (!isTrustedUpdateUrl(downloadUrl) || (sumsUrl && !isTrustedUpdateUrl(sumsUrl))) {
    return { success: false, error: 'Update-URL nicht vertrauenswürdig (nur offizielle GitHub-Releases erlaubt)' };
  }
  const downloadDir = app.getPath('downloads');
  // v6.5.0: Dateiname richtet sich nach der erwarteten Asset-Endung —
  // damit Mac-Finder die .dmg mountet und Windows-Explorer die .exe als Installer erkennt.
  const matcher = getPlatformAssetMatcher();
  const ext = matcher?.ext || '.AppImage';
  const filename = expectedFilename || `CoreMail-Desktop-update${ext}`;
  const filePath = path.join(downloadDir, filename);

  // Remove existing partial download
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}

  // 10-minute hard timeout for the whole download (node-fetch follows redirects automatically)
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10 * 60 * 1000);

  let fileStream;
  try {
    const resp = await fetch(downloadUrl, {
      headers: { 'User-Agent': 'CoreMail-Desktop', 'Accept': 'application/octet-stream' },
      signal: controller.signal
      // node-fetch v2 follows redirects automatically (default: redirect='follow')
    });

    if (!resp.ok) throw new Error(`HTTP-Fehler: ${resp.status}`);

    const totalSize = parseInt(resp.headers.get('content-length') || '0', 10);
    const hasValidSize = totalSize > 0;
    let downloadedSize = 0;

    fileStream = fs.createWriteStream(filePath);

    // Stream body to file with progress reporting
    await new Promise((resolve, reject) => {
      resp.body.on('data', (chunk) => {
        downloadedSize += chunk.length;
        const progress = hasValidSize
          ? Math.round((downloadedSize / totalSize) * 100)
          : Math.min(99, Math.round(downloadedSize / (1024 * 1024)));
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update:progress', {
            progress, downloaded: downloadedSize,
            total: hasValidSize ? totalSize : downloadedSize, hasValidSize
          });
        }
      });
      resp.body.on('error', reject);
      fileStream.on('error', reject);
      fileStream.on('finish', resolve);
      resp.body.pipe(fileStream);
    });

    clearTimeout(timer);

    const stats = fs.statSync(filePath);
    if (stats.size < 1024 * 1024) { // AppImage must be at least 1 MB
      fs.unlinkSync(filePath);
      throw new Error('Download unvollständig — Datei zu klein');
    }

    fs.chmodSync(filePath, 0o755);
    console.log('[Update] Download abgeschlossen:', filePath, 'Grösse:', stats.size);

    // Security v6.2.0: SHA-256-Verifikation gegen SHA256SUMS-Manifest aus dem Release.
    // Wenn das Manifest fehlt (alte Releases), wird die Datei zwar akzeptiert,
    // aber ein deutlicher Warn-Log ausgegeben. Aktuelle Releases (v6.2.0+)
    // haben das Manifest verpflichtend.
    let verified = null;
    if (sumsUrl && expectedFilename) {
      const expected = await fetchExpectedSha256(sumsUrl, expectedFilename);
      if (expected) {
        const actual = (await computeFileSha256(filePath)).toLowerCase();
        if (actual !== expected) {
          fs.unlinkSync(filePath);
          console.error('[Update] SHA-256-Mismatch! erwartet:', expected, 'gemessen:', actual);
          throw new Error('Sicherheitsprüfung fehlgeschlagen — Hash der heruntergeladenen Datei stimmt nicht mit dem Release-Manifest überein.');
        }
        verified = { sha256: actual };
        console.log('[Update] SHA-256 verifiziert:', actual);
      } else {
        console.warn('[Update] SHA256SUMS-Manifest nicht im Release gefunden — ungeprüft akzeptiert.');
      }
    } else {
      console.warn('[Update] Kein Manifest-URL übergeben — Hash-Verifikation übersprungen (Legacy-Pfad).');
    }

    return { success: true, filePath, size: stats.size, verified };

  } catch (e) {
    clearTimeout(timer);
    try { fileStream?.close?.(); } catch {}
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
    const msg = e.name === 'AbortError' ? 'Download-Timeout (10 Minuten überschritten)' : e.message;
    console.error('[Update] Download-Fehler:', msg);
    return { success: false, error: msg };
  }
}

// ============ NOTIFICATION FUNCTIONS ============

// v2.3.0: Updated to use notification icon with transparent background
function showNotification(title, body, onClick = null) {
  if (!Notification.isSupported()) {
    console.log('Notifications not supported');
    return;
  }

  const notification = new Notification({
    title,
    body,
    icon: getNotificationIconPath(),
    silent: store.get('appSettings.notificationSound', true) === false
  });

  if (onClick) {
    notification.on('click', onClick);
  }

  notification.show();
  return notification;
}

function updateBadgeCount(count) {
  try {
    if (process.platform === 'darwin') {
      app.dock?.setBadge(count > 0 ? String(count) : '');
    } else if (process.platform === 'linux') {
      // Linux uses Unity/GNOME launcher API
      if (app.setBadgeCount) {
        app.setBadgeCount(count);
      }
    }
    // Windows: kein natives Zahlen-Badge — der Fenstertitel zeigt den Zähler.
  } catch (e) {
    console.warn('[Badge] update error:', e.message);
  }
}


// ============ IPC HANDLERS ============

// === THEME ICON MANAGEMENT (v2.2.0) ===
const THEME_ICONS = {
  dark: 'dark.png',
  light: 'light.png',
  minimal: 'minimal.png',
  morphismus: 'morphismus.png',
  glas: 'glas.png',
  retro: 'retro.png',
  foundations: 'foundations.png',
  nerd: 'dark.png',
  colorful: 'dark.png',
  indie: 'dark.png'
};

// v2.3.0: Fixed icon path resolution for packaged apps
function getIconPathForTheme(themeName) {
  const iconFile = THEME_ICONS[themeName] || THEME_ICONS['dark'];
  
  if (app.isPackaged) {
    // In packaged app, icons are in resources/build/icons/themes/
    const resourcePath = path.join(process.resourcesPath, 'app.asar', 'build', 'icons', 'themes', iconFile);
    if (fs.existsSync(resourcePath)) {
      return resourcePath;
    }
    // Fallback: try without asar
    const fallbackPath = path.join(process.resourcesPath, 'build', 'icons', 'themes', iconFile);
    if (fs.existsSync(fallbackPath)) {
      return fallbackPath;
    }
    // Last fallback: try __dirname (unpacked)
    return path.join(__dirname, 'build', 'icons', 'themes', iconFile);
  } else {
    // Development mode
    return path.join(__dirname, 'public', 'icons', 'themes', iconFile);
  }
}

function updateWindowIcon(themeName) {
  if (!mainWindow) return false;

  const iconPath = getIconPathForTheme(themeName);

  try {
    // Use nativeImage.createFromPath to safely load icon (supports asar paths)
    const icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) {
      console.warn(`[Theme] Icon is empty or not found: ${iconPath}`);
      return false;
    }
    mainWindow.setIcon(icon);
    console.log(`[Theme] Icon updated to: ${themeName}`);
    return true;
  } catch (error) {
    console.error(`[Theme] Failed to set icon: ${error.message}`);
    return false;
  }
}

ipcMain.handle('theme:setIcon', async (event, themeName) => {
  try {
    const success = updateWindowIcon(themeName);
    return { success, theme: themeName };
  } catch (error) {
    console.error('[Theme] IPC handler error:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('theme:getAvailableIcons', async () => {
  return Object.keys(THEME_ICONS);
});

// === APP INFO ===
ipcMain.handle('app:getVersion', () => APP_VERSION);

ipcMain.handle('app:openExternal', async (event, url) => {
  if (url && (url.startsWith('https://') || url.startsWith('http://') || url.startsWith('mailto:'))) {
    await shell.openExternal(url);
  }
});

ipcMain.handle('app:openDevTools', () => {
  if (mainWindow) mainWindow.webContents.openDevTools();
});

ipcMain.handle('app:getSettings', () => {
  return store.get('appSettings', {
    autoCheckUpdates: true,
    notificationsEnabled: true,
    notificationSound: true,
    downloadPath: app.getPath('downloads')
  });
});

ipcMain.handle('app:saveSettings', async (event, settings) => {
  store.set('appSettings', settings);
  return { success: true };
});

// === UPDATE ===
ipcMain.handle('update:check', async () => {
  return await checkForUpdates(false);
});

ipcMain.handle('update:download', async (event, downloadUrlOrParams) => {
  try {
    // Backward-compat: kann String (legacy) oder Object {downloadUrl, sumsUrl, expectedFilename} sein
    if (typeof downloadUrlOrParams === 'string') {
      return await downloadUpdate(downloadUrlOrParams);
    }
    const { downloadUrl, sumsUrl, expectedFilename } = downloadUrlOrParams || {};
    return await downloadUpdate(downloadUrl, sumsUrl, expectedFilename);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('update:install', async (event, filePath) => {
  try {
    // v6.9.6: Nur Dateien aus dem Download-Verzeichnis dürfen installiert
    // werden — der Kanal akzeptierte beliebige Pfade. Ein kompromittierter
    // Renderer hätte damit jede Datei als "Update" starten/ersetzen können
    // (persistente Codeausführung). downloadUpdate() legt Updates immer in
    // app.getPath('downloads') ab, Legitimes ist also nicht betroffen.
    if (typeof filePath !== 'string' || !isPathInside(filePath, app.getPath('downloads'))) {
      return { success: false, error: 'Update-Datei liegt ausserhalb des Download-Verzeichnisses' };
    }

    // Verify file exists
    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'Update-Datei nicht gefunden' };
    }

    const stats = fs.statSync(filePath);
    if (stats.size < 1024 * 1024) {
      return { success: false, error: `Update-Datei zu klein (${stats.size} Bytes) — Download unvollständig` };
    }

    // v6.5.0: Mac/Windows übergeben die Installation an das OS — Replace eines
    // laufenden .app/.exe ist riskant, der Installer/Finder macht's sauber.
    if (process.platform === 'darwin' || process.platform === 'win32') {
      try {
        // Auf macOS öffnet das die .dmg im Finder (mountet das Volume) — User zieht
        // die neue .app ins Applications-Verzeichnis. Auf Windows startet das den
        // NSIS-Installer.
        const openErr = await shell.openPath(filePath);
        if (openErr) {
          return { success: false, error: `OS-Installer konnte nicht gestartet werden: ${openErr}` };
        }
      } catch (openExc) {
        return { success: false, error: 'Konnte Installer nicht öffnen: ' + openExc.message };
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update:restart-required');
      }
      // Auf Mac: User muss die neue .app rüberziehen und CoreMail manuell beenden,
      // damit /Applications/CoreMail Desktop.app ersetzt werden kann.
      // Auf Windows: NSIS verlangt, dass die laufende Instanz beendet ist.
      // Beide → wir geben dem User 5s und beenden dann sauber.
      setTimeout(() => app.quit(), 5000);
      return { success: true, restartRequired: true, handedOffToOS: true };
    }

    // ── Linux: AppImage in-place ersetzen ─────────────────────────────────────
    // Validate ELF magic bytes: AppImage starts with 0x7f 'E' 'L' 'F'
    const fd = fs.openSync(filePath, 'r');
    const magic = Buffer.alloc(4);
    fs.readSync(fd, magic, 0, 4, 0);
    fs.closeSync(fd);
    if (magic[0] !== 0x7f || magic[1] !== 0x45 || magic[2] !== 0x4c || magic[3] !== 0x46) {
      return { success: false, error: 'Heruntergeladene Datei ist kein gültiges AppImage (falsche Magic Bytes) – bitte manuell von GitHub herunterladen' };
    }

    // Determine install target: prefer APPIMAGE env var, fall back to install.sh location
    const installTarget = process.env.APPIMAGE || path.join(process.env.HOME, '.local', 'bin', 'coremail-desktop');

    // Backup current AppImage before replacing
    if (fs.existsSync(installTarget)) {
      try {
        const backupDir = path.join(app.getPath('userData'), 'backups');
        if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
        const backupPath = path.join(backupDir, `CoreMail-Desktop-backup-${APP_VERSION}.AppImage`);
        fs.copyFileSync(installTarget, backupPath);
        console.log('Backup created:', backupPath);
        // Keep only last 3 backups
        const backups = fs.readdirSync(backupDir)
          .filter(f => f.startsWith('CoreMail-Desktop-backup-'))
          .map(f => ({ name: f, time: fs.statSync(path.join(backupDir, f)).mtime.getTime() }))
          .sort((a, b) => b.time - a.time);
        if (backups.length > 3) {
          backups.slice(3).forEach(b => { try { fs.unlinkSync(path.join(backupDir, b.name)); } catch(e) {} });
        }
      } catch (backupError) {
        console.error('Backup error (non-fatal):', backupError.message);
      }
    }

    // Replace via temp file + rename to avoid ETXTBSY (cannot overwrite running executable on Linux)
    const tmpTarget = installTarget + '.new';
    try {
      fs.copyFileSync(filePath, tmpTarget);
      fs.chmodSync(tmpTarget, 0o755);
      if (fs.existsSync(installTarget)) fs.unlinkSync(installTarget); // unlink frees the inode; running process keeps its fd
      fs.renameSync(tmpTarget, installTarget);
      console.log('AppImage successfully replaced at:', installTarget);
    } catch (replaceError) {
      // Clean up temp file if something went wrong
      try { fs.unlinkSync(tmpTarget); } catch(e) {}
      return { success: false, error: 'Konnte AppImage nicht ersetzen: ' + replaceError.message };
    }

    // Immediately refresh .desktop file + icon caches so the launcher icon
    // works right after the update without needing a reinstall.
    try {
      const { execFile } = require('child_process');
      const home = os.homedir();
      const pixIconPath = path.join(home, '.local/share/pixmaps/coremail.png');
      const desktopDir  = path.join(home, '.local/share/applications');
      const desktopFile = path.join(desktopDir, 'coremail.desktop');
      if (!fs.existsSync(desktopDir)) fs.mkdirSync(desktopDir, { recursive: true });
      const desktopContent = [
        '[Desktop Entry]',
        'Version=1.0',
        'Type=Application',
        'Name=CoreMail Desktop',
        'Comment=E-Mail Client für Linux',
        `Exec=env APPIMAGE_EXTRACT_AND_RUN=1 ${installTarget}`,
        `Icon=${pixIconPath}`,
        'Terminal=false',
        'Categories=Network;Email;Office;',
        'StartupNotify=true',
        'StartupWMClass=coremail-desktop',
        'Keywords=email;mail;imap;smtp;',
        ''
      ].join('\n');
      fs.writeFileSync(desktopFile, desktopContent);
      try { fs.chmodSync(desktopFile, 0o755); } catch (_) {}
      execFile('gtk-update-icon-cache', ['-f', path.join(home, '.local/share/icons/hicolor')], () => {});
      execFile('update-desktop-database', [desktopDir], () => {});
      // Force syncSystemIcons to re-run on next start (reset stored version)
      store.delete('iconsVersion');
      console.log('[Update] .desktop file refreshed → launcher icon will work after restart');
    } catch (desktopErr) {
      console.warn('[Update] Could not refresh .desktop file:', desktopErr.message);
    }

    // AppImage replaced — quit app cleanly so user can restart the new version
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:restart-required');
    }
    setTimeout(() => {
      app.quit();
    }, 3000);

    return { success: true, restartRequired: true };
  } catch (error) {
    console.error('Update install error:', error);
    return { success: false, error: error.message };
  }
});

// v1.16.0: Get SHA256 hash of a file
ipcMain.handle('update:verifyFile', async (event, filePath) => {
  try {
    if (!fs.existsSync(filePath)) {
      return { success: false, error: 'Datei nicht gefunden' };
    }
    
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    
    return new Promise((resolve) => {
      stream.on('data', data => hash.update(data));
      stream.on('end', () => {
        resolve({ success: true, sha256: hash.digest('hex') });
      });
      stream.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// v1.16.0: Get list of backups
ipcMain.handle('update:getBackups', async () => {
  try {
    const backupDir = path.join(app.getPath('userData'), 'backups');
    if (!fs.existsSync(backupDir)) {
      return { success: true, backups: [] };
    }
    
    const backups = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('CoreMail-Desktop-backup-'))
      .map(f => {
        const filePath = path.join(backupDir, f);
        const stats = fs.statSync(filePath);
        const version = f.match(/backup-(.+)\.AppImage/)?.[1] || 'unknown';
        return {
          name: f,
          path: filePath,
          version,
          size: stats.size,
          date: stats.mtime.toISOString()
        };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    
    return { success: true, backups };
  } catch (error) {
    return { success: false, error: error.message, backups: [] };
  }
});

// Prüft, dass ein Pfad innerhalb eines erlaubten Verzeichnisses liegt
// (kein Ausbruch via ../ oder Symlink-Trick).
function isPathInside(target, dir) {
  const rel = path.relative(path.resolve(dir), path.resolve(target));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// v1.16.0: Restore from backup
ipcMain.handle('update:restoreBackup', async (event, backupPath) => {
  try {
    // Security: nur Backups aus dem app-eigenen backups-Verzeichnis dürfen
    // gestartet werden — sonst könnte der Renderer einen beliebigen Pfad
    // ausführbar machen und als Prozess spawnen (RCE-Primitive).
    const backupDir = path.join(app.getPath('userData'), 'backups');
    if (!isPathInside(backupPath, backupDir)) {
      return { success: false, error: 'Ungültiger Backup-Pfad' };
    }
    if (!fs.existsSync(backupPath)) {
      return { success: false, error: 'Backup nicht gefunden' };
    }

    fs.chmodSync(backupPath, 0o755);

    const child = spawn(backupPath, [], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: '0' }
    });
    
    child.unref();

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update:restart-required');
    }
    setTimeout(() => {
      app.quit();
    }, 3000);

    return { success: true, restartRequired: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('update:openDownloads', () => {
  shell.openPath(app.getPath('downloads'));
});

// === NOTIFICATIONS ===
ipcMain.handle('notification:show', async (event, { title, body }) => {
  const settings = store.get('appSettings', {});
  if (settings.notificationsEnabled === false) {
    return { success: false, reason: 'disabled' };
  }
  
  showNotification(title, body, () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  return { success: true };
});

ipcMain.handle('notification:setBadge', async (event, count) => {
  updateBadgeCount(count);
  return { success: true };
});

// === FULL-TEXT-SEARCH (FTS5, v6.3.0) ===
// Schnelle lokale Suche über bereits indexierte Mails.
// Index wird live beim Mail-Abruf gefüllt (über search:indexEmail aus dem Renderer).
ipcMain.handle('search:fts', async (event, params) => {
  return searchEmailsFTS({
    query: params?.query || '',
    accountIds: params?.accountIds || [],
    limit: params?.limit || 50
  });
});

ipcMain.handle('search:indexEmail', async (event, payload) => {
  const ok = indexEmailInSearch(payload || {});
  return { success: ok };
});

ipcMain.handle('search:indexBatch', async (event, payloads) => {
  if (!searchDbAvailable || !searchDb) return { success: false, count: 0 };
  let count = 0;
  const txn = searchDb.transaction((items) => {
    for (const it of items) {
      if (indexEmailInSearch(it)) count++;
    }
  });
  try {
    txn(payloads || []);
    return { success: true, count };
  } catch (e) {
    return { success: false, count, error: e.message };
  }
});

ipcMain.handle('search:stats', async () => {
  if (!searchDbAvailable || !searchDb) return { success: false, available: false };
  try {
    const total = searchDb.prepare('SELECT COUNT(*) as c FROM emails').get().c;
    const accounts = searchDb.prepare('SELECT account_id, COUNT(*) as c FROM emails GROUP BY account_id').all();
    return { success: true, available: true, total, accounts };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('search:clearIndex', async () => {
  if (!searchDbAvailable || !searchDb) return { success: false };
  try {
    searchDb.exec('DELETE FROM emails');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// === LIST-UNSUBSCRIBE (RFC 2369 + RFC 8058) ===
// Drei Wege:
//   1) one-click POST an https-URL (RFC 8058) — wenn der Sender es mitsendet
//   2) GET an https-URL → im Browser öffnen (User bestätigt selbst)
//   3) mailto: → leere Mail vom aktiven Konto an den angegebenen Empfänger schicken
// SSRF-Schutz: die One-Click-URL kommt direkt aus dem List-Unsubscribe-Header
// der (nicht vertrauenswürdigen) Mail. Ohne Prüfung könnte ein Absender den
// Main-Prozess einen POST an interne Hosts (127.0.0.1, 169.254.169.254,
// LAN, Cloud-Metadaten) absetzen lassen.

ipcMain.handle('mail:unsubscribe', async (event, { listUnsubscribe, accountId }) => {
  if (!listUnsubscribe) return { success: false, error: 'Keine Unsubscribe-Information' };
  const { mailto, http, oneClick } = listUnsubscribe;

  // Pfad 1: One-Click POST (RFC 8058) — bevorzugt, nur an sichere öffentliche https-Hosts
  if (http && oneClick && isSafePublicHttpsUrl(http)) {
    try {
      const resp = await fetch(http, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'CoreMail-Desktop' },
        body: 'List-Unsubscribe=One-Click'
      });
      if (resp.ok) {
        return { success: true, method: 'http-post', message: 'Erfolgreich abgemeldet' };
      }
      console.warn('[Unsubscribe] HTTP-POST scheiterte, Status:', resp.status);
    } catch (e) {
      console.warn('[Unsubscribe] HTTP-POST-Fehler, Fallback auf mailto/Browser:', e.message);
    }
  }

  // Pfad 2: mailto — leere Mail über das aktive Konto schicken
  if (mailto && accountId) {
    try {
      const accounts = store.get('accounts', []);
      const account = accounts.find(a => a.id === accountId);
      if (account?.smtp) {
        const url = new URL(mailto);
        const to = url.pathname || url.href.replace(/^mailto:/, '').split('?')[0];
        const subject = url.searchParams.get('subject') || 'unsubscribe';
        const body = url.searchParams.get('body') || '';

        if (account.type === 'microsoft') {
          await graphRequest(accountId, 'POST', '/me/sendMail', {
            message: {
              subject,
              body: { contentType: 'Text', content: body },
              toRecipients: [{ emailAddress: { address: to } }]
            }
          });
        } else {
          const transporter = getSmtpTransporterForAccount(account);
          await transporter.sendMail({
            from: account.smtp.fromEmail || account.smtp.username,
            to, subject, text: body
          });
        }
        return { success: true, method: 'mailto', message: 'Abmeldungs-Mail gesendet an ' + to };
      }
    } catch (e) {
      console.error('[Unsubscribe] mailto-Fehler:', e.message);
    }
  }

  // Pfad 3: Fallback — Browser öffnen für User-Bestätigung
  if (http) {
    try {
      await shell.openExternal(http);
      return { success: true, method: 'http-browser', message: 'Abmeldungs-Seite im Browser geöffnet' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  return { success: false, error: 'Keine nutzbare Unsubscribe-Methode gefunden' };
});

// === SPAM FILTER (v1.14.0) ===
ipcMain.handle('spamfilter:saveSettings', async (event, settings) => {
  store.set('spamFilterSettings', settings);
  return { success: true };
});

ipcMain.handle('spamfilter:loadSettings', async () => {
  return {
    success: true,
    settings: store.get('spamFilterSettings', {
      enabled: true,
      sensitivity: 'medium',
      whitelist: [],
      blacklist: [],
      autoMoveToSpam: false,
      showTags: true
    })
  };
});

ipcMain.handle('spamfilter:saveAnalysis', async (event, accountId, analysisData) => {
  const key = `spamAnalysis:${accountId}`;
  store.set(key, analysisData);
  return { success: true };
});

ipcMain.handle('spamfilter:loadAnalysis', async (event, accountId) => {
  const key = `spamAnalysis:${accountId}`;
  return {
    success: true,
    analysis: store.get(key, {})
  };
});

// === SIGNATURES ===
ipcMain.handle('signatures:save', async (event, signatures) => {
  store.set('signatures', signatures);
  return { success: true };
});

ipcMain.handle('signatures:load', async () => {
  return {
    success: true,
    signatures: store.get('signatures', {})
  };
});

// === ATTACHMENT DOWNLOAD ===
ipcMain.handle('attachment:saveAll', async (event, attachments) => {
  const settings = store.get('appSettings', {});
  const downloadPath = settings.downloadPath || app.getPath('downloads');
  
  const results = [];
  for (const att of attachments) {
    try {
      // path.basename() verhindert Path-Traversal (z.B. ../../../etc/passwd)
      const safeFilename = path.basename(att.filename || 'anhang');
      const filePath = path.join(downloadPath, safeFilename);
      const buffer = Buffer.from(att.content, 'base64');
      // async statt writeFileSync — grosse Anhänge blockierten sonst den
      // gesamten Main-Prozess für die Dauer des Disk-Writes
      await fs.promises.writeFile(filePath, buffer);
      results.push({ filename: safeFilename, success: true, path: filePath });
    } catch (error) {
      results.push({ filename: att.filename, success: false, error: error.message });
    }
  }
  return { success: true, results };
});

ipcMain.handle('attachment:openFile', async (event, filePath) => {
  try {
    // Security: nur Dateien aus dem konfigurierten Download-Ordner öffnen —
    // sonst könnte der Renderer eine beliebige Systemdatei mit dem OS-Handler
    // starten (z.B. zuvor via attachment:saveAll geschriebene Payload).
    const settings = store.get('appSettings', {});
    const downloadPath = settings.downloadPath || app.getPath('downloads');
    if (!isPathInside(filePath, downloadPath)) {
      return { success: false, error: 'Datei liegt ausserhalb des Download-Ordners' };
    }
    await shell.openPath(filePath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('attachment:selectDownloadFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Download-Ordner auswählen'
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return { success: true, path: result.filePaths[0] };
  }
  return { success: false, canceled: true };
});

// === ACCOUNTS & CATEGORIES ===

ipcMain.handle('accounts:save', async (event, data) => {
  try {
    // v2.9.0: Migrate Microsoft token cache from tempId to real account id
    const prevAccounts = store.get('accounts', []);
    const prevIds = new Set(prevAccounts.map(a => a.id));

    for (const acc of (data.accounts || [])) {
      if (acc.type === 'microsoft' && acc.microsoft?.tempId && !prevIds.has(acc.id)) {
        // New Microsoft account – move token cache from tempId key to real account id key
        const tempKey = `msalCache_${acc.microsoft.tempId}`;
        const realKey = `msalCache_${acc.id}`;
        const cached = store.get(tempKey);
        if (cached) {
          store.set(realKey, cached);
          store.delete(tempKey);
        }
        // Remove tempId from stored account (no longer needed)
        delete acc.microsoft.tempId;
      }
    }

    // Close pooled connections for any removed accounts
    const newIds = new Set((data.accounts || []).map(a => a.id));
    for (const [id] of imapPool) {
      if (!newIds.has(id)) releaseImapConnection(id, true);
    }

    store.set('accounts', data.accounts);
    store.set('categories', data.categories);
    invalidateAccountsCache();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('accounts:load', async () => {
  try {
    let accounts = store.get('accounts', []);

    // Security v6.9.2: Neue/unmarkierte Konten bekommen den SICHEREN Default
    // (Cert-Validierung an). Früher wurden sie auf allowInsecureTLS=true gesetzt,
    // was eine MITM-Lücke offen liess. Falls ein Server ein selbstsigniertes
    // Zertifikat nutzt, kann der User es pro Konto in den Einstellungen erlauben.
    let migrated = false;
    accounts = accounts.map(acc => {
      if (acc && acc.allowInsecureTLS === undefined) {
        migrated = true;
        return { ...acc, allowInsecureTLS: false, _tlsSecurityMigrated: true };
      }
      return acc;
    });
    if (migrated) {
      store.set('accounts', accounts);
      invalidateAccountsCache();
      console.log('[Security] TLS-Migration: unmarkierte Konten auf sicheren Default (Cert-Validierung an) gesetzt.');
    }

    return {
      success: true,
      accounts,
      categories: store.get('categories', [
        { id: 'work', name: 'Arbeit', color: '#3b82f6' },
        { id: 'personal', name: 'Privat', color: '#22c55e' },
        { id: 'other', name: 'Sonstiges', color: '#8b5cf6' }
      ])
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// === PROFIL EXPORT/IMPORT (v7.3.0) ===
// Konten + Kategorien + Signaturen + Microsoft-Token in eine mit Einmal-
// Passwort verschlüsselte Datei, die nur 5 Minuten gültig ist. Krypto und
// Zusammenführen in lib/profileTransfer.js (getestet). Die Datei und das
// Passwort laufen nie durch den Renderer — nur Anzeige-Infos.
const PROFILE_EXT = 'coremail-profile';
const PROFILE_MAX_BYTES = 20 * 1024 * 1024;
const PROFILE_USED_KEY = 'profileImportsUsed';
let pendingProfileImport = null; // { path, file }

function getUsedProfileIds() {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  // Ältere Einträge braucht es nicht mehr: solche Dateien sind längst abgelaufen
  const used = store.get(PROFILE_USED_KEY, []).filter(e => e && e.at > weekAgo);
  return used;
}

// Best effort: Inhalt überschreiben, dann löschen (auf SSDs nicht garantiert,
// die Datei ist aber ohnehin verschlüsselt und abgelaufen bzw. verbraucht)
function destroyProfileFile(filePath) {
  try {
    const size = fs.statSync(filePath).size;
    fs.writeFileSync(filePath, crypto.randomBytes(size));
    fs.unlinkSync(filePath);
    return true;
  } catch (e) {
    console.warn('[Profil] Datei konnte nicht gelöscht werden:', e.message);
    return false;
  }
}

ipcMain.handle('profile:export', async () => {
  try {
    const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Profil exportieren',
      defaultPath: path.join(app.getPath('documents'), `coremail-profil-${stamp}.${PROFILE_EXT}`),
      filters: [{ name: 'CoreMail-Profil', extensions: [PROFILE_EXT] }],
    });
    if (result.canceled || !result.filePath) return { success: false, canceled: true };

    const accounts = store.get('accounts', []);
    const allSignatures = store.get('signatures', {});
    const signatures = {};
    const msalCaches = {};
    for (const acc of accounts) {
      if (allSignatures[acc.id]) signatures[acc.id] = allSignatures[acc.id];
      if (acc.type === 'microsoft') {
        const blob = store.get(`msalCache_${acc.id}`, '');
        if (blob) msalCaches[acc.id] = blob;
      }
    }
    const payload = {
      appVersion: app.getVersion(),
      accounts,
      categories: store.get('categories', []),
      signatures,
      msalCaches,
    };

    const password = profileTransfer.generateOneTimePassword();
    const file = await profileTransfer.encryptProfile(payload, password);
    fs.writeFileSync(result.filePath, JSON.stringify(file), { mode: 0o600 });
    return {
      success: true,
      password,
      expiresAt: file.expiresAt,
      filePath: result.filePath,
      accountCount: accounts.length,
      categoryCount: payload.categories.length,
    };
  } catch (error) {
    console.error('[Profil] Export fehlgeschlagen:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('profile:selectImportFile', async () => {
  pendingProfileImport = null;
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Profil importieren',
      properties: ['openFile'],
      filters: [{ name: 'CoreMail-Profil', extensions: [PROFILE_EXT] }],
    });
    if (result.canceled || result.filePaths.length === 0) return { success: false, canceled: true };
    const filePath = result.filePaths[0];
    if (fs.statSync(filePath).size > PROFILE_MAX_BYTES) {
      return { success: false, error: 'Datei ist zu gross für eine CoreMail-Profildatei' };
    }
    const file = profileTransfer.parseProfileFile(fs.readFileSync(filePath, 'utf8'));
    profileTransfer.checkProfileUsable(file, { usedIds: getUsedProfileIds().map(e => e.id) });
    pendingProfileImport = { path: filePath, file };
    return { success: true, fileName: path.basename(filePath), createdAt: file.createdAt, expiresAt: file.expiresAt };
  } catch (error) {
    return { success: false, error: error.message, code: error.code };
  }
});

ipcMain.handle('profile:import', async (event, { password, deleteFile = true } = {}) => {
  if (!pendingProfileImport) return { success: false, error: 'Keine Profildatei ausgewählt' };
  const { path: filePath, file } = pendingProfileImport;
  try {
    const used = getUsedProfileIds();
    const data = await profileTransfer.decryptProfile(file, password, { usedIds: used.map(e => e.id) });

    const merged = profileTransfer.mergeProfile({
      accounts: store.get('accounts', []),
      categories: store.get('categories', []),
      signatures: store.get('signatures', {}),
    }, data);

    // Datei sofort als verbraucht markieren — vor dem Schreiben der Konten,
    // damit ein Absturz mittendrin keinen zweiten Import erlaubt
    store.set(PROFILE_USED_KEY, [...used, { id: file.exportId, at: Date.now() }]);
    pendingProfileImport = null;

    for (const id of merged.importedAccountIds) {
      if (imapPool.has(id)) releaseImapConnection(id, true);
      invalidateGraphTokenCache(id);
    }
    for (const [id, blob] of Object.entries(merged.msalCaches)) {
      store.set(`msalCache_${id}`, blob);
    }
    store.set('accounts', merged.accounts);
    store.set('categories', merged.categories);
    store.set('signatures', merged.signatures);
    invalidateAccountsCache();

    const fileDeleted = deleteFile ? destroyProfileFile(filePath) : false;
    return { success: true, ...merged.stats, fileDeleted };
  } catch (error) {
    // Abgelaufen/verbraucht: Auswahl verwerfen, ein neuer Versuch bringt nichts
    if (error.code === 'EXPIRED' || error.code === 'ALREADY_USED' || error.code === 'INVALID_TIME') {
      pendingProfileImport = null;
    }
    if (!error.code) console.error('[Profil] Import fehlgeschlagen:', error);
    return { success: false, error: error.message, code: error.code };
  }
});

ipcMain.handle('profile:cancelImport', async () => {
  pendingProfileImport = null;
  return { success: true };
});

// === LEGACY SETTINGS (for backward compatibility) ===

ipcMain.handle('settings:save', async (event, settings) => {
  try {
    store.set('imapSettings', settings.imap);
    store.set('smtpSettings', settings.smtp);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('settings:load', async () => {
  try {
    return {
      success: true,
      data: {
        imap: store.get('imapSettings', {}),
        smtp: store.get('smtpSettings', {})
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// === IMAP OPERATIONS ===

ipcMain.handle('imap:test', async (event, settings) => {
  try {
    const config = {
      imap: {
        user: settings.username,
        password: settings.password,
        host: settings.host,
        port: parseInt(settings.port),
        tls: settings.tls !== false,
        authTimeout: 10000,
        tlsOptions: { rejectUnauthorized: !(settings.allowInsecureTLS === true) }
      }
    };

    const connection = await imapSimple.connect(config);
    await connection.end();
    return { success: true, message: 'Verbindung erfolgreich!' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Fetch emails for specific account (v1.10.0: OAuth2 support)
// v2.3.1: Fixed IMAP fetch to load ALL emails (no limit by default)
ipcMain.handle('imap:fetchEmailsForAccount', async (event, accountId, options = {}) => {
  const account = getAccountById(accountId);
  
  if (!account) {
    return { success: false, error: 'Konto nicht gefunden' };
  }

  // v2.3.1: Changed default limit from 50 to 0 (0 = no limit, fetch all emails)
  const { folder = 'INBOX', limit = 0, offset = 0 } = options;

  let connection;
  let usedPool = false;
  try {
    try {
      connection = await getPooledImapConnection(account);
      usedPool = true;
    } catch (_) {
      // Pool failed (e.g. connection died) — fall back to fresh connection
      const config = getImapConfigForAccount(account);
      connection = await imapSimple.connect(config);
    }
    await connection.openBox(folder);

    // v2.8.3: Header-only fetch for fast listing (full body only when viewing email)
    const fetchOptions = {
      bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)'],
      markSeen: false,
      struct: true
    };

    // Erst die UID-Liste holen (nur Zahlen, billig), dann Header nur für die
    // angefragte Seite — vorher wurden bei jedem Refresh die Header des
    // gesamten Postfachs geladen und erst danach zugeschnitten.
    const allUids = await new Promise((resolve, reject) => {
      connection.imap.search(['ALL'], (err, uids) => err ? reject(err) : resolve(uids || []));
    });
    allUids.sort((a, b) => b - a); // newest first (higher UID = newer)
    const totalCount = allUids.length;
    const pageUids = limit > 0 ? allUids.slice(offset, offset + limit) : allUids.slice(offset);

    let messagesToProcess = [];
    if (pageUids.length > 0) {
      // v6.11.0 FIX: UIDs einzeln übergeben (Spread) — der frühere Komma-
      // String wurde von node-imaps validateUIDList per parseInt still auf
      // die ERSTE UID gestutzt: seit v6.8.0 lieferte jede INBOX-Seite nur
      // 1 Mail (kaschiert durch IndexedDB-Cache und Background-Loader).
      const searchCriteria = pageUids.length === totalCount
        ? ['ALL']
        : [['UID', ...pageUids]];
      messagesToProcess = await connection.search(searchCriteria, fetchOptions);
      messagesToProcess.sort((a, b) => b.attributes.uid - a.attributes.uid);
    }

    // Track unread count for notifications
    let unreadCount = 0;
    const previousUnread = store.get(`unreadCount_${accountId}`, 0);

    const emails = messagesToProcess.map(msg => {
      const header = msg.parts.find(p => p.which.includes('HEADER'));
      const h = header?.body || {};
      const isUnread = !msg.attributes.flags.includes('\\Seen');
      if (isUnread) unreadCount++;

      const fromRaw = (h.from || ['Unbekannt'])[0];
      const fromMatch = fromRaw.match(/^(.*?)\s*<(.+?)>$/);
      const fromName = fromMatch
        ? fromMatch[1].replace(/^["']+|["']+$/g, '').trim() || fromMatch[2]
        : fromRaw.split('@')[0].trim();

      return {
        uid: msg.attributes.uid,
        subject: (h.subject || ['(Kein Betreff)'])[0],
        from: fromRaw,
        fromName,
        to: (h.to || [''])[0],
        // v6.11.0: für Undo (imap:findAndMove sucht per Message-ID)
        messageId: (h['message-id'] || [null])[0],
        date: msg.attributes.date || (h.date ? new Date(h.date[0]) : new Date()),
        seen: !isUnread,
        hasAttachments: Array.isArray(msg.attributes.struct) &&
          msg.attributes.struct.some(p => p.disposition?.type?.toLowerCase() === 'attachment'),
        preview: ''
      };
    });

    // Check for new unread emails and notify
    const settings = store.get('appSettings', {});
    if (settings.notificationsEnabled !== false && unreadCount > previousUnread) {
      const newCount = unreadCount - previousUnread;
      const newEmails = emails.filter(e => !e.seen).slice(0, newCount);
      const focusApp = () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } };

      if (newCount > 5) {
        // Gebündelte Benachrichtigung
        showNotification(
          `${newCount} neue E-Mails`,
          newEmails.slice(0, 3).map(e => `• ${e.fromName}: ${e.subject}`).join('\n') +
            (newCount > 3 ? `\n• … und ${newCount - 3} weitere` : ''),
          focusApp
        );
      } else {
        // Einzelne Benachrichtigung pro Mail
        for (const email of newEmails) {
          showNotification(
            `Neue E-Mail von ${email.fromName}`,
            email.subject,
            () => {
              focusApp();
              mainWindow.webContents.send('email:open', { accountId, uid: email.uid });
            }
          );
        }
      }
    }

    // Nur bei Änderung schreiben — store.set schreibt die komplette
    // verschlüsselte Config synchron, und das hier läuft bei jedem Poll.
    if (unreadCount !== previousUnread) {
      store.set(`unreadCount_${accountId}`, unreadCount);
    }

    // v6.9.0: Absender fürs Adress-Autocomplete merken
    learnContactsFromEmails(emails);

    // v6.6.0: Mail-Regeln auf neue Mails anwenden (markRead/move/delete/snooze).
    // Verschobene/gelöschte Mails werden aus emails entfernt — der Renderer
    // sieht sie also gar nicht erst.
    const filtered = await runRulesOnFetchedEmails(account, folder, emails, 'imap', connection);

    return {
      success: true,
      emails: filtered,
      unreadCount,
      total: totalCount,
      hasMore: limit > 0 ? (offset + limit < totalCount) : false
    };
  } catch (error) {
    console.error('IMAP Fehler:', error);
    if (usedPool) releaseImapConnection(accountId, true, connection); // destroy broken connection
    return { success: false, error: error.message };
  } finally {
    if (connection) {
      if (usedPool) releaseImapConnection(accountId, false, connection); // return to pool
      else try { await connection.end(); } catch (_) {}
    }
  }
});

// Fetch single email for specific account
// v1.10.0: OAuth2 support for single email fetch
ipcMain.handle('imap:fetchEmailForAccount', async (event, accountId, uid, folder = 'INBOX') => {
  const account = getAccountById(accountId);
  if (!account) return { success: false, error: 'Konto nicht gefunden' };

  let connection;
  let usedPool = false;
  try {
    try {
      connection = await getPooledImapConnection(account);
      usedPool = true;
    } catch (_) {
      const config = getImapConfigForAccount(account);
      connection = await imapSimple.connect(config);
    }
    await connection.openBox(folder);

    const messages = await connection.search([['UID', uid]], { bodies: [''], markSeen: true, struct: true });
    if (messages.length === 0) return { success: false, error: 'E-Mail nicht gefunden' };

    const all = messages[0].parts.find(p => p.which === '');
    const parsed = await simpleParser(all.body);

    // v7.2.0: Kalenderteile haben oft keinen Dateinamen — normalizeAttachments
    // vergibt einen und markiert sie, damit der Renderer sie als Einladung zeigt.
    const attachments = normalizeAttachments(parsed.attachments.map(att => ({
      filename: att.filename,
      contentType: att.contentType,
      size: att.size,
      content: att.content.toString('base64')
    })));

    return {
      success: true,
      email: {
        uid,
        subject: parsed.subject || '(Kein Betreff)',
        from: parsed.from?.text || 'Unbekannt',
        to: parsed.to?.text || '',
        cc: parsed.cc?.text || '',
        // v6.11.0: für Undo/Snooze (Suche per Message-ID)
        messageId: parsed.messageId || null,
        date: parsed.date || new Date(),
        html: parsed.html || null,
        text: parsed.text || '',
        listUnsubscribe: extractListUnsubscribe(parsed),
        attachments,
        // v7.2.0: Meeting-Einladung (text/calendar) ausgewertet mitliefern
        invitation: extractInvitation(attachments, parsed)
      }
    };
  } catch (error) {
    console.error('IMAP Fehler:', error);
    if (usedPool) releaseImapConnection(accountId, true, connection);
    return { success: false, error: error.message };
  } finally {
    if (connection) {
      if (usedPool) releaseImapConnection(accountId, false, connection);
      else try { await connection.end(); } catch (_) {}
    }
  }
});

// Legacy fetch emails (for backward compatibility)
// Perf: header-only fetch, limit defaults to 100 most recent
ipcMain.handle('imap:fetchEmails', async (event, { folder = 'INBOX', limit = 100 }) => {
  const imapSettings = store.get('imapSettings');
  if (!imapSettings) return { success: false, error: 'Keine IMAP-Einstellungen konfiguriert' };

  let connection;
  try {
    const config = {
      imap: {
        user: imapSettings.username,
        password: imapSettings.password,
        host: imapSettings.host,
        port: parseInt(imapSettings.port),
        tls: imapSettings.tls !== false,
        authTimeout: 15000
      }
    };
    connection = await imapSimple.connect(config);
    await connection.openBox(folder);

    const searchCriteria = ['ALL'];
    // Perf: header-only — no body/text loaded during listing
    const fetchOptions = {
      bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)'],
      markSeen: false,
      struct: true
    };

    const messages = await connection.search(searchCriteria, fetchOptions);
    messages.sort((a, b) => b.attributes.uid - a.attributes.uid);

    const messagesToProcess = limit > 0 ? messages.slice(0, limit) : messages;

    const emails = messagesToProcess.map(message => {
      try {
        const header = message.parts.find(p => p.which.includes('HEADER'));
        const h = header?.body || {};
        const fromRaw = (h.from || ['Unbekannt'])[0];
        const fromMatch = fromRaw.match(/^(.*?)\s*<(.+?)>$/);
        const fromName = fromMatch
          ? fromMatch[1].replace(/^["']+|["']+$/g, '').trim() || fromMatch[2]
          : fromRaw.split('@')[0].trim();
        return {
          uid: message.attributes.uid,
          subject: (h.subject || ['(Kein Betreff)'])[0],
          from: fromName,
          fromEmail: fromMatch ? fromMatch[2] : fromRaw,
          to: (h.to || [''])[0],
          // v6.11.0: für Undo (imap:findAndMove sucht per Message-ID)
          messageId: (h['message-id'] || [null])[0],
          date: h.date ? new Date(h.date[0]) : new Date(),
          seen: message.attributes.flags.includes('\\Seen'),
          hasAttachments: (message.attributes.struct || []).some(
            p => p.disposition?.type?.toLowerCase() === 'attachment'
          ),
          preview: ''
        };
      } catch (e) {
        console.error('Fehler beim Parsen einer E-Mail:', e);
        return null;
      }
    }).filter(Boolean);

    return { success: true, emails, hasMore: messages.length > limit };
  } catch (error) {
    console.error('IMAP Fehler:', error);
    return { success: false, error: error.message };
  } finally {
    if (connection) try { await connection.end(); } catch (_) {}
  }
});

ipcMain.handle('imap:fetchEmail', async (event, uid) => {
  const imapSettings = store.get('imapSettings');
  if (!imapSettings) return { success: false, error: 'Keine IMAP-Einstellungen konfiguriert' };

  let connection;
  try {
    const config = {
      imap: {
        user: imapSettings.username,
        password: imapSettings.password,
        host: imapSettings.host,
        port: parseInt(imapSettings.port),
        tls: imapSettings.tls !== false,
        authTimeout: 15000
      }
    };
    connection = await imapSimple.connect(config);
    await connection.openBox('INBOX');

    const messages = await connection.search([['UID', uid]], { bodies: [''], markSeen: true, struct: true });
    if (messages.length === 0) return { success: false, error: 'E-Mail nicht gefunden' };

    const all = messages[0].parts.find(p => p.which === '');
    const parsed = await simpleParser(all.body);

    // v7.2.0: Kalenderteile haben oft keinen Dateinamen — normalizeAttachments
    // vergibt einen und markiert sie, damit der Renderer sie als Einladung zeigt.
    const attachments = normalizeAttachments(parsed.attachments.map(att => ({
      filename: att.filename,
      contentType: att.contentType,
      size: att.size,
      content: att.content.toString('base64')
    })));

    return {
      success: true,
      email: {
        uid,
        subject: parsed.subject || '(Kein Betreff)',
        from: parsed.from?.text || 'Unbekannt',
        to: parsed.to?.text || '',
        cc: parsed.cc?.text || '',
        // v6.11.0: für Undo/Snooze (Suche per Message-ID)
        messageId: parsed.messageId || null,
        date: parsed.date || new Date(),
        html: parsed.html || null,
        text: parsed.text || '',
        listUnsubscribe: extractListUnsubscribe(parsed),
        attachments,
        // v7.2.0: Meeting-Einladung (text/calendar) ausgewertet mitliefern
        invitation: extractInvitation(attachments, parsed)
      }
    };
  } catch (error) {
    console.error('IMAP Fehler:', error);
    return { success: false, error: error.message };
  } finally {
    if (connection) try { await connection.end(); } catch (_) {}
  }
});

// === SMTP OPERATIONS ===

ipcMain.handle('smtp:send', async (event, emailData) => {
  const smtpSettings = store.get('smtpSettings');
  
  if (!smtpSettings) {
    return { success: false, error: 'Keine SMTP-Einstellungen konfiguriert' };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: smtpSettings.host,
      port: parseInt(smtpSettings.port),
      secure: smtpSettings.secure !== false,
      auth: {
        user: smtpSettings.username,
        pass: smtpSettings.password
      },
      // Timeouts wie im Konto-Pfad — ein hängender Server liess den Send sonst endlos offen
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 30000
    });

    const mailOptions = {
      from: smtpSettings.fromEmail || smtpSettings.username,
      to: emailData.to,
      cc: emailData.cc || undefined,
      bcc: emailData.bcc || undefined,
      subject: emailData.subject,
      text: emailData.text,
      html: emailData.html,
      attachments: (emailData.attachments || []).map(a => ({ ...a, encoding: 'base64' }))
    };

    await transporter.sendMail(mailOptions);
    return { success: true, message: 'E-Mail erfolgreich gesendet!' };
  } catch (error) {
    console.error('SMTP Fehler:', error);
    return { success: false, error: error.message };
  }
});

// Send email for specific account
// v1.10.0: OAuth2 support for SMTP
ipcMain.handle('smtp:sendForAccount', async (event, accountId, emailData) => {
  const account = getAccountById(accountId);
  
  if (!account) {
    return { success: false, error: 'Konto nicht gefunden' };
  }

  // Signature is inserted by the frontend into the editor; use body as-is.
  const finalHtml = emailData.html || `<p>${(emailData.text || '').replace(/\n/g, '</p><p>')}</p>`;
  const finalText = emailData.text || '';

  try {
    // v1.10.0: Use OAuth2-aware SMTP transporter
    const { transporter, fromEmail: defaultFrom } = getSmtpTransporterForAccount(account);

    // v2.8.2: Allow per-email sender name override
    let fromEmail = defaultFrom;
    if (emailData.fromName !== undefined) {
      const emailAddr = account.smtp.fromEmail || account.smtp.username;
      const safeName = (emailData.fromName || '').replace(/["\\\r\n]/g, '').trim();
      fromEmail = safeName ? `"${safeName}" <${emailAddr}>` : emailAddr;
    }

    const mailOptions = {
      from: fromEmail,
      to: emailData.to,
      cc: emailData.cc || undefined,
      bcc: emailData.bcc || undefined,
      subject: emailData.subject,
      text: finalText,
      html: finalHtml,
      attachments: (emailData.attachments || []).map(a => ({ ...a, encoding: 'base64' })),
      // Threading headers — set when replying/forwarding
      ...(emailData.inReplyTo  && { inReplyTo:  emailData.inReplyTo }),
      ...(emailData.references && { references: emailData.references }),
    };

    const sendInfo = await transporter.sendMail(mailOptions);

    // v6.9.0: Empfänger fürs Adress-Autocomplete merken
    learnContactsFromSend(emailData);

    // v2.8.4: Kopie in den IMAP-Gesendet-Ordner — fire-and-forget, damit die
    // Sende-Antwort nicht am Upload der Anhänge hängt.
    saveToSentFolder(account, mailOptions, emailData.subject || '(kein Betreff)', sendInfo?.messageId);

    return { success: true, message: 'E-Mail erfolgreich gesendet!' };
  } catch (error) {
    console.error('SMTP Fehler:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('smtp:test', async (event, settings) => {
  try {
    const transporter = nodemailer.createTransport({
      host: settings.host,
      port: parseInt(settings.port),
      secure: settings.secure !== false,
      auth: {
        user: settings.username,
        pass: settings.password
      },
      tls: { rejectUnauthorized: !(settings.allowInsecureTLS === true) }
    });

    await transporter.verify();
    return { success: true, message: 'SMTP-Verbindung erfolgreich!' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ============ NEW v1.8.0 IMAP OPERATIONS ============

// Delete email
// v1.10.0: OAuth2 support for delete
ipcMain.handle('imap:deleteEmail', async (event, accountId, uid, folder = 'INBOX') => {
  const account = getAccountById(accountId);

  if (!account) {
    return { success: false, error: 'Konto nicht gefunden' };
  }

  let connection;
  const DELETE_TIMEOUT_MS = 15000; // 15s max — prevents UI freeze on slow/broken servers

  try {
    await Promise.race([
      (async () => {
        const config = getImapConfigForAccount(account);
        connection = await imapSimple.connect(config);
        await connection.openBox(folder);
        await connection.addFlags(uid, ['\\Deleted'], { uid: true });
        await connection.imap.expunge();
      })(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('IMAP delete timed out after 15s')), DELETE_TIMEOUT_MS)
      )
    ]);

    return { success: true, message: 'E-Mail gelöscht' };
  } catch (error) {
    console.error('IMAP Delete Fehler:', error);
    return { success: false, error: error.message };
  } finally {
    if (connection) try { await connection.end(); } catch (_) {}
  }
});

// Mark email as read/unread
// v1.10.0: OAuth2 support
ipcMain.handle('imap:markAsRead', async (event, accountId, uid, isRead = true, folder = 'INBOX') => {
  const account = getAccountById(accountId);

  if (!account) {
    return { success: false, error: 'Konto nicht gefunden' };
  }

  let connection;
  try {
    const config = getImapConfigForAccount(account);
    connection = await imapSimple.connect(config);
    await connection.openBox(folder);

    if (isRead) {
      await connection.addFlags(uid, ['\\Seen'], { uid: true });
    } else {
      await connection.delFlags(uid, ['\\Seen'], { uid: true });
    }

    return { success: true, message: isRead ? 'Als gelesen markiert' : 'Als ungelesen markiert' };
  } catch (error) {
    console.error('IMAP Mark Fehler:', error);
    return { success: false, error: error.message };
  } finally {
    if (connection) try { await connection.end(); } catch (_) {}
  }
});

// Move email to folder
// v1.10.0: OAuth2 support
ipcMain.handle('imap:moveEmail', async (event, accountId, uid, sourceFolder, destFolder) => {
  const account = getAccountById(accountId);

  if (!account) {
    return { success: false, error: 'Konto nicht gefunden' };
  }

  let connection;
  try {
    const config = getImapConfigForAccount(account);
    connection = await imapSimple.connect(config);

    // Create destination folder if it doesn't exist
    try {
      await connection.imap.addBox(destFolder);
    } catch (_) { /* already exists — ignore */ }

    await connection.openBox(sourceFolder);

    // Copy to destination folder
    await connection.imap.copy(uid, destFolder, { uid: true });

    // Delete from source folder
    await connection.addFlags(uid, ['\\Deleted'], { uid: true });
    await connection.imap.expunge();

    return { success: true, message: 'E-Mail verschoben' };
  } catch (error) {
    console.error('IMAP Move Fehler:', error);
    return { success: false, error: error.message };
  } finally {
    if (connection) try { await connection.end(); } catch (_) {}
  }
});

// ── v6.10.0: Papierkorb & Archiv (Outlook-Semantik) ─────────────────────────
// Löschen verschiebt in den Papierkorb statt endgültig zu expungen; Archivieren
// verschiebt in den Archiv-Ordner. Spezialordner werden bevorzugt über
// SPECIAL-USE-Attribute (RFC 6154) erkannt, sonst über übliche Namen, und bei
// Bedarf angelegt.
function flattenImapBoxes(boxes, prefix = '', out = []) {
  for (const [name, box] of Object.entries(boxes || {})) {
    const full = prefix ? prefix + (box.delimiter || '/') + name : name;
    const attribs = [...(box.attribs || []), box.special_use_attrib]
      .filter(Boolean)
      .map(a => String(a).toLowerCase());
    out.push({ name, full, attribs });
    if (box.children) flattenImapBoxes(box.children, full, out);
  }
  return out;
}

function findSpecialImapFolder(boxes, kind) {
  const flat = flattenImapBoxes(boxes);
  const attrib = kind === 'trash' ? '\\trash' : '\\archive';
  const names = kind === 'trash'
    ? ['trash', 'deleted items', 'deleted', 'deleted messages', 'papierkorb', 'gelöschte elemente', 'geloeschte elemente', 'bin', 'corbeille', 'cestino', 'papelera']
    : ['archive', 'archiv', 'archives'];
  const byAttrib = flat.find(b => b.attribs.includes(attrib));
  if (byAttrib) return byAttrib.full;
  // Namens-Fallback NUR auf Top-Level oder direkt unter INBOX — tief
  // verschachtelte Treffer (z.B. ein eigener Sortierordner "Foo/Archive")
  // sind fast nie der echte Spezialordner. Lieber einen sauberen
  // Top-Level-Ordner anlegen als in Nutzer-Ordner zu verschieben.
  const byName = flat.find(b => {
    if (!names.includes(b.name.toLowerCase())) return false;
    const depth = (b.full.match(/[./]/g) || []).length;
    return depth === 0 || (depth === 1 && /^inbox[./]/i.test(b.full));
  });
  return byName ? byName.full : null;
}

async function moveToSpecialImapFolder(accountId, uid, folder, kind) {
  const account = getAccountById(accountId);
  if (!account) return { success: false, error: 'Konto nicht gefunden' };

  let connection;
  const TIMEOUT_MS = 20000; // hängende Server dürfen die UI nicht blockieren
  try {
    return await Promise.race([
      (async () => {
        const config = getImapConfigForAccount(account);
        connection = await imapSimple.connect(config);
        const boxes = await connection.getBoxes();
        let dest = findSpecialImapFolder(boxes, kind);
        if (!dest) {
          const base = kind === 'trash' ? 'Trash' : 'Archive';
          // v7.0: Namespace beachten — Server, die alle Ordner unter INBOX
          // führen (Dovecot-Personal-Namespace), lehnen Top-Level-Ordner mit
          // "nonexistent namespace" ab. Dann INBOX.<Name> anlegen.
          const inboxKey = Object.keys(boxes || {}).find(k => k.toUpperCase() === 'INBOX');
          const topLevelOthers = Object.keys(boxes || {}).filter(k => k.toUpperCase() !== 'INBOX');
          if (inboxKey && topLevelOthers.length === 0) {
            const delim = boxes[inboxKey].delimiter || '.';
            dest = `${inboxKey}${delim}${base}`;
          } else {
            dest = base;
          }
          try { await connection.addBox(dest); } catch (_) { /* existiert schon */ }
        }
        if (dest === folder) {
          return { success: false, error: 'E-Mail ist bereits in diesem Ordner' };
        }
        await connection.openBox(folder);
        await connection.moveMessage(String(uid), dest);
        return { success: true, destFolder: dest };
      })(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`IMAP-${kind === 'trash' ? 'Papierkorb' : 'Archiv'}-Vorgang: Timeout nach 20s`)), TIMEOUT_MS)
      )
    ]);
  } catch (error) {
    console.error(`IMAP ${kind} Fehler:`, error);
    return { success: false, error: error.message };
  } finally {
    if (connection) try { await connection.end(); } catch (_) {}
  }
}

// v6.11.0: Undo für Papierkorb/Archiv — IMAP vergibt beim Verschieben eine
// neue UID, darum wird die Mail per Message-ID-Header im Zielordner gesucht
// und zurückverschoben.
ipcMain.handle('imap:findAndMove', async (event, accountId, fromFolder, toFolder, messageId) => {
  const account = getAccountById(accountId);
  if (!account) return { success: false, error: 'Konto nicht gefunden' };
  if (typeof messageId !== 'string' || !messageId.trim()) {
    return { success: false, error: 'Keine Message-ID — Rückgängig nicht möglich' };
  }

  let connection;
  const TIMEOUT_MS = 20000;
  try {
    return await Promise.race([
      (async () => {
        const config = getImapConfigForAccount(account);
        connection = await imapSimple.connect(config);
        await connection.openBox(fromFolder);
        const found = await connection.search(
          [['HEADER', 'MESSAGE-ID', messageId]],
          { bodies: ['HEADER.FIELDS (MESSAGE-ID)'], struct: false }
        );
        if (!found || found.length === 0) {
          return { success: false, error: 'E-Mail im Zielordner nicht gefunden' };
        }
        const uid = found[found.length - 1].attributes.uid;
        await connection.moveMessage(String(uid), toFolder);
        return { success: true };
      })(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Rückgängig: Timeout nach 20s')), TIMEOUT_MS)
      )
    ]);
  } catch (error) {
    console.error('IMAP findAndMove Fehler:', error);
    return { success: false, error: error.message };
  } finally {
    if (connection) try { await connection.end(); } catch (_) {}
  }
});

ipcMain.handle('imap:trashEmail', async (event, accountId, uid, folder = 'INBOX') => {
  return moveToSpecialImapFolder(accountId, uid, folder, 'trash');
});

ipcMain.handle('imap:archiveEmail', async (event, accountId, uid, folder = 'INBOX') => {
  return moveToSpecialImapFolder(accountId, uid, folder, 'archive');
});

// Graph: Papierkorb/Archiv über Well-Known-Folder-Namen — deleteditems bzw.
// archive funktionieren direkt als destinationId beim /move-Aufruf.
ipcMain.handle('graph:trashEmail', async (event, accountId, messageId) => {
  try {
    const result = await graphRequest(accountId, 'POST', `/me/messages/${messageId}/move`, {
      destinationId: 'deleteditems'
    });
    return { success: true, newId: result?.id, destFolder: 'deleteditems' };
  } catch (error) {
    console.error('[Graph] trashEmail:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('graph:archiveEmail', async (event, accountId, messageId) => {
  try {
    const result = await graphRequest(accountId, 'POST', `/me/messages/${messageId}/move`, {
      destinationId: 'archive'
    });
    return { success: true, newId: result?.id, destFolder: 'archive' };
  } catch (error) {
    console.error('[Graph] archiveEmail:', error.message);
    return { success: false, error: error.message };
  }
});

// List folders for account
// v1.10.0: OAuth2 support
ipcMain.handle('imap:listFolders', async (event, accountId) => {
  const account = getAccountById(accountId);
  if (!account) return { success: false, error: 'Konto nicht gefunden' };

  let connection;
  try {
    const config = getImapConfigForAccount(account);
    connection = await imapSimple.connect(config);
    const boxes = await connection.getBoxes();

    // v6.10.0: SPECIAL-USE-Attribute (RFC 6154) haben Vorrang vor Namensraten —
    // sonst wird z.B. ein französischer Papierkorb ("Corbeille") nicht erkannt
    // und die Papierkorb-Semantik im Renderer greift dort nicht.
    const specialUseType = (box) => {
      const attribs = [...(box.attribs || []), box.special_use_attrib]
        .filter(Boolean).map(a => String(a).toLowerCase());
      if (attribs.includes('\\trash')) return 'trash';
      if (attribs.includes('\\sent')) return 'sent';
      if (attribs.includes('\\drafts')) return 'drafts';
      if (attribs.includes('\\junk')) return 'spam';
      if (attribs.includes('\\archive')) return 'archive';
      return null;
    };

    const parseFolders = (boxMap, prefix = '') => {
      const folders = [];
      for (const name in boxMap) {
        const box = boxMap[name];
        const sep = box.delimiter || '/';
        const fullPath = prefix ? `${prefix}${sep}${name}` : name;
        const nameLower = name.toLowerCase();
        let type = 'folder';
        if (nameLower === 'inbox') type = 'inbox';
        else if (specialUseType(box)) type = specialUseType(box);
        else if (nameLower.includes('sent') || nameLower.includes('gesendet') || nameLower.includes('sent items')) type = 'sent';
        else if (nameLower.includes('draft') || nameLower.includes('entwu')) type = 'drafts';
        else if (nameLower.includes('trash') || nameLower.includes('papierkorb') || nameLower.includes('deleted') || nameLower.includes('gelöscht')) type = 'trash';
        else if (nameLower.includes('spam') || nameLower.includes('junk')) type = 'spam';
        else if (nameLower.includes('archive') || nameLower.includes('archiv')) type = 'archive';
        folders.push({
          name,
          path: fullPath,
          type,
          // v6.10.0: verlässliches SPECIAL-USE-Signal getrennt vom (teils
          // namensgeratenen) type — der Renderer stützt die Papierkorb-
          // Semantik nur auf specialUse bzw. exakte Namen, nie auf Substrings.
          specialUse: specialUseType(box),
          delimiter: sep,
          children: box.children ? parseFolders(box.children, fullPath) : []
        });
      }
      return folders;
    };

    const folders = parseFolders(boxes);
    return { success: true, folders };
  } catch (error) {
    console.error('IMAP Folders Fehler:', error);
    return { success: false, error: error.message };
  } finally {
    if (connection) try { connection.end(); } catch (_) {}
  }
});

// ── Folder management (create / rename / delete) ─────────────────────────────

ipcMain.handle('imap:createFolder', async (event, accountId, folderName) => {
  const account = getAccountById(accountId);
  if (!account) return { success: false, error: 'Konto nicht gefunden' };
  let connection;
  try {
    const config = getImapConfigForAccount(account);
    connection = await imapSimple.connect(config);
    await new Promise((resolve, reject) =>
      connection.imap.addBox(folderName, (err) => err ? reject(err) : resolve())
    );
    return { success: true };
  } catch (e) {
    console.error('[IMAP] createFolder:', e.message);
    return { success: false, error: e.message };
  } finally {
    if (connection) try { await connection.end(); } catch (_) {}
  }
});

ipcMain.handle('imap:renameFolder', async (event, accountId, oldName, newName) => {
  const account = getAccountById(accountId);
  if (!account) return { success: false, error: 'Konto nicht gefunden' };
  let connection;
  try {
    const config = getImapConfigForAccount(account);
    connection = await imapSimple.connect(config);
    await new Promise((resolve, reject) =>
      connection.imap.renameBox(oldName, newName, (err) => err ? reject(err) : resolve())
    );
    return { success: true };
  } catch (e) {
    console.error('[IMAP] renameFolder:', e.message);
    return { success: false, error: e.message };
  } finally {
    if (connection) try { await connection.end(); } catch (_) {}
  }
});

ipcMain.handle('imap:deleteFolder', async (event, accountId, folderName) => {
  const account = getAccountById(accountId);
  if (!account) return { success: false, error: 'Konto nicht gefunden' };
  let connection;
  try {
    const config = getImapConfigForAccount(account);
    connection = await imapSimple.connect(config);
    await new Promise((resolve, reject) =>
      connection.imap.delBox(folderName, (err) => err ? reject(err) : resolve())
    );
    return { success: true };
  } catch (e) {
    console.error('[IMAP] deleteFolder:', e.message);
    return { success: false, error: e.message };
  } finally {
    if (connection) try { await connection.end(); } catch (_) {}
  }
});

// ── Graph folder management ───────────────────────────────────────────────────

ipcMain.handle('graph:createFolder', async (event, accountId, folderName, parentId) => {
  try {
    const endpoint = parentId
      ? `/me/mailFolders/${parentId}/childFolders`
      : `/me/mailFolders`;
    const result = await graphRequest(accountId, 'POST', endpoint, { displayName: folderName });
    return { success: true, folder: result };
  } catch (e) {
    console.error('[Graph] createFolder:', e.message);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('graph:renameFolder', async (event, accountId, folderId, newName) => {
  try {
    await graphRequest(accountId, 'PATCH', `/me/mailFolders/${folderId}`, { displayName: newName });
    return { success: true };
  } catch (e) {
    console.error('[Graph] renameFolder:', e.message);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('graph:deleteFolder', async (event, accountId, folderId) => {
  try {
    await graphRequest(accountId, 'DELETE', `/me/mailFolders/${folderId}`);
    return { success: true };
  } catch (e) {
    console.error('[Graph] deleteFolder:', e.message);
    return { success: false, error: e.message };
  }
});

// Fetch emails from specific folder
// v1.10.0: OAuth2 support
// v2.3.1: Fixed to load ALL emails by default (limit = 0 means no limit)
ipcMain.handle('imap:fetchEmailsFromFolder', async (event, accountId, folder, options = {}) => {
  const account = getAccountById(accountId);
  
  if (!account) {
    return { success: false, error: 'Konto nicht gefunden' };
  }

  // v2.3.1: Changed default limit from 50 to 0 (0 = no limit, fetch all emails)
  const { limit = 0, offset = 0 } = options;

  let connection;
  try {
    const config = getImapConfigForAccount(account);
    connection = await imapSimple.connect(config);

    try {
      await connection.openBox(folder);
    } catch (err) {
      return { success: false, error: `Ordner "${folder}" konnte nicht geöffnet werden` };
    }

    const searchCriteria = ['ALL'];
    const fetchOptions = {
      bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE MESSAGE-ID)'],
      markSeen: false,
      struct: true
    };

    const messages = await connection.search(searchCriteria, fetchOptions);

    // Sort by date descending and apply pagination
    messages.sort((a, b) => {
      const dateA = new Date(a.attributes?.date || 0);
      const dateB = new Date(b.attributes?.date || 0);
      return dateB - dateA;
    });

    // v2.3.1: If limit is 0, return all messages; otherwise apply pagination
    const paginatedMessages = limit > 0 ? messages.slice(offset, offset + limit) : messages.slice(offset);

    const emails = paginatedMessages.map(msg => {
      const header = msg.parts.find(p => p.which.includes('HEADER'));
      const headerLines = header?.body || {};

      return {
        uid: msg.attributes.uid,
        subject: (headerLines.subject || ['(Kein Betreff)'])[0],
        from: (headerLines.from || ['Unbekannt'])[0],
        to: (headerLines.to || [''])[0],
        // v6.11.0: für Undo (imap:findAndMove sucht per Message-ID)
        messageId: (headerLines['message-id'] || [null])[0],
        date: msg.attributes.date || (headerLines.date || [new Date()])[0],
        seen: msg.attributes.flags?.includes('\\Seen') || false,
        // v6.14.0: einheitlicher Feldname (Plural) wie in den übrigen Fetches —
        // Singular bleibt für ältere Cache-Einträge erhalten
        hasAttachment: !!msg.attributes.struct?.find(p => p.disposition?.type === 'attachment'),
        hasAttachments: !!msg.attributes.struct?.find(p => p.disposition?.type === 'attachment'),
        preview: ''
      };
    });

    return {
      success: true,
      emails,
      folder,
      total: messages.length,
      // v2.3.1: hasMore is always false if limit is 0 (all loaded)
      hasMore: limit > 0 ? (offset + limit < messages.length) : false
    };
  } catch (error) {
    console.error('IMAP Fetch Folder Fehler:', error);
    return { success: false, error: error.message };
  } finally {
    if (connection) try { await connection.end(); } catch (_) {}
  }
});



// ============ GLOBAL SEARCH (v1.13.0) ============
// Search emails across all accounts and folders with advanced filters

ipcMain.handle('search:globalSearch', async (event, searchParams) => {
  const {
    query,
    accountIds = [], // Empty = all accounts
    folders = [],    // Empty = all folders
    filters = {}     // Advanced filters
  } = searchParams;

  if (!query || query.trim().length < 2) {
    return { success: false, error: 'Suchbegriff muss mindestens 2 Zeichen haben' };
  }

  const accounts = store.get('accounts', []);
  const searchableAccounts = accountIds.length > 0 
    ? accounts.filter(a => accountIds.includes(a.id))
    : accounts;

  if (searchableAccounts.length === 0) {
    return { success: false, error: 'Keine Konten zum Durchsuchen gefunden' };
  }

  const searchTerm = query.toLowerCase().trim();

  // Perf: search all accounts in parallel (one IMAP connection per account)
  const accountResults = await Promise.all(searchableAccounts.map(async (account) => {
    const accountEmails = [];
    try {
      const config = getImapConfigForAccount(account);
      const connection = await imapSimple.connect(config);

      let foldersToSearch = folders.length > 0 ? folders : ['INBOX'];
      if (folders.length === 0 || folders.includes('*')) {
        try {
          const boxes = await connection.getBoxes();
          foldersToSearch = extractFolderPaths(boxes);
        } catch (e) {
          foldersToSearch = ['INBOX'];
        }
      }

      for (const folder of foldersToSearch) {
        try {
          await connection.openBox(folder);
          const searchCriteria = buildSearchCriteria(searchTerm, filters);
          // '' enthält bereits die komplette Roh-Mail — HEADER/TEXT zusätzlich
          // anzufordern würde denselben Inhalt bis zu 3x herunterladen.
          const fetchOptions = {
            bodies: [''],
            markSeen: false,
            struct: true
          };
          const messages = await connection.search(searchCriteria, fetchOptions);

          // Perf: parse matching messages in parallel (limit 100 per folder)
          const parsed = await Promise.all(
            messages.slice(-100).map(async (message) => {
              try {
                const all = message.parts.find(p => p.which === '');
                return { message, parsed: await simpleParser(all.body) };
              } catch (e) {
                return null;
              }
            })
          );

          for (const entry of parsed) {
            if (!entry) continue;
            const { message, parsed: p } = entry;
            if (matchesFilters(p, message, filters, searchTerm)) {
              const isUnread = !message.attributes.flags.includes('\\Seen');
              accountEmails.push({
                uid: message.attributes.uid,
                accountId: account.id,
                accountName: account.name,
                folder,
                subject: p.subject || '(Kein Betreff)',
                from: p.from?.text || 'Unbekannt',
                fromName: p.from?.value?.[0]?.name || p.from?.text?.split('<')[0]?.trim() || 'Unbekannt',
                fromEmail: p.from?.value?.[0]?.address || '',
                to: p.to?.text || '',
                date: p.date || new Date(),
                seen: !isUnread,
                flagged: message.attributes.flags.includes('\\Flagged'),
                hasAttachments: p.attachments && p.attachments.length > 0,
                preview: p.text ? p.text.substring(0, 200).replace(/\n/g, ' ') + '...' : '',
                matchedIn: getMatchedFields(p, searchTerm)
              });
            }
          }
        } catch (folderErr) {
          console.log(`Could not search folder ${folder}:`, folderErr.message);
        }
      }

      await connection.end();
    } catch (accountErr) {
      console.error(`Search error for account ${account.name}:`, accountErr.message);
    }
    return accountEmails;
  }));

  const results = accountResults.flat();

  // Sort results by date (newest first)
  results.sort((a, b) => new Date(b.date) - new Date(a.date));

  return {
    success: true,
    results: results.slice(0, 200), // Limit total results
    totalFound: results.length,
    searchedAccounts: searchableAccounts.length,
    query: searchTerm
  };
});

// Helper: Extract all folder paths from IMAP boxes
function extractFolderPaths(boxes, prefix = '') {
  const paths = [];
  for (const [name, box] of Object.entries(boxes)) {
    const fullPath = prefix ? `${prefix}${box.delimiter || '/'}${name}` : name;
    paths.push(fullPath);
    if (box.children) {
      paths.push(...extractFolderPaths(box.children, fullPath));
    }
  }
  return paths;
}

// Helper: Build IMAP search criteria
function buildSearchCriteria(searchTerm, filters) {
  const criteria = [];
  
  // Text search - use OR for multiple fields
  // Note: IMAP search is case-insensitive
  if (searchTerm) {
    criteria.push(['OR', 
      ['OR', 
        ['SUBJECT', searchTerm],
        ['FROM', searchTerm]
      ],
      ['OR',
        ['TO', searchTerm],
        ['BODY', searchTerm]
      ]
    ]);
  }
  
  // Date filters
  if (filters.dateFrom) {
    criteria.push(['SINCE', new Date(filters.dateFrom)]);
  }
  if (filters.dateTo) {
    criteria.push(['BEFORE', new Date(filters.dateTo)]);
  }
  
  // Read/Unread filter
  if (filters.unreadOnly === true) {
    criteria.push('UNSEEN');
  }
  
  // Flagged filter
  if (filters.flaggedOnly === true) {
    criteria.push('FLAGGED');
  }
  
  // Has attachments - Note: Not all IMAP servers support this
  // We'll filter in memory instead
  
  return criteria.length > 0 ? criteria : ['ALL'];
}

// Helper: Check if email matches filters (in-memory filtering)
function matchesFilters(parsed, message, filters, searchTerm) {
  // Check attachments filter
  if (filters.hasAttachments === true) {
    if (!parsed.attachments || parsed.attachments.length === 0) {
      return false;
    }
  }
  
  // Additional text matching for better precision
  const subject = (parsed.subject || '').toLowerCase();
  const from = (parsed.from?.text || '').toLowerCase();
  const to = (parsed.to?.text || '').toLowerCase();
  const body = (parsed.text || '').toLowerCase();
  const html = (parsed.html || '').toLowerCase();
  
  // Must match at least one field
  const matchesText = 
    subject.includes(searchTerm) ||
    from.includes(searchTerm) ||
    to.includes(searchTerm) ||
    body.includes(searchTerm) ||
    html.includes(searchTerm);
  
  return matchesText;
}

// Helper: Get which fields matched the search term
function getMatchedFields(parsed, searchTerm) {
  const matched = [];
  
  if ((parsed.subject || '').toLowerCase().includes(searchTerm)) {
    matched.push('subject');
  }
  if ((parsed.from?.text || '').toLowerCase().includes(searchTerm)) {
    matched.push('from');
  }
  if ((parsed.to?.text || '').toLowerCase().includes(searchTerm)) {
    matched.push('to');
  }
  if ((parsed.text || '').toLowerCase().includes(searchTerm) ||
      (parsed.html || '').toLowerCase().includes(searchTerm)) {
    matched.push('body');
  }
  
  return matched;
}

// Quick-Search-Cache in-memory — vorher wurde bei jedem Konto-Fetch die
// komplette verschlüsselte Config gelesen und synchron neu geschrieben.
let quickCacheMem = null;
let quickCacheFlushTimer = null;
function getQuickCache() {
  if (!quickCacheMem) quickCacheMem = store.get('emailCache', []);
  return quickCacheMem;
}
function flushQuickCache() {
  if (quickCacheFlushTimer) { clearTimeout(quickCacheFlushTimer); quickCacheFlushTimer = null; }
  if (quickCacheMem) store.set('emailCache', quickCacheMem);
}
app.on('before-quit', flushQuickCache);

// Quick search - Search in local cache first (faster)
ipcMain.handle('search:quickSearch', async (event, { query, limit = 20 }) => {
  if (!query || query.trim().length < 2) {
    return { success: true, suggestions: [] };
  }

  const searchTerm = query.toLowerCase().trim();
  const cachedEmails = getQuickCache();
  
  // Search in cached emails
  const suggestions = cachedEmails
    .filter(email => {
      const subject = (email.subject || '').toLowerCase();
      const from = (email.from || '').toLowerCase();
      return subject.includes(searchTerm) || from.includes(searchTerm);
    })
    .slice(0, limit)
    .map(email => ({
      uid: email.uid,
      accountId: email.accountId,
      subject: email.subject,
      from: email.from,
      date: email.date
    }));
  
  return { success: true, suggestions };
});

// Cache emails for quick search
ipcMain.handle('search:updateCache', async (event, { accountId, emails }) => {
  try {
    const cache = getQuickCache();

    // Remove old entries for this account
    const filtered = cache.filter(e => e.accountId !== accountId);

    // Add new entries
    const newEntries = emails.map(e => ({
      ...e,
      accountId,
      cachedAt: new Date().toISOString()
    }));

    // Keep cache manageable (max 1000 entries)
    quickCacheMem = [...newEntries, ...filtered].slice(0, 1000);
    if (!quickCacheFlushTimer) quickCacheFlushTimer = setTimeout(flushQuickCache, 5000);

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});


// ============================================================
// MICROSOFT EXCHANGE / MICROSOFT 365 via Graph API (v2.9.0)
// ============================================================

const msalInstances = {}; // clientId → PublicClientApplication

const MS_GRAPH_SCOPES = [
  'https://graph.microsoft.com/Mail.ReadWrite',
  'https://graph.microsoft.com/Mail.Send',
  'https://graph.microsoft.com/User.Read',
  'https://graph.microsoft.com/Calendars.ReadWrite',
  'offline_access'
];

const GRAPH_FOLDER_MAP = {
  'INBOX': 'inbox',
  'Sent': 'sentitems',
  'Drafts': 'drafts',
  'Deleted': 'deleteditems',
  'Trash': 'deleteditems',
  'Junk': 'junkemail',
  'Spam': 'junkemail',
  'Archive': 'archive'
};

function getMsalApp(clientId, tenantId) {
  const instanceKey = tenantId ? `${clientId}_${tenantId}` : clientId;
  if (!msalInstances[instanceKey]) {
    const msal = require('@azure/msal-node');
    const authority = tenantId
      ? `https://login.microsoftonline.com/${tenantId}`
      : 'https://login.microsoftonline.com/common';
    msalInstances[instanceKey] = new msal.PublicClientApplication({
      auth: { clientId, authority },
      system: {
        loggerOptions: {
          loggerCallback: () => {},
          piiLoggingEnabled: false,
          logLevel: 3
        }
      }
    });
  }
  return msalInstances[instanceKey];
}

// v6.8.1: In-Memory-Token-Cache — vorher liefen deserialize + acquireTokenSilent
// + ein synchroner verschlüsselter store.set bei JEDEM Graph-Request (jedes
// Mail-Öffnen, jeder Poll). Der Token ist ~1h gültig; solange er frisch ist,
// braucht es weder MSAL noch Disk.
const graphTokenCache = new Map();      // accountId → { token, expiresOn(ms) }
const msalCacheLoaded = new Set();      // accountId — Disk-Cache nur einmal laden
const msalCacheLastWritten = new Map(); // accountId → zuletzt geschriebener Serialize-String

function invalidateGraphTokenCache(accountId) {
  graphTokenCache.delete(accountId);
  msalCacheLoaded.delete(accountId);
  msalCacheLastWritten.delete(accountId);
}

async function getGraphAccessToken(accountId) {
  const mem = graphTokenCache.get(accountId);
  if (mem && mem.expiresOn - Date.now() > 5 * 60 * 1000) {
    return mem.token;
  }

  const account = getAccountById(accountId);
  if (!account || account.type !== 'microsoft') throw new Error('Kein Microsoft-Konto');

  const clientId = account.microsoft.clientId;
  const tenantId = account.microsoft.tenantId || null;
  const pca = getMsalApp(clientId, tenantId);

  // Restore token cache from store (einmal pro Session/Invalidierung)
  const cacheKey = `msalCache_${accountId}`;
  if (!msalCacheLoaded.has(accountId)) {
    const cachedData = store.get(cacheKey, '');
    if (cachedData) {
      pca.getTokenCache().deserialize(cachedData);
      msalCacheLastWritten.set(accountId, cachedData);
    }
    msalCacheLoaded.add(accountId);
  }

  const msalAccounts = await pca.getTokenCache().getAllAccounts();
  if (msalAccounts.length === 0) {
    invalidateGraphTokenCache(accountId);
    throw new Error('TOKEN_EXPIRED');
  }

  // When multiple M365 accounts share the same clientId, the MSAL instance cache
  // accumulates all their tokens. Pick the account matching this CoreMail account's
  // email to avoid always fetching mail for the first account in the cache.
  const accountEmail = (account.microsoft?.email || account.email || '').toLowerCase();
  const msalAccount = accountEmail
    ? (msalAccounts.find(a => (a.username || '').toLowerCase() === accountEmail) || msalAccounts[0])
    : msalAccounts[0];

  try {
    const result = await pca.acquireTokenSilent({
      scopes: MS_GRAPH_SCOPES,
      account: msalAccount
    });
    graphTokenCache.set(accountId, {
      token: result.accessToken,
      expiresOn: result.expiresOn ? new Date(result.expiresOn).getTime() : Date.now() + 30 * 60 * 1000
    });
    // Nur auf Disk schreiben, wenn sich der MSAL-Cache tatsächlich geändert
    // hat (z.B. Refresh-Token rotiert) — sonst wäre es derselbe Blob.
    const serialized = pca.getTokenCache().serialize();
    if (serialized !== msalCacheLastWritten.get(accountId)) {
      store.set(cacheKey, serialized);
      msalCacheLastWritten.set(accountId, serialized);
    }
    return result.accessToken;
  } catch (err) {
    // Silent token failed: scope consent needed (AADSTS65001) or token truly expired
    // Surface as TOKEN_EXPIRED so the UI shows the re-login prompt
    console.log('[MSAL] Silent token failed:', err.message);
    invalidateGraphTokenCache(accountId);
    throw new Error('TOKEN_EXPIRED');
  }
}

async function graphRequest(accountId, method, apiPath, body, extraHeaders = {}, _retryCount = 0) {
  const token = await getGraphAccessToken(accountId);

  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...extraHeaders
    }
  };
  if (body !== undefined) opts.body = JSON.stringify(body);

  const resp = await fetch(`https://graph.microsoft.com/v1.0${apiPath}`, opts);

  if (resp.status === 204 || resp.status === 202) return null; // No content

  // Retry on 429 (rate limit) or 503 (service unavailable), up to 3 times
  if ((resp.status === 429 || resp.status === 503) && _retryCount < 3) {
    const retryAfter = parseInt(resp.headers.get('Retry-After') || '0', 10);
    const backoff = retryAfter > 0 ? retryAfter * 1000 : Math.min(1000 * Math.pow(2, _retryCount), 16000);
    console.warn(`[Graph] ${resp.status} on ${apiPath} — retry ${_retryCount + 1}/3 after ${backoff}ms`);
    await new Promise(r => setTimeout(r, backoff));
    return graphRequest(accountId, method, apiPath, body, extraHeaders, _retryCount + 1);
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Graph ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const text = await resp.text();
  if (!text) return null;
  return JSON.parse(text);
}

function normalizeGraphEmail(msg) {
  const fromName = msg.from?.emailAddress?.name || '';
  const fromAddr = msg.from?.emailAddress?.address || '';
  return {
    uid: msg.id,
    subject: msg.subject || '(Kein Betreff)',
    from: fromName ? `${fromName} <${fromAddr}>` : fromAddr,
    fromName,
    to: (msg.toRecipients || []).map(r => r.emailAddress?.address).filter(Boolean).join(', '),
    date: msg.receivedDateTime || new Date().toISOString(),
    seen: msg.isRead === true,
    hasAttachments: msg.hasAttachments === true,
    preview: msg.bodyPreview ? msg.bodyPreview.substring(0, 80).trim() : '',
    flags: msg.isRead ? ['\\Seen'] : []
  };
}

// --- IPC: Microsoft OAuth2 Login ---
ipcMain.handle('msauth:startLogin', async (event, { clientId }) => {
  try {
    const msal = require('@azure/msal-node');
    // Fresh instance for login (avoids stale cache issues)
    const pca = new msal.PublicClientApplication({
      auth: {
        clientId,
        authority: 'https://login.microsoftonline.com/common'
      }
    });

    const result = await pca.acquireTokenInteractive({
      scopes: MS_GRAPH_SCOPES,
      openBrowser: async (authUrl) => {
        await shell.openExternal(authUrl);
      },
      successTemplate: '<html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0d1117;color:#e6edf3"><h2 style="color:#3fb950">✅ Anmeldung erfolgreich!</h2><p>Du kannst dieses Fenster schließen und zu CoreMail zurückkehren.</p></body></html>',
      errorTemplate: '<html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0d1117;color:#e6edf3"><h2 style="color:#f85149">❌ Anmeldung fehlgeschlagen</h2><p>{error}</p></body></html>'
    });

    // Fetch display name and email via Graph
    const userResp = await fetch('https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName', {
      headers: { 'Authorization': `Bearer ${result.accessToken}` }
    });
    const userInfo = await userResp.json();
    const email = userInfo.mail || userInfo.userPrincipalName || result.account.username || '';
    const displayName = userInfo.displayName || email;

    // Temporary ID used until account is saved; caller replaces with final ID
    const tempId = `ms_${Date.now()}`;
    store.set(`msalCache_${tempId}`, pca.getTokenCache().serialize());

    const tenantId = result.account?.tenantId || result.idTokenClaims?.tid || null;
    return { success: true, email, displayName, tempId, clientId, tenantId };
  } catch (error) {
    console.error('[MSAuth] Login error:', error.message);
    return { success: false, error: error.message };
  }
});

// --- IPC: Re-login (token refresh after expiry) ---
ipcMain.handle('msauth:relogin', async (event, accountId) => {
  try {
    const account = getAccountById(accountId);
    if (!account?.microsoft?.clientId) return { success: false, error: 'Kein Microsoft-Konto' };

    const msal = require('@azure/msal-node');
    const reloginTenantId = account.microsoft.tenantId || null;
    const reloginAuthority = reloginTenantId
      ? `https://login.microsoftonline.com/${reloginTenantId}`
      : 'https://login.microsoftonline.com/common';
    const pca = new msal.PublicClientApplication({
      auth: { clientId: account.microsoft.clientId, authority: reloginAuthority }
    });

    const result = await pca.acquireTokenInteractive({
      scopes: MS_GRAPH_SCOPES,
      openBrowser: async (authUrl) => { await shell.openExternal(authUrl); },
      successTemplate: '<html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0d1117;color:#e6edf3"><h2 style="color:#3fb950">✅ Erneut angemeldet!</h2><p>Du kannst dieses Fenster schließen.</p></body></html>',
      errorTemplate: '<html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;text-align:center;padding:40px;background:#0d1117;color:#e6edf3"><h2 style="color:#f85149">❌ Fehler</h2><p>{error}</p></body></html>'
    });

    store.set(`msalCache_${accountId}`, pca.getTokenCache().serialize());
    const reloginInstanceKey = reloginTenantId ? `${account.microsoft.clientId}_${reloginTenantId}` : account.microsoft.clientId;
    msalInstances[reloginInstanceKey] = pca; // update cached instance
    invalidateGraphTokenCache(accountId); // frischen Cache beim nächsten Request laden
    return { success: true };
  } catch (error) {
    console.error('[MSAuth] Relogin error:', error.message);
    return { success: false, error: error.message };
  }
});

// --- IPC: Logout (clear tokens) ---
ipcMain.handle('msauth:logout', async (event, accountId) => {
  try {
    const account = getAccountById(accountId);
    if (account?.microsoft?.clientId) delete msalInstances[account.microsoft.clientId];
    store.delete(`msalCache_${accountId}`);
    invalidateGraphTokenCache(accountId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// --- IPC: Graph – Fetch emails from folder ---
ipcMain.handle('graph:fetchEmails', async (event, accountId, { folder = 'INBOX', limit = 50, skip = 0 } = {}) => {
  try {
    const graphFolder = GRAPH_FOLDER_MAP[folder] || folder;
    const select = 'id,subject,from,toRecipients,ccRecipients,receivedDateTime,isRead,hasAttachments,bodyPreview';
    const data = await graphRequest(
      accountId, 'GET',
      `/me/mailFolders/${graphFolder}/messages?$top=${limit}&$skip=${skip}&$select=${select}&$orderby=receivedDateTime desc`
    );
    const emails = (data?.value || []).map(normalizeGraphEmail);
    // v6.9.0: Absender fürs Adress-Autocomplete merken
    learnContactsFromEmails(emails);
    // v6.6.0: Mail-Regeln auch auf Graph-Konten anwenden
    const account = getAccountById(accountId);
    const filtered = account
      ? await runRulesOnFetchedEmails(account, folder, emails, 'graph')
      : emails;
    return { success: true, emails: filtered, hasMore: !!(data?.['@odata.nextLink']), total: filtered.length };
  } catch (error) {
    console.error('[Graph] fetchEmails:', error.message);
    if (error.message === 'TOKEN_EXPIRED') return { success: false, error: 'TOKEN_EXPIRED', emails: [] };
    return { success: false, error: error.message, emails: [] };
  }
});

// ─── Graph: Meeting-Einladungen (v7.2.0) ────────────────────────────────────
// Exchange wandelt Einladungen in "eventMessage"-Objekte um und entfernt den
// text/calendar-Teil. Die Termindaten stehen am verknüpften Kalendereintrag,
// den Graph per $expand=event mitliefert.

const GRAPH_PARTSTAT = {
  accepted: 'ACCEPTED',
  declined: 'DECLINED',
  tentativelyAccepted: 'TENTATIVE',
  notResponded: 'NEEDS-ACTION',
  none: 'NEEDS-ACTION',
  organizer: 'ACCEPTED'
};

const GRAPH_MESSAGE_METHOD = {
  meetingRequest: 'REQUEST',
  meetingCancelled: 'CANCEL',
  meetingAccepted: 'REPLY',
  meetingTentativelyAccepted: 'REPLY',
  meetingDeclined: 'REPLY'
};

const GRAPH_WEEKDAYS = {
  monday: 'Montag', tuesday: 'Dienstag', wednesday: 'Mittwoch', thursday: 'Donnerstag',
  friday: 'Freitag', saturday: 'Samstag', sunday: 'Sonntag'
};

function describeGraphRecurrence(recurrence) {
  const pattern = recurrence?.pattern;
  if (!pattern) return null;
  const interval = pattern.interval || 1;
  const type = String(pattern.type || '').toLowerCase();
  let text;
  if (type === 'daily')                             text = interval === 1 ? 'Täglich' : `Alle ${interval} Tage`;
  else if (type === 'weekly')                       text = interval === 1 ? 'Wöchentlich' : `Alle ${interval} Wochen`;
  else if (type.includes('monthly'))                text = interval === 1 ? 'Monatlich' : `Alle ${interval} Monate`;
  else if (type.includes('yearly'))                 text = interval === 1 ? 'Jährlich' : `Alle ${interval} Jahre`;
  else return null;

  const days = (pattern.daysOfWeek || []).map(d => GRAPH_WEEKDAYS[String(d).toLowerCase()]).filter(Boolean);
  if (days.length) text += ` am ${days.join(', ')}`;

  const range = recurrence.range || {};
  if (range.type === 'numbered' && range.numberOfOccurrences) text += `, ${range.numberOfOccurrences}×`;
  else if (range.type === 'endDate' && range.endDate) text += `, bis ${String(range.endDate).slice(0, 10).split('-').reverse().join('.')}`;
  return text;
}

// Graph liefert dateTime ohne Zeitzonen-Suffix; mit Prefer-UTC ist es UTC.
function graphDateToIso(slot, isAllDay) {
  const dt = slot?.dateTime || slot?.date;
  if (!dt) return null;
  if (isAllDay) return String(dt).slice(0, 10);
  if (/Z$|[+-]\d{2}:\d{2}$/.test(dt)) return new Date(dt).toISOString();
  return new Date(dt + 'Z').toISOString();
}

// Erkennt eine Einladung, ohne für jede geöffnete Mail eine Zusatzabfrage zu
// riskieren: Graph annotiert abgeleitete Typen mit @odata.type, und Exchange
// setzt zusätzlich den Header `Content-Class: urn:content-classes:calendarmessage`.
// Zwei unabhängige Signale — fehlt eines, greift das andere.
function isGraphMeetingMessage(message) {
  const odataType = String(message?.['@odata.type'] || '').toLowerCase();
  if (odataType.includes('eventmessage')) return true;
  if (message?.meetingMessageType) return true;
  const headers = message?.internetMessageHeaders || [];
  return headers.some(h => /^content-class$/i.test(h?.name || '') && /calendarmessage/i.test(h?.value || ''));
}

async function fetchGraphInvitation(accountId, messageId, message) {
  if (!isGraphMeetingMessage(message)) return null;

  try {
    const detail = await graphRequest(
      accountId, 'GET',
      `/me/messages/${messageId}?$select=id,meetingMessageType,isOutOfDate&$expand=event`,
      undefined,
      { 'Prefer': 'outlook.timezone="UTC"' }
    );
    const ev = detail?.event;
    if (!ev) return null;

    const method = GRAPH_MESSAGE_METHOD[detail.meetingMessageType] || 'REQUEST';
    const organizer = ev.organizer?.emailAddress || {};

    return {
      source: 'graph',
      method,
      eventId: ev.id || null,
      uid: ev.iCalUId || null,
      sequence: 0,
      status: ev.isCancelled ? 'CANCELLED' : 'CONFIRMED',
      summary: ev.subject || '(Kein Titel)',
      description: ev.bodyPreview || '',
      location: ev.location?.displayName || '',
      url: ev.webLink || null,
      start: graphDateToIso(ev.start, ev.isAllDay),
      end: graphDateToIso(ev.end, ev.isAllDay),
      allDay: ev.isAllDay === true,
      timeZone: ev.start?.timeZone || null,
      organizer: (organizer.address || organizer.name)
        ? { name: organizer.name || organizer.address, email: organizer.address || '', partstat: 'ACCEPTED' }
        : null,
      attendees: (ev.attendees || []).map(a => ({
        name: a.emailAddress?.name || a.emailAddress?.address || '',
        email: a.emailAddress?.address || '',
        partstat: GRAPH_PARTSTAT[a.status?.response] || 'NEEDS-ACTION',
        optional: String(a.type || '').toLowerCase() === 'optional',
        rsvp: true
      })),
      rrule: null,
      recurrence: describeGraphRecurrence(ev.recurrence),
      meetingUrl: ev.onlineMeeting?.joinUrl || (ev.isOnlineMeeting ? ev.onlineMeetingUrl : null) || null,
      isCancelled: method === 'CANCEL' || ev.isCancelled === true,
      isOutOfDate: detail.isOutOfDate === true,
      myResponse: GRAPH_PARTSTAT[ev.responseStatus?.response] || 'NEEDS-ACTION',
      filename: 'einladung.ics'
    };
  } catch (err) {
    console.error('[Einladung] Graph-Termin nicht ladbar:', err.message);
    return null;
  }
}

// --- IPC: Graph – Fetch single email with body ---
ipcMain.handle('graph:fetchEmail', async (event, accountId, messageId) => {
  try {
    // internetMessageHeaders zusätzlich anfragen für List-Unsubscribe-Erkennung
    const data = await graphRequest(
      accountId, 'GET',
      `/me/messages/${messageId}?$select=id,subject,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,isRead,hasAttachments,body,internetMessageHeaders&$expand=attachments`
    );

    // List-Unsubscribe aus Graph-internetMessageHeaders extrahieren
    let listUnsubscribe = null;
    try {
      const headers = data.internetMessageHeaders || [];
      const lu = headers.find(h => /^list-unsubscribe$/i.test(h.name));
      const lup = headers.find(h => /^list-unsubscribe-post$/i.test(h.name));
      if (lu?.value) {
        const items = (lu.value.match(/<([^>]+)>/g) || []);
        let mailto = null, http = null;
        for (const it of items) {
          const v = it.slice(1, -1).trim();
          if (v.startsWith('mailto:')) mailto = mailto || v;
          else if (v.startsWith('http://') || v.startsWith('https://')) http = http || v;
        }
        if (mailto || http) {
          listUnsubscribe = { mailto, http, oneClick: !!lup && /one-click/i.test(lup.value) };
        }
      }
    } catch (_) {}

    const attachments = normalizeAttachments((data.attachments || []).map(att => ({
      filename: att.name,
      size: att.size,
      contentType: att.contentType,
      content: att.contentBytes || null,
      id: att.id
    })));

    const email = {
      ...normalizeGraphEmail(data),
      html: data.body?.contentType?.toLowerCase() === 'html' ? data.body.content : null,
      text: data.body?.contentType?.toLowerCase() === 'text' ? data.body.content : null,
      cc: (data.ccRecipients || []).map(r => r.emailAddress?.address).filter(Boolean).join(', '),
      bcc: (data.bccRecipients || []).map(r => r.emailAddress?.address).filter(Boolean).join(', '),
      listUnsubscribe,
      attachments
    };

    // v7.2.0: Meeting-Einladung. Exchange reicht bei M365-Konten keinen
    // text/calendar-Anhang durch — die Termindaten hängen stattdessen am
    // zugehörigen Kalendereintrag (eventMessage). Darum zuerst der Anhang-Weg
    // (z.B. weitergeleitete .ics), danach der Graph-Weg.
    email.invitation = extractInvitation(attachments, null) || await fetchGraphInvitation(accountId, messageId, data);

    return { success: true, email };
  } catch (error) {
    console.error('[Graph] fetchEmail:', error.message);
    return { success: false, error: error.message };
  }
});

// --- IPC: Graph – Send email ---
ipcMain.handle('graph:sendEmail', async (event, accountId, emailData) => {
  try {
    const parseAddrs = (str) => (str || '').split(/[,;]/).map(s => s.trim()).filter(Boolean)
      .map(addr => {
        const match = addr.match(/^(.*?)\s*<([^>]+)>\s*$/);
        if (match) return { emailAddress: { name: match[1].trim(), address: match[2].trim() } };
        return { emailAddress: { address: addr.trim() } };
      });

    // Attachments: Graph /sendMail supports up to 3 MB per file.
    // Files are loaded as base64 in the renderer (FileReader.readAsDataURL → split(',')[1]).
    const GRAPH_ATTACH_LIMIT = 3 * 1024 * 1024; // 3 MB in bytes
    const rawAttachments = emailData.attachments || [];
    const oversized = rawAttachments.filter(a => {
      // base64 string length × 0.75 ≈ byte size
      const approxBytes = (a.content?.length || 0) * 0.75;
      return approxBytes > GRAPH_ATTACH_LIMIT;
    });
    if (oversized.length > 0) {
      return {
        success: false,
        error: `Anhang zu gross für Microsoft 365 (max. 3 MB pro Datei): ${oversized.map(a => a.filename).join(', ')}. Bitte die Datei zuerst in OneDrive hochladen und den Link teilen.`
      };
    }

    const graphAttachments = rawAttachments.map(a => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: a.filename,
      contentType: a.contentType || 'application/octet-stream',
      contentBytes: a.content, // already base64
    }));

    // Threading headers for replies
    const internetMessageHeaders = [];
    if (emailData.inReplyTo)  internetMessageHeaders.push({ name: 'In-Reply-To', value: emailData.inReplyTo });
    if (emailData.references) internetMessageHeaders.push({ name: 'References',  value: emailData.references });

    const message = {
      subject: emailData.subject || '(Kein Betreff)',
      body: {
        contentType: emailData.html ? 'html' : 'text',
        content: emailData.html || emailData.text || ''
      },
      toRecipients:  parseAddrs(emailData.to),
      ccRecipients:  parseAddrs(emailData.cc),
      bccRecipients: parseAddrs(emailData.bcc),
      ...(graphAttachments.length > 0 && { attachments: graphAttachments }),
      ...(internetMessageHeaders.length > 0 && { internetMessageHeaders }),
    };

    await graphRequest(accountId, 'POST', '/me/sendMail', { message, saveToSentItems: true });
    // v6.9.0: Empfänger fürs Adress-Autocomplete merken
    learnContactsFromSend(emailData);
    return { success: true };
  } catch (error) {
    console.error('[Graph] sendEmail:', error.message);
    return { success: false, error: error.message };
  }
});

// --- IPC: Graph – Delete email ---
ipcMain.handle('graph:deleteEmail', async (event, accountId, messageId) => {
  try {
    await graphRequest(accountId, 'DELETE', `/me/messages/${messageId}`);
    return { success: true };
  } catch (error) {
    console.error('[Graph] deleteEmail:', error.message);
    return { success: false, error: error.message };
  }
});

// --- IPC: Graph – Mark as read/unread ---
ipcMain.handle('graph:markAsRead', async (event, accountId, messageId, isRead) => {
  try {
    await graphRequest(accountId, 'PATCH', `/me/messages/${messageId}`, { isRead });
    return { success: true };
  } catch (error) {
    console.error('[Graph] markAsRead:', error.message);
    return { success: false, error: error.message };
  }
});

// --- IPC: Graph – Move email ---
ipcMain.handle('graph:moveEmail', async (event, accountId, messageId, destinationFolderId) => {
  try {
    const result = await graphRequest(accountId, 'POST', `/me/messages/${messageId}/move`, {
      destinationId: destinationFolderId
    });
    return { success: true, newId: result?.id };
  } catch (error) {
    console.error('[Graph] moveEmail:', error.message);
    return { success: false, error: error.message };
  }
});

// --- IPC: Graph – List mail folders (with 60s TTL cache) ---
const graphFolderCache = new Map(); // accountId → { folders, ts }
const GRAPH_FOLDER_CACHE_TTL = 60_000; // 60 seconds

ipcMain.handle('graph:listFolders', async (event, accountId) => {
  try {
    // Return cached result if still fresh
    const cached = graphFolderCache.get(accountId);
    if (cached && (Date.now() - cached.ts) < GRAPH_FOLDER_CACHE_TTL) {
      return { success: true, folders: cached.folders, fromCache: true };
    }

    // No $select — let Graph return all default fields to avoid tenant-specific issues
    const data = await graphRequest(
      accountId, 'GET',
      `/me/mailFolders?$top=100`
    );
    const topLevel = data?.value || [];
    console.log(`[Graph] listFolders: ${topLevel.length} top-level Ordner gefunden`);

    const mapFolder = (f) => ({
      id: f.id,
      name: f.displayName || f.name || '(Unbekannt)',
      path: f.id,
      wellKnown: f.wellKnownName || null,
      unread: f.unreadItemCount || 0,
      total: f.totalItemCount || 0,
      type: f.wellKnownName || 'folder',
      isHidden: f.isHidden === true,
      childFolderCount: f.childFolderCount || 0,
      children: [],
    });

    // Fetch child folders for all parent folders in parallel
    const foldersWithChildren = await Promise.all(
      topLevel.map(async (f) => {
        const folder = mapFolder(f);
        if (f.childFolderCount > 0) {
          try {
            const childData = await graphRequest(
              accountId, 'GET',
              `/me/mailFolders/${f.id}/childFolders?$top=100`
            );
            folder.children = (childData?.value || []).map(mapFolder);
          } catch (_) {
            folder.children = [];
          }
        }
        return folder;
      })
    );

    const folderOrder = ['inbox', 'sentitems', 'drafts', 'deleteditems', 'junkemail', 'archive'];
    foldersWithChildren.sort((a, b) => {
      const ai = folderOrder.indexOf(a.wellKnown);
      const bi = folderOrder.indexOf(b.wellKnown);
      if (ai === -1 && bi === -1) return (a.name || '').localeCompare(b.name || '');
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

    // Store in cache
    graphFolderCache.set(accountId, { folders: foldersWithChildren, ts: Date.now() });

    return { success: true, folders: foldersWithChildren };
  } catch (error) {
    console.error('[Graph] listFolders Fehler:', error.message);
    if (error.message === 'TOKEN_EXPIRED') return { success: false, error: 'TOKEN_EXPIRED' };
    return { success: false, error: error.message };
  }
});

// ============================================================
// KONTAKTE (v6.9.0) — lernt Adressen aus empfangenen und gesendeten
// Mails und liefert Vorschläge fürs Compose-Feld (wie Outlook).
// ============================================================

const CONTACTS_KEY = 'contactsBook'; // { "mail@domain": { email, name, useCount, lastUsed } }
let contactsMem = null;
let contactsFlushTimer = null;

function getContactsBook() {
  if (!contactsMem) contactsMem = store.get(CONTACTS_KEY, {});
  return contactsMem;
}
function flushContactsBook() {
  if (contactsFlushTimer) { clearTimeout(contactsFlushTimer); contactsFlushTimer = null; }
  if (contactsMem) store.set(CONTACTS_KEY, contactsMem);
}
function scheduleContactsFlush() {
  if (contactsFlushTimer) return;
  contactsFlushTimer = setTimeout(flushContactsBook, 5000);
}
app.on('before-quit', flushContactsBook);

// "Name <mail@x>" | "mail@x" → { name, email }; Listen mit , oder ; getrennt
function parseAddressList(str) {
  return String(str || '')
    .split(/[,;]/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(a => {
      const m = a.match(/^(.*?)\s*<([^>]+)>\s*$/);
      return m
        ? { name: m[1].replace(/^["']+|["']+$/g, '').trim(), email: m[2].trim() }
        : { name: '', email: a };
    })
    .filter(x => x.email.includes('@'));
}

// weight 0 = nur merken (aus Posteingang), weight >= 1 = aktiv genutzt (gesendet).
// Schreibt nur auf Disk, wenn sich tatsächlich etwas geändert hat — läuft
// sonst bei jedem Mail-Poll.
function upsertContact(email, name = '', weight = 0) {
  const key = String(email || '').toLowerCase().trim();
  if (!key || !key.includes('@') || key.length > 120) return;
  const book = getContactsBook();
  const prev = book[key];
  const cleanName = (name && name.toLowerCase() !== key ? String(name).trim() : '') || prev?.name || '';
  if (prev && weight === 0 && prev.name === cleanName) return; // nichts Neues
  book[key] = {
    email: key,
    name: cleanName,
    useCount: (prev?.useCount || 0) + weight,
    lastUsed: weight > 0 ? Date.now() : (prev?.lastUsed || Date.now())
  };
  scheduleContactsFlush();
}

function learnContactsFromEmails(emails) {
  try {
    for (const em of emails || []) {
      for (const a of parseAddressList(em.from)) upsertContact(a.email, a.name || em.fromName, 0);
    }
  } catch (_) {}
}

function learnContactsFromSend(emailData) {
  try {
    for (const field of ['to', 'cc', 'bcc']) {
      for (const a of parseAddressList(emailData?.[field])) upsertContact(a.email, a.name, 1);
    }
  } catch (_) {}
}

ipcMain.handle('contacts:suggest', async (event, query, limit = 6) => {
  const q = String(query || '').toLowerCase().trim();
  const all = Object.values(getContactsBook());
  const matches = q
    ? all.filter(cn => cn.email.includes(q) || (cn.name || '').toLowerCase().includes(q))
    : all;
  matches.sort((a, b) => (b.useCount - a.useCount) || (b.lastUsed - a.lastUsed));
  return { success: true, contacts: matches.slice(0, Math.min(limit, 20)) };
});

ipcMain.handle('contacts:list', async () => ({
  success: true,
  contacts: Object.values(getContactsBook()).sort((a, b) => (b.useCount - a.useCount) || (b.lastUsed - a.lastUsed))
}));

ipcMain.handle('contacts:remove', async (event, email) => {
  const book = getContactsBook();
  delete book[String(email || '').toLowerCase().trim()];
  scheduleContactsFlush();
  return { success: true };
});

// ============================================================
// LOGBUCH (v3.0.12)
// ============================================================

const LOG_KEY = 'appLog';
const LOG_MAX = 2000;

// Log in-memory halten und gebündelt schreiben — store.set schreibt sonst pro
// Eintrag (z.B. pro Regel-Treffer) die komplette verschlüsselte Config synchron.
let logEntriesMem = null;
let logFlushTimer = null;
function getLogEntries() {
  if (!logEntriesMem) logEntriesMem = store.get(LOG_KEY, []);
  return logEntriesMem;
}
function flushLog() {
  if (logFlushTimer) { clearTimeout(logFlushTimer); logFlushTimer = null; }
  if (logEntriesMem) store.set(LOG_KEY, logEntriesMem);
}
app.on('before-quit', flushLog);

function addLogEntry(type, title, detail = '') {
  try {
    const entries = getLogEntries();
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      timestamp: new Date().toISOString(),
      type,
      title,
      detail
    };
    entries.unshift(entry);
    if (entries.length > LOG_MAX) entries.splice(LOG_MAX);
    if (!logFlushTimer) logFlushTimer = setTimeout(flushLog, 3000);
  } catch (e) {
    console.error('[Log] addLogEntry error:', e.message);
  }
}

ipcMain.handle('log:add', async (event, { type, title, detail }) => {
  addLogEntry(type, title, detail || '');
  return { success: true };
});

ipcMain.handle('log:getAll', async () => {
  return { success: true, entries: getLogEntries() };
});

ipcMain.handle('log:clear', async () => {
  logEntriesMem = [];
  store.set(LOG_KEY, []);
  return { success: true };
});

// ============================================================
// ÜBERSETZUNG
// ============================================================

const TRANSLATION_KEY = 'translationSettings';
const TRANSLATION_DEFAULTS = {
  service: 'deepl',
  deeplFree: true,
  apiKey: '',
  customApiUrl: '',
  enabledLanguages: ['DE', 'EN'],
};

ipcMain.handle('translation:getSettings', async () => {
  return { ...TRANSLATION_DEFAULTS, ...store.get(TRANSLATION_KEY, {}) };
});

ipcMain.handle('translation:saveSettings', async (event, settings) => {
  store.set(TRANSLATION_KEY, settings);
  return { success: true };
});

ipcMain.handle('translation:translate', async (event, { text, targetLang }) => {
  const s = { ...TRANSLATION_DEFAULTS, ...store.get(TRANSLATION_KEY, {}) };

  if (!text || !targetLang) return { success: false, error: 'Kein Text oder Zielsprache angegeben' };

  try {
    if (s.service === 'deepl') {
      if (!s.apiKey) return { success: false, error: 'Kein DeepL API-Key konfiguriert' };
      const base = s.deeplFree !== false
        ? 'https://api-free.deepl.com'
        : 'https://api.deepl.com';
      const res = await fetch(`${base}/v2/translate`, {
        method: 'POST',
        headers: {
          'Authorization': `DeepL-Auth-Key ${s.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: [text], target_lang: targetLang }),
      });
      if (!res.ok) {
        const errBody = await res.text();
        return { success: false, error: `DeepL Fehler ${res.status}: ${errBody}` };
      }
      const data = await res.json();
      const translatedText = data?.translations?.[0]?.text || '';
      return { success: true, translatedText };

    } else if (s.service === 'google') {
      if (!s.apiKey) return { success: false, error: 'Kein Google API-Key konfiguriert' };
      const url = `https://translation.googleapis.com/language/translate/v2?key=${s.apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: text, target: targetLang.toLowerCase(), format: 'text' }),
      });
      if (!res.ok) {
        const errBody = await res.text();
        return { success: false, error: `Google Fehler ${res.status}: ${errBody}` };
      }
      const data = await res.json();
      const translatedText = data?.data?.translations?.[0]?.translatedText || '';
      return { success: true, translatedText };

    } else if (s.service === 'custom') {
      if (!s.customApiUrl) return { success: false, error: 'Keine Custom-API-URL konfiguriert' };
      const res = await fetch(s.customApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, targetLang }),
      });
      if (!res.ok) {
        const errBody = await res.text();
        return { success: false, error: `API Fehler ${res.status}: ${errBody}` };
      }
      const data = await res.json();
      const translatedText = data?.translatedText || data?.text || data?.result || '';
      if (!translatedText) return { success: false, error: 'Antwort enthält kein Übersetzungsfeld' };
      return { success: true, translatedText };

    } else {
      return { success: false, error: 'Unbekannter Übersetzungsdienst' };
    }
  } catch (e) {
    console.error('[Translation] error:', e.message);
    return { success: false, error: e.message };
  }
});

// ============================================================
// ZEITVERSETZTES SENDEN
// ============================================================

const SCHEDULED_KEY = 'scheduledEmails';

async function processScheduledEmails() {
  const scheduled = store.get(SCHEDULED_KEY, []);
  if (scheduled.length === 0) return;
  const now = Date.now();
  const due = scheduled.filter(e => e.sendAt <= now);
  if (due.length === 0) return;

  // v6.8.1: Fehlgeschlagene Sendungen bleiben in der Queue (bis 3 Versuche) —
  // vorher wurden sie stillschweigend entfernt und die Mail ging verloren.
  const sentIds = new Set();
  const failedIds = new Set();

  for (const email of due) {
    try {
      const emailData = {
        fromName: email.fromName,
        to: email.to, cc: email.cc, bcc: email.bcc,
        subject: email.subject, text: email.text, html: email.html,
        attachments: (email.attachments || []).map(a => ({ ...a, encoding: 'base64' })),
      };
      let result;
      if (email.accountType === 'microsoft') {
        result = await graphRequest(email.accountId, 'POST', '/me/sendMail', {
          message: {
            subject: emailData.subject || '(Kein Betreff)',
            body: { contentType: emailData.html ? 'html' : 'text', content: emailData.html || emailData.text || '' },
            toRecipients: (emailData.to || '').split(/[,;]/).map(s => s.trim()).filter(Boolean).map(addr => {
              const m = addr.match(/^(.*?)\s*<([^>]+)>\s*$/);
              return m ? { emailAddress: { name: m[1].trim(), address: m[2].trim() } } : { emailAddress: { address: addr } };
            }),
          },
          saveToSentItems: true,
        });
        result = { success: true };
      } else {
        const account = getAccountById(email.accountId);
        if (account && account.smtp) {
          // v6.9.6: zentraler, gehärteter Transporter (TLS-Policy, Timeouts,
          // fromEmail/displayName) — der Inline-Transporter hier umging die
          // v6.9.2-TLS-Härtung und hatte keine Timeouts (hängender Versand
          // blockierte den ganzen Scheduled-Tick).
          const { transporter, fromEmail: defaultFrom } = getSmtpTransporterForAccount(account);
          // Pro-Mail-Absendername-Override wie beim Sofort-Versand (v2.8.2) —
          // sonst verliert eine zeitversetzte Mail den im Compose gewählten Namen.
          let fromEmail = defaultFrom;
          if (emailData.fromName !== undefined) {
            const emailAddr = account.smtp.fromEmail || account.smtp.username;
            const safeName = (emailData.fromName || '').replace(/["\\\r\n]/g, '').trim();
            fromEmail = safeName ? `"${safeName}" <${emailAddr}>` : emailAddr;
          }
          const mailOptions = {
            from: fromEmail, to: emailData.to, cc: emailData.cc, bcc: emailData.bcc,
            subject: emailData.subject, text: emailData.text, html: emailData.html,
            attachments: (email.attachments || []).map(a => ({ ...a, encoding: 'base64' })),
          };
          const sendInfo = await transporter.sendMail(mailOptions);
          // v6.13.1: Auch zeitversetzte Mails gehören in den Gesendet-Ordner —
          // dieser Pfad hat die Kopie bisher komplett ausgelassen.
          saveToSentFolder(account, mailOptions, `Geplant: ${emailData.subject || '(kein Betreff)'}`, sendInfo?.messageId);
          result = { success: true };
        }
      }
      if (result?.success) {
        sentIds.add(email.id);
        addLogEntry('email_sent', `Geplant gesendet: ${email.subject || '(kein Betreff)'}`, `An: ${email.to}`);
      } else {
        failedIds.add(email.id);
      }
    } catch (e) {
      console.error('[Scheduled] send error:', e.message);
      failedIds.add(email.id);
    }
  }

  const remaining = [];
  for (const e of scheduled) {
    if (sentIds.has(e.id)) continue; // erfolgreich gesendet → raus
    if (failedIds.has(e.id)) {
      const attempts = (e.attempts || 0) + 1;
      if (attempts >= 3) {
        addLogEntry('email_error', `Geplante Mail nach 3 Versuchen verworfen: ${e.subject || '(kein Betreff)'}`, `An: ${e.to}`);
        showNotification('Geplante E-Mail fehlgeschlagen', `"${e.subject || '(kein Betreff)'}" konnte nicht gesendet werden.`, () => {
          if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
        });
        continue;
      }
      // In 5 Minuten erneut versuchen
      remaining.push({ ...e, attempts, sendAt: now + 5 * 60 * 1000 });
      continue;
    }
    remaining.push(e); // noch nicht fällig
  }
  store.set(SCHEDULED_KEY, remaining);
}

ipcMain.handle('scheduled:add', async (event, emailData) => {
  const scheduled = store.get(SCHEDULED_KEY, []);
  scheduled.push({ ...emailData, id: `sch_${Date.now()}` });
  store.set(SCHEDULED_KEY, scheduled);
  return { success: true };
});

ipcMain.handle('scheduled:list', async () => {
  return { success: true, items: store.get(SCHEDULED_KEY, []) };
});

ipcMain.handle('scheduled:cancel', async (event, id) => {
  const scheduled = store.get(SCHEDULED_KEY, []).filter(e => e.id !== id);
  store.set(SCHEDULED_KEY, scheduled);
  return { success: true };
});

// ============================================================
// SNOOZE / ERINNERUNGEN  (v6.6.0)
// ============================================================
// Speichert pro snooze {id, accountId, folder, uid, messageId, subject, from,
// snoozedAt, wakeAt}. Beim Wake-up:
//   1) Desktop-Notification ("Erinnerung: <subject>")
//   2) IPC 'snooze:woke' an den Renderer → Inbox-Refresh
//   3) Eintrag aus der Liste entfernen → Mail erscheint wieder im Posteingang
const SNOOZE_KEY = 'snoozes';

async function processSnoozes() {
  const snoozes = store.get(SNOOZE_KEY, []);
  if (snoozes.length === 0) return;
  const now = Date.now();
  const due = snoozes.filter(s => s.wakeAt <= now);
  if (due.length === 0) return;

  for (const snz of due) {
    try {
      const subj = snz.subject || '(Kein Betreff)';
      const from = snz.from || '';
      showNotification(
        'Erinnerung',
        from ? `${subj}\nVon: ${from}` : subj,
        () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
            mainWindow.webContents.send('snooze:open', {
              accountId: snz.accountId, folder: snz.folder, uid: snz.uid
            });
          }
        }
      );
      addLogEntry('snooze_woke', `Erinnerung: ${subj}`, `Konto: ${snz.accountId}`);
    } catch (e) {
      console.error('[Snooze] wake error:', e.message);
    }
  }
  store.set(SNOOZE_KEY, snoozes.filter(s => s.wakeAt > now));
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('snooze:woke', { count: due.length });
  }
}

ipcMain.handle('snooze:add', async (event, data) => {
  if (!data?.accountId || !data?.uid || !data?.wakeAt) {
    return { success: false, error: 'accountId, uid und wakeAt sind erforderlich' };
  }
  if (data.wakeAt <= Date.now()) {
    return { success: false, error: 'wakeAt muss in der Zukunft liegen' };
  }
  const snoozes = store.get(SNOOZE_KEY, []);
  // Existiert bereits eine Snooze für (accountId, folder, uid)? Dann ersetzen.
  const without = snoozes.filter(s =>
    !(s.accountId === data.accountId && s.folder === data.folder && s.uid === data.uid)
  );
  without.push({
    id: `snz_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    accountId: data.accountId,
    folder: data.folder || 'INBOX',
    uid: data.uid,
    messageId: data.messageId || null,
    subject: data.subject || '',
    from: data.from || '',
    snoozedAt: Date.now(),
    wakeAt: data.wakeAt
  });
  store.set(SNOOZE_KEY, without);
  return { success: true };
});

ipcMain.handle('snooze:list', async () => {
  const snoozes = store.get(SNOOZE_KEY, []);
  // Sortiert nach Wake-Up-Zeit aufsteigend
  return { success: true, items: snoozes.slice().sort((a, b) => a.wakeAt - b.wakeAt) };
});

// Liefert nur die Identifier — der Renderer filtert damit den Inbox-View.
ipcMain.handle('snooze:active', async () => {
  const snoozes = store.get(SNOOZE_KEY, []);
  return {
    success: true,
    items: snoozes.map(s => ({
      accountId: s.accountId, folder: s.folder, uid: s.uid, wakeAt: s.wakeAt
    }))
  };
});

ipcMain.handle('snooze:cancel', async (event, id) => {
  const snoozes = store.get(SNOOZE_KEY, []).filter(s => s.id !== id);
  store.set(SNOOZE_KEY, snoozes);
  return { success: true };
});

// ============================================================
// MAIL-REGELN / FILTER  (v6.6.0)
// ============================================================
// Regel-Schema:
// {
//   id, name, enabled, appliesToAccount: 'all' | accountId,
//   matchAll: bool,                              // true=AND, false=OR
//   conditions: [{ field, op, value }],          // field: from|to|subject; op: contains|equals|startsWith|endsWith
//   actions: [{ type, ...params }],              // type: markRead|moveToFolder|delete|snoozeHours
// }
//
// Ausführung: nach jedem fetchEmailsForAccount/graph:fetchEmails über die
// neu geladenen Mails laufen. processedRulesCache verhindert, dass dieselbe
// UID mehrfach in einer App-Session verarbeitet wird (cache resettet beim
// Neustart — Aktionen sind grösstenteils idempotent oder löschen die Quelle).
const RULES_KEY = 'mailRules';
const processedRulesCache = new Set(); // "accountId|folder|uid"
const PROCESSED_RULES_MAX = 20000; // Obergrenze — sonst wächst der Set über eine lange Session unbegrenzt

// Regeln in-memory cachen — store.get entschlüsselt sonst bei jedem Fetch die
// komplette Config. Invalidiert bei rules:save/delete.
let rulesCache = null;
function getRules() {
  if (!rulesCache) rulesCache = store.get(RULES_KEY, []);
  return rulesCache;
}



// IMAP-Aktion ausführen. Liefert { removed: bool, seen?: bool } — removed
// bedeutet, die Mail soll aus dem zurückgegebenen Listen-Array entfernt werden
// (verschoben oder gelöscht).
async function applyImapRuleAction(connection, account, folder, email, action) {
  try {
    if (action.type === 'markRead') {
      await new Promise((resolve, reject) => {
        connection.imap.addFlags(email.uid, '\\Seen', (err) => err ? reject(err) : resolve());
      });
      return { seen: true };
    }
    if (action.type === 'delete') {
      await new Promise((resolve, reject) => {
        connection.imap.addFlags(email.uid, '\\Deleted', (err) => err ? reject(err) : resolve());
      });
      try { await new Promise((resolve) => connection.imap.expunge(() => resolve())); } catch (_) {}
      return { removed: true };
    }
    if (action.type === 'moveToFolder' && action.folder && action.folder !== folder) {
      await connection.moveMessage(email.uid, action.folder);
      return { removed: true };
    }
    if (action.type === 'snoozeHours' && action.hours > 0) {
      const snoozes = store.get(SNOOZE_KEY, []);
      const without = snoozes.filter(s =>
        !(s.accountId === account.id && s.folder === folder && s.uid === email.uid)
      );
      without.push({
        id: `snz_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        accountId: account.id, folder, uid: email.uid,
        messageId: email.messageId || null,
        subject: email.subject || '', from: email.from || '',
        snoozedAt: Date.now(),
        wakeAt: Date.now() + action.hours * 3600 * 1000
      });
      store.set(SNOOZE_KEY, without);
      return { removed: true }; // aus der Liste verstecken bis Wake-up
    }
  } catch (e) {
    console.warn(`[Rules] IMAP-Action ${action.type} fehlgeschlagen:`, e.message);
  }
  return {};
}

// Graph-Aktion. Reuse existing graphRequest.
async function applyGraphRuleAction(account, folder, email, action) {
  try {
    if (action.type === 'markRead') {
      await graphRequest(account.id, 'PATCH', `/me/messages/${email.uid}`, { isRead: true });
      return { seen: true };
    }
    if (action.type === 'delete') {
      await graphRequest(account.id, 'DELETE', `/me/messages/${email.uid}`);
      return { removed: true };
    }
    if (action.type === 'moveToFolder' && action.folder && action.folder !== folder) {
      // Bei Graph ist action.folder die Folder-ID
      await graphRequest(account.id, 'POST', `/me/messages/${email.uid}/move`, { destinationId: action.folder });
      return { removed: true };
    }
    if (action.type === 'snoozeHours' && action.hours > 0) {
      const snoozes = store.get(SNOOZE_KEY, []);
      const without = snoozes.filter(s =>
        !(s.accountId === account.id && s.folder === folder && s.uid === email.uid)
      );
      without.push({
        id: `snz_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        accountId: account.id, folder, uid: email.uid,
        messageId: email.messageId || null,
        subject: email.subject || '', from: email.from || '',
        snoozedAt: Date.now(),
        wakeAt: Date.now() + action.hours * 3600 * 1000
      });
      store.set(SNOOZE_KEY, without);
      return { removed: true };
    }
  } catch (e) {
    console.warn(`[Rules] Graph-Action ${action.type} fehlgeschlagen:`, e.message);
  }
  return {};
}

// Filter Mails durch Regeln. Liefert die bereinigte Liste zurück (ohne
// move/delete-betroffene Einträge, mit aktualisiertem .seen-Flag).
async function runRulesOnFetchedEmails(account, folder, emails, kind, imapConnection = null, opts = {}) {
  const allRules = getRules();
  const accountRules = allRules.filter(r =>
    r.enabled !== false &&
    (r.appliesToAccount === 'all' || r.appliesToAccount === account.id)
  );
  if (accountRules.length === 0) return emails;

  const force = !!opts.force;
  const out = [];
  let appliedCount = 0;
  for (const email of emails) {
    const cacheKey = `${account.id}|${folder}|${email.uid}`;
    if (!force && processedRulesCache.has(cacheKey)) {
      out.push(email);
      continue;
    }
    let removed = false;
    let updatedEmail = email;
    for (const rule of accountRules) {
      if (!matchRule(email, rule)) continue;
      for (const action of (rule.actions || [])) {
        const res = kind === 'graph'
          ? await applyGraphRuleAction(account, folder, email, action)
          : await applyImapRuleAction(imapConnection, account, folder, email, action);
        if (res.seen) updatedEmail = { ...updatedEmail, seen: true };
        if (res.removed) { removed = true; break; }
      }
      if (removed) break;
    }
    processedRulesCache.add(cacheKey);
    if (removed) {
      appliedCount++;
      addLogEntry('rule_applied', `Regel auf Mail angewendet`, `${updatedEmail.subject || '(kein Betreff)'} — ${updatedEmail.from || ''}`);
    } else {
      out.push(updatedEmail);
    }
  }
  if (appliedCount > 0) console.log(`[Rules] ${appliedCount} Mail(s) durch Regeln verschoben/gelöscht/gesnoozt in ${folder}`);
  if (processedRulesCache.size > PROCESSED_RULES_MAX) {
    // Älteste Einträge verwerfen (Set iteriert in Einfüge-Reihenfolge)
    const it = processedRulesCache.values();
    const drop = Math.floor(PROCESSED_RULES_MAX / 4);
    for (let i = 0; i < drop; i++) processedRulesCache.delete(it.next().value);
  }
  return out;
}

ipcMain.handle('rules:list', async () => ({ success: true, items: getRules() }));

ipcMain.handle('rules:save', async (event, rule) => {
  if (!rule || !Array.isArray(rule.conditions) || !Array.isArray(rule.actions)) {
    return { success: false, error: 'Ungültige Regel' };
  }
  const all = store.get(RULES_KEY, []);
  if (rule.id) {
    const idx = all.findIndex(r => r.id === rule.id);
    if (idx >= 0) all[idx] = rule;
    else all.push(rule);
  } else {
    rule.id = `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    all.push(rule);
  }
  store.set(RULES_KEY, all);
  rulesCache = all;
  // Cache leeren — neue/geänderte Regeln sollen beim nächsten Fetch greifen
  processedRulesCache.clear();
  return { success: true, rule };
});

ipcMain.handle('rules:delete', async (event, id) => {
  const remaining = store.get(RULES_KEY, []).filter(r => r.id !== id);
  store.set(RULES_KEY, remaining);
  rulesCache = remaining;
  return { success: true };
});

// Regeln auf den aktuellen Posteingang eines Kontos anwenden — nützlich nach
// dem Anlegen einer neuen Regel.
ipcMain.handle('rules:applyNow', async (event, accountId, folder = 'INBOX') => {
  const account = getAccountById(accountId);
  if (!account) return { success: false, error: 'Konto nicht gefunden' };

  // processedRulesCache für dieses Konto+Folder leeren, damit die Regeln greifen
  for (const key of Array.from(processedRulesCache)) {
    if (key.startsWith(`${accountId}|${folder}|`)) processedRulesCache.delete(key);
  }

  if (account.type === 'microsoft') {
    try {
      const data = await graphRequest(accountId, 'GET',
        `/me/mailFolders/${folder === 'INBOX' ? 'inbox' : folder}/messages?$select=id,subject,from,toRecipients,ccRecipients,isRead&$top=200`
      );
      const emails = (data.value || []).map(m => ({
        uid: m.id,
        subject: m.subject || '',
        from: m.from?.emailAddress?.address || '',
        to: (m.toRecipients || []).map(r => r.emailAddress?.address).filter(Boolean).join(', '),
        cc: (m.ccRecipients || []).map(r => r.emailAddress?.address).filter(Boolean).join(', '),
        seen: m.isRead
      }));
      const before = emails.length;
      const after = await runRulesOnFetchedEmails(account, folder, emails, 'graph', null, { force: true });
      return { success: true, total: before, applied: before - after.length };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // IMAP
  let connection;
  let usedPool = false;
  try {
    try { connection = await getPooledImapConnection(account); usedPool = true; }
    catch (_) { connection = await imapSimple.connect(getImapConfigForAccount(account)); }
    await connection.openBox(folder);
    const messages = await connection.search(['ALL'], {
      bodies: ['HEADER.FIELDS (FROM TO CC SUBJECT)'],
      markSeen: false, struct: false
    });
    const emails = messages.map(msg => {
      const header = msg.parts.find(p => p.which.includes('HEADER'));
      const h = header?.body || {};
      return {
        uid: msg.attributes.uid,
        subject: (h.subject || [''])[0],
        from: (h.from || [''])[0],
        to: (h.to || [''])[0],
        cc: (h.cc || [''])[0],
        seen: msg.attributes.flags.includes('\\Seen')
      };
    });
    const before = emails.length;
    const after = await runRulesOnFetchedEmails(account, folder, emails, 'imap', connection, { force: true });
    return { success: true, total: before, applied: before - after.length };
  } catch (e) {
    if (usedPool) releaseImapConnection(accountId, true, connection);
    return { success: false, error: e.message };
  } finally {
    if (connection) {
      if (usedPool) releaseImapConnection(accountId, false, connection);
      else try { await connection.end(); } catch (_) {}
    }
  }
});

// --- IPC: Kalender (v4.4.0) ---

ipcMain.handle('calendar:getEvents', async (event, accountId, { startDate, endDate } = {}) => {
  try {
    const start = startDate || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const end = endDate || new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59).toISOString();
    // 'Prefer: outlook.timezone="UTC"' forces Graph API to return all datetimes in UTC
    // so new Date(dt) always parses correctly regardless of the client's locale.
    const data = await graphRequest(accountId, 'GET',
      `/me/calendarView?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}&$select=id,subject,start,end,location,isAllDay,organizer,bodyPreview,showAs&$top=100&$orderby=start/dateTime`,
      undefined,
      { 'Prefer': 'outlook.timezone="UTC"' }
    );
    const events = (data?.value || []).map(e => {
      // With Prefer UTC header, dateTime is UTC but may still lack 'Z'.
      // Append 'Z' defensively so Date() always treats it as UTC.
      const toUTC = (dt) => {
        if (!dt) return dt;
        if (/^\d{4}-\d{2}-\d{2}$/.test(dt)) return dt; // all-day date — keep as-is
        return dt.endsWith('Z') || /[+-]\d{2}:\d{2}$/.test(dt) ? dt : dt + 'Z';
      };
      return {
        id: e.id,
        title: e.subject || '(Kein Titel)',
        start: toUTC(e.start?.dateTime || e.start?.date),
        startTimeZone: e.start?.timeZone,
        end: toUTC(e.end?.dateTime || e.end?.date),
        endTimeZone: e.end?.timeZone,
        isAllDay: e.isAllDay || false,
        location: e.location?.displayName || '',
        organizer: e.organizer?.emailAddress?.name || e.organizer?.emailAddress?.address || '',
        preview: e.bodyPreview || '',
        showAs: e.showAs || 'busy',
      };
    });
    return { success: true, events };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('calendar:createEvent', async (event, accountId, eventData) => {
  try {
    const body = {
      subject: eventData.title,
      start: { dateTime: eventData.start, timeZone: eventData.timeZone || 'UTC' },
      end: { dateTime: eventData.end, timeZone: eventData.timeZone || 'UTC' },
      isAllDay: eventData.isAllDay || false,
      location: eventData.location ? { displayName: eventData.location } : undefined,
      body: eventData.notes ? { contentType: 'text', content: eventData.notes } : undefined,
    };
    const result = await graphRequest(accountId, 'POST', '/me/events', body);
    return { success: true, eventId: result?.id };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('calendar:updateEvent', async (event, accountId, eventId, eventData) => {
  try {
    const body = {
      subject: eventData.title,
      start: { dateTime: eventData.start, timeZone: eventData.timeZone || 'UTC' },
      end: { dateTime: eventData.end, timeZone: eventData.timeZone || 'UTC' },
      isAllDay: eventData.isAllDay || false,
      location: eventData.location ? { displayName: eventData.location } : undefined,
    };
    await graphRequest(accountId, 'PATCH', `/me/events/${eventId}`, body);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('calendar:deleteEvent', async (event, accountId, eventId) => {
  try {
    await graphRequest(accountId, 'DELETE', `/me/events/${eventId}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ─── Einladungen beantworten / übernehmen (v7.2.0) ──────────────────────────

// Zu-/Absage für eine M365-Einladung. Graph verlangt die Aktion auf dem
// Kalendereintrag (nicht auf der Mail) — die eventId liefert fetchGraphInvitation.
const GRAPH_RESPONSE_ACTIONS = {
  accept: 'accept',
  decline: 'decline',
  tentative: 'tentativelyAccept'
};

ipcMain.handle('calendar:respondToEvent', async (event, accountId, eventId, response, options = {}) => {
  const action = GRAPH_RESPONSE_ACTIONS[response];
  if (!action) return { success: false, error: `Unbekannte Antwort: ${response}` };
  if (!eventId)  return { success: false, error: 'Kein Termin zur Einladung gefunden' };
  try {
    await graphRequest(accountId, 'POST', `/me/events/${eventId}/${action}`, {
      comment: options.comment || '',
      sendResponse: options.sendResponse !== false
    });
    return { success: true, response };
  } catch (err) {
    console.error('[Einladung] Antwort fehlgeschlagen:', err.message);
    return { success: false, error: err.message };
  }
});

// Einladung aus einer .ics-Datei in den M365-Kalender übernehmen.
// Für reine IMAP-Konten gibt es kein Kalender-Backend — dort bleibt der Weg
// über "ICS speichern/öffnen" (der Anhang trägt jetzt einen echten Dateinamen).
ipcMain.handle('calendar:importInvitation', async (event, accountId, invitation) => {
  try {
    if (!invitation?.start) return { success: false, error: 'Einladung ohne Startzeitpunkt' };
    const account = getAccountById(accountId);
    if (account?.type !== 'microsoft') {
      return { success: false, error: 'Kalender-Übernahme ist nur für Microsoft-365-Konten verfügbar' };
    }

    // Graph erwartet dateTime OHNE Zeitzonen-Suffix plus separates timeZone-Feld
    const toGraph = (iso) => {
      if (!iso) return null;
      if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return `${iso}T00:00:00`;
      return new Date(iso).toISOString().replace(/\.\d+Z$/, '').replace(/Z$/, '');
    };
    const nextDay = (dateOnly) => new Date(new Date(`${dateOnly}T00:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);

    const startDt = toGraph(invitation.start);
    let endIso = invitation.end;
    // Ohne DTEND: Ganztagestermine enden am Folgetag (Graph verlangt das),
    // Terminen mit Uhrzeit wird eine Stunde gegeben.
    if (!endIso || (invitation.allDay && endIso === invitation.start)) {
      endIso = invitation.allDay
        ? nextDay(String(invitation.start).slice(0, 10))
        : new Date(new Date(invitation.start).getTime() + 3600000).toISOString();
    }
    const endDt = toGraph(endIso);

    const body = {
      subject: invitation.summary || '(Kein Titel)',
      start: { dateTime: startDt, timeZone: 'UTC' },
      end: { dateTime: endDt, timeZone: 'UTC' },
      isAllDay: invitation.allDay === true,
      location: invitation.location ? { displayName: invitation.location } : undefined,
      body: invitation.description ? { contentType: 'text', content: invitation.description } : undefined
    };
    const result = await graphRequest(accountId, 'POST', '/me/events', body);
    return { success: true, eventId: result?.id };
  } catch (err) {
    console.error('[Einladung] Import fehlgeschlagen:', err.message);
    return { success: false, error: err.message };
  }
});

// ============================================================
// AI-LAYER (Mail-Assistant)  v6.6.0
// ============================================================
// Provider-Abstraktion: lokales Ollama (default) + Anthropic Cloud-Fallback.
// Alle Mail-Inhalte gehen nur dann an die Cloud, wenn der User explizit
// Anthropic gewählt hat. Settings im store unter 'aiSettings'.

const AI_SETTINGS_KEY = 'aiSettings';
const AI_TRIAGE_KEY   = 'aiTriage'; // { "accountId|folder|uid": { category, confidence, reasoning, signals, ts } }

const AI_DEFAULT_SETTINGS = {
  provider: 'ollama',                      // 'ollama' | 'anthropic'
  ollamaEndpoint: 'http://localhost:11434',
  ollamaModel: 'llama3.1:8b',
  anthropicApiKey: '',
  anthropicModel: 'claude-haiku-4-5-20251001',
  enabled: false                           // erst aktivieren wenn konfiguriert
};

function getAiSettings() {
  return { ...AI_DEFAULT_SETTINGS, ...(store.get(AI_SETTINGS_KEY, {})) };
}

const AI_SYSTEM_PROMPT = `Du bist der AI-Layer eines Mail-Clients. Du analysierst E-Mails und generierst Antworten.

Grundprinzipien:
- Transparenz: jede Einstufung und jeder Vorschlag muss begründbar sein
- User overrides everything: du schlägst vor, der User entscheidet
- Datensparsam: nur das Nötigste verarbeiten
- Sprache: antworte in der Sprache der Mail
- Keine erfundenen Fakten — wenn Info fehlt, markiere Lücken mit [...]

Antworte IMMER als valides JSON ohne Markdown-Codeblöcke und ohne Prosa drumherum.`;

// Liefert den parsed-JSON-Output. Wirft bei Fehler.
async function aiComplete({ system = '', user = '', maxTokens = 1500, temperature = 0.4 }) {
  const settings = getAiSettings();
  if (!settings.enabled) {
    throw new Error('AI ist nicht aktiviert (siehe AI-Einstellungen)');
  }

  const fullSystem = (system ? system + '\n\n' : '') + AI_SYSTEM_PROMPT;

  if (settings.provider === 'ollama') {
    const url = (settings.ollamaEndpoint || AI_DEFAULT_SETTINGS.ollamaEndpoint).replace(/\/$/, '') + '/api/chat';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: settings.ollamaModel,
          messages: [
            { role: 'system', content: fullSystem },
            { role: 'user',   content: user }
          ],
          stream: false,
          format: 'json',
          options: { temperature, num_predict: maxTokens }
        }),
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!resp.ok) throw new Error(`Ollama HTTP ${resp.status}`);
      const data = await resp.json();
      const text = data?.message?.content || '';
      return parseAiJson(text);
    } catch (e) {
      clearTimeout(timer);
      const msg = e.name === 'AbortError'
        ? 'Ollama-Timeout (60s) — Server erreichbar?'
        : (e.message?.includes('ECONNREFUSED') ? `Ollama nicht erreichbar unter ${settings.ollamaEndpoint} — läuft 'ollama serve'?` : e.message);
      throw new Error(msg);
    }
  }

  if (settings.provider === 'anthropic') {
    if (!settings.anthropicApiKey) throw new Error('Anthropic API-Key fehlt');
    // v6.7.0: Auto-Retry bei 429 mit Retry-After-Header (max. 1 Wiederholung,
    // damit Free-Tier-Bursts nicht sofort scheitern).
    const callOnce = async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 60000);
      try {
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': settings.anthropicApiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: settings.anthropicModel,
            max_tokens: maxTokens,
            system: fullSystem,
            messages: [{ role: 'user', content: user }],
            temperature
          }),
          signal: controller.signal
        });
        clearTimeout(timer);
        return resp;
      } catch (e) {
        clearTimeout(timer);
        if (e.name === 'AbortError') throw new Error('Anthropic-Timeout (60s)');
        throw e;
      }
    };

    let resp = await callOnce();
    if (resp.status === 429) {
      const retryAfter = parseInt(resp.headers.get('retry-after') || '0', 10);
      const waitMs = (retryAfter > 0 && retryAfter < 60 ? retryAfter : 15) * 1000;
      console.log(`[AI] Anthropic 429 — warte ${waitMs}ms und versuche erneut`);
      await new Promise(r => setTimeout(r, waitMs));
      resp = await callOnce();
    }
    if (!resp.ok) {
      const errBody = await resp.text();
      // Bei wiederholtem 429: freundlicherer Hinweis statt rohem JSON-Error
      if (resp.status === 429) {
        throw new Error('Rate-Limit erreicht — dein Anthropic-Tarif erlaubt aktuell nicht mehr Anfragen pro Minute. Tipp: Lokales Ollama nutzen für unbegrenzte Triage.');
      }
      throw new Error(`Anthropic HTTP ${resp.status}: ${errBody.slice(0, 200)}`);
    }
    const data = await resp.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    return parseAiJson(text);
  }

  throw new Error(`Unbekannter AI-Provider: ${settings.provider}`);
}

// Robustes Parsing: zieht ggf. JSON aus Markdown-Codefences, akzeptiert sowohl
// Objekt als auch Array.
function parseAiJson(text) {
  if (!text) throw new Error('Leere AI-Antwort');
  const trimmed = text.trim();
  // Codefence entfernen (manche Modelle schicken trotz Anweisung Markdown)
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate);
  } catch (e) {
    // Letzter Versuch: erstes { ... } oder [ ... ] greifen
    const obj = candidate.match(/\{[\s\S]*\}/);
    const arr = candidate.match(/\[[\s\S]*\]/);
    const slice = obj?.[0] || arr?.[0];
    if (slice) {
      try { return JSON.parse(slice); } catch (_) {}
    }
    throw new Error('AI-Antwort ist kein gültiges JSON: ' + candidate.slice(0, 200));
  }
}

ipcMain.handle('ai:getSettings', async () => ({ success: true, settings: getAiSettings() }));

ipcMain.handle('ai:saveSettings', async (event, partial) => {
  const next = { ...getAiSettings(), ...(partial || {}) };
  store.set(AI_SETTINGS_KEY, next);
  return { success: true, settings: next };
});

// Verbindungstest — versucht ein triviales JSON-Echo. Schnell & günstig.
ipcMain.handle('ai:testConnection', async () => {
  try {
    const r = await aiComplete({
      user: 'Antworte nur mit {"ok": true}.',
      temperature: 0,
      maxTokens: 30
    });
    if (r && (r.ok === true || JSON.stringify(r).includes('"ok"'))) {
      return { success: true };
    }
    return { success: true, warning: 'Verbindung steht, aber unerwartete Antwort: ' + JSON.stringify(r).slice(0, 200) };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// v6.8.2: Installierte Ollama-Modelle auflisten — die Settings-Seite zeigt
// damit ein Dropdown statt Freitext (Tippfehler/nicht installierte Modelle
// endeten sonst in "Ollama HTTP 404" bei jedem AI-Aufruf).
ipcMain.handle('ai:listOllamaModels', async (event, endpoint) => {
  try {
    const base = (endpoint || getAiSettings().ollamaEndpoint || AI_DEFAULT_SETTINGS.ollamaEndpoint).replace(/\/$/, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(base + '/api/tags', { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) return { success: false, error: `HTTP ${resp.status}` };
    const data = await resp.json();
    return { success: true, models: (data?.models || []).map(m => m.name) };
  } catch (e) {
    return { success: false, error: e.name === 'AbortError' ? 'Timeout — läuft Ollama?' : e.message };
  }
});

// ── Triage ──────────────────────────────────────────────────────────────────
// Der Triage-Cache lebt in-memory; store.set würde sonst pro Mail die komplette
// verschlüsselte Config synchron neu schreiben (blockiert den Main-Prozess).
let triageCacheMem = null;
let triageFlushTimer = null;
function getTriageCache() {
  if (!triageCacheMem) triageCacheMem = store.get(AI_TRIAGE_KEY, {});
  return triageCacheMem;
}
function flushTriageCache() {
  if (triageFlushTimer) { clearTimeout(triageFlushTimer); triageFlushTimer = null; }
  if (triageCacheMem) store.set(AI_TRIAGE_KEY, triageCacheMem);
}
function scheduleTriageFlush() {
  if (triageFlushTimer) return;
  triageFlushTimer = setTimeout(flushTriageCache, 3000);
}
function triageCacheGet(accountId, folder, uid) {
  return getTriageCache()[`${accountId}|${folder}|${uid}`] || null;
}
function triageCachePut(accountId, folder, uid, value) {
  getTriageCache()[`${accountId}|${folder}|${uid}`] = { ...value, ts: Date.now() };
  scheduleTriageFlush();
}
app.on('before-quit', flushTriageCache);

async function triageOneEmail(email) {
  const userPrompt = `Stufe diese E-Mail ein. Kategorien: urgent, important, informational, newsletter, automated.

Mail:
Von: ${email.from || ''}
An: ${email.to || ''}
Betreff: ${email.subject || ''}
Datum: ${email.date || ''}
${email.preview || email.text ? '\nVorschau:\n' + (email.preview || (email.text || '').slice(0, 800)) : ''}

Antworte exakt in diesem JSON-Format:
{
  "category": "urgent" | "important" | "informational" | "newsletter" | "automated",
  "confidence": 0.0-1.0,
  "reasoning": "ein knapper Satz mit konkreten Hinweisen aus der Mail",
  "signals": ["max 4 kurze Signal-Tags wie direct_reply, open_question, known_sender, marketing_template, automated_sender"]
}`;
  return await aiComplete({ user: userPrompt, temperature: 0.2, maxTokens: 250 });
}

ipcMain.handle('ai:triageMail', async (event, payload) => {
  try {
    const { accountId, folder, uid, email } = payload || {};
    if (!accountId || !uid || !email) return { success: false, error: 'accountId/uid/email fehlt' };
    const cached = triageCacheGet(accountId, folder, uid);
    if (cached) return { success: true, result: cached, fromCache: true };
    const result = await triageOneEmail(email);
    triageCachePut(accountId, folder, uid, result);
    return { success: true, result };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('ai:triageBatch', async (event, payload) => {
  const { items = [] } = payload || {};
  let processed = 0, fromCache = 0, errors = 0;
  const results = {};
  // v6.7.0: Pacing — bei Anthropic Free-Tier sind 5 RPM Limit. Wir pausieren
  // 13s zwischen Aufrufen → max. 4.6 RPM, sicher unter dem Limit. Bei Ollama
  // (lokal) keine Pause — das ist single-stream sequentiell schnell genug.
  const settings = getAiSettings();
  if (!settings.enabled) {
    return { success: false, error: 'AI ist nicht aktiviert — im AI-Assistent (Seitenleiste) aktivieren und Modell wählen' };
  }
  const interCallDelayMs = settings.provider === 'anthropic' ? 13000 : 0;

  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx];
    const cached = triageCacheGet(it.accountId, it.folder, it.uid);
    if (cached) {
      results[`${it.accountId}|${it.folder}|${it.uid}`] = cached;
      fromCache++;
      continue;
    }
    try {
      const r = await triageOneEmail(it.email);
      triageCachePut(it.accountId, it.folder, it.uid, r);
      results[`${it.accountId}|${it.folder}|${it.uid}`] = { ...r, ts: Date.now() };
      processed++;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('ai:triageProgress', { processed, total: items.length, fromCache });
      }
      // Pacing nur wenn weitere uncached-Anfragen folgen
      if (interCallDelayMs > 0 && idx < items.length - 1) {
        const remaining = items.slice(idx + 1).filter(x => !triageCacheGet(x.accountId, x.folder, x.uid));
        if (remaining.length > 0) {
          await new Promise(r => setTimeout(r, interCallDelayMs));
        }
      }
    } catch (e) {
      errors++;
      console.warn('[AI] triage error:', e.message);
      // Bei wiederholten Fehlern abbrechen — sonst geht das nie zu Ende
      if (errors >= 3) {
        return { success: false, error: e.message, processed, fromCache, errors };
      }
    }
  }
  return { success: true, processed, fromCache, errors, results };
});

ipcMain.handle('ai:getTriageMap', async (event, accountId, folder = 'INBOX') => {
  const all = getTriageCache();
  const out = {};
  const prefix = `${accountId}|${folder}|`;
  for (const k of Object.keys(all)) {
    if (k.startsWith(prefix)) out[k.slice(prefix.length)] = all[k];
  }
  return { success: true, map: out };
});

// ── Smart Compose ───────────────────────────────────────────────────────────
ipcMain.handle('ai:smartCompose', async (event, payload) => {
  try {
    const { originalEmail = {}, intent = 'custom', tone = 'neutral', length = 'medium', userHint = '' } = payload || {};
    const userPrompt = `Generiere einen Antwortvorschlag.

Original-Mail:
Von: ${originalEmail.from || ''}
Betreff: ${originalEmail.subject || ''}
${originalEmail.text ? originalEmail.text.slice(0, 3000) : ''}

Vorgaben:
- intent: ${intent}        (accept | decline | defer | ask_clarification | acknowledge | custom)
- tone:   ${tone}          (formal | neutral | casual)
- length: ${length}        (short=1-2 Sätze | medium=Absatz | long=ausführlich)
${userHint ? '- user_hint: ' + userHint : ''}

Regeln:
- Übernimm den Anrede-Stil aus der Original-Mail
- Keine erfundenen Fakten — fehlende Infos mit [...] markieren
- Bei decline: höflich aber klar, keine schwammigen Ausreden
- Bei accept: konkret bestätigen was zugesagt wird

Antworte exakt in diesem JSON-Format:
{
  "draft": "der eigentliche Antworttext, mehrzeilig erlaubt",
  "tone_used": "${tone}",
  "length_used": "${length}",
  "gaps": ["Liste fehlender Infos die der User noch ergänzen muss, leer wenn keine"]
}`;
    const result = await aiComplete({ user: userPrompt, temperature: 0.6, maxTokens: 800 });
    return { success: true, result };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
