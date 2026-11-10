import React, { useState, useEffect, useMemo } from 'react';
import {
  CheckmarkFilled, WarningAlt, Settings, Email, InProgress, Security, Renew,
  ChevronDown, ChevronUp, Help, Launch, Password, Information, Building, Close
} from '@carbon/icons-react';
import { useTheme } from '../context/ThemeContext';
import { useAccounts } from '../context/AccountContext';

// v2.0.0: Server Presets - Nur IMAP/SMTP (OAuth2 entfernt)
const SERVER_PRESETS = [
  {
    id: 'custom',
    name: 'Benutzerdefiniert',
    Icon: Settings,
    imap: { host: '', port: '993', tls: true },
    smtp: { host: '', port: '465', secure: true }
  },
  {
    id: 'hostpoint',
    name: 'Hostpoint',
    Icon: Building,
    imap: { host: 'imap.mail.hostpoint.ch', port: '993', tls: true },
    smtp: { host: 'asmtp.mail.hostpoint.ch', port: '465', secure: true },
    note: 'Schweizer Hosting-Anbieter - Benutzername ist die vollständige E-Mail-Adresse',
    autoFillUsername: true
  },
  {
    id: 'bluewin',
    name: 'Bluewin (Swisscom)',
    Icon: Email,
    imap: { host: 'imaps.bluewin.ch', port: '993', tls: true },
    smtp: { host: 'smtpauths.bluewin.ch', port: '465', secure: true },
    note: 'Swisscom Bluewin Mail - Benutzername ist die vollständige E-Mail-Adresse',
    autoFillUsername: true
  }
];

