/**
 * SenderManagement.js v2.6.0
 * 
 * Settings page for managing sender-based email categorization.
 * Users can view, edit, and remove sender categories here.
 */

import React, { useState, useEffect } from 'react';
import {
  TrashCan, Search, Download, Upload, Renew, Warning, Bullhorn, Misuse,
  WarningAlt, Debug, Group, Close, Filter, CheckmarkFilled
} from '@carbon/icons-react';
import { useTheme } from '../context/ThemeContext';
import SenderCategoryManager from '../services/SenderCategoryManager';

// Category definitions matching InboxSplitView
const CATEGORIES = [
  { id: 'whitelist', name: 'Vertrauenswürdig', Icon: CheckmarkFilled, color: 'text-green-400', bgColor: 'bg-green-500/20' },
  { id: 'werbung', name: 'Werbung', Icon: Bullhorn, color: 'text-orange-400', bgColor: 'bg-orange-500/20' },
  { id: 'spam', name: 'Spam', Icon: Misuse, color: 'text-red-400', bgColor: 'bg-red-500/20' },
  { id: 'schaedlich', name: 'Schädlich', Icon: WarningAlt, color: 'text-yellow-400', bgColor: 'bg-yellow-500/20' },
  { id: 'virus', name: 'Virus', Icon: Debug, color: 'text-purple-400', bgColor: 'bg-purple-500/20' },
];

