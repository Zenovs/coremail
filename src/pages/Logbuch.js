import React, { useState, useEffect, useCallback } from 'react';
import { useTheme } from '../context/ThemeContext';
import {
  Renew, TrashCan, Download, Search, Close,
  Rocket, MailAll, Send, Settings, WarningAlt, Information
} from '@carbon/icons-react';

const TYPE_CONFIG = {
  app_start:       { label: 'App-Start',     Icon: Rocket,      color: 'text-accent' },
  email_received:  { label: 'Empfangen',     Icon: MailAll,     color: 'text-green-400' },
  email_sent:      { label: 'Gesendet',      Icon: Send,        color: 'text-blue-400' },
  settings:        { label: 'Einstellungen', Icon: Settings,    color: 'text-yellow-400' },
  update:          { label: 'Update',        Icon: Renew,       color: 'text-purple-400' },
  error:           { label: 'Fehler',        Icon: WarningAlt,  color: 'text-red-400' },
  info:            { label: 'Info',          Icon: Information, color: 'text-gray-400' },
};

const FILTERS = [
  { id: 'all',             label: 'Alle' },
  { id: 'email_received',  label: 'Empfangen' },
  { id: 'email_sent',      label: 'Gesendet' },
  { id: 'settings',        label: 'Einstellungen' },
  { id: 'update',          label: 'Updates' },
  { id: 'error',           label: 'Fehler' },
];

function formatDate(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString('de-CH', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  } catch { return iso; }
}

function Logbuch() {
  const { currentTheme } = useTheme();
  const c = currentTheme.colors;

  const [entries, setEntries] = useState([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.electronAPI.logGetAll();
      setEntries(res.entries || []);
    } catch (e) {
      console.error('[Logbuch] load error:', e);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleClear = () => setConfirmClear(true);

  const handleClearConfirmed = async () => {
    setConfirmClear(false);
    await window.electronAPI.logClear();
    setEntries([]);
  };

  const handleExport = () => {
    const lines = entries.map(e =>
      `[${formatDate(e.timestamp)}] [${(TYPE_CONFIG[e.type]?.label || e.type).toUpperCase()}] ${e.title}${e.detail ? ' — ' + e.detail : ''}`
    );
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `coremail-log-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filtered = entries.filter(e => {
    if (filter !== 'all' && e.type !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return e.title.toLowerCase().includes(q) || (e.detail || '').toLowerCase().includes(q);
    }
    return true;
  });

  const counts = {};
  FILTERS.forEach(f => {
    counts[f.id] = f.id === 'all' ? entries.length : entries.filter(e => e.type === f.id).length;
  });

  return (
    <div className={`flex flex-col h-full ${c.bg}`}>
      {/* Header */}
      <div className={`px-6 py-4 ${c.border} border-b flex items-center justify-between`}>
        <div>
          <h2 className={`text-xl font-bold ${c.text}`}>Logbuch</h2>
          <p className={`text-sm ${c.textSecondary} mt-0.5`}>
            {entries.length} Einträge protokolliert
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className={`p-2 rounded-lg ${c.hover} ${c.textSecondary} transition-colors`}
            title="Aktualisieren"
          >
            <Renew size={16} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={handleExport}
            className={`p-2 rounded-lg ${c.hover} ${c.textSecondary} transition-colors`}
            title="Als .txt exportieren"
          >
            <Download size={16} />
          </button>
          <button
            onClick={handleClear}
            className="p-2 rounded-lg hover:bg-red-500/20 text-red-400 transition-colors"
            title="Logbuch leeren"
          >
            <TrashCan size={16} />
          </button>
        </div>
      </div>

      {/* Filter + Suche */}
      <div className={`px-6 py-3 ${c.border} border-b space-y-3`}>
        {/* Suchfeld */}
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${c.bgSecondary} ${c.border} border`}>
          <Search size={16} className={`${c.textSecondary} flex-shrink-0`} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Einträge durchsuchen..."
            className={`flex-1 bg-transparent text-sm ${c.text} outline-none placeholder:${c.textSecondary}`}
          />
          {search && (
            <button onClick={() => setSearch('')} className={c.textSecondary}>
              <Close size={16} />
            </button>
          )}
        </div>
        {/* Filter-Chips */}
        <div className="flex flex-wrap gap-2">
          {FILTERS.map(f => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                filter === f.id
                  ? `${c.accentBg} text-white`
                  : `${c.bgSecondary} ${c.textSecondary} ${c.hover}`
              }`}
            >
              {f.label}
              {counts[f.id] > 0 && (
                <span className="ml-1.5 opacity-70">{counts[f.id]}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Bestätigungs-Dialog: Logbuch leeren */}
      {confirmClear && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className={`${c.bgSecondary} ${c.border} border rounded-xl p-6 shadow-2xl max-w-sm w-full mx-4`}>
            <h3 className={`text-lg font-semibold ${c.text} mb-2`}>Logbuch leeren?</h3>
            <p className={`text-sm ${c.textSecondary} mb-5`}>
              Alle {entries.length} Einträge werden unwiderruflich gelöscht.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmClear(false)}
                className={`px-4 py-2 rounded-lg ${c.bgTertiary} ${c.hover} ${c.text} text-sm transition-colors`}
              >
                Abbrechen
              </button>
              <button
                onClick={handleClearConfirmed}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm transition-colors"
              >
                Leeren
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Einträge */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className={`flex items-center justify-center h-32 ${c.textSecondary}`}>
            <Renew size={20} className="animate-spin mr-2" />
            Lade Logbuch...
          </div>
        ) : filtered.length === 0 ? (
          <div className={`flex flex-col items-center justify-center h-32 ${c.textSecondary}`}>
            <span className="text-3xl mb-2">📋</span>
            <span className="text-sm">Keine Einträge gefunden</span>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {filtered.map((entry, idx) => {
              const cfg = TYPE_CONFIG[entry.type] || TYPE_CONFIG.info;
              const isExpanded = expanded === entry.id;
              return (
                <div
                  key={entry.id}
                  className={`px-6 py-3 cursor-pointer transition-colors ${c.hover} ${
                    idx === 0 ? '' : ''
                  }`}
                  onClick={() => setExpanded(isExpanded ? null : entry.id)}
                >
                  <div className="flex items-start gap-3">
                    {/* Icon */}
                    {(() => { const CfgIcon = cfg.Icon; return <CfgIcon size={16} className={`mt-0.5 flex-shrink-0 ${cfg.color}`} />; })()}
                    {/* Inhalt */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-semibold ${cfg.color} uppercase tracking-wide`}>
                          {cfg.label}
                        </span>
                        <span className={`text-xs ${c.textSecondary}`}>
                          {formatDate(entry.timestamp)}
                        </span>
                      </div>
                      <p className={`text-sm ${c.text} mt-0.5 truncate`}>{entry.title}</p>
                      {entry.detail && isExpanded && (
                        <p className={`text-xs ${c.textSecondary} mt-1 whitespace-pre-wrap break-words`}>
                          {entry.detail}
                        </p>
                      )}
                      {entry.detail && !isExpanded && (
                        <p className={`text-xs ${c.textSecondary} mt-0.5 truncate`}>{entry.detail}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default Logbuch;
