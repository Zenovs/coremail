import React, { useState, useEffect, useCallback, Component, useRef } from 'react';
import { WarningFilled, WarningAlt, Close, CloudOffline } from '@carbon/icons-react';
import { ThemeProvider, useTheme } from './context/ThemeContext';
import { AccountProvider, useAccounts, useAccountStats } from './context/AccountContext';
import { SearchProvider, useSearch } from './context/SearchContext';
import AppRail from './components/AppRail';
import GlobalSearch from './components/GlobalSearch';
import UpdateNotification from './components/UpdateNotification';
import InboxSplitView from './pages/InboxSplitView';
import ComposeEmail from './pages/ComposeEmail';
import SettingsV2 from './pages/SettingsV2';
import Logbuch from './pages/Logbuch';
import AccountManager from './pages/AccountManager';
import EmailView from './pages/EmailView';
import CalendarView from './pages/CalendarView';
import SnoozedView from './pages/SnoozedView';
import MailRules from './pages/MailRules';
import AISettings from './pages/AISettings';
import { applySavedFont } from './pages/FontSettings';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('[CoreMail] Render error:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'var(--cm-bg)', color: 'var(--cm-text)', padding: '32px' }}>
          <WarningFilled size={48} style={{ marginBottom: '16px', color: '#f59e0b' }} />
          <h2 style={{ fontSize: '20px', fontWeight: 'bold', marginBottom: '8px' }}>Ansicht konnte nicht geladen werden</h2>
          <p style={{ fontSize: '14px', opacity: 0.7, marginBottom: '24px', textAlign: 'center', maxWidth: '400px' }}>
            {this.state.error?.message || 'Unbekannter Fehler'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{ padding: '8px 20px', background: '#0f6cbd', color: 'white', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: 500 }}
          >
            Erneut versuchen
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

applySavedFont();

const bgSaveToIndexedDB = async (accountId, folder, emails) => {
  try {
    const request = indexedDB.open('CoreMailDB', 1);
    await new Promise((resolve, reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('emails', 'readwrite');
        const store = tx.objectStore('emails');
        store.put({ id: `${accountId}:${folder}`, accountId, folder, emails, timestamp: Date.now() });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('emails')) {
          db.createObjectStore('emails', { keyPath: 'id' });
        }
      };
    });
  } catch (e) {
    console.error('[BGSync] IndexedDB write error:', e);
  }
};

const REFRESH_INTERVALS_APP = { '1': 60000, '5': 300000, '10': 600000, '15': 900000, '30': 1800000, 'manual': 0 };