function SenderManagement() {
  const { currentTheme } = useTheme();
  const c = currentTheme.colors;
  
  const [senders, setSenders] = useState([]);
  const [stats, setStats] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(null);
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);
  
  // Load senders on mount and subscribe to changes
  useEffect(() => {
    loadSenders();
    
    // Subscribe to changes
    const unsubscribe = SenderCategoryManager.subscribe(() => {
      loadSenders();
    });
    
    return () => unsubscribe();
  }, []);
  
  const loadSenders = () => {
    setSenders(SenderCategoryManager.getAllSenders());
    setStats(SenderCategoryManager.getStats());
  };
  
  const handleRemoveSender = (email) => {
    SenderCategoryManager.removeSender(email);
    loadSenders();
    setShowDeleteConfirm(null);
  };
  
  const handleChangeSenderCategory = (email, newCategory) => {
    SenderCategoryManager.setSenderCategory(email, newCategory);
    loadSenders();
  };
  
  const handleClearAll = () => {
    SenderCategoryManager.clearAll();
    loadSenders();
    setShowClearAllConfirm(false);
  };
  
  const handleExport = () => {
    const data = SenderCategoryManager.export();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `coremail-sender-categories-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  
  const handleImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        SenderCategoryManager.import(data, true); // Merge with existing
        loadSenders();
        alert('Import erfolgreich!');
      } catch (err) {
        alert('Fehler beim Import: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = ''; // Reset input
  };
  
  // Filter senders based on search and category
  const filteredSenders = senders.filter(sender => {
    const matchesSearch = !searchQuery || 
      sender.email.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = !categoryFilter || sender.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });
  
  // Sort by last updated (newest first)
  const sortedSenders = [...filteredSenders].sort((a, b) => 
    new Date(b.lastUpdated) - new Date(a.lastUpdated)
  );
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className={`text-xl font-bold ${c.text} flex items-center gap-2`}>
          <Group size={24} />
          Absender-Verwaltung
        </h2>
        <p className={`${c.textSecondary} text-sm mt-1`}>
          Verwalte gelernte Absender-Kategorien. Neue E-Mails von gespeicherten Absendern werden automatisch kategorisiert.
        </p>
      </div>
      
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        {/* Total */}
        <div className={`${c.bgSecondary} ${c.border} border rounded-xl p-4`}>
          <div className={`text-2xl font-bold ${c.text}`}>{stats.total || 0}</div>
          <div className={`text-sm ${c.textSecondary}`}>Gesamt</div>
        </div>
        
        {/* Category counts */}
        {CATEGORIES.map(cat => {
          const Icon = cat.Icon;
          return (
            <button
              key={cat.id}
              onClick={() => setCategoryFilter(categoryFilter === cat.id ? null : cat.id)}
              className={`${c.bgSecondary} ${c.border} border rounded-xl p-4 text-left transition-all ${
                categoryFilter === cat.id ? `ring-2 ring-offset-2 ring-offset-transparent ${cat.bgColor}` : 'hover:opacity-80'
              }`}
            >
              <div className="flex items-center gap-2">
                <Icon className={`w-5 h-5 ${cat.color}`} />
                <span className={`text-2xl font-bold ${c.text}`}>{stats[cat.id] || 0}</span>
              </div>
              <div className={`text-sm ${cat.color}`}>{cat.name}</div>
            </button>
          );
        })}
      </div>
      
      {/* Toolbar */}
      <div className={`flex flex-wrap items-center gap-3 ${c.bgSecondary} ${c.border} border rounded-xl p-4`}>
        {/* Search */}
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${c.textSecondary}`} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Absender suchen..."
              className={`w-full pl-9 pr-4 py-2 ${c.bg} ${c.border} border rounded-lg ${c.text} text-sm focus:outline-none focus:ring-2 focus:ring-accent`}
            />
          </div>
        </div>
        
        {/* Category Filter Indicator */}
        {categoryFilter && (
          <button
            onClick={() => setCategoryFilter(null)}
            className={`px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${
              CATEGORIES.find(c => c.id === categoryFilter)?.bgColor
            } ${
              CATEGORIES.find(c => c.id === categoryFilter)?.color
            }`}
          >
            <Filter size={16} />
            {CATEGORIES.find(c => c.id === categoryFilter)?.name}
            <Close size={16} />
          </button>
        )}
        
        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleExport}
            disabled={senders.length === 0}
            className={`p-2 rounded-lg ${c.hover} ${c.textSecondary} hover:${c.text} transition-colors disabled:opacity-50`}
            title="Exportieren"
          >
            <Download size={20} />
          </button>
          
          <label className={`p-2 rounded-lg ${c.hover} ${c.textSecondary} hover:${c.text} transition-colors cursor-pointer`} title="Importieren">
            <Upload size={20} />
            <input type="file" accept=".json" onChange={handleImport} className="hidden" />
          </label>
          
          <button
            onClick={loadSenders}
            className={`p-2 rounded-lg ${c.hover} ${c.textSecondary} hover:${c.text} transition-colors`}
            title="Aktualisieren"
          >
            <Renew size={20} />
          </button>
          
          {senders.length > 0 && (
            <button
              onClick={() => setShowClearAllConfirm(true)}
              className="p-2 rounded-lg hover:bg-red-500/20 text-red-400 hover:text-red-300 transition-colors"
              title="Alle löschen"
            >
              <TrashCan size={20} />
            </button>
          )}
        </div>
      </div>
      
      {/* Sender List */}
      <div className={`${c.bgSecondary} ${c.border} border rounded-xl overflow-hidden`}>
        {sortedSenders.length === 0 ? (
          <div className={`p-8 text-center ${c.textSecondary}`}>
            {searchQuery || categoryFilter ? (
              <>
                <Search size={32} className="mx-auto mb-4 opacity-50" />
                <p>Keine Absender gefunden</p>
                <button
                  onClick={() => { setSearchQuery(''); setCategoryFilter(null); }}
                  className={`mt-2 text-sm ${c.accent} hover:underline`}
                >
                  Filter zurücksetzen
                </button>
              </>
            ) : (
              <>
                <Group size={32} className="mx-auto mb-4 opacity-50" />
                <p className="font-medium">Keine Absender kategorisiert</p>
                <p className="text-sm mt-1">
                  Markiere E-Mails im Posteingang, um Absender automatisch zu kategorisieren.
                </p>
              </>
            )}
          </div>
        ) : (
          <table className="w-full">
            <thead className={`${c.bg} border-b ${c.border}`}>
              <tr>
                <th className={`px-4 py-3 text-left text-sm font-medium ${c.textSecondary}`}>Absender</th>
                <th className={`px-4 py-3 text-left text-sm font-medium ${c.textSecondary}`}>Kategorie</th>
                <th className={`px-4 py-3 text-left text-sm font-medium ${c.textSecondary}`}>Anzahl</th>
                <th className={`px-4 py-3 text-left text-sm font-medium ${c.textSecondary}`}>Zuletzt</th>
                <th className={`px-4 py-3 text-right text-sm font-medium ${c.textSecondary}`}>Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {sortedSenders.map(sender => {
                const cat = CATEGORIES.find(c => c.id === sender.category);
                const Icon = cat?.Icon || Warning;
                
                return (
                  <tr key={sender.email} className={`${c.hover} transition-colors`}>
                    <td className={`px-4 py-3 ${c.text} text-sm font-mono`}>
                      {sender.email}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={sender.category}
                        onChange={(e) => handleChangeSenderCategory(sender.email, e.target.value)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium ${cat?.bgColor || 'bg-gray-500/20'} ${cat?.color || 'text-gray-400'} border-0 cursor-pointer`}
                      >
                        {CATEGORIES.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className={`px-4 py-3 ${c.textSecondary} text-sm`}>
                      {sender.count}x
                    </td>
                    <td className={`px-4 py-3 ${c.textSecondary} text-sm`}>
                      {new Date(sender.lastUpdated).toLocaleDateString('de-DE', {
                        day: '2-digit',
                        month: '2-digit',
                        year: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setShowDeleteConfirm(sender.email)}
                        className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-400 hover:text-red-300 transition-colors"
                        title="Entfernen"
                      >
                        <TrashCan size={16} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      
      {/* Info Box */}
      <div className={`${c.bgTertiary} ${c.border} border rounded-xl p-4`}>
        <h4 className={`font-medium ${c.text} mb-2 flex items-center gap-2`}>
          <Warning size={16} className="text-yellow-400" />
          Hinweis
        </h4>
        <ul className={`text-sm ${c.textSecondary} space-y-1 list-disc list-inside`}>
          <li>Manuelle Kategorisierung hat Vorrang vor automatischer Spam-Erkennung</li>
          <li>Absender werden dauerhaft gespeichert (auch nach App-Neustart)</li>
          <li>Um eine Kategorie zu ändern, markiere eine neue E-Mail vom gleichen Absender</li>
          <li>Exportiere deine Kategorien regelmäßig als Backup</li>
        </ul>
      </div>
      
      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className={`${c.bgSecondary} ${c.border} border rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl`}>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-red-500/20 rounded-full">
                <TrashCan size={24} className="text-red-400" />
              </div>
              <div>
                <h3 className={`text-lg font-semibold ${c.text}`}>Absender entfernen?</h3>
                <p className={`text-sm ${c.textSecondary} font-mono`}>{showDeleteConfirm}</p>
              </div>
            </div>
            
            <p className={`text-sm ${c.textSecondary} mb-6`}>
              Der Absender wird aus der Kategorisierung entfernt. Zukünftige E-Mails werden nicht mehr automatisch kategorisiert.
            </p>
            
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(null)}
                className={`px-4 py-2 ${c.hover} ${c.border} border rounded-lg transition-colors ${c.text}`}
              >
                Abbrechen
              </button>
              <button
                onClick={() => handleRemoveSender(showDeleteConfirm)}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors flex items-center gap-2"
              >
                <TrashCan size={16} />
                Entfernen
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Clear All Confirmation Modal */}
      {showClearAllConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className={`${c.bgSecondary} ${c.border} border rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl`}>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-red-500/20 rounded-full">
                <Warning size={24} className="text-red-400" />
              </div>
              <div>
                <h3 className={`text-lg font-semibold ${c.text}`}>Alle Absender löschen?</h3>
                <p className={`text-sm ${c.textSecondary}`}>{stats.total} Absender werden entfernt</p>
              </div>
            </div>
            
            <p className={`text-sm ${c.textSecondary} mb-6`}>
              Diese Aktion kann nicht rückgängig gemacht werden. Alle gelernten Absender-Kategorien werden gelöscht.
            </p>
            
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowClearAllConfirm(false)}
                className={`px-4 py-2 ${c.hover} ${c.border} border rounded-lg transition-colors ${c.text}`}
              >
                Abbrechen
              </button>
              <button
                onClick={handleClearAll}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors flex items-center gap-2"
              >
                <TrashCan size={16} />
                Alle löschen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SenderManagement;
