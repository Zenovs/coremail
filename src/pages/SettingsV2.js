import React, { useState, useEffect } from 'react';
import {
  Settings, Email, Security, Group, TextFont,
  SidePanelOpen, Tag, Notification, Edit, FolderDetails, Translate, Renew,
  ColorPalette, Information, UserProfile
} from '@carbon/icons-react';
import { useTheme, themes } from '../context/ThemeContext';
import UpdateSettings from './UpdateSettings';
import NotificationSettings from './NotificationSettings';
import SignatureEditor from './SignatureEditor';
import SidebarSettings from './SidebarSettings';
import CategorySettings from './CategorySettings';
import EmailSettings from './EmailSettings';
import FontSettings from './FontSettings';
import SpamFilterSettings from './SpamFilterSettings';
import SenderManagement from './SenderManagement';
import TranslationSettings from './TranslationSettings';
import ProfileTransfer from './ProfileTransfer';

function SettingsV2() {
  const { theme, currentTheme, changeTheme } = useTheme();
  const c = currentTheme.colors;
  const [activeTab, setActiveTab] = useState('general');
  const [downloadPath, setDownloadPath] = useState('');
  const [appVersion, setAppVersion] = useState('');

  useEffect(() => {
    loadDownloadPath();
    loadAppVersion();
  }, []);

  const loadAppVersion = async () => {
    if (window.electronAPI?.getVersion) {
      const version = await window.electronAPI.getVersion();
      setAppVersion(version);
    }
  };

  const loadDownloadPath = async () => {
    if (window.electronAPI?.getAppSettings) {
      const settings = await window.electronAPI.getAppSettings();
      setDownloadPath(settings.downloadPath || '');
    }
  };

  const selectDownloadFolder = async () => {
    if (window.electronAPI?.selectDownloadFolder) {
      const result = await window.electronAPI.selectDownloadFolder();
      if (result.success) {
        setDownloadPath(result.path);
        const settings = await window.electronAPI.getAppSettings();
        await window.electronAPI.saveAppSettings({ ...settings, downloadPath: result.path });
      }
    }
  };

  const tabs = [
    { id: 'general',       name: 'Allgemein',          Icon: Settings       },
    { id: 'email',         name: 'E-Mail',              Icon: Email          },
    { id: 'spamfilter',    name: 'Spam-Filter',         Icon: Security       },
    { id: 'senders',       name: 'Absender',            Icon: Group          },
    { id: 'font',          name: 'Schriftart',          Icon: TextFont       },
    { id: 'sidebar',       name: 'Sidebar',             Icon: SidePanelOpen  },
    { id: 'categories',    name: 'Kategorien',          Icon: Tag            },
    { id: 'notifications', name: 'Benachrichtigungen',  Icon: Notification   },
    { id: 'signatures',    name: 'Signaturen',          Icon: Edit           },
    { id: 'downloads',     name: 'Downloads',           Icon: FolderDetails  },
    { id: 'translation',   name: 'Übersetzung',         Icon: Translate      },
    { id: 'updates',       name: 'Updates',             Icon: Renew          },
    { id: 'profile',       name: 'Profil übertragen',   Icon: UserProfile    },
  ];

  const themeOptions = [
    { id: 'dark', name: 'Dark', desc: 'Dunkles Design mit Cyan-Akzenten', preview: 'bg-gray-900', previewBorder: 'border-cyan-500/50' },
    { id: 'light', name: 'Light', desc: 'Helles Design mit blauen Akzenten', preview: 'bg-white', previewBorder: 'border-blue-500/50' },
    { id: 'minimal', name: 'Minimal', desc: 'Minimalistisch in Schwarz/Weiß', preview: 'bg-gray-100', previewBorder: 'border-gray-400' },
    { id: 'morphism', name: 'Morphismus', desc: 'Glasmorphismus mit weichen Schatten', preview: 'bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900', previewBorder: 'border-purple-500/50' },
    { id: 'glass', name: 'Glas', desc: 'Transparente Glaseffekte', preview: 'bg-gradient-to-br from-blue-950 via-slate-900 to-indigo-950', previewBorder: 'border-sky-400/50' },
    { id: 'retro', name: 'Retro', desc: '80er/90er Neon-Stil', preview: 'bg-gray-950', previewBorder: 'border-pink-500/50' },
    { id: 'foundations', name: 'Foundations', desc: 'Professionelles Design-System mit Orange & Grün', preview: 'bg-foundations-950', previewBorder: 'border-orange-500/50' },
    { id: 'lollipop', name: 'Lollipop', desc: 'Farbenfrohes Candy-Design mit bunten Akzenten', preview: 'bg-lollipop-bg', previewBorder: 'border-lollipop-pink/50' },
    { id: 'nerd', name: 'Nerd', desc: 'VS Code Dark+ Stil', preview: 'bg-nerd-900', previewBorder: 'border-nerd-blue/50' },
    { id: 'colorful', name: 'Colorful', desc: 'Leuchtende Rainbow-Farben', preview: 'bg-gray-950', previewBorder: 'border-purple-500/50' },
    { id: 'indie', name: 'Indie', desc: 'Warme Erdtöne im Vintage-Stil', preview: 'bg-indie-950', previewBorder: 'border-indie-rose/50' },
  ];

  const getThemePreviewContent = (themeId) => {
    switch (themeId) {
      case 'morphism':
        return (
          <div className="w-full h-full flex items-center justify-center">
            <div className="w-8 h-8 rounded-lg bg-white/20 backdrop-blur shadow-lg" />
          </div>
        );
      case 'glass':
        return (
          <div className="w-full h-full flex items-center justify-center">
            <div className="w-8 h-8 rounded bg-white/10 backdrop-blur-sm border border-white/20" />
          </div>
        );
      case 'retro':
        return (
          <div className="w-full h-full flex items-center justify-center relative">
            <span className="text-xs text-pink-500 font-bold" style={{ textShadow: '0 0 10px #ff00ff' }}>NEON</span>
          </div>
        );
      case 'foundations':
        return (
          <div className="w-full h-full flex items-center justify-center gap-1">
            <div className="w-4 h-4 rounded-full bg-orange-500" />
            <div className="w-4 h-4 rounded-full bg-green-500" />
          </div>
        );
      case 'lollipop':
        return (
          <div className="w-full h-full flex items-center justify-center gap-1">
            <div className="w-3 h-3 rounded-full bg-lollipop-pink" />
            <div className="w-3 h-3 rounded-full bg-lollipop-purple" />
            <div className="w-3 h-3 rounded-full bg-lollipop-yellow" />
            <div className="w-3 h-3 rounded-full bg-lollipop-green" />
            <div className="w-3 h-3 rounded-full bg-lollipop-orange" />
          </div>
        );
      case 'nerd':
        return (
          <div className="w-full h-full flex items-center justify-center gap-1 px-2">
            <span className="text-xs font-mono font-bold" style={{ color: '#569cd6' }}>const</span>
            <span className="text-xs font-mono" style={{ color: '#9cdcfe' }}>x</span>
            <span className="text-xs font-mono" style={{ color: '#d4d4d4' }}>=</span>
            <span className="text-xs font-mono" style={{ color: '#dcdcaa' }}>1</span>
          </div>
        );
      case 'colorful':
        return (
          <div className="w-full h-full flex items-center justify-center gap-1">
            <div className="w-2 h-2 rounded-full bg-pink-500" />
            <div className="w-2 h-2 rounded-full bg-yellow-400" />
            <div className="w-2 h-2 rounded-full bg-green-400" />
            <div className="w-2 h-2 rounded-full bg-cyan-400" />
            <div className="w-2 h-2 rounded-full bg-violet-500" />
          </div>
        );
      case 'indie':
        return (
          <div className="w-full h-full flex items-center justify-center gap-1">
            <div className="w-4 h-4 rounded-full bg-indie-rose" />
            <div className="w-4 h-4 rounded-full bg-indie-amber" />
            <div className="w-4 h-4 rounded-full bg-indie-sage" />
          </div>
        );
      default:
        return null;
    }
  };

  const renderContent = () => {
    switch (activeTab) {
      case 'general':
        return (
          <div className="space-y-6">
            {/* Theme Selection */}
            <div className={`${c.card} ${c.border} border rounded-xl p-6`}>
              <h3 className={`text-lg font-semibold ${c.text} mb-4 flex items-center gap-2`}><ColorPalette size={16} className="text-cyan-400" /> Design</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {themeOptions.map(t => (
                  <button
                    key={t.id}
                    onClick={() => changeTheme(t.id)}
                    className={`p-4 rounded-xl border-2 transition-all ${
                      theme === t.id 
                        ? `border-cyan-500 ring-2 ring-cyan-500/20` 
                        : `${c.border} hover:border-gray-400`
                    }`}
                  >
                    <div className={`w-full h-16 rounded-lg ${t.preview} border ${t.previewBorder} mb-3 overflow-hidden relative`}>
                      {getThemePreviewContent(t.id)}
                    </div>
                    <div className={`font-medium ${c.text} text-sm`}>{t.name}</div>
                    <div className={`text-xs ${c.textSecondary} mt-1 line-clamp-2`}>{t.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Info */}
            <div className={`${c.card} ${c.border} border rounded-xl p-6`}>
              <h3 className={`text-lg font-semibold ${c.text} mb-4 flex items-center gap-2`}><Information size={16} className="text-cyan-400" /> Über CoreMail</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className={c.textSecondary}>Version</span>
                  <span className={`${c.accent} font-semibold`}>{appVersion}</span>
                </div>
                <div className="flex justify-between">
                  <span className={c.textSecondary}>Electron</span>
                  <span className={c.text}>28.x</span>
                </div>
                <div className="flex justify-between">
                  <span className={c.textSecondary}>Node.js</span>
                  <span className={c.text}>20.x</span>
                </div>
              </div>
            </div>

            {/* Hinweise */}
            <div className={`${c.card} ${c.border} border rounded-xl p-6`}>
              <h3 className={`text-lg font-semibold ${c.text} mb-4 flex items-center gap-2`}><Information size={16} className="text-cyan-400" /> Hinweise</h3>
              <ul className={`space-y-2 text-sm ${c.textSecondary}`}>
                <li>• E-Mail-Konten werden unter "Konten" verwaltet</li>
                <li>• Passwörter werden verschlüsselt gespeichert</li>
                <li>• Für Gmail: App-Passwörter erforderlich</li>
                <li>• Tastaturkürzel: ↑↓ für E-Mail-Navigation</li>
              </ul>
            </div>

          </div>
        );
      
      case 'email':
        return <EmailSettings />;
      
      case 'spamfilter':
        return <SpamFilterSettings />;
      
      case 'senders':
        return <SenderManagement />;
      
      case 'font':
        return <FontSettings />;

      case 'sidebar':
        return <SidebarSettings />;
      
      case 'categories':
        return <CategorySettings />;
      
      case 'notifications':
        return <NotificationSettings />;
      
      case 'signatures':
        return <SignatureEditor />;
      
      case 'downloads':
        return (
          <div className="space-y-6">
            <div className={`${c.card} ${c.border} border rounded-xl p-6`}>
              <h3 className={`text-lg font-semibold ${c.text} mb-4`}>Download-Einstellungen</h3>
              
              <div className="space-y-4">
                <div>
                  <label className={`block text-sm ${c.textSecondary} mb-2`}>
                    Standard Download-Ordner
                  </label>
                  <div className="flex gap-3">
                    <input
                      type="text"
                      value={downloadPath}
                      readOnly
                      className={`flex-1 px-4 py-2 ${c.input} rounded-lg`}
                      placeholder="~/Downloads"
                    />
                    <button
                      onClick={selectDownloadFolder}
                      className={`px-4 py-2 ${c.accentBg} ${c.accentHover} text-white rounded-lg transition-colors`}
                    >
                      Ändern
                    </button>
                  </div>
                  <p className={`text-xs ${c.textSecondary} mt-2`}>
                    Hier werden Anhänge und Updates gespeichert
                  </p>
                </div>
              </div>
            </div>

            <div className={`${c.card} ${c.border} border rounded-xl p-6`}>
              <h3 className={`text-lg font-semibold ${c.text} mb-4`}>Anhänge</h3>
              <ul className={`space-y-2 text-sm ${c.textSecondary}`}>
                <li>• Anhänge können einzeln oder alle auf einmal heruntergeladen werden</li>
                <li>• Bilder und PDFs werden mit Vorschau angezeigt</li>
                <li>• Klicke auf "Öffnen" um Dateien mit der Standard-App zu öffnen</li>
                <li>• Drag & Drop: Ziehe Dateien direkt in das Compose-Fenster</li>
              </ul>
            </div>
          </div>
        );
      
      case 'translation':
        return <TranslationSettings />;

      case 'updates':
        return <UpdateSettings />;

      case 'profile':
        return <ProfileTransfer />;
      
      default:
        return null;
    }
  };

  return (
    <div className={`flex-1 flex overflow-hidden ${c.bg}`}>
      {/* Sidebar - breiter und scrollbar */}
      <div className={`w-64 min-w-[256px] ${c.bgSecondary} ${c.border} border-r p-4 overflow-y-auto flex-shrink-0`}>
        <h2 className={`text-lg font-bold ${c.text} mb-4 px-3`}>Einstellungen</h2>
        <nav className="space-y-1">
          {tabs.map(tab => {
            const { Icon } = tab;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all ${
                  isActive
                    ? `${c.accentBg} text-white`
                    : `${c.hover} text-white opacity-60 hover:opacity-100`
                }`}
              >
                <Icon size={16} className="flex-shrink-0" />
                <span className="text-sm">{tab.name}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-2xl mx-auto">
          {(() => {
            const active = tabs.find(t => t.id === activeTab);
            const HeaderIcon = active?.Icon;
            return (
              <div className={`flex items-center gap-3 mb-6`}>
                {HeaderIcon && (
                  <div className="w-9 h-9 rounded-xl bg-cyan-500/15 border border-cyan-500/20 flex items-center justify-center flex-shrink-0">
                    <HeaderIcon size={16} className="text-cyan-400" />
                  </div>
                )}
                <h1 className={`text-2xl font-bold ${c.text}`}>{active?.name}</h1>
              </div>
            );
          })()}
          {renderContent()}
        </div>
      </div>
    </div>
  );
}

export default SettingsV2;