function AppContent() {
  const { currentTheme } = useTheme();
  const { setActiveAccountId, accounts, updateAccountStats } = useAccounts();
  const { openSearch, toggleSearch } = useSearch();
  const [currentView, setCurrentView] = useState('inbox');
  const [fullViewEmail, setFullViewEmail] = useState(null);
  const [currentFolder, setCurrentFolder] = useState('INBOX');
  const [composeData, setComposeData] = useState(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncErrorToast, setSyncErrorToast] = useState(null);
  const syncErrorTimerRef = useRef(null);
  const lastSyncSignatureRef = useRef(new Map()); // accountId → "uid:seen,..." des letzten Syncs
  const c = currentTheme.colors;

  useEffect(() => {
    const onOnline  = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online',  onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online',  onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        toggleSearch();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        openSearch();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [toggleSearch, openSearch]);

  useEffect(() => {
    if (!accounts || accounts.length === 0) return;

    const getInterval = () => {
      const saved = localStorage.getItem('emailSettings.refreshInterval') || '5';
      return REFRESH_INTERVALS_APP[saved] || 0;
    };

    const syncAllAccounts = async () => {
      if (!window.electronAPI) return;
      // Bewusst KEIN `document.hidden`-Guard mehr: ein Mail-Client soll auch
      // bei minimiertem/verdecktem Fenster im Hintergrund weiter abrufen.
      // Zusammen mit backgroundThrottling:false (main.js) laufen die Timer
      // dann auch im Tray zuverlässig weiter.
      if (!navigator.onLine) return;

      const localStorageEnabled = localStorage.getItem('emailSettings.localStorageEnabled') !== 'false';

      // v7.0: Konten parallel synchronisieren — vorher lief der Sync strikt
      // sequenziell; bei einem langsamen/hängenden Konto warteten alle anderen.
      const syncOne = async (account) => {
        try {
          let result;
          if (account.type === 'microsoft') {
            result = await window.electronAPI.fetchGraphEmails(account.id, { folder: 'INBOX', limit: 50, skip: 0 });
          } else {
            result = await window.electronAPI.fetchEmailsForAccount(account.id, { limit: 50, offset: 0 });
          }
          if (result?.success && result.emails?.length > 0) {
            // v6.8.1: Unverändertes Postfach → nichts persistieren/indexieren.
            // Vorher wurden dieselben 50 Mails alle 5 Minuten erneut in
            // IndexedDB geschrieben und im FTS-Index neu indexiert.
            const signature = result.emails.map(e => `${e.uid}:${e.seen ? 1 : 0}`).join(',');
            if (lastSyncSignatureRef.current.get(account.id) === signature) {
              return;
            }
            lastSyncSignatureRef.current.set(account.id, signature);
            if (localStorageEnabled) {
              await bgSaveToIndexedDB(account.id, 'INBOX', result.emails);
            }
            // FTS5-Index aktualisieren (best-effort, blockiert nicht)
            if (window.electronAPI?.searchIndexBatch) {
              window.electronAPI.searchIndexBatch(
                result.emails.map(e => ({
                  accountId: account.id,
                  folder: 'INBOX',
                  uid: e.uid,
                  messageId: e.messageId || null,
                  subject: e.subject || '',
                  from: e.from || '',
                  to: e.to || '',
                  cc: e.cc || '',
                  date: e.date || null,
                  body: e.preview || e.text || '',
                  html: null,
                  hasAttachments: !!e.hasAttachments,
                  seen: !!e.seen
                }))
              ).catch(() => {});
            }
            const unread = result.emails.filter(e => !e.seen).length;
            updateAccountStats(account.id, { unread, total: result.emails.length });
            window.dispatchEvent(new CustomEvent('coremail:bgSync', {
              detail: { accountId: account.id, folder: 'INBOX', emails: result.emails }
            }));
          }
        } catch (e) {
          console.error('[BGSync] Error for account', account.id, e);
          setSyncErrorToast({ accountName: account.name || account.id, message: e.message });
          if (syncErrorTimerRef.current) clearTimeout(syncErrorTimerRef.current);
          syncErrorTimerRef.current = setTimeout(() => setSyncErrorToast(null), 5000);
        }
      };

      await Promise.allSettled(accounts.map(syncOne));
    };

    const interval = getInterval();
    if (interval <= 0) return;

    const jitter = Math.random() * 10000;
    console.log(`[BGSync] Starting background sync every ${interval / 1000}s (+${Math.round(jitter/1000)}s jitter) for ${accounts.length} account(s)`);
    let syncIntervalId = null;
    const firstTimeout = setTimeout(() => {
      syncAllAccounts();
      syncIntervalId = setInterval(syncAllAccounts, interval);
    }, jitter);
    return () => {
      clearTimeout(firstTimeout);
      if (syncIntervalId) clearInterval(syncIntervalId);
      console.log('[BGSync] Background sync stopped');
    };
  }, [accounts]);

  const handleFullView = (email, folder = 'INBOX') => {
    // v7.0: Aus dem Alle-Konten-Modus heraus trägt die Mail ihr Konto selbst —
    // aktives Konto umschalten und die Original-UID verwenden, damit die
    // Vollansicht (und Antworten daraus) am richtigen Konto arbeiten.
    if (email?.__accId) {
      setActiveAccountId(email.__accId);
      folder = email.__folder || 'INBOX'; // v7.1: echter Ordner (z.B. Gesendet)
      email = { ...email, uid: email.origUid ?? email.uid };
    }
    setFullViewEmail(email);
    setCurrentFolder(folder);
    setCurrentView('emailView');
  };

  const handleBackFromEmail = () => {
    setFullViewEmail(null);
    setCurrentView('inbox');
  };

  const handleReply = (email, options = {}) => {
    // v7.0: aus dem Alle-Konten-Modus mit dem Konto der Mail antworten
    if (email?.__accId) {
      setActiveAccountId(email.__accId);
      email = { ...email, uid: email.origUid ?? email.uid };
    }
    setComposeData({
      type: options.forward ? 'forward' : (options.replyAll ? 'replyAll' : 'reply'),
      originalEmail: email,
      aiDraft: options.aiDraft || null
    });
    setCurrentView('compose');
  };

  const handleReplyAll = (email) => {
    handleReply(email, { replyAll: true });
  };

  const handleForward = (email) => {
    handleReply(email, { forward: true });
  };

  const handleSelectEmailFromSearch = useCallback((email) => {
    setActiveAccountId(email.accountId);
    setFullViewEmail(email);
    setCurrentFolder(email.folder || 'INBOX');
    setCurrentView('emailView');
  }, [setActiveAccountId]);

  const renderContent = () => {
    switch (currentView) {
      case 'inbox':
        return <InboxSplitView onFullView={handleFullView} onNavigate={setCurrentView} onForward={handleForward} />;
      case 'compose':
        return (
          <ComposeEmail
            onBack={() => { setComposeData(null); setCurrentView('inbox'); }}
            composeData={composeData}
          />
        );
      case 'settings':
        return <SettingsV2 />;
      case 'accounts':
        return <AccountManager />;
      case 'logbuch':
        return <Logbuch />;
      case 'calendar':
        return <CalendarView />;
      case 'rules':
        return <MailRules />;
      case 'ai':
        return <AISettings />;
      case 'snoozed':
        return <SnoozedView onOpenEmail={({ accountId, folder, uid }) => {
          if (accountId) setActiveAccountId(accountId);
          // Mail-Stub mit accountId/folder/uid — EmailView lädt den Rest
          setFullViewEmail({ uid, accountId, folder: folder || 'INBOX' });
          setCurrentFolder(folder || 'INBOX');
          setCurrentView('emailView');
        }} />;
      case 'emailView':
        return (
          <EmailView
            email={fullViewEmail}
            onBack={handleBackFromEmail}
            onReply={handleReply}
            onReplyAll={handleReplyAll}
            onForward={handleForward}
            currentFolder={currentFolder}
          />
        );
      default:
        return <InboxSplitView onFullView={handleFullView} onNavigate={setCurrentView} onForward={handleForward} />;
    }
  };

  return (
    <div className={`flex flex-col h-screen ${c.bg}`}>
      {!isOnline && (
        <div className="flex items-center justify-center gap-2 px-4 py-2 bg-red-600/90 text-white text-sm font-medium flex-shrink-0 z-50">
          <CloudOffline size={16} />
          <span>Keine Internetverbindung — E-Mails werden offline angezeigt</span>
        </div>
      )}
      {syncErrorToast && (
        <div className="fixed bottom-4 right-4 z-50 cm-banner cm-banner-red shadow-lg max-w-sm">
          <WarningAlt size={16} />
          <span>Sync fehlgeschlagen für <strong>{syncErrorToast.accountName}</strong></span>
          <button onClick={() => setSyncErrorToast(null)} className="ml-auto opacity-60 hover:opacity-100"><Close size={16} /></button>
        </div>
      )}
      <ErrorBoundary>
      <div className="flex flex-1 overflow-hidden min-h-0">
      <AppRail currentView={currentView} onNavigate={setCurrentView} />
      <main className="flex-1 flex flex-col overflow-hidden min-h-0">
        {/* key={currentView}: Boundary beim Seitenwechsel neu mounten — sonst
            blieb nach einem Crash (z.B. Mail-Regeln) JEDE danach angeklickte
            Ansicht auf der Fehlerseite hängen. */}
        <ErrorBoundary key={currentView}>
          {renderContent()}
        </ErrorBoundary>
      </main>
      <GlobalSearch onSelectEmail={handleSelectEmailFromSearch} />
      <UpdateNotification onOpenSettings={() => setCurrentView('settings')} />
      </div>
      </ErrorBoundary>
    </div>
  );
}

// Eigene Komponente statt Teil von AppContent: konsumiert den schnellen
// Stats-Context, ohne den ganzen App-Baum bei jedem Zähler-Update zu re-rendern.
function UnreadBadgeSync() {
  const accountStats = useAccountStats();

  useEffect(() => {
    const totalUnread = Object.values(accountStats || {})
      .reduce((sum, s) => sum + (s?.unread || 0), 0);
    document.title = totalUnread > 0
      ? `CoreMail Desktop (${totalUnread})`
      : 'CoreMail Desktop';
    window.electronAPI?.setBadgeCount?.(totalUnread);
  }, [accountStats]);

  return null;
}

function App() {
  return (
    <ThemeProvider>
      <AccountProvider>
        <SearchProvider>
          <UnreadBadgeSync />
          <AppContent />
        </SearchProvider>
      </AccountProvider>
    </ThemeProvider>
  );
}

export default App;
