import React, { useState, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import { useAccounts } from '../context/AccountContext';
import { Checkmark, Notification, Information } from '@carbon/icons-react';

function NotificationSettings() {
  const { currentTheme } = useTheme();
  const { accounts, categories } = useAccounts();
  const c = currentTheme.colors;
  
  const [settings, setSettings] = useState({
    notificationsEnabled: true,
    notificationSound: true,
    notifyForAccounts: {}, // { accountId: true/false }
    notifyForCategories: {} // { categoryId: true/false }
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    if (window.electronAPI?.getAppSettings) {
      const result = await window.electronAPI.getAppSettings();
      setSettings(prev => ({ ...prev, ...result }));
    }
  };

  const saveSettings = async (newSettings) => {
    setSettings(newSettings);
    if (window.electronAPI?.saveAppSettings) {
      await window.electronAPI.saveAppSettings(newSettings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  const testNotification = () => {
    if (window.electronAPI?.showNotification) {
      window.electronAPI.showNotification({
        title: 'Test-Benachrichtigung',
        body: 'Die Benachrichtigungen funktionieren korrekt!'
      });
    }
  };

  const toggleAccountNotification = (accountId) => {
    const newNotifyForAccounts = {
      ...settings.notifyForAccounts,
      [accountId]: !(settings.notifyForAccounts[accountId] ?? true)
    };
    saveSettings({ ...settings, notifyForAccounts: newNotifyForAccounts });
  };

  const toggleCategoryNotification = (categoryId) => {
    const newNotifyForCategories = {
      ...settings.notifyForCategories,
      [categoryId]: !(settings.notifyForCategories[categoryId] ?? true)
    };
    saveSettings({ ...settings, notifyForCategories: newNotifyForCategories });
  };

  return (
    <div className="space-y-6">
      {/* Saved Banner */}
      {saved && (
        <div className="p-3 bg-green-900/20 border border-green-600 rounded-lg text-green-400 text-center inline-flex items-center justify-center gap-1 w-full">
          <Checkmark size={16} /> Einstellungen gespeichert
        </div>
      )}

      {/* Main Settings */}
      <div className={`${c.card} ${c.border} border rounded-xl p-6`}>
        <h3 className={`text-lg font-semibold ${c.text} mb-4`}>Benachrichtigungen</h3>
        
        <div className="space-y-4">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <span className={c.text}>Benachrichtigungen aktivieren</span>
              <p className={`text-sm ${c.textSecondary}`}>
                Desktop-Benachrichtigungen bei neuen E-Mails
              </p>
            </div>
            <div className="relative">
              <input
                type="checkbox"
                checked={settings.notificationsEnabled}
                onChange={(e) => saveSettings({ ...settings, notificationsEnabled: e.target.checked })}
                className="sr-only"
              />
              <div 
                onClick={() => saveSettings({ ...settings, notificationsEnabled: !settings.notificationsEnabled })}
                className={`w-14 h-7 rounded-full transition-colors cursor-pointer ${
                  settings.notificationsEnabled ? 'bg-accentbg' : c.bgTertiary
                }`}
              >
                <div className={`absolute top-0.5 w-6 h-6 bg-white rounded-full transition-transform ${
                  settings.notificationsEnabled ? 'translate-x-7' : 'translate-x-0.5'
                }`} />
              </div>
            </div>
          </label>

          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <span className={c.text}>Benachrichtigungston</span>
              <p className={`text-sm ${c.textSecondary}`}>
                Sound bei neuen Benachrichtigungen abspielen
              </p>
            </div>
            <div className="relative">
              <input
                type="checkbox"
                checked={settings.notificationSound}
                onChange={(e) => saveSettings({ ...settings, notificationSound: e.target.checked })}
                className="sr-only"
              />
              <div 
                onClick={() => saveSettings({ ...settings, notificationSound: !settings.notificationSound })}
                className={`w-14 h-7 rounded-full transition-colors cursor-pointer ${
                  settings.notificationSound ? 'bg-accentbg' : c.bgTertiary
                }`}
              >
                <div className={`absolute top-0.5 w-6 h-6 bg-white rounded-full transition-transform ${
                  settings.notificationSound ? 'translate-x-7' : 'translate-x-0.5'
                }`} />
              </div>
            </div>
          </label>
        </div>

        <div className="mt-6">
          <button
            onClick={testNotification}
            disabled={!settings.notificationsEnabled}
            className={`px-4 py-2 ${c.bgTertiary} ${c.hover} ${c.text} rounded-lg transition-colors disabled:opacity-50 inline-flex items-center gap-2`}
          >
            <Notification size={16} /> Test-Benachrichtigung senden
          </button>
        </div>
      </div>

      {/* Per-Account Settings */}
      {accounts.length > 0 && (
        <div className={`${c.card} ${c.border} border rounded-xl p-6`}>
          <h3 className={`text-lg font-semibold ${c.text} mb-4`}>Benachrichtigungen pro Konto</h3>
          <p className={`text-sm ${c.textSecondary} mb-4`}>
            Wähle aus, für welche Konten Benachrichtigungen angezeigt werden sollen.
          </p>
          
          <div className="space-y-3">
            {accounts.map(account => (
              <label 
                key={account.id}
                className={`flex items-center justify-between p-3 ${c.bgSecondary} rounded-lg cursor-pointer hover:${c.bgTertiary}`}
              >
                <div className="flex items-center gap-3">
                  <div 
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: categories.find(cat => cat.id === account.categoryId)?.color || '#888' }}
                  />
                  <span className={c.text}>{account.name}</span>
                  <span className={`text-xs ${c.textSecondary}`}>
                    ({account.imap?.username || ''})
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={settings.notifyForAccounts[account.id] ?? true}
                  onChange={() => toggleAccountNotification(account.id)}
                  className="w-5 h-5 rounded accent-accentbg"
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Per-Category Settings */}
      {categories.length > 0 && (
        <div className={`${c.card} ${c.border} border rounded-xl p-6`}>
          <h3 className={`text-lg font-semibold ${c.text} mb-4`}>Benachrichtigungen pro Kategorie</h3>
          <p className={`text-sm ${c.textSecondary} mb-4`}>
            Aktiviere oder deaktiviere Benachrichtigungen für ganze Kategorien.
          </p>
          
          <div className="space-y-3">
            {categories.map(category => (
              <label 
                key={category.id}
                className={`flex items-center justify-between p-3 ${c.bgSecondary} rounded-lg cursor-pointer hover:${c.bgTertiary}`}
              >
                <div className="flex items-center gap-3">
                  <div 
                    className="w-4 h-4 rounded"
                    style={{ backgroundColor: category.color }}
                  />
                  <span className={c.text}>{category.name}</span>
                </div>
                <input
                  type="checkbox"
                  checked={settings.notifyForCategories[category.id] ?? true}
                  onChange={() => toggleCategoryNotification(category.id)}
                  className="w-5 h-5 rounded accent-accentbg"
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Info */}
      <div className={`${c.card} ${c.border} border rounded-xl p-6`}>
        <h3 className={`text-lg font-semibold ${c.text} mb-3 flex items-center gap-2`}><Information size={20} /> Hinweise</h3>
        <ul className={`space-y-2 text-sm ${c.textSecondary}`}>
          <li>• Benachrichtigungen werden nur bei neuen ungelesenen E-Mails angezeigt</li>
          <li>• Klicke auf eine Benachrichtigung, um die E-Mail direkt zu öffnen</li>
          <li>• Der Badge-Counter zeigt die Anzahl ungelesener E-Mails an</li>
          <li>• Systembenachrichtigungen müssen in den Systemeinstellungen aktiviert sein</li>
        </ul>
      </div>
    </div>
  );
}

export default NotificationSettings;