function AccountManager() {
  const { currentTheme } = useTheme();
  const { accounts, categories, addAccount, updateAccount, deleteAccount, addCategory, deleteCategory } = useAccounts();
  const [editingAccount, setEditingAccount] = useState(null);
  const [showAccountForm, setShowAccountForm] = useState(false);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [testing, setTesting] = useState({ imap: false, smtp: false });
  const [testResults, setTestResults] = useState({ imap: null, smtp: null });
  const [selectedPreset, setSelectedPreset] = useState('custom');
  const c = currentTheme.colors;

  // v2.9.0: Account type selection (imap | microsoft)
  const [accountType, setAccountType] = useState(null); // null = show type selector
  const [msClientId, setMsClientId] = useState('');
  const [msLoginState, setMsLoginState] = useState('idle'); // idle | loading | success | error
  const [msLoginError, setMsLoginError] = useState('');
  const [msLoginResult, setMsLoginResult] = useState(null);
  const [categoryId, setCategoryId] = useState('work');

  const [accountForm, setAccountForm] = useState({
    name: '',
    displayName: '',
    categoryId: 'work',
    // Security: allowInsecureTLS=false (default) bedeutet strikte Cert-Validierung.
    // Nur aktivieren bei selbst-signierten Zertifikaten auf privaten/firmeneigenen Servern.
    allowInsecureTLS: false,
    imap: { host: '', port: '993', username: '', password: '', tls: true },
    smtp: { host: '', port: '465', username: '', password: '', secure: true, fromEmail: '' }
  });

  // v6.7.1: Wenn die hartcodierte Default-Kategorie 'work' beim User nicht
  // existiert (umbenannt/gelöscht/eigene Kategorien), zeigt der <select>
  // optisch die erste verfügbare Option, der State bleibt aber bei 'work'
  // → ungültige ID landet im neuen Konto → Sidebar gruppiert es nicht.
  // Wir korrigieren ungültige categoryId-Werte automatisch auf die erste
  // existierende Kategorie.
  useEffect(() => {
    if (categories.length === 0) return;
    if (!categories.find(c => c.id === categoryId)) {
      setCategoryId(categories[0].id);
    }
    if (!categories.find(c => c.id === accountForm.categoryId)) {
      setAccountForm(f => ({ ...f, categoryId: categories[0].id }));
    }
  }, [categories, categoryId, accountForm.categoryId]);

  const currentPreset = useMemo(() => {
    return SERVER_PRESETS.find(p => p.id === selectedPreset);
  }, [selectedPreset]);

  const [categoryForm, setCategoryForm] = useState({ name: '', color: '#3b82f6' });

  // v2.0.0: Vereinfachte Email-Behandlung (keine Microsoft-Auto-Detection)
  const handleEmailChange = (email) => {
    const preset = SERVER_PRESETS.find(p => p.id === selectedPreset);
    const shouldAutoFill = preset?.autoFillUsername;
    
    setAccountForm(f => ({
      ...f,
      imap: {
        ...f.imap,
        username: email
      },
      smtp: {
        ...f.smtp,
        username: shouldAutoFill ? email : f.smtp.username,
        fromEmail: email
      }
    }));
  };

  const applyPreset = (presetId) => {
    setSelectedPreset(presetId);
    const preset = SERVER_PRESETS.find(p => p.id === presetId);
    if (preset && presetId !== 'custom') {
      setAccountForm(f => ({
        ...f,
        imap: {
          ...f.imap,
          host: preset.imap.host,
          port: preset.imap.port,
          tls: preset.imap.tls
        },
        smtp: {
          ...f.smtp,
          host: preset.smtp.host,
          port: preset.smtp.port,
          secure: preset.smtp.secure
        }
      }));
    }
  };

  const copyImapToSmtp = () => {
    setAccountForm(f => ({
      ...f,
      smtp: {
        ...f.smtp,
        username: f.imap.username,
        password: f.imap.password
      }
    }));
  };

  const resetForm = () => {
    // v6.7.1: erste existierende Kategorie als Default — falls 'work' beim
    // User nicht (mehr) existiert.
    const defaultCat = categories[0]?.id || 'work';
    setAccountForm({
      name: '',
      displayName: '',
      categoryId: defaultCat,
      allowInsecureTLS: false,
      imap: { host: '', port: '993', username: '', password: '', tls: true },
      smtp: { host: '', port: '465', username: '', password: '', secure: true, fromEmail: '' }
    });
    setEditingAccount(null);
    setShowAccountForm(false);
    setTestResults({ imap: null, smtp: null });
    setSelectedPreset('custom');
    setAccountType(null);
    setMsClientId('');
    setMsLoginState('idle');
    setMsLoginError('');
    setMsLoginResult(null);
    setCategoryId(defaultCat);
  };

  // v2.9.0: Microsoft OAuth2 login flow
  const handleMicrosoftLogin = async () => {
    if (!msClientId.trim()) {
      setMsLoginError('Bitte zuerst die App-ID (Client-ID) eingeben.');
      return;
    }
    setMsLoginState('loading');
    setMsLoginError('');
    try {
      const result = await window.electronAPI.microsoftLogin(msClientId.trim());
      if (result.success) {
        setMsLoginResult(result);
        setMsLoginState('success');
      } else {
        setMsLoginState('error');
        setMsLoginError(result.error || 'Unbekannter Fehler');
      }
    } catch (e) {
      setMsLoginState('error');
      setMsLoginError(e.message);
    }
  };

  const handleSaveMicrosoftAccount = async () => {
    if (!msLoginResult) return;
    const newAccount = {
      name: msLoginResult.displayName || msLoginResult.email,
      displayName: msLoginResult.displayName || '',
      categoryId,
      type: 'microsoft',
      microsoft: {
        email: msLoginResult.email,
        clientId: msClientId.trim(),
        tempId: msLoginResult.tempId,
        tenantId: msLoginResult.tenantId || null
      }
    };
    const saved = await addAccount(newAccount);
    // Rename token cache key from tempId to real account id
    // This is handled automatically: the tempId cache key gets copied when account is saved
    // The IPC handler in main.js uses account.microsoft.tempId to find the cache
    resetForm();
  };

  const handleEditAccount = (account) => {
    setAccountForm(account);
    setEditingAccount(account.id);
    setShowAccountForm(true);
  };

  const handleSaveAccount = async () => {
    const accountData = { ...accountForm };
    
    if (editingAccount) {
      await updateAccount(editingAccount, accountData);
    } else {
      await addAccount(accountData);
    }
    resetForm();
  };

  const handleTestImap = async () => {
    setTesting(t => ({ ...t, imap: true }));
    const result = await window.electronAPI.testImap({ ...accountForm.imap, allowInsecureTLS: accountForm.allowInsecureTLS });
    setTestResults(r => ({ ...r, imap: result }));
    setTesting(t => ({ ...t, imap: false }));
  };

  const handleTestSmtp = async () => {
    setTesting(t => ({ ...t, smtp: true }));
    const result = await window.electronAPI.testSmtp({ ...accountForm.smtp, allowInsecureTLS: accountForm.allowInsecureTLS });
    setTestResults(r => ({ ...r, smtp: result }));
    setTesting(t => ({ ...t, smtp: false }));
  };

  const handleAddCategory = async () => {
    if (categoryForm.name) {
      await addCategory(categoryForm);
      setCategoryForm({ name: '', color: '#3b82f6' });
      setShowCategoryForm(false);
    }
  };

  return (
    <div className={`flex-1 p-6 overflow-auto ${c.bg}`}>
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className={`text-2xl font-bold ${c.text}`}>Kontenverwaltung</h1>
          <button
            onClick={() => { setShowAccountForm(true); setAccountType(null); }}
            className={`px-4 py-2 ${c.accentBg} ${c.accentHover} text-white rounded-lg transition-colors`}
          >
            + Neues Konto
          </button>
        </div>

        {/* v2.9.0: Info Banner */}
        <div className={`mb-6 p-4 ${c.card} ${c.border} border rounded-xl`}>
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 w-10 h-10 bg-accent/15 rounded-lg flex items-center justify-center">
              <Email size={20} className="text-accent" />
            </div>
            <div className="flex-1">
              <h3 className={`font-medium ${c.text}`}>CoreMail Desktop – E-Mail-Client</h3>
              <p className={`text-sm ${c.textSecondary} mt-1`}>
                Unterstützt IMAP/SMTP-Konten (Hostpoint, Bluewin, benutzerdefiniert) sowie
                Microsoft Exchange / Microsoft 365 über OAuth2-Browser-Anmeldung.
              </p>
            </div>
          </div>
        </div>

        {/* Kategorien */}
        <div className="mb-8">
          <div className="flex justify-between items-center mb-4">
            <h2 className={`text-lg font-semibold ${c.text}`}>Kategorien</h2>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setShowCategoryForm(true)}
                className={`text-sm ${c.accent} hover:underline`}
              >
                + Kategorie
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {categories.map(cat => (
              <div 
                key={cat.id} 
                className={`flex items-center gap-2 px-3 py-1.5 ${c.card} ${c.border} border rounded-full`}
              >
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cat.color }} />
                <span className={c.text}>{cat.name}</span>
                {!['work', 'personal', 'other'].includes(cat.id) && (
                  <button 
                    onClick={() => deleteCategory(cat.id)}
                    className="text-red-400 hover:text-red-300 ml-1"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className={`mt-3 flex items-center gap-2 text-sm ${c.textSecondary}`}>
            <span>💡</span>
            <span>Kategorien bearbeiten (Name, Farbe, Icon)?</span>
            <span className={`${c.accent} font-medium`}>→ Einstellungen → Kategorien</span>
          </div>
        </div>

        {/* Kategorie hinzufügen Modal */}
        {showCategoryForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className={`${c.card} ${c.border} border rounded-xl p-6 w-96`}>
              <h3 className={`text-lg font-semibold ${c.text} mb-4`}>Neue Kategorie</h3>
              <div className="space-y-4">
                <input
                  type="text"
                  placeholder="Name"
                  value={categoryForm.name}
                  onChange={e => setCategoryForm(f => ({ ...f, name: e.target.value }))}
                  className={`w-full px-4 py-2 rounded-lg ${c.input} focus:outline-none focus:ring-2 focus:ring-accent`}
                />
                <div className="flex items-center gap-3">
                  <span className={c.textSecondary}>Farbe:</span>
                  <input
                    type="color"
                    value={categoryForm.color}
                    onChange={e => setCategoryForm(f => ({ ...f, color: e.target.value }))}
                    className="w-10 h-10 rounded cursor-pointer"
                  />
                </div>
                <div className="flex justify-end gap-3">
                  <button onClick={() => setShowCategoryForm(false)} className={`px-4 py-2 ${c.textSecondary}`}>
                    Abbrechen
                  </button>
                  <button onClick={handleAddCategory} className={`px-4 py-2 ${c.accentBg} text-white rounded-lg`}>
                    Speichern
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Kontenliste */}
        <h2 className={`text-lg font-semibold ${c.text} mb-4`}>E-Mail-Konten</h2>
        {accounts.length === 0 ? (
          <div className={`${c.card} ${c.border} border rounded-xl p-8 text-center`}>
            <p className={c.textSecondary}>Noch keine Konten hinzugefügt.</p>
            <p className={`text-sm ${c.textSecondary} mt-2`}>
              Klicke auf "+ Neues Konto" um ein IMAP/SMTP-Konto hinzuzufügen.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {accounts.map(account => {
              const cat = categories.find(c => c.id === account.categoryId);
              return (
                <div key={account.id} className={`${c.card} ${c.border} border rounded-xl p-4 flex items-center justify-between`}>
                  <div className="flex items-center gap-4">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cat?.color || '#888' }} />
                    <div>
                      <div className={`font-medium ${c.text} flex items-center gap-2`}>
                        {account.name}
                        {account.type === 'microsoft' ? (
                          <span className="px-1.5 py-0.5 text-xs bg-blue-500/20 text-blue-400 rounded flex items-center gap-1">
                            <Building size={16} />
                            Microsoft 365
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 text-xs bg-accent/15 text-accent rounded flex items-center gap-1">
                            <Email size={16} />
                            IMAP/SMTP
                          </span>
                        )}
                      </div>
                      {account.displayName && (
                        <div className={`text-sm ${c.text} opacity-75`}>✉ {account.displayName}</div>
                      )}
                      <div className={`text-sm ${c.textSecondary}`}>
                        {account.type === 'microsoft' ? account.microsoft?.email : account.imap?.username}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEditAccount(account)}
                      className={`px-3 py-1.5 text-sm ${c.hover} ${c.text} rounded-lg transition-colors`}
                    >
                      Bearbeiten
                    </button>
                    <button
                      onClick={() => deleteAccount(account.id)}
                      className="px-3 py-1.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded-lg transition-colors"
                    >
                      Löschen
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Account Form Modal */}
        {showAccountForm && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-auto py-8">
            <div className={`${c.card} ${c.border} border rounded-xl p-6 w-full max-w-2xl mx-4`}>
              <h3 className={`text-xl font-semibold ${c.text} mb-6`}>
                {editingAccount ? 'Konto bearbeiten' : 'Neues Konto'}
              </h3>

              {/* v2.9.0: Step 1 – Account type selector (only for new accounts) */}
              {!editingAccount && accountType === null && (
                <div className="space-y-4">
                  <p className={`text-sm ${c.textSecondary} mb-4`}>Welchen Kontotyp möchtest du hinzufügen?</p>
                  <div className="grid grid-cols-2 gap-4">
                    <button
                      onClick={() => setAccountType('microsoft')}
                      className={`p-5 rounded-xl ${c.bgTertiary} ${c.border} border hover:border-blue-500 transition-colors text-left`}
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center">
                          <Building size={20} className="text-blue-400" />
                        </div>
                        <span className={`font-semibold ${c.text}`}>Microsoft Exchange</span>
                      </div>
                      <p className={`text-xs ${c.textSecondary}`}>
                        Outlook.com, Hotmail, Live, Microsoft 365, Exchange — Anmeldung direkt im Browser via OAuth2. Kein App-Passwort nötig.
                      </p>
                    </button>
                    <button
                      onClick={() => setAccountType('imap')}
                      className={`p-5 rounded-xl ${c.bgTertiary} ${c.border} border hover:border-accent/60 transition-colors text-left`}
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-10 h-10 bg-accent/15 rounded-lg flex items-center justify-center">
                          <Email size={20} className="text-accent" />
                        </div>
                        <span className={`font-semibold ${c.text}`}>IMAP / SMTP</span>
                      </div>
                      <p className={`text-xs ${c.textSecondary}`}>
                        Hostpoint, Bluewin oder benutzerdefinierter Server — klassische Verbindung mit Benutzername und Passwort.
                      </p>
                    </button>
                  </div>
                  <div className="flex justify-end pt-2">
                    <button onClick={resetForm} className={`px-4 py-2 ${c.textSecondary}`}>Abbrechen</button>
                  </div>
                </div>
              )}

              {/* v2.9.0: Microsoft Exchange Flow */}
              {!editingAccount && accountType === 'microsoft' && (
                <div className="space-y-5">
                  {/* Kategorie */}
                  <div>
                    <label className={`block text-sm ${c.textSecondary} mb-1`}>Kategorie</label>
                    <select
                      value={categoryId}
                      onChange={e => setCategoryId(e.target.value)}
                      className={`w-full px-4 py-2 rounded-lg ${c.input} focus:outline-none focus:ring-2 focus:ring-blue-500`}
                    >
                      {categories.map(cat => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Azure App Client ID */}
                  <div className={`${c.bgTertiary} p-4 rounded-xl space-y-3`}>
                    <div className="flex items-center gap-2">
                      <Password size={16} className="text-blue-400" />
                      <h4 className={`font-medium ${c.text}`}>Azure App-ID (Client-ID)</h4>
                    </div>
                    <input
                      type="text"
                      value={msClientId}
                      onChange={e => setMsClientId(e.target.value)}
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      className={`w-full px-4 py-2 rounded-lg ${c.input} font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500`}
                    />
                    {/* Instructions */}
                    <details className={`text-xs ${c.textSecondary}`}>
                      <summary className="cursor-pointer text-blue-400 hover:underline flex items-center gap-1">
                        <Help size={16} />
                        Wie erhalte ich eine Client-ID?
                      </summary>
                      <ol className="mt-2 space-y-1 pl-4 list-decimal">
                        <li>Gehe zu <span className="text-blue-400">portal.azure.com</span> und melde dich an</li>
                        <li>Suche nach <strong>«App-Registrierungen»</strong> → <strong>«Neue Registrierung»</strong></li>
                        <li>Name: z.B. <em>CoreMail Desktop</em></li>
                        <li>Kontotypen: <strong>«Konten in einem beliebigen Organisationsverzeichnis und persönliche Microsoft-Konten»</strong></li>
                        <li>Umleitungs-URI: Typ <strong>«Mobilgerät und Desktopanwendung»</strong>, URI: <code>http://localhost</code></li>
                        <li>Klicke <strong>«Registrieren»</strong></li>
                        <li>Unter <strong>«Authentifizierung»</strong> → aktiviere <strong>«Öffentliche Clientflows zulassen»</strong></li>
                        <li>Unter <strong>«API-Berechtigungen»</strong> → füge hinzu: <code>Mail.ReadWrite</code>, <code>Mail.Send</code>, <code>User.Read</code> (alle Delegiert)</li>
                        <li>Kopiere die <strong>«Anwendungs-ID (Client-ID)»</strong> von der Übersichtsseite</li>
                      </ol>
                    </details>
                  </div>

                  {/* Login Button & Status */}
                  {msLoginState === 'idle' && (
                    <button
                      onClick={handleMicrosoftLogin}
                      disabled={!msClientId.trim()}
                      className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl font-medium flex items-center justify-center gap-2 transition-colors"
                    >
                      <Building size={20} />
                      Mit Microsoft anmelden
                    </button>
                  )}
                  {msLoginState === 'loading' && (
                    <div className={`flex items-center gap-3 p-4 rounded-xl ${c.bgTertiary}`}>
                      <InProgress size={20} className="text-blue-400 animate-spin flex-shrink-0" />
                      <div>
                        <p className={`text-sm font-medium ${c.text}`}>Browser geöffnet…</p>
                        <p className={`text-xs ${c.textSecondary}`}>Bitte im Browser bei Microsoft anmelden und danach hierher zurückkehren.</p>
                      </div>
                    </div>
                  )}
                  {msLoginState === 'success' && msLoginResult && (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3 p-4 rounded-xl bg-green-500/10 border border-green-500/30">
                        <CheckmarkFilled size={20} className="text-green-400 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-green-400">Anmeldung erfolgreich!</p>
                          <p className={`text-xs ${c.textSecondary}`}>{msLoginResult.displayName} ({msLoginResult.email})</p>
                        </div>
                      </div>
                      <button
                        onClick={handleSaveMicrosoftAccount}
                        className="w-full py-3 bg-green-600 hover:bg-green-500 text-white rounded-xl font-medium flex items-center justify-center gap-2 transition-colors"
                      >
                        <CheckmarkFilled size={20} />
                        Konto speichern
                      </button>
                    </div>
                  )}
                  {msLoginState === 'error' && (
                    <div className="space-y-3">
                      <div className="flex items-start gap-3 p-4 rounded-xl bg-red-500/10 border border-red-500/30">
                        <WarningAlt size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-red-400">Anmeldung fehlgeschlagen</p>
                          <p className={`text-xs ${c.textSecondary} mt-1`}>{msLoginError}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => { setMsLoginState('idle'); setMsLoginError(''); }}
                        className={`w-full py-2 ${c.hover} ${c.text} rounded-xl text-sm transition-colors`}
                      >
                        Erneut versuchen
                      </button>
                    </div>
                  )}

                  <div className="flex justify-between pt-2">
                    <button onClick={() => setAccountType(null)} className={`px-4 py-2 text-sm ${c.textSecondary}`}>
                      ← Zurück
                    </button>
                    <button onClick={resetForm} className={`px-4 py-2 text-sm ${c.textSecondary}`}>Abbrechen</button>
                  </div>
                </div>
              )}

              {/* IMAP/SMTP Form (existing accounts or new IMAP) */}
              {(editingAccount || accountType === 'imap') && (
                <div className="space-y-6">
                  {/* Basis-Infos */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={`block text-sm ${c.textSecondary} mb-1`}>Kontoname</label>
                      <input
                        type="text"
                        value={accountForm.name}
                        onChange={e => setAccountForm(f => ({ ...f, name: e.target.value }))}
                        placeholder="z.B. Firma E-Mail"
                        className={`w-full px-4 py-2 rounded-lg ${c.input} focus:outline-none focus:ring-2 focus:ring-accent`}
                      />
                    </div>
                    <div>
                      <label className={`block text-sm ${c.textSecondary} mb-1`}>Kategorie</label>
                      <select
                        value={accountForm.categoryId}
                        onChange={e => setAccountForm(f => ({ ...f, categoryId: e.target.value }))}
                        className={`w-full px-4 py-2 rounded-lg ${c.input} focus:outline-none focus:ring-2 focus:ring-accent`}
                      >
                        {categories.map(cat => (
                          <option key={cat.id} value={cat.id}>{cat.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Anzeigename */}
                  <div>
                    <label className={`block text-sm ${c.textSecondary} mb-1`}>Anzeigename (für ausgehende E-Mails)</label>
                    <input
                      type="text"
                      value={accountForm.displayName || ''}
                      onChange={e => setAccountForm(f => ({ ...f, displayName: e.target.value.slice(0, 100) }))}
                      placeholder="z.B. Max Mustermann"
                      className={`w-full px-4 py-2 rounded-lg ${c.input} focus:outline-none focus:ring-2 focus:ring-accent`}
                    />
                    <p className={`text-xs ${c.textSecondary} mt-1`}>Optional – wird als Absendername angezeigt.</p>
                  </div>

                  {/* Server Preset Selector */}
                  {!editingAccount && (
                    <div className={`${c.bgTertiary} p-4 rounded-lg`}>
                      <h4 className={`font-medium ${c.text} mb-3`}>Server-Vorlage</h4>
                      <div className="grid grid-cols-3 gap-2">
                        {SERVER_PRESETS.map(preset => (
                          <button
                            key={preset.id}
                            onClick={() => applyPreset(preset.id)}
                            className={`p-3 rounded-lg text-left transition-colors ${
                              selectedPreset === preset.id
                                ? `${c.accentBg} text-white`
                                : `${c.card} ${c.border} border ${c.hover}`
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              {(() => { const PresetIcon = preset.Icon; return <PresetIcon size={20} />; })()}
                              <span className={`text-sm font-medium ${selectedPreset === preset.id ? 'text-white' : c.text}`}>
                                {preset.name}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                      {currentPreset?.note && (
                        <p className={`text-xs ${c.textSecondary} mt-2 flex items-start gap-2`}><Information size={16} className="flex-shrink-0 mt-0.5" /> {currentPreset.note}</p>
                      )}
                    </div>
                  )}

                  {/* IMAP */}
                  <div className={`${c.bgTertiary} p-4 rounded-lg`}>
                    <h4 className={`font-medium ${c.text} mb-3`}>IMAP (Empfang)</h4>
                    <div className="grid grid-cols-2 gap-3">
                      <input type="text" placeholder="Host" value={accountForm.imap.host}
                        onChange={e => setAccountForm(f => ({ ...f, imap: { ...f.imap, host: e.target.value }}))}
                        className={`px-3 py-2 rounded-lg ${c.input} text-sm`} />
                      <input type="text" placeholder="Port (993)" value={accountForm.imap.port}
                        onChange={e => setAccountForm(f => ({ ...f, imap: { ...f.imap, port: e.target.value }}))}
                        className={`px-3 py-2 rounded-lg ${c.input} text-sm`} />
                      <input type="email" placeholder="E-Mail-Adresse" value={accountForm.imap.username}
                        onChange={e => handleEmailChange(e.target.value)}
                        className={`px-3 py-2 rounded-lg ${c.input} text-sm`} />
                      <input type="password" placeholder="Passwort" value={accountForm.imap.password}
                        onChange={e => setAccountForm(f => ({ ...f, imap: { ...f.imap, password: e.target.value }}))}
                        className={`px-3 py-2 rounded-lg ${c.input} text-sm`} />
                    </div>
                    <div className="flex items-center justify-between mt-3">
                      <label className={`flex items-center gap-2 ${c.textSecondary} text-sm`}>
                        <input type="checkbox" checked={accountForm.imap.tls}
                          onChange={e => setAccountForm(f => ({ ...f, imap: { ...f.imap, tls: e.target.checked }}))} />
                        TLS/SSL
                      </label>
                      <button onClick={handleTestImap} disabled={testing.imap}
                        className={`px-3 py-1 text-sm ${c.accentBg} text-white rounded flex items-center gap-1`}>
                        {testing.imap ? <InProgress size={16} className="animate-spin" /> : <CheckmarkFilled size={16} />}
                        {testing.imap ? 'Teste...' : 'Testen'}
                      </button>
                    </div>
                    {testResults.imap && (
                      <div className={`mt-2 text-sm flex items-center gap-1 ${testResults.imap.success ? 'text-green-400' : 'text-red-400'}`}>
                        {testResults.imap.success ? <CheckmarkFilled size={16} /> : <WarningAlt size={16} />}
                        {testResults.imap.success ? 'Verbindung OK' : testResults.imap.error}
                      </div>
                    )}
                  </div>

                  {/* SMTP */}
                  <div className={`${c.bgTertiary} p-4 rounded-lg`}>
                    <div className="flex items-center justify-between mb-3">
                      <h4 className={`font-medium ${c.text}`}>SMTP (Versand)</h4>
                      <button onClick={copyImapToSmtp} className={`text-xs ${c.accent} hover:underline flex items-center gap-1`}>
                        <Email size={16} /> Von IMAP kopieren
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <input type="text" placeholder="Host" value={accountForm.smtp.host}
                        onChange={e => setAccountForm(f => ({ ...f, smtp: { ...f.smtp, host: e.target.value }}))}
                        className={`px-3 py-2 rounded-lg ${c.input} text-sm`} />
                      <input type="text" placeholder="Port (465 oder 587)" value={accountForm.smtp.port}
                        onChange={e => setAccountForm(f => ({ ...f, smtp: { ...f.smtp, port: e.target.value }}))}
                        className={`px-3 py-2 rounded-lg ${c.input} text-sm`} />
                      <input type="text" placeholder="Benutzername" value={accountForm.smtp.username}
                        onChange={e => setAccountForm(f => ({ ...f, smtp: { ...f.smtp, username: e.target.value }}))}
                        className={`px-3 py-2 rounded-lg ${c.input} text-sm`} />
                      <input type="password" placeholder="Passwort" value={accountForm.smtp.password}
                        onChange={e => setAccountForm(f => ({ ...f, smtp: { ...f.smtp, password: e.target.value }}))}
                        className={`px-3 py-2 rounded-lg ${c.input} text-sm`} />
                      <input type="email" placeholder="Absender E-Mail" value={accountForm.smtp.fromEmail}
                        onChange={e => setAccountForm(f => ({ ...f, smtp: { ...f.smtp, fromEmail: e.target.value }}))}
                        className={`col-span-2 px-3 py-2 rounded-lg ${c.input} text-sm`} />
                    </div>
                    <div className="flex items-center justify-between mt-3">
                      <label className={`flex items-center gap-2 ${c.textSecondary} text-sm`}>
                        <input type="checkbox" checked={accountForm.smtp.secure}
                          onChange={e => setAccountForm(f => ({ ...f, smtp: { ...f.smtp, secure: e.target.checked }}))} />
                        SSL/TLS {accountForm.smtp.port === '587' && <span className="text-xs text-yellow-400">(STARTTLS)</span>}
                      </label>
                      <button onClick={handleTestSmtp} disabled={testing.smtp}
                        className={`px-3 py-1 text-sm ${c.accentBg} text-white rounded flex items-center gap-1`}>
                        {testing.smtp ? <InProgress size={16} className="animate-spin" /> : <CheckmarkFilled size={16} />}
                        {testing.smtp ? 'Teste...' : 'Testen'}
                      </button>
                    </div>
                    {testResults.smtp && (
                      <div className={`mt-2 text-sm flex items-center gap-1 ${testResults.smtp.success ? 'text-green-400' : 'text-red-400'}`}>
                        {testResults.smtp.success ? <CheckmarkFilled size={16} /> : <WarningAlt size={16} />}
                        {testResults.smtp.success ? 'Verbindung OK' : testResults.smtp.error}
                      </div>
                    )}
                  </div>

                  {/* Sicherheit / TLS-Validierung */}
                  <div className={`${c.card} ${c.border} border rounded-xl p-4`}>
                    <div className="flex items-start gap-3">
                      <Security size={20} className={accountForm.allowInsecureTLS ? 'text-yellow-400 flex-shrink-0 mt-0.5' : 'text-green-400 flex-shrink-0 mt-0.5'} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className={`text-sm font-medium ${c.text}`}>Selbstsigniertes Zertifikat erlauben</p>
                            <p className={`text-xs ${c.textSecondary} mt-0.5`}>
                              {accountForm.allowInsecureTLS
                                ? 'Cert-Validierung ausgeschaltet — nur für eigene Server.'
                                : 'Empfohlen: Cert-Validierung aktiv (verhindert MITM).'}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setAccountForm(f => ({ ...f, allowInsecureTLS: !f.allowInsecureTLS }))}
                            className={`relative flex-shrink-0 w-12 h-6 rounded-full transition-colors ${accountForm.allowInsecureTLS ? 'bg-yellow-500' : 'bg-gray-600'}`}
                          >
                            <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${accountForm.allowInsecureTLS ? 'translate-x-6' : 'translate-x-0'}`} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Buttons */}
                  <div className="flex justify-between gap-3 pt-4">
                    {!editingAccount && (
                      <button onClick={() => setAccountType(null)} className={`px-4 py-2 text-sm ${c.textSecondary}`}>
                        ← Zurück
                      </button>
                    )}
                    <div className="flex gap-3 ml-auto">
                      <button onClick={resetForm} className={`px-4 py-2 ${c.textSecondary}`}>Abbrechen</button>
                      <button onClick={handleSaveAccount}
                        className={`px-6 py-2 ${c.accentBg} ${c.accentHover} text-white rounded-lg transition-colors`}>
                        Speichern
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default AccountManager;
