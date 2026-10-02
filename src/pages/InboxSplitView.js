import React, { useState, useEffect, useCallback, useMemo, memo, useRef } from 'react';
import {
  TrashCan, Email, EmailNew, Renew, MailAll, Send, Document,
  WarningAlt, Archive, Folder, DragVertical, Security,
  CheckboxChecked, Checkbox, CloseFilled, ChevronDown, ChevronRight,
  Bullhorn, Misuse, Debug, Tag, Close, Checkmark, CheckmarkFilled, Reply, ReplyAll, SendAlt,
  Download, FolderOpen, Earth, InProgress, FolderAdd, Edit, WarningFilled, Time, Bot, Pin, Locked
} from '@carbon/icons-react';
import Attachment from '../components/PaperclipIcon';
import { useTheme } from '../context/ThemeContext';
import { useAccounts, useAccountStats } from '../context/AccountContext';
import MailApi from '../services/MailApi';
import LoadingSpinner from '../components/LoadingSpinner';
import EmailHtmlFrame from '../components/EmailHtmlFrame';
import SnoozeMenu from '../components/SnoozeMenu';
import EmailTagInput from '../components/EmailTagInput';
import InvitationCard from '../components/InvitationCard';
import { usePanelMode, PANEL_TRANSITION } from '../utils/usePanelMode';

// v6.6.2: Kollabierte Spaltenbreiten — schmal genug damit Icons noch klickbar sind
const FOLDER_COLLAPSED_WIDTH    = 48;
const EMAIL_LIST_COLLAPSED_WIDTH = 64;

// Deterministische Farb-Palette für Avatar-Hintergründe (Initiale-Avatare im
// kollabierten Mail-Listen-Modus). Hash auf Absender → stabile Farbe pro Person.
const AVATAR_COLORS = [
  'bg-cyan-600', 'bg-blue-600', 'bg-indigo-600', 'bg-violet-600',
  'bg-purple-600', 'bg-pink-600', 'bg-rose-600', 'bg-orange-600',
  'bg-amber-600', 'bg-emerald-600', 'bg-teal-600', 'bg-sky-600'
];
function avatarFor(email) {
  const raw = (email.fromName || email.from || '?').replace(/^["']+|["']+$/g, '').trim();
  // Erste sinnvolle Initiale: nicht von Adressen wie "<x@y>" verwirren
  const cleaned = raw.replace(/<[^>]*>/g, '').trim() || raw;
  const initial = (cleaned[0] || '?').toUpperCase();
  let h = 0;
  for (let i = 0; i < cleaned.length; i++) h = (h * 31 + cleaned.charCodeAt(i)) >>> 0;
  return { initial, color: AVATAR_COLORS[h % AVATAR_COLORS.length] };
}

// Kleines Mode-Toggle-Icon (Auto / Pinned / Closed)
const PanelModeToggle = ({ panel, c }) => {
  const Icon = panel.isPinned ? Pin : (panel.isClosed ? Locked : Pin);
  const colorClass = panel.isPinned ? c.accent : c.textSecondary;
  return (
    <button
      onClick={panel.cycleMode}
      title={panel.tooltip}
      aria-label={panel.tooltip}
      className={`p-1 rounded hover:bg-white/10 transition-colors ${colorClass}`}
    >
      <Icon size={14} className={panel.isAuto ? 'opacity-50' : ''} />
    </button>
  );
};
import { getCurrentFont } from './FontSettings';
import { analyzeEmails, getSpamFilterSettings, TAG_STYLES } from '../utils/SpamFilter';
import SenderCategoryManager from '../services/SenderCategoryManager';

// v2.4.0: Virtual Inbox Subfolders for automatic categorization
const INBOX_SUBFOLDERS = [
  { id: 'werbung', name: 'Werbung', icon: Bullhorn, color: 'text-orange-400', bgColor: 'bg-orange-500/20' },
  { id: 'spam', name: 'Spam', icon: Misuse, color: 'text-red-400', bgColor: 'bg-red-500/20' },
  { id: 'schaedlich', name: 'Schädlich', icon: WarningAlt, color: 'text-yellow-400', bgColor: 'bg-yellow-500/20' },
  { id: 'virus', name: 'Virus', icon: Debug, color: 'text-purple-400', bgColor: 'bg-purple-500/20' },
  { id: 'whitelist', name: 'Vertrauenswürdig', icon: CheckmarkFilled, color: 'text-green-400', bgColor: 'bg-green-500/20' },
];

// v2.6.0: Category definitions for manual categorization
const MANUAL_CATEGORIES = [
  { id: 'whitelist', name: 'Vertrauenswürdig', Icon: CheckmarkFilled, color: '#10B981', bgClass: 'bg-green-500', hoverClass: 'hover:bg-green-600' },
  { id: 'werbung', name: 'Werbung', Icon: Bullhorn, color: '#F59E0B', bgClass: 'bg-orange-500', hoverClass: 'hover:bg-orange-600' },
  { id: 'spam', name: 'Spam', Icon: Misuse, color: '#EF4444', bgClass: 'bg-red-500', hoverClass: 'hover:bg-red-600' },
  { id: 'schaedlich', name: 'Schädlich', Icon: WarningAlt, color: '#EAB308', bgClass: 'bg-yellow-500', hoverClass: 'hover:bg-yellow-600' },
  { id: 'virus', name: 'Virus', Icon: Debug, color: '#7C3AED', bgClass: 'bg-purple-500', hoverClass: 'hover:bg-purple-600' },
];

// v2.6.0: Category Buttons Component for manual email categorization
const CategoryButtons = memo(({ email, currentCategory, onCategorize, c }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const senderEmail = SenderCategoryManager.extractEmail(email?.from);
  const senderCategory = SenderCategoryManager.getSenderCategory(email?.from);
  
  // Kompakte einzeilige Leiste — die grossen Rahmen-Buttons nahmen zusammen
  // mit der Übersetzen-Zeile ~20% der Vorschau-Höhe ein, bevor Inhalt kam.
  return (
    <div className={`px-3 py-1.5 ${c.bgSecondary} ${c.border} border-t flex items-center gap-1.5 flex-wrap`}>
      <Tag size={14} className={`${c.textSecondary} flex-shrink-0`} title="Absender kategorisieren" />

      {MANUAL_CATEGORIES.map(cat => {
        const isActive = currentCategory === cat.id || senderCategory === cat.id;
        const CatIcon = cat.Icon;
        return (
          <button
            key={cat.id}
            onClick={() => onCategorize(email, cat.id)}
            className={`px-2 py-1 rounded-md text-xs font-medium flex items-center gap-1 transition-all border ${
              isActive
                ? `${cat.bgClass} text-white border-transparent`
                : `bg-transparent ${c.textSecondary} ${cat.hoverClass} hover:text-white`
            }`}
            style={{ borderColor: isActive ? 'transparent' : cat.color + '66' }}
            title={`Absender als ${cat.name} markieren`}
            aria-label={`Absender als ${cat.name} markieren`}
          >
            <CatIcon size={14} />
            <span>{cat.name}</span>
            {isActive && <Checkmark size={14} />}
          </button>
        );
      })}

      {/* Remove category button */}
      {(currentCategory || senderCategory) && (
        <button
          onClick={() => onCategorize(email, null)}
          className={`px-2 py-1 rounded-md text-xs font-medium flex items-center gap-1 transition-all border ${c.border} ${c.textSecondary} ${c.hover}`}
          title="Kategorie entfernen"
          aria-label="Kategorie entfernen"
        >
          <Close size={14} />
          <span>Entfernen</span>
        </button>
      )}

      {/* Sender info */}
      {senderCategory && (
        <div className={`text-xs ${c.textSecondary} ml-auto hidden lg:flex items-center gap-1`}>
          <span>Absender gemerkt:</span>
          <span className={`px-2 py-0.5 rounded-full ${
            INBOX_SUBFOLDERS.find(f => f.id === senderCategory)?.bgColor || 'bg-gray-500/20'
          } ${
            INBOX_SUBFOLDERS.find(f => f.id === senderCategory)?.color || 'text-gray-400'
          }`}>
            {MANUAL_CATEGORIES.find(c => c.id === senderCategory)?.name || senderCategory}
          </span>
        </div>
      )}
    </div>
  );
});

// Übersetzen-Button mit Dropdown + Ergebnisanzeige
const TranslateBar = memo(({ email, c }) => {
  const [enabledLanguages, setEnabledLanguages] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null); // { lang, text } | null
  const [error, setError] = useState(null);
  const dropdownRef = useRef(null);

  const LANG_NAMES = {
    DE:'Deutsch', EN:'Englisch', FR:'Französisch', IT:'Italienisch',
    ES:'Spanisch', PT:'Portugiesisch', NL:'Niederländisch', PL:'Polnisch',
    RU:'Russisch', ZH:'Chinesisch', JA:'Japanisch', TR:'Türkisch',
    AR:'Arabisch', UK:'Ukrainisch',
  };

  useEffect(() => {
    const load = async () => {
      const s = await window.electronAPI?.translationGetSettings?.();
      setEnabledLanguages(s?.enabledLanguages || []);
    };
    load();
  }, []);

  // Reset on email change
  useEffect(() => { setResult(null); setError(null); }, [email?.uid]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const translate = async (lang) => {
    setOpen(false);
    setLoading(true);
    setError(null);
    setResult(null);
    const text = email?.text || email?.html?.replace(/<[^>]*>/g, '') || '';
    const res = await window.electronAPI?.translationTranslate?.({ text, targetLang: lang });
    setLoading(false);
    if (res?.success) {
      setResult({ lang, text: res.translatedText });
    } else {
      setError(res?.error || 'Übersetzung fehlgeschlagen');
    }
  };

  if (enabledLanguages.length === 0) return null;

  return (
    <>
      <div className={`px-3 py-1.5 ${c.bgSecondary} ${c.border} border-t flex items-center gap-2 flex-wrap`}>
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setOpen(o => !o)}
            disabled={loading}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors ${c.bgTertiary} ${c.border} border ${c.textSecondary} ${c.hover} disabled:opacity-50`}
            title="Mail übersetzen"
          >
            {loading ? <Renew size={14} className="animate-spin" /> : <Earth size={14} />}
            <span>{loading ? 'Übersetze...' : result ? `Übersetzt → ${result.lang}` : 'Übersetzen'}</span>
            <ChevronDown size={14} className="opacity-60" />
          </button>

          {open && (
            <div className={`absolute top-full left-0 mt-1 z-50 min-w-[160px] rounded-xl shadow-xl ${c.bg} ${c.border} border py-1`}>
              {enabledLanguages.map(code => (
                <button
                  key={code}
                  onClick={() => translate(code)}
                  className={`w-full text-left px-3 py-2 text-sm ${c.text} ${c.hover} flex items-center justify-between gap-4`}
                >
                  <span>{LANG_NAMES[code] || code}</span>
                  <span className={`text-xs ${c.textSecondary}`}>{code}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {result && (
          <button
            onClick={() => setResult(null)}
            className={`ml-auto text-xs ${c.textSecondary} ${c.hover} px-2 py-1 rounded flex items-center gap-1`}
          >
            <Close size={14} /> Übersetzung schließen
          </button>
        )}
      </div>

      {/* Übersetzungs-Ergebnis */}
      {(result || error) && (
        <div className={`mx-4 mt-4 rounded-xl border ${c.border} overflow-hidden`}>
          <div className={`px-4 py-2 ${c.bgSecondary} flex items-center gap-2 border-b ${c.border}`}>
            <Earth size={16} className={c.accent} />
            <span className={`text-sm font-medium ${c.text}`}>
              {result ? `Übersetzung → ${LANG_NAMES[result.lang] || result.lang}` : 'Übersetzungsfehler'}
            </span>
          </div>
          <div className="p-4">
            {error
              ? <p className="text-sm text-red-400">{error}</p>
              : <p className={`text-sm ${c.text} whitespace-pre-wrap leading-relaxed`}>{result.text}</p>
            }
          </div>
        </div>
      )}
    </>
  );
});

// v1.11.1: Google Fonts list for email content styling
const GOOGLE_FONTS = {
  'inter': 'Inter',
  'roboto': 'Roboto',
  'opensans': 'Open Sans',
  'lato': 'Lato',
  'montserrat': 'Montserrat',
  'poppins': 'Poppins',
  'sourcesans': 'Source Sans 3',
  'raleway': 'Raleway',
  'ubuntu': 'Ubuntu',
  'nunito': 'Nunito',
  'firacode': 'Fira Code',
  'jetbrains': 'JetBrains Mono'
};

// Folder column width constants (v1.8.1)
const FOLDER_MIN_WIDTH = 150;
const FOLDER_MAX_WIDTH = 350;
const FOLDER_DEFAULT_WIDTH = 192;

// v1.12.2: Email list column width constants (resizable)
const EMAIL_LIST_MIN_WIDTH = 100;
const EMAIL_LIST_MAX_WIDTH = 600;
const EMAIL_LIST_DEFAULT_WIDTH = 350;

// v1.12.0: Preview column width constants (reduced min from 200 to 100)
const PREVIEW_MIN_WIDTH = 100;
const PREVIEW_MAX_WIDTH = 800;
const PREVIEW_DEFAULT_WIDTH = 450;

// Email cache for performance (v1.8.0)
const emailCache = new Map();

// v7.0: LRU-Cache für vollständig geladene Mails (Vorschau) — Wiederanklicken
// ist damit sofort, statt jedes Mal die Roh-Mail inkl. Anhängen zu laden.
// Bewusst klein gehalten, weil Mails mit Base64-Anhängen mehrere MB wiegen können.
const previewCache = new Map();
const PREVIEW_CACHE_MAX = 15;

// v7.1: Gesendet-Ordner-Pfad pro IMAP-Konto (für "Gesendet (alle Konten)") —
// einmal pro Sitzung über die Ordnerliste aufgelöst (SPECIAL-USE \Sent bevorzugt)
const sentFolderCache = new Map();
async function resolveSentFolder(acc) {
  if (sentFolderCache.has(acc.id)) return sentFolderCache.get(acc.id);
  let path = null;
  try {
    const r = await window.electronAPI.listFolders(acc.id);
    const flat = (r?.folders || []).flatMap(f => [f, ...(f.children || [])]);
    const hit = flat.find(f => f.specialUse === 'sent') || flat.find(f => f.type === 'sent');
    path = hit?.path || null;
  } catch (_) { /* Konto nicht erreichbar — überspringen */ }
  sentFolderCache.set(acc.id, path);
  return path;
}
const folderCache = new Map();
const CACHE_TTL = 15 * 60 * 1000; // 15 Minuten


// v1.8.2: IndexedDB for local email storage
const DB_NAME = 'CoreMailDB';
const DB_VERSION = 1;

const openEmailDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('emails')) {
        const store = db.createObjectStore('emails', { keyPath: 'id' });
        store.createIndex('accountId', 'accountId', { unique: false });
        store.createIndex('folder', 'folder', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
};

const MAX_EMAILS_INDEXED_DB = 500;

// Custom event to surface IndexedDB quota errors to the UI
const INDEXEDDB_QUOTA_EVENT = 'coremail:indexeddb-quota';

const saveEmailsToIndexedDB = async (accountId, folder, emails) => {
  try {
    const db = await openEmailDB();
    const tx = db.transaction('emails', 'readwrite');
    const store = tx.objectStore('emails');
    // Perf: cap at 500 most recent — prevents IndexedDB from growing unboundedly
    const trimmed = emails.length > MAX_EMAILS_INDEXED_DB ? emails.slice(0, MAX_EMAILS_INDEXED_DB) : emails;
    await store.put({ id: `${accountId}:${folder}`, accountId, folder, emails: trimmed, timestamp: Date.now() });
    db.close();
  } catch (e) {
    if (e?.name === 'QuotaExceededError' || e?.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
      window.dispatchEvent(new CustomEvent(INDEXEDDB_QUOTA_EVENT));
    }
    console.error('Failed to save to IndexedDB:', e);
  }
};

const loadEmailsFromIndexedDB = async (accountId, folder) => {
  try {
    const db = await openEmailDB();
    const tx = db.transaction('emails', 'readonly');
    const store = tx.objectStore('emails');
    
    const id = `${accountId}:${folder}`;
    const result = await new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    
    db.close();
    return result;
  } catch (e) {
    console.error('Failed to load from IndexedDB:', e);
    return null;
  }
};

// v1.12.1: Remove deleted email from IndexedDB to prevent re-fetching
const removeEmailFromIndexedDB = async (accountId, folder, uid) => {
  try {
    const db = await openEmailDB();
    const tx = db.transaction('emails', 'readwrite');
    const store = tx.objectStore('emails');
    
    const id = `${accountId}:${folder}`;
    const result = await new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    
    if (result && result.emails) {
      // Filter out the deleted email
      result.emails = result.emails.filter(e => e.uid !== uid);
      result.timestamp = Date.now();
      await store.put(result);
    }
    
    db.close();
  } catch (e) {
    console.error('Failed to remove email from IndexedDB:', e);
  }
};

// v1.14.0: Spam Tag Badge component
const SpamTagBadge = memo(({ category }) => {
  if (!category || category === 'sicher') return null;
  const style = TAG_STYLES[category];
  if (!style) return null;
  
  return (
    <span 
      className={`inline-flex items-center px-1.5 py-0.5 text-xs rounded-full font-medium border ${style.bgColor} ${style.textColor} ${style.borderColor}`}
      title={style.description}
    >
      {style.label}
    </span>
  );
});

// v2.3.0: Improved Email List Item with multi-select checkbox
// v1.14.0: Added spam filter tags
// v6.6.0: Triage-Badge mit Farb-Codierung der AI-Kategorisierung
const TRIAGE_STYLE = {
  urgent:        { bg: 'bg-red-500/15',    text: 'text-red-300',    label: 'Dringend' },
  important:     { bg: 'bg-amber-500/15',  text: 'text-amber-300',  label: 'Wichtig' },
  informational: { bg: 'bg-cyan-500/15',   text: 'text-cyan-300',   label: 'Info' },
  newsletter:    { bg: 'bg-slate-500/15',  text: 'text-slate-300',  label: 'Newsletter' },
  automated:     { bg: 'bg-gray-500/15',   text: 'text-gray-300',   label: 'Auto' }
};
const TriageBadge = memo(({ triage }) => {
  if (!triage?.category) return null;
  const s = TRIAGE_STYLE[triage.category];
  if (!s) return null;
  return (
    <span
      className={`px-1.5 py-0.5 ${s.bg} ${s.text} text-xs rounded-full font-medium`}
      title={triage.reasoning ? `${triage.reasoning} (${Math.round((triage.confidence || 0) * 100)}%)` : ''}
    >
      {s.label}
    </span>
  );
});

const EmailListItem = memo(({ email, index, isSelected, isChecked, onSelect, onCheckboxChange, onDelete, onArchive, onToggleRead, c, actionLoading, spamAnalysis, showCheckboxes, isSentFolder, onDragStart, triage }) => {
  const isUnread = !email.seen;
  const spamCategory = spamAnalysis?.category;
  const spamTags = spamAnalysis?.tags || [];
  const displayAddress = isSentFolder ? (email.to || email.from) : email.from;
  
  // v1.14.0: Border color based on spam category
  const getBorderColor = () => {
    if (spamCategory === 'virus') return 'border-l-red-600';
    if (spamCategory === 'schaedlich') return 'border-l-yellow-500';
    if (spamCategory === 'spam') return 'border-l-red-400';
    if (spamCategory === 'werbung') return 'border-l-orange-400';
    if (spamCategory === 'whitelist') return 'border-l-green-500';
    if (isUnread) return 'border-l-blue-500';
    return 'border-l-transparent';
  };
  
  // v2.3.0: Handle checkbox click
  const handleCheckboxClick = (e) => {
    e.stopPropagation();
    onCheckboxChange(email.uid, e.shiftKey);
  };
  
  return (
    <div
      onClick={() => onSelect(index)}
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart?.(email); }}
      className={`cm-list-item p-3 cursor-pointer ${c.border} border-b relative group select-none
        ${isSelected
          ? `${c.bgTertiary} shadow-[inset_3px_0_0_0] shadow-cyan-500`
          : isChecked
          ? 'bg-cyan-500/10 shadow-[inset_3px_0_0_0] shadow-cyan-400'
          : isUnread
          ? `bg-blue-500/5 hover:bg-blue-500/10 shadow-[inset_3px_0_0_0] shadow-blue-500`
          : `${c.hover} shadow-[inset_3px_0_0_0] shadow-transparent hover:shadow-white/10`}
        ${!isSelected ? getBorderColor() : ''}
      `}
    >
      {/* Outlook-Layout: Absender + Datum in Zeile 1, Betreff in Zeile 2,
          Vorschau + Badges in Zeile 3. Ungelesen = fetter Absender, farbiger
          Betreff, blauer Seitenbalken — kein "Neu"-Badge mehr. */}
      <div className="flex items-start gap-2">
        {/* v2.3.0: Checkbox for multi-select */}
        {showCheckboxes && (
          <div
            className="flex-shrink-0 mt-0.5"
            onClick={handleCheckboxClick}
          >
            {isChecked ? (
              <CheckboxChecked size={20} className={`${c.accent} cursor-pointer`} />
            ) : (
              <Checkbox size={20} className={`${c.textSecondary} hover:${c.accent} cursor-pointer`} />
            )}
          </div>
        )}

        <div className="flex-1 min-w-0 overflow-hidden">
          {/* Zeile 1: Absender + Anhang-Indikator + Datum rechts */}
          <div className="flex items-baseline justify-between gap-2">
            <span className={`text-sm truncate ${isUnread ? `font-semibold ${c.text}` : `font-medium ${c.text}`}`}>
              {isSentFolder && <span className={`text-xs ${c.textSecondary}`}>An: </span>}
              {displayAddress}
            </span>
            <span className="flex items-center gap-1.5 flex-shrink-0">
              {/* v6.14.0: Anhänge deutlich kennzeichnen — wurden vorher in
                  der Liste gar nicht angezeigt und darum leicht übersehen */}
              {(email.hasAttachments || email.hasAttachment) && (
                <Attachment size={14} className="text-amber-400 flex-shrink-0" aria-label="Enthält Anhang" />
              )}
              <span
                className={`text-xs group-hover:invisible ${isUnread ? 'text-blue-400 font-medium' : c.textSecondary}`}
                title={new Date(email.date).toLocaleString('de-DE')}
              >
                {formatListDate(email.date)}
              </span>
            </span>
          </div>

          {/* Zeile 2: Betreff (+ Konto-Badge im Alle-Konten-Modus) */}
          <div className="flex items-center gap-2 mt-0.5">
            <span className={`text-sm truncate flex-1 min-w-0 ${isUnread ? `${c.accent} font-medium` : c.textSecondary}`}>
              {email.subject}
            </span>
            {email.__accName && (
              <span
                className="px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 text-white/90"
                style={{ backgroundColor: `hsl(${[...email.__accName].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7)} 45% 38%)` }}
                title={email.__accName}
              >
                {email.__accName.length > 14 ? email.__accName.slice(0, 13) + '…' : email.__accName}
              </span>
            )}
          </div>

          {/* Zeile 3: Vorschau + Badges (nur wenn vorhanden) */}
          {(email.preview || (spamCategory && spamCategory !== 'sicher' && spamCategory !== 'whitelist') || triage) && (
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`text-xs ${c.textSecondary} truncate flex-1 min-w-0`}>
                {email.preview}
              </span>
              {spamCategory && spamCategory !== 'sicher' && spamCategory !== 'whitelist' && (
                <SpamTagBadge category={spamCategory} />
              )}
              <TriageBadge triage={triage} />
            </div>
          )}
        </div>
      </div>

      {/* Quick Actions als Overlay oben rechts (verdeckt beim Hovern das Datum,
          statt in jeder Zeile dauerhaft Platz zu reservieren) */}
      <div className={`absolute right-2 top-2 hidden group-hover:flex items-center gap-1 ${c.bgSecondary} rounded-md shadow px-0.5`}>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleRead(email.uid, email.seen); }}
          className={`p-1.5 ${c.hover} rounded transition-colors ${c.textSecondary} hover:${c.text}`}
          title={email.seen ? 'Als ungelesen markieren' : 'Als gelesen markieren'}
          aria-label={email.seen ? 'Als ungelesen markieren' : 'Als gelesen markieren'}
        >
          {actionLoading === `read-${email.uid}` ? (
            <InProgress size={16} className="animate-spin" />
          ) : email.seen ? (
            <EmailNew size={16} />
          ) : (
            <Email size={16} />
          )}
        </button>
        {/* v6.10.0: Archivieren direkt aus der Zeile (Kürzel: E) */}
        <button
          onClick={(e) => { e.stopPropagation(); onArchive(email.uid); }}
          className={`p-1.5 ${c.hover} rounded transition-colors ${c.textSecondary} hover:${c.text}`}
          title="Archivieren (E)"
          aria-label="Archivieren"
        >
          {actionLoading === `archive-${email.uid}` ? (
            <InProgress size={16} className="animate-spin" />
          ) : (
            <Archive size={16} />
          )}
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(email.uid); }}
          className={`p-1.5 ${c.hover} rounded transition-colors text-red-400 hover:text-red-300 hover:bg-red-900/20`}
          title="Löschen"
          aria-label="Löschen"
        >
          {actionLoading === `delete-${email.uid}` ? (
            <InProgress size={16} className="animate-spin" />
          ) : (
            <TrashCan size={16} />
          )}
        </button>
      </div>
    </div>
  );
});

// Intelligente Datumsanzeige wie in gängigen Mail-Clients: heute nur die
// Uhrzeit, gestern "Gestern", dieses Jahr "2. Juli", älter mit Jahr.
const formatListDate = (dateVal) => {
  const d = new Date(dateVal);
  if (isNaN(d)) return '';
  const now = new Date();
  const sameDay = (a, b) =>
    a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear();
  if (sameDay(d, now)) {
    return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return 'Gestern';
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
  }
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
};

// "Name <mail@x>" → "mail@x" (für die Reply-Empfänger-Tags)
const extractEmailAddr = (s) => {
  const m = String(s || '').match(/<([^>]+)>/);
  return (m ? m[1] : String(s || '')).trim();
};

// Outlook-artige Datums-Gruppen für die Mail-Liste (Liste ist neueste zuerst)
const dateGroupOf = (dateVal) => {
  const d = new Date(dateVal);
  if (isNaN(d)) return 'Älter';
  const now = new Date();
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (diffDays <= 0) return 'Heute';
  if (diffDays === 1) return 'Gestern';
  if (diffDays < 7) return 'Diese Woche';
  if (diffDays < 14) return 'Letzte Woche';
  if (diffDays < 31) return 'Dieser Monat';
  return 'Älter';
};

// Folder icon helper
const getFolderIcon = (type) => {
  switch (type) {
    case 'inbox': return <MailAll size={16} />;
    case 'sent': case 'sentitems': return <Send size={16} />;
    case 'drafts': return <Document size={16} />;
    case 'trash': case 'deleteditems': return <TrashCan size={16} />;
    case 'spam': case 'junkemail': return <WarningAlt size={16} />;
    case 'archive': return <Archive size={16} />;
    default: return <Folder size={16} />;
  }
};


function InboxSplitView({ onFullView, onNavigate, onForward }) {
  const { currentTheme } = useTheme();
  const { activeAccountId, getActiveAccount, accounts, updateAccountStats } = useAccounts();
  // v7.0: Vereinheitlichter Posteingang — '__ALL__' ist ein virtueller Modus,
  // der die INBOX aller Konten zusammenführt. Mails tragen dann __accId/__accName
  // und eine zusammengesetzte uid (`kontoId::uid`), weil IMAP-UIDs zwischen
  // Konten kollidieren können; die Original-UID liegt in origUid.
  const allMode = activeAccountId === '__ALL__';
  const accountFor = useCallback((mailObj) => {
    if (mailObj?.__accId) return accounts.find(a => a.id === mailObj.__accId) || null;
    return getActiveAccount();
  }, [accounts, getActiveAccount]);
  const [emails, setEmails] = useState([]);
  const [folders, setFolders] = useState([]);
  const [currentFolder, setCurrentFolder] = useState('INBOX');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [selectedEmail, setSelectedEmail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState(null); // { uid, message } | null
  const [replySentToast, setReplySentToast] = useState(false);
  const [confirmDeleteUid, setConfirmDeleteUid] = useState(null); // Einzel-Löschen bestätigen
  const [confirmDiscardReply, setConfirmDiscardReply] = useState(false);
  const [headerExpanded, setHeaderExpanded] = useState(false); // An/Cc-Liste aufgeklappt
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [folderError, setFolderError] = useState(null);
  // Folder management modals
  const [folderModal, setFolderModal] = useState(null); // { mode:'create'|'rename'|'delete', folder?: obj }
  const [folderModalInput, setFolderModalInput] = useState('');
  const [folderModalLoading, setFolderModalLoading] = useState(false);
  const [folderModalError, setFolderModalError] = useState(null);
  const [hoveredFolder, setHoveredFolder] = useState(null);
  const [error, setError] = useState(null);
  // v6.9.6: Aktionsfehler (Löschen, Markieren, Snooze, Triage) landen in einem
  // Toast — vorher ersetzte setError() die komplette Inbox durch den
  // Vollbild-Screen "Verbindung fehlgeschlagen".
  const [actionToast, setActionToast] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [bgLoadOffset, setBgLoadOffset] = useState(50);
  const [loadingMore, setLoadingMore] = useState(false);
  // Abort signal for background batch loading — set to true when account/folder changes
  const bgLoadAbortRef = useRef(false);
  // Race-guard for loadEmailPreview: tracks the uid of the most-recently requested preview
  const previewRequestIdRef = useRef(null);
  // v7.0: Versionszähler gegen Stale-Writes von fetchEmails nach Modus-/Kontowechsel
  const fetchVersionRef = useRef(0);
  // v4.5.6: Version counter to prevent stale loadFolders from overwriting current account's folders
  const folderLoadVersionRef = useRef(0);
  // Scrollable email list container ref (for keyboard-nav scroll)
  const emailScrollRef = useRef(null);
  const c = currentTheme.colors;
  
  // v2.3.0: Multi-Select State
  const [selectedUids, setSelectedUids] = useState(new Set());
  const [showCheckboxes, setShowCheckboxes] = useState(false);
  const [lastClickedIndex, setLastClickedIndex] = useState(null);

  // Aktionsfehler-Toast automatisch ausblenden — mit Undo etwas länger,
  // damit "Rückgängig" realistisch klickbar bleibt
  useEffect(() => {
    if (!actionToast) return;
    const t = setTimeout(() => setActionToast(null), actionToast.undo ? 8000 : 6000);
    return () => clearTimeout(t);
  }, [actionToast]);

  // v6.11.0: Undo-Toast bei Ordner-/Kontowechsel räumen — der Undo-Callback
  // hält die fetchEmails-Identität des ALTEN Kontexts und würde nach dem
  // Wechsel die fremde Mailliste in die aktuelle Ansicht schreiben.
  useEffect(() => {
    setActionToast(null);
  }, [activeAccountId, currentFolder]);

  // Refs spiegeln häufig wechselnden State, damit die Row-Callbacks
  // (onSelect/onToggleRead/onDelete) stabile Identität behalten — sonst
  // re-rendert jede Selektion sämtliche memoisierten EmailListItem-Rows.
  const emailsRef = useRef(emails);
  emailsRef.current = emails;
  const selectedEmailRef = useRef(selectedEmail);
  selectedEmailRef.current = selectedEmail;
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;
  const lastClickedIndexRef = useRef(lastClickedIndex);
  lastClickedIndexRef.current = lastClickedIndex;
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  
  // v2.4.0: Inbox Subfolder Filter State
  const [categoryFilter, setCategoryFilter] = useState(null); // null = alle, 'werbung', 'spam', 'schaedlich', 'virus'
  const [inboxExpanded, setInboxExpanded] = useState(true);
  const [collapsedFolders, setCollapsedFolders] = useState(new Set());
  const toggleFolderCollapsed = (path) => {
    setCollapsedFolders(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  
  // v2.6.0: Manual sender-based categorization state
  const [manualCategories, setManualCategories] = useState(new Map()); // uid -> category

  // Drag & Drop state
  const [draggedEmail, setDraggedEmail] = useState(null);
  const [dragOverFolder, setDragOverFolder] = useState(null);

  // v2.9.3: Inline reply state
  const [replyMode, setReplyMode] = useState(null); // null | 'reply' | 'replyAll'
  // v7.0: Kürzel-Hilfe (?-Taste) + stabiler Zugriff auf handleSendReply aus
  // dem Keyboard-Effekt (Cmd+Enter), ohne dessen Deps aufzublähen
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const sendReplyRef = useRef(null);
  // v6.9.1: Empfänger im Inline-Reply editierbar (An + CC, mit Autocomplete)
  const [replyToTags, setReplyToTags] = useState([]);
  const [replyCcTags, setReplyCcTags] = useState([]);
  const [replyShowCc, setReplyShowCc] = useState(false);
  const [replySending, setReplySending] = useState(false);
  // v7.0: synchroner Reentry-Schutz für Cmd+Enter (State wäre einen Render zu spät)
  const replySendingRef = useRef(false);
  const [replyError, setReplyError] = useState(null);
  const [replyAttachments, setReplyAttachments] = useState([]);
  const replyFileInputRef = useRef(null);
  // v7.3.0: Dateien per Drag & Drop ins Antwort-Panel ziehen — Zähler statt
  // Boolean, weil dragenter/dragleave auch beim Überfahren von Kindelementen feuern.
  const [replyDragging, setReplyDragging] = useState(false);
  const replyDragDepthRef = useRef(0);

  // Toast for IndexedDB quota warning
  const [showQuotaWarning, setShowQuotaWarning] = useState(false);
  const replyEditorRef = useRef(null);

  // v3.0.2: Attachment download/open state for split-view
  const [attachProgress, setAttachProgress] = useState({});

  // v1.14.0: Spam filter analysis results (moved up to avoid TDZ in filteredEmails)
  const [spamResults, setSpamResults] = useState(new Map());

  // v6.6.0: AI-Triage — Map<uid, {category, confidence, reasoning, signals, ts}>
  const [triageMap, setTriageMap] = useState(() => new Map());
  const [triageRunning, setTriageRunning] = useState(false);
  const [triageProgress, setTriageProgress] = useState(null); // {processed, total} | null

  // v6.6.2: Hover-Expand für Folder- und Mail-Listen-Spalten
  const folderPanel   = usePanelMode('panel.folderColumn',   'auto');
  const mailListPanel = usePanelMode('panel.mailListColumn', 'auto');

  // v6.6.0: Snooze — Set von "accountId|folder|uid", die aktuell gesnoozt sind.
  // Filtert betroffene Mails aus dem Inbox-View. Wird per IPC bei Mount,
  // Account-/Folder-Wechsel und beim 'snooze:woke'-Event aktualisiert.
  const [snoozedKeys, setSnoozedKeys] = useState(() => new Set());
  const [snoozeMenuOpen, setSnoozeMenuOpen] = useState(false);
  const [snoozeAnchorRect, setSnoozeAnchorRect] = useState(null);
  const snoozeBtnRef = useRef(null);
  
  // Resizable folder column (v1.8.1)
  const [folderWidth, setFolderWidth] = useState(() => {
    const saved = localStorage.getItem('inbox.folderColumnWidth');
    return saved ? parseInt(saved, 10) : FOLDER_DEFAULT_WIDTH;
  });
  const [isResizingFolder, setIsResizingFolder] = useState(false);
  
  // v1.12.2: Resizable email list column
  const [emailListWidth, setEmailListWidth] = useState(() => {
    const saved = localStorage.getItem('inbox.emailListColumnWidth');
    return saved ? parseInt(saved, 10) : EMAIL_LIST_DEFAULT_WIDTH;
  });
  const [isResizingEmailList, setIsResizingEmailList] = useState(false);
  
  // v1.11.0: Resizable preview column
  const [previewWidth, setPreviewWidth] = useState(() => {
    const saved = localStorage.getItem('inbox.previewColumnWidth');
    return saved ? parseInt(saved, 10) : PREVIEW_DEFAULT_WIDTH;
  });
  const [isResizingPreview, setIsResizingPreview] = useState(false);
  
  // Handle column resize — rAF-throttled to avoid 60 setState/sec
  useEffect(() => {
    if (!isResizingFolder && !isResizingEmailList && !isResizingPreview) return;

    let frameId = null;
    let lastClientX = 0;

    const handleMouseMove = (e) => {
      lastClientX = e.clientX;
      if (frameId) return;
      frameId = requestAnimationFrame(() => {
        frameId = null;
        if (isResizingFolder) {
          setFolderWidth(Math.max(FOLDER_MIN_WIDTH, Math.min(FOLDER_MAX_WIDTH, lastClientX - 60)));
        }
        if (isResizingEmailList) {
          setEmailListWidth(Math.max(EMAIL_LIST_MIN_WIDTH, Math.min(EMAIL_LIST_MAX_WIDTH, lastClientX - 60 - folderWidth)));
        }
        if (isResizingPreview) {
          setPreviewWidth(Math.max(PREVIEW_MIN_WIDTH, Math.min(PREVIEW_MAX_WIDTH, window.innerWidth - lastClientX)));
        }
      });
    };

    const handleMouseUp = () => {
      if (frameId) { cancelAnimationFrame(frameId); frameId = null; }
      if (isResizingFolder) { setIsResizingFolder(false); localStorage.setItem('inbox.folderColumnWidth', folderWidth.toString()); }
      if (isResizingEmailList) { setIsResizingEmailList(false); localStorage.setItem('inbox.emailListColumnWidth', emailListWidth.toString()); }
      if (isResizingPreview) { setIsResizingPreview(false); localStorage.setItem('inbox.previewColumnWidth', previewWidth.toString()); }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    return () => {
      if (frameId) cancelAnimationFrame(frameId);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizingFolder, isResizingEmailList, isResizingPreview, folderWidth, emailListWidth, previewWidth]);

  // Generate cache key
  const getCacheKey = useCallback((accountId, folder) => `${accountId}:${folder}`, []);

  // v2.9.0: Helper to check if current account uses Microsoft Graph API
  const isGraphAccount = useCallback(() => {
    const acc = getActiveAccount();
    return acc?.type === 'microsoft';
  }, [getActiveAccount]);

  // Drag & Drop: move email to folder (optimistic UI + rollback)
  const handleDropOnFolder = useCallback(async (targetFolder) => {
    setDragOverFolder(null);
    if (!draggedEmail || targetFolder === currentFolder) return;
    const email = draggedEmail;
    setDraggedEmail(null);
    setEmails(prev => prev.filter(e => e.uid !== email.uid)); // optimistic remove
    try {
      const result = await MailApi.move(getActiveAccount(), email.uid, currentFolder, targetFolder);
      if (!result?.success) setEmails(prev => [email, ...prev]); // rollback
    } catch {
      setEmails(prev => [email, ...prev]); // rollback
    }
  }, [draggedEmail, currentFolder, activeAccountId, getActiveAccount]);

  // Load folders for account (forceRefresh = bypass cache)
  // v4.5.6: version check prevents a stale async call (e.g. slow IMAP) from
  // overwriting the folders of a newer account after the user switches accounts.
  const loadFolders = useCallback(async (forceRefresh = false) => {
    if (!window.electronAPI || !activeAccountId) return;

    // v7.0: Alle-Konten-Modus zeigt zusammengeführte Ansichten — Ordnerlisten
    // sind pro Konto und hier bewusst auf die zwei Sammel-Ansichten reduziert.
    // v7.1: zusätzlich "Gesendet (alle Konten)" — damit ist Gesendetes aller
    // Konten (egal von welchem Rechner versendet) an EINER Stelle sichtbar.
    if (allMode) {
      setFolders([
        { name: 'Posteingang (alle Konten)', path: 'INBOX', type: 'inbox', children: [], unread: 0 },
        { name: 'Gesendet (alle Konten)', path: 'SENT_ALL', type: 'sent', children: [], unread: 0 },
      ]);
      setLoadingFolders(false);
      setFolderError(null);
      return;
    }

    // Capture the current version at call-start; if it changes before we write
    // state, a newer loadFolders is already running — discard this result.
    const myVersion = ++folderLoadVersionRef.current;

    const cacheKey = `folders:${activeAccountId}`;
    if (!forceRefresh) {
      const cached = folderCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        if (folderLoadVersionRef.current !== myVersion) return;
        setFolders(cached.data);
        return;
      }
    }

    setLoadingFolders(true);
    setFolderError(null);
    try {
      let result;
      if (isGraphAccount()) {
        // Fallback folders shown immediately so sidebar is never empty
        const GRAPH_DEFAULT_FOLDERS = [
          { name: 'Posteingang', path: 'INBOX',   type: 'inbox',        children: [], unread: 0 },
          { name: 'Gesendet',    path: 'Sent',    type: 'sentitems',    children: [], unread: 0 },
          { name: 'Entwürfe',    path: 'Drafts',  type: 'drafts',       children: [], unread: 0 },
          { name: 'Gelöscht',    path: 'Deleted', type: 'deleteditems', children: [], unread: 0 },
          { name: 'Junk',        path: 'Junk',    type: 'junkemail',    children: [], unread: 0 },
        ];
        if (folderLoadVersionRef.current !== myVersion) return;
        setFolders(GRAPH_DEFAULT_FOLDERS);

        // Load real folders from Graph API (includes custom folders + unread counts)
        result = await window.electronAPI.listGraphFolders(activeAccountId);

        // Stale check: a newer account's loadFolders may have started while we waited
        if (folderLoadVersionRef.current !== myVersion) return;

        if (result?.error === 'TOKEN_EXPIRED') {
          setError('Microsoft-Token abgelaufen. Bitte Konto erneut verbinden (Einstellungen → Kontenverwaltung).');
          setLoadingFolders(false);
          return;
        }
        if (result.success && result.folders && result.folders.length > 0) {
          const WELLKNOWN_PATH = {
            inbox: 'INBOX', sentitems: 'Sent', drafts: 'Drafts',
            deleteditems: 'Deleted', junkemail: 'Junk', archive: 'Archive'
          };
          const normalizeFolder = (f) => ({
            name: f.name,
            path: WELLKNOWN_PATH[f.type] || f.path,
            type: f.type,
            unread: f.unread || 0,
            children: (f.children || []).map(normalizeFolder),
          });
          const normalized = result.folders.filter(f => !f.isHidden).map(normalizeFolder);
          setFolders(normalized);
          folderCache.set(cacheKey, { data: normalized, timestamp: Date.now() });
        } else if (!result.success) {
          setFolderError(result.error || 'Ordner konnten nicht geladen werden');
          console.error('[Folders] Graph Ordner Fehler:', result.error);
        }
      } else {
        result = await window.electronAPI.listFolders(activeAccountId);
        if (folderLoadVersionRef.current !== myVersion) return;
        if (result.success && result.folders?.length > 0) {
          setFolders(result.folders);
          folderCache.set(cacheKey, { data: result.folders, timestamp: Date.now() });
        } else {
          const IMAP_DEFAULT_FOLDERS = [
            { name: 'Posteingang', path: 'INBOX',        type: 'inbox',  children: [], unread: 0 },
            { name: 'Gesendet',    path: 'Sent',         type: 'sent',   children: [], unread: 0 },
            { name: 'Entwürfe',    path: 'Drafts',       type: 'drafts', children: [], unread: 0 },
            { name: 'Gelöscht',    path: 'Trash',        type: 'trash',  children: [], unread: 0 },
            { name: 'Junk',        path: 'Junk',         type: 'spam',   children: [], unread: 0 },
          ];
          setFolders(IMAP_DEFAULT_FOLDERS);
          console.warn('[Folders] IMAP Ordner konnten nicht geladen werden, Fallback aktiv:', result.error);
        }
      }
    } catch (err) {
      console.error('Error loading folders:', err);
      if (folderLoadVersionRef.current === myVersion) setFolderError(err.message);
    }
    if (folderLoadVersionRef.current === myVersion) setLoadingFolders(false);
  }, [activeAccountId, isGraphAccount, allMode]);

  // v2.8.3: Background batch loading — runs a loop loading 50 emails at a time
  // until all are loaded or aborted (account/folder change).
  // Tracks full running list locally so cache + IndexedDB stay up-to-date,
  // meaning a later account switch restores all emails instantly.
  const startBackgroundLoading = useCallback(async (startOffset, accountId, folder, initialEmails, isGraph = false) => {
    let offset = startOffset;
    let runningList = [...initialEmails]; // full list so far (for cache/DB saves)

    while (true) {
      if (bgLoadAbortRef.current) break;

      // Small pause between batches to avoid hammering the server
      await new Promise(resolve => setTimeout(resolve, 2000));

      if (bgLoadAbortRef.current) break;
      if (!window.electronAPI) break;

      try {
        let result;
        if (isGraph) {
          result = await window.electronAPI.fetchGraphEmails(accountId, { folder, limit: 50, skip: offset });
        } else if (folder === 'INBOX') {
          result = await window.electronAPI.fetchEmailsForAccount(accountId, { limit: 50, offset });
        } else {
          result = await window.electronAPI.fetchEmailsFromFolder(accountId, folder, { limit: 50, offset });
        }

        if (bgLoadAbortRef.current || !result.success) break;

        if (result.emails.length > 0) {
          const existingUids = new Set(runningList.map(e => e.uid));
          const olderOnes = result.emails.filter(e => !existingUids.has(e.uid));
          if (olderOnes.length > 0) {
            runningList = [...runningList, ...olderOnes];
            setEmails(runningList);
            offset += olderOnes.length;
            setBgLoadOffset(offset);

            // Perf: memory cache update on every batch (fast, needed for account switch)
            // IndexedDB write only at end — avoid writing growing lists on every batch
            const cacheKey = `${accountId}:${folder}`;
            emailCache.set(cacheKey, { data: runningList, hasMore: result.hasMore, timestamp: Date.now() });
          }
        }

        setHasMore(result.hasMore || false);
        if (!result.hasMore) break;
      } catch (e) {
        console.error('[BgLoad] Error:', e);
        break;
      }
    }

    // Perf: single IndexedDB write after all batches are done (not per batch)
    const localStorageEnabled = localStorage.getItem('emailSettings.localStorageEnabled') !== 'false';
    if (localStorageEnabled && runningList.length > 0) {
      saveEmailsToIndexedDB(accountId, folder, runningList);
    }
  }, []); // no deps — uses ref for abort, params passed explicitly

  // v1.8.2: Fetch emails with caching and IndexedDB (stale-while-revalidate)
  const fetchEmails = useCallback(async (useCache = true) => {
    if (!window.electronAPI || !activeAccountId) {
      setLoading(false);
      return;
    }

    // v7.0: Stale-Guard (wie loadFolders) — bei Konto-/Moduswechsel während
    // eines laufenden Fetches darf die späte Antwort die Liste des neuen
    // Kontexts nicht überschreiben (sonst z.B. gemergte Alle-Konten-Liste
    // mit zusammengesetzten UIDs in einer Einzelkonto-Ansicht).
    const myFetchVersion = ++fetchVersionRef.current;
    const isStale = () => fetchVersionRef.current !== myFetchVersion;

    // Abort any running background batch load
    bgLoadAbortRef.current = true;

    // v7.0: Vereinheitlichter Posteingang — INBOX aller Konten parallel laden
    // v7.1: auch "Gesendet (alle Konten)" (currentFolder 'SENT_ALL')
    if (allMode) {
      const isSentAll = currentFolder === 'SENT_ALL';
      const cacheKey = getCacheKey('__ALL__', isSentAll ? 'SENT_ALL' : 'INBOX');
      if (useCache) {
        const cached = emailCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
          setEmails(cached.data);
          // Ref sofort spiegeln — loadEmailPreview löst das Konto der Mail
          // über emailsRef auf, das sonst einen Render hinterherhinkt
          emailsRef.current = cached.data;
          setHasMore(false);
          setLoading(false);
          if (cached.data.length > 0) loadEmailPreview(cached.data[0].uid);
          return;
        }
      }
      setError(null);
      if (emailsRef.current.length === 0) setLoading(true);
      try {
        const results = await Promise.allSettled(accounts.map(async (acc) => {
          let r;
          let realFolder = 'INBOX';
          if (isSentAll) {
            if (acc.type === 'microsoft') {
              realFolder = 'Sent';
              r = await window.electronAPI.fetchGraphEmails(acc.id, { folder: 'Sent', limit: 30, skip: 0 });
            } else {
              realFolder = await resolveSentFolder(acc);
              if (!realFolder) return [];
              r = await window.electronAPI.fetchEmailsFromFolder(acc.id, realFolder, { limit: 30, offset: 0 });
            }
          } else {
            r = acc.type === 'microsoft'
              ? await window.electronAPI.fetchGraphEmails(acc.id, { folder: 'INBOX', limit: 30, skip: 0 })
              : await window.electronAPI.fetchEmailsForAccount(acc.id, { limit: 30, offset: 0 });
          }
          if (!r?.success) return [];
          return (r.emails || []).map(e => ({
            ...e,
            uid: `${acc.id}::${e.uid}`,
            origUid: e.uid,
            __accId: acc.id,
            __accName: acc.displayName || acc.name || '',
            // Echter Ordner der Mail — Aktionen (Löschen/Archivieren/Markieren)
            // brauchen ihn, in der Gesendet-Ansicht ist er kontospezifisch
            __folder: realFolder,
          }));
        }));
        const merged = results
          .filter(r => r.status === 'fulfilled')
          .flatMap(r => r.value)
          .sort((a, b) => new Date(b.date) - new Date(a.date));
        if (isStale()) return; // Modus/Konto wurde inzwischen gewechselt
        setEmails(merged);
        // Ref sofort spiegeln (siehe Cache-Pfad oben)
        emailsRef.current = merged;
        setHasMore(false);
        emailCache.set(cacheKey, { data: merged, hasMore: false, timestamp: Date.now() });
        if (merged.length > 0) loadEmailPreview(merged[0].uid);
        else setSelectedEmail(null);
      } catch (e) {
        if (!isStale()) setError(e.message);
      }
      if (!isStale()) setLoading(false);
      return;
    }

    const cacheKey = getCacheKey(activeAccountId, currentFolder);
    const localStorageEnabled = localStorage.getItem('emailSettings.localStorageEnabled') !== 'false';
    
    // Check memory cache first
    if (useCache) {
      const cached = emailCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        setEmails(cached.data);
        setHasMore(cached.hasMore);
        setLoading(false);
        if (cached.data.length > 0) {
          loadEmailPreview(cached.data[0].uid);
        }
        return;
      }
    }

    // v1.8.2: Try IndexedDB first (stale-while-revalidate)
    // Perf: if IndexedDB data is fresh (< 10 min), skip server fetch entirely.
    // Background sync will pick up new emails on its own timer.
    const FRESH_TTL = 10 * 60 * 1000; // 10 Minuten
    let existingEmails = [];
    if (localStorageEnabled && useCache) {
      const localData = await loadEmailsFromIndexedDB(activeAccountId, currentFolder);
      if (isStale()) return; // v7.0: Konto/Modus wurde inzwischen gewechselt
      if (localData && localData.emails?.length > 0) {
        existingEmails = localData.emails;
        setEmails(existingEmails);
        setLoading(false);
        loadEmailPreview(existingEmails[0].uid);

        // Cache fresh enough → skip server round-trip
        if (localData.timestamp && Date.now() - localData.timestamp < FRESH_TTL) {
          emailCache.set(cacheKey, { data: existingEmails, hasMore: false, timestamp: localData.timestamp });
          return;
        }
        // Otherwise continue and refresh in background
      }
    }

    setError(null);
    if (existingEmails.length === 0) {
      setLoading(true);
    }

    try {
      let result;
      if (isGraphAccount()) {
        // v2.9.0: Microsoft Graph fetch
        result = await window.electronAPI.fetchGraphEmails(activeAccountId, { folder: currentFolder, limit: 50, skip: 0 });
        if (result?.error === 'TOKEN_EXPIRED') {
          setError('Microsoft-Token abgelaufen. Bitte Konto erneut verbinden (Einstellungen → Kontenverwaltung).');
          setLoading(false);
          return;
        }
      } else if (currentFolder === 'INBOX') {
        result = await window.electronAPI.fetchEmailsForAccount(activeAccountId, { limit: 50 });
      } else {
        result = await window.electronAPI.fetchEmailsFromFolder(activeAccountId, currentFolder, { limit: 50 });
      }

      if (result.success) {
        // v2.9.7: Server is authoritative — use server list as base, preserve local seen status,
        // keep older cached emails (pagination) that aren't in the server page.
        // This prevents deleted emails from reappearing and keeps read status intact.
        let finalEmails;
        if (existingEmails.length > 0) {
          const serverUids = new Set(result.emails.map(e => e.uid));
          const existingByUid = new Map(existingEmails.map(e => [e.uid, e]));

          // Server emails with local seen-status preserved
          const mergedServer = result.emails.map(e => {
            const cached = existingByUid.get(e.uid);
            return cached ? { ...e, seen: cached.seen } : e;
          });

          // Keep only truly older cached emails not covered by the server page
          const olderCached = existingEmails.filter(e => !serverUids.has(e.uid));

          finalEmails = [...mergedServer, ...olderCached];
        } else {
          finalEmails = result.emails;
        }

        if (isStale()) return; // v7.0: Konto/Modus wurde inzwischen gewechselt
        setEmails(finalEmails);
        setHasMore(result.hasMore || false);
        setBgLoadOffset(finalEmails.length);

        // Start background loading if server has more than we have locally
        if (result.hasMore) {
          bgLoadAbortRef.current = false;
          startBackgroundLoading(finalEmails.length, activeAccountId, currentFolder, finalEmails, isGraphAccount());
        }

        // Update memory cache
        emailCache.set(cacheKey, {
          data: finalEmails,
          hasMore: result.hasMore,
          timestamp: Date.now()
        });

        // v1.8.2: Save to IndexedDB for offline access
        if (localStorageEnabled) {
          saveEmailsToIndexedDB(activeAccountId, currentFolder, finalEmails);
        }

        if (finalEmails.length > 0) {
          loadEmailPreview(finalEmails[0].uid);
        } else {
          setSelectedEmail(null);
        }
      } else {
        setError(result.error);
      }
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  // Hinweis: loadEmailPreview ist bewusst NICHT in den Deps — es ist erst
  // weiter unten definiert (TDZ im Deps-Array beim ersten Render).
  }, [activeAccountId, currentFolder, getCacheKey, allMode, accounts]);

  // Load more emails (pagination)
  const loadMoreEmails = useCallback(async () => {
    if (!window.electronAPI || !activeAccountId || loadingMore || !hasMore) return;

    setLoadingMore(true);
    try {
      let result;
      if (isGraphAccount()) {
        result = await window.electronAPI.fetchGraphEmails(activeAccountId, {
          folder: currentFolder, limit: 50, skip: emails.length
        });
      } else if (currentFolder === 'INBOX') {
        result = await window.electronAPI.fetchEmailsForAccount(activeAccountId, {
          limit: 50, offset: emails.length
        });
      } else {
        result = await window.electronAPI.fetchEmailsFromFolder(activeAccountId, currentFolder, {
          limit: 50, offset: emails.length
        });
      }
      
      if (result.success) {
        // Deduplicate: only append emails not already in the list
        const existingUids = new Set(emails.map(e => e.uid));
        const newOnes = result.emails.filter(e => !existingUids.has(e.uid));
        const newEmails = [...emails, ...newOnes];
        setEmails(newEmails);
        setHasMore(result.hasMore || false);

        // Update cache
        const cacheKey = getCacheKey(activeAccountId, currentFolder);
        emailCache.set(cacheKey, {
          data: newEmails,
          hasMore: result.hasMore,
          timestamp: Date.now()
        });
      }
    } catch (e) {
      console.error('Error loading more emails:', e);
    }
    setLoadingMore(false);
  }, [activeAccountId, currentFolder, emails, hasMore, loadingMore, getCacheKey]);

  // v2.8.3: Sync — fetch latest emails from server, merge with current state
  // v2.9.8: Also updates seen-status from server + persists to cache/IndexedDB
  const syncEmails = useCallback(async () => {
    if (!window.electronAPI || !activeAccountId) return;
    try {
      let freshResult;
      if (isGraphAccount()) {
        freshResult = await window.electronAPI.fetchGraphEmails(activeAccountId, { folder: currentFolder, limit: 50, skip: 0 });
      } else if (currentFolder === 'INBOX') {
        freshResult = await window.electronAPI.fetchEmailsForAccount(activeAccountId, { limit: 50, offset: 0 });
      } else {
        freshResult = await window.electronAPI.fetchEmailsFromFolder(activeAccountId, currentFolder, { limit: 50, offset: 0 });
      }
      if (freshResult?.success) {
        const localStorageEnabled = localStorage.getItem('emailSettings.localStorageEnabled') !== 'false';
        setEmails(prev => {
          const serverUids = new Set(freshResult.emails.map(e => e.uid));
          const prevByUid = new Map(prev.map(e => [e.uid, e]));

          // Update existing emails with fresh server data (e.g. seen-status from other device)
          const updated = freshResult.emails.map(e => {
            const local = prevByUid.get(e.uid);
            // Keep local seen-status only if it's MORE read than server
            // (local mark-as-read should not be overwritten by stale server state)
            return local ? { ...e, seen: local.seen || e.seen } : e;
          });

          // Prepend truly new emails, keep older ones not in server page
          const olderOnes = prev.filter(e => !serverUids.has(e.uid));
          const merged = [...updated, ...olderOnes];

          // Persist to cache + IndexedDB so account-switch doesn't lose sync results
          const cacheKey = getCacheKey(activeAccountId, currentFolder);
          emailCache.set(cacheKey, { data: merged, hasMore: freshResult.hasMore ?? false, timestamp: Date.now() });
          if (localStorageEnabled) saveEmailsToIndexedDB(activeAccountId, currentFolder, merged);

          return merged;
        });
      }
    } catch (e) {
      console.error('[Sync] Error:', e);
    }
  }, [activeAccountId, currentFolder, isGraphAccount, getCacheKey]);

  // Guard gegen Doppel-Fetches: Kontowechsel änderte bisher sowohl
  // activeAccountId als auch die fetchEmails-Identität, wodurch beide Effekte
  // feuerten und dieselbe Mailbox zweimal vom Server geladen wurde.
  const currentFolderRef = useRef(currentFolder);
  currentFolderRef.current = currentFolder;
  const lastFetchKeyRef = useRef(null);

  // Initial load / account switch — der eigentliche Fetch läuft über den
  // Folder-Effekt darunter (genau einmal pro Konto+Ordner).
  useEffect(() => {
    setSelectedEmail(null);
    setSelectedIndex(0);
    setError(null);
    setFolderError(null);
    // Ordner-Cache leeren damit Ordner des neuen Kontos geladen werden
    folderCache.clear();
    setCurrentFolder('INBOX');
    loadFolders();
    // useCache=true: zeigt Memory-Cache oder IndexedDB sofort an, kein erneuter Download nötig
    // Mails bleiben leer bis Cache geladen ist (kein falsches Konto sichtbar, da Cache-Key accountId enthält)
    setEmails([]);
    if (currentFolderRef.current === 'INBOX') {
      lastFetchKeyRef.current = null; // Folder-Effekt feuert gleich → fetchen lassen
    } else {
      // Folder-Effekt feuert in diesem Commit noch mit dem alten Ordner —
      // diesen veralteten Fetch unterdrücken; der INBOX-Fetch folgt nach
      // dem setCurrentFolder-Re-Render.
      lastFetchKeyRef.current = `${activeAccountId}|${currentFolderRef.current}`;
    }
  }, [activeAccountId]);

  // Load emails when folder changes
  useEffect(() => {
    const key = `${activeAccountId}|${currentFolder}`;
    if (lastFetchKeyRef.current === key) return;
    lastFetchKeyRef.current = key;
    setSelectedIndex(0);
    setSelectedEmail(null);
    fetchEmails(true);
  }, [activeAccountId, currentFolder, fetchEmails]);

  // v6.6.0: AI-Triage-Map laden bei Account-/Folder-Wechsel + Live-Updates
  useEffect(() => {
    let cancelled = false;
    const refreshTriage = async () => {
      if (!activeAccountId || !window.electronAPI?.aiGetTriageMap) return;
      try {
        const r = await window.electronAPI.aiGetTriageMap(activeAccountId, currentFolder);
        if (cancelled || !r?.success) return;
        const m = new Map();
        for (const [uidStr, value] of Object.entries(r.map || {})) {
          m.set(parseInt(uidStr, 10), value);
          // Bei Microsoft Graph ist uid keine Zahl → fallback string-key
          m.set(uidStr, value);
        }
        setTriageMap(m);
      } catch (_) {}
    };
    refreshTriage();
    if (window.electronAPI?.onAiTriageProgress) {
      window.electronAPI.onAiTriageProgress((data) => {
        setTriageProgress({ processed: data.processed, total: data.total });
      });
    }
    return () => {
      cancelled = true;
      window.electronAPI?.removeAiListeners?.();
    };
  }, [activeAccountId, currentFolder]);

  // v6.6.0 fix: keine useCallback-Bindung an filteredEmails — würde TDZ
  // werfen, da filteredEmails als const weiter unten deklariert ist. Plain
  // Arrow-Function reicht (wird nur aus dem Bot-Button-onClick aufgerufen).
  const handleRunTriage = async () => {
    if (!activeAccountId || !window.electronAPI?.aiTriageBatch) return;
    if (filteredEmails.length === 0) return;
    // v7.0: Triage nur im Einzelkonto-Modus — im Alle-Konten-Modus würden
    // Ergebnisse unter '__ALL__' + zusammengesetzten UIDs persistiert und
    // beim nächsten Einzelkonto-Lauf erneut berechnet (doppelte AI-Kosten).
    if (allMode) {
      setActionToast('KI-Triage bitte im einzelnen Konto ausführen');
      return;
    }
    setTriageRunning(true);
    setTriageProgress({ processed: 0, total: filteredEmails.length });
    const items = filteredEmails.map(e => ({
      accountId: activeAccountId,
      folder: currentFolder,
      uid: e.uid,
      email: {
        from: e.from, to: e.to, cc: e.cc || '',
        subject: e.subject, date: e.date,
        preview: e.preview || ''
      }
    }));
    try {
      const r = await window.electronAPI.aiTriageBatch({ items });
      if (r?.success) {
        const r2 = await window.electronAPI.aiGetTriageMap(activeAccountId, currentFolder);
        if (r2?.success) {
          const m = new Map();
          for (const [uidStr, value] of Object.entries(r2.map || {})) {
            m.set(parseInt(uidStr, 10), value);
            m.set(uidStr, value);
          }
          setTriageMap(m);
        }
      } else {
        setActionToast('Triage fehlgeschlagen: ' + (r?.error || 'unbekannt'));
      }
    } catch (e) {
      setActionToast('Triage-Fehler: ' + e.message);
    } finally {
      setTriageRunning(false);
      setTimeout(() => setTriageProgress(null), 2000);
    }
  };

  // v6.6.0: Aktive Snoozes laden + bei Wake-up neu laden
  useEffect(() => {
    let cancelled = false;
    const refreshSnoozes = async () => {
      if (!window.electronAPI?.snoozeActive) return;
      try {
        const r = await window.electronAPI.snoozeActive();
        if (cancelled || !r?.success) return;
        setSnoozedKeys(new Set(r.items.map(s => `${s.accountId}|${s.folder}|${s.uid}`)));
      } catch (_) {}
    };
    refreshSnoozes();
    if (window.electronAPI?.onSnoozeWoke) {
      window.electronAPI.onSnoozeWoke(() => { refreshSnoozes(); fetchEmails(true); });
    }
    return () => {
      cancelled = true;
      window.electronAPI?.removeSnoozeListeners?.();
    };
  }, [activeAccountId, fetchEmails]);

  // v2.9.9: Receive background sync results from App.js global timer
  // The timer runs in App.js (always active), dispatches 'coremail:bgSync' events.
  // InboxSplitView merges incoming data into state + memory cache when visible.
  useEffect(() => {
    const handleBgSync = (e) => {
      const { accountId, folder, emails: serverEmails } = e.detail || {};
      if (accountId !== activeAccountId || folder !== currentFolder) return;

      // v6.8.1: Merge ausserhalb des setState-Updaters (Side-Effects in
      // Updatern laufen unter StrictMode doppelt → doppelte Log-Einträge und
      // IndexedDB-Writes) und Skip, wenn sich nichts geändert hat — sonst
      // löste jeder 5-Minuten-Tick Re-Render, Spam-Reanalyse über bis zu 500
      // Mails und einen IndexedDB-Write für identische Daten aus.
      const prev = emailsRef.current;
      const serverUids = new Set(serverEmails.map(m => m.uid));
      const prevByUid = new Map(prev.map(m => [m.uid, m]));

      const trulyNew = serverEmails.filter(m => !prevByUid.has(m.uid));
      const seenChanged = serverEmails.some(m => {
        const local = prevByUid.get(m.uid);
        return local && !local.seen && m.seen;
      });
      if (trulyNew.length === 0 && !seenChanged) return; // nichts Neues

      if (trulyNew.length > 0 && window.electronAPI?.logAdd) {
        const title = trulyNew.length === 1
          ? `E-Mail empfangen: ${trulyNew[0].subject || '(kein Betreff)'}`
          : `${trulyNew.length} neue E-Mails empfangen`;
        const detail = trulyNew.slice(0, 5).map(m => `• ${m.subject || '(kein Betreff)'} — ${m.from || ''}`).join('\n');
        window.electronAPI.logAdd('email_received', title, `Konto: ${accountId}\n${detail}`).catch(() => {});
      }

      const merged = serverEmails.map(m => {
        const local = prevByUid.get(m.uid);
        return local ? { ...m, seen: local.seen || m.seen } : m;
      });
      const olderOnes = prev.filter(m => !serverUids.has(m.uid));
      const result = [...merged, ...olderOnes];

      setEmails(result);
      emailCache.set(getCacheKey(activeAccountId, currentFolder), {
        data: result, hasMore: false, timestamp: Date.now()
      });
      const localStorageEnabled = localStorage.getItem('emailSettings.localStorageEnabled') !== 'false';
      if (localStorageEnabled) saveEmailsToIndexedDB(activeAccountId, currentFolder, result);
    };

    window.addEventListener('coremail:bgSync', handleBgSync);
    return () => window.removeEventListener('coremail:bgSync', handleBgSync);
  }, [activeAccountId, currentFolder]); // eslint-disable-line

  const loadEmailPreview = useCallback(async (uid) => {
    if (!window.electronAPI || !activeAccountId) return;

    // Race guard: discard responses for any earlier request
    previewRequestIdRef.current = uid;

    // v7.0: konto-bewusst — im Alle-Konten-Modus trägt die Mail ihr Konto
    // selbst (__accId) und die Original-UID (origUid), Ordner ist dort INBOX.
    const mailObj = emailsRef.current.find(e => e.uid === uid);
    const acc = accountFor(mailObj);
    const fetchUid = mailObj?.origUid ?? uid;
    const folder = mailObj?.__accId ? (mailObj.__folder || 'INBOX') : currentFolder;

    // v7.0: LRU-Cache — erneutes Anklicken einer Mail zeigt sie sofort,
    // statt die komplette Roh-Mail (inkl. Base64-Anhängen) neu über IPC
    // und den Server zu laden. Key nutzt die LISTEN-uid (im Alle-Modus
    // zusammengesetzt, sonst roh) — dadurch kollidieren die modus-
    // spezifischen Objektformen nie (Review-Befund v7.0).
    const cacheKey = `${acc?.id || activeAccountId}|${folder}|${uid}`;
    const cached = previewCache.get(cacheKey);
    if (cached) {
      // LRU-Auffrischung: ans Ende der Map verschieben
      previewCache.delete(cacheKey);
      previewCache.set(cacheKey, cached);
      setSelectedEmail(cached);
      setLoadingPreview(false);
      setPreviewError(null);
      return;
    }

    setLoadingPreview(true);
    setPreviewError(null);
    try {
      const result = await MailApi.fetchOne(acc, fetchUid, folder);
      // Only apply result if this is still the latest request
      if (previewRequestIdRef.current === uid) {
        if (result?.success) {
          // Listen-Identität (zusammengesetzte uid, Konto-Infos) beibehalten
          const enriched = mailObj?.__accId
            ? { ...result.email, uid, origUid: fetchUid, __accId: mailObj.__accId, __accName: mailObj.__accName, __folder: mailObj.__folder }
            : result.email;
          previewCache.set(cacheKey, enriched);
          while (previewCache.size > PREVIEW_CACHE_MAX) {
            previewCache.delete(previewCache.keys().next().value);
          }
          setSelectedEmail(enriched);
        } else {
          // Fehler sichtbar machen statt nur in der Konsole — der Nutzer sah
          // sonst eine leere/alte Vorschau ohne Erklärung.
          setPreviewError({ uid, message: result?.error || 'E-Mail konnte nicht geladen werden' });
        }
      }
    } catch (e) {
      console.error('Error loading email preview', e);
      if (previewRequestIdRef.current === uid) {
        setPreviewError({ uid, message: e.message || 'E-Mail konnte nicht geladen werden' });
      }
    }
    if (previewRequestIdRef.current === uid) {
      setLoadingPreview(false);
    }
  }, [activeAccountId, currentFolder, accountFor]);

  // Moved before handleSelectEmail to avoid TDZ in deps array
  const handleToggleRead = useCallback(async (uid, currentSeen) => {
    if (!window.electronAPI || !activeAccountId) return;

    setActionLoading(`read-${uid}`);
    try {
      // v7.0: konto-bewusst (Alle-Konten-Modus)
      const mailObj = emailsRef.current.find(e => e.uid === uid);
      const result = await MailApi.markRead(
        accountFor(mailObj),
        mailObj?.origUid ?? uid,
        !currentSeen,
        mailObj?.__accId ? (mailObj.__folder || 'INBOX') : currentFolder
      );
      if (result.success) {
        const newEmails = emailsRef.current.map(e =>
          e.uid === uid ? { ...e, seen: !currentSeen } : e
        );
        setEmails(newEmails);
        const cacheKey = getCacheKey(activeAccountId, currentFolder);
        emailCache.set(cacheKey, { data: newEmails, hasMore: hasMoreRef.current, timestamp: Date.now() });
        const localStorageEnabled = localStorage.getItem('emailSettings.localStorageEnabled') !== 'false';
        if (localStorageEnabled) saveEmailsToIndexedDB(activeAccountId, currentFolder, newEmails);
        setSelectedEmail(prev => prev?.uid === uid ? { ...prev, seen: !currentSeen } : prev);
      }
    } catch (err) {
      console.error('Error toggling read status:', err);
    }
    setActionLoading(null);
  }, [activeAccountId, currentFolder, getCacheKey, accountFor]);

  // v2.6.0: Category-filtered emails — moved before handleSelectEmail to avoid TDZ
  const categoryFilteredEmails = useMemo(() => {
    if (!categoryFilter || currentFolder !== 'INBOX') return emails;
    return emails.filter(email => {
      const manualCat = manualCategories.get(email.uid);
      if (manualCat) return manualCat === categoryFilter;
      const analysis = spamResults.get(email.uid);
      return analysis?.category === categoryFilter;
    });
  }, [emails, categoryFilter, manualCategories, spamResults, currentFolder]);

  // Visibility filter — moved before handleSelectEmail to avoid TDZ
  const filteredEmails = useMemo(() => {
    let list = categoryFilteredEmails;
    if (showUnreadOnly) list = list.filter(email => !email.seen);
    // v6.6.0: gesnoozte Mails ausblenden (key = "accountId|folder|uid")
    if (snoozedKeys.size > 0 && activeAccountId) {
      // v7.0: konto-bewusst — im Alle-Konten-Modus trägt die Mail ihr Konto
      // selbst (sonst blendete Snooze dort nie aus, Key-Mismatch)
      list = list.filter(e => !snoozedKeys.has(`${e.__accId || activeAccountId}|${e.__accId ? (e.__folder || 'INBOX') : currentFolder}|${e.origUid ?? e.uid}`));
    }
    return list;
  }, [categoryFilteredEmails, showUnreadOnly, snoozedKeys, activeAccountId, currentFolder]);

  // Pro UID ein stabiles Analyse-Objekt — ein Inline-Spread im Row-Mapping
  // würde die memo()-Prüfung jeder kategorisierten Row bei jedem Render brechen.
  const effectiveAnalysisMap = useMemo(() => {
    const map = new Map();
    emails.forEach(email => {
      const manualCat = manualCategories.get(email.uid);
      const spamAnalysis = spamResults.get(email.uid);
      map.set(email.uid, manualCat
        ? { ...spamAnalysis, category: manualCat, isManual: true }
        : spamAnalysis);
    });
    return map;
  }, [emails, manualCategories, spamResults]);

  const isSentFolder = useMemo(() => {
    const folderLower = currentFolder.toLowerCase();
    return folderLower.includes('sent') || folderLower.includes('gesendet');
  }, [currentFolder]);

  // Einmal pro Mount statt localStorage-Read bei jedem Preview-Render —
  // die Schrift ändert sich nur in den FontSettings (anderer View).
  const previewFontStyle = useMemo(() => {
    const fontFamily = GOOGLE_FONTS[getCurrentFont()] || 'Inter';
    return `"${fontFamily}", system-ui, -apple-system, sans-serif`;
  }, []);

  // Ref statt Dependency — handleSelectEmail bleibt so über Listen-Updates
  // hinweg stabil und lässt die memoisierten Rows in Ruhe.
  const filteredEmailsRef = useRef(filteredEmails);
  filteredEmailsRef.current = filteredEmails;

  const handleSelectEmail = useCallback((index) => {
    setSelectedIndex(index);
    const email = filteredEmailsRef.current[index];
    if (email) {
      loadEmailPreview(email.uid);
      // Default 'onClick' (wie Outlook): eine Mail beim Anklicken als gelesen
      // markieren. Vorher war der Default 'never' — eine nicht wählbare Option,
      // in der ein Klick nie etwas markierte.
      const markMode = localStorage.getItem('emailSettings.markAsReadMode') || 'onClick';
      if (markMode === 'onClick' && !email.seen) {
        handleToggleRead(email.uid, false);
      }
    }
  }, [loadEmailPreview, handleToggleRead]);

  // v6.6.0: Snooze — Mail bis zum gewählten Zeitpunkt aus dem Posteingang ausblenden,
  // dann Desktop-Notification + Wiedereinblenden via processSnoozes() im Backend.
  const handleSnoozePick = useCallback(async (wakeAtMs) => {
    setSnoozeMenuOpen(false);
    if (!selectedEmail || !activeAccountId || !window.electronAPI?.snoozeAdd) return;
    // v7.0: konto-bewusst (Alle-Konten-Modus)
    const snoozeAccId = selectedEmail.__accId || activeAccountId;
    const snoozeFolder = selectedEmail.__accId ? (selectedEmail.__folder || 'INBOX') : currentFolder;
    const snoozeUid = selectedEmail.origUid ?? selectedEmail.uid;
    const result = await window.electronAPI.snoozeAdd({
      accountId: snoozeAccId,
      folder: snoozeFolder,
      uid: snoozeUid,
      messageId: selectedEmail.messageId || null,
      subject: selectedEmail.subject || '',
      from: selectedEmail.from || '',
      wakeAt: wakeAtMs
    });
    if (!result?.success) {
      setActionToast('Snooze fehlgeschlagen: ' + (result?.error || 'unbekannter Fehler'));
      return;
    }
    setSnoozedKeys(prev => {
      const next = new Set(prev);
      next.add(`${snoozeAccId}|${snoozeFolder}|${snoozeUid}`);
      return next;
    });
    setSelectedEmail(null);
  }, [selectedEmail, activeAccountId, currentFolder]);

  // v6.10.0: Ist der übergebene Ordner der Papierkorb? Primär über den
  // Ordner-Typ (Graph: wellKnownName 'deleteditems'; IMAP: 'trash' via
  // SPECIAL-USE aus imap:listFolders). Namens-Fallback nur EXAKT — ein
  // Substring-Match hätte harmlose Ordner wie "Gelöschte Projekte 2023" als
  // Papierkorb behandelt und dort ENDGÜLTIG gelöscht statt verschoben.
  const isTrashFolder = useCallback((folderPath) => {
    const TRASH_NAMES = ['trash', 'deleted items', 'deleted', 'deleted messages', 'papierkorb', 'gelöschte elemente', 'geloeschte elemente', 'bin', 'corbeille', 'cestino', 'papelera'];
    const all = (folders || []).flatMap(f => [f, ...(f.children || [])]);
    const f = all.find(x => x.path === folderPath);
    if (f) {
      // Graph: wellKnownName; IMAP: nur echtes SPECIAL-USE — der namens-
      // geratene type wäre hier zu lasch (Substring, z.B. "Trashbin")
      if (f.type === 'deleteditems' || f.specialUse === 'trash') return true;
      return TRASH_NAMES.includes((f.name || '').toLowerCase());
    }
    // Fallback ohne Ordnerliste: letztes Pfadsegment exakt vergleichen
    const seg = String(folderPath || '').split(/[./]/).pop().toLowerCase();
    return TRASH_NAMES.includes(seg);
  }, [folders]);

  // Email Actions
  // v1.12.1: Fixed - now also removes from IndexedDB to prevent deleted emails from reappearing
  // v6.10.0: Outlook-Semantik — ausserhalb des Papierkorbs wird in den
  // Papierkorb verschoben; nur im Papierkorb selbst wird endgültig gelöscht.
  const handleDelete = useCallback(async (uid) => {
    if (!window.electronAPI || !activeAccountId) return;

    setActionLoading(`delete-${uid}`);
    try {
      // v6.11.0: Undo braucht das Mail-Objekt (messageId) VOR dem Entfernen
      // v7.0: konto-bewusst (Alle-Konten-Modus)
      const mailObj = emailsRef.current.find(e => e.uid === uid);
      const acc = accountFor(mailObj);
      const actionUid = mailObj?.origUid ?? uid;
      const actionFolder = mailObj?.__accId ? (mailObj.__folder || 'INBOX') : currentFolder;
      const inTrash = !mailObj?.__accId && isTrashFolder(currentFolder);
      const result = inTrash
        ? await MailApi.deletePermanent(acc, actionUid, actionFolder)
        : await MailApi.trash(acc, actionUid, actionFolder);
      if (result.success) {
        // Stop background loader immediately so it can't write the deleted email back
        bgLoadAbortRef.current = true;

        // Remove from local state and cache
        const newEmails = emailsRef.current.filter(e => e.uid !== uid);
        setEmails(newEmails);

        // Update memory cache
        const cacheKey = getCacheKey(activeAccountId, currentFolder);
        emailCache.set(cacheKey, { data: newEmails, hasMore: hasMoreRef.current, timestamp: Date.now() });

        // v1.12.1: Also remove from IndexedDB to prevent re-fetching
        await removeEmailFromIndexedDB(acc?.id || activeAccountId, actionFolder, actionUid);

        // v7.0: Gegenmodus-Cache invalidieren — sonst taucht die Mail beim
        // Wechsel zwischen Alle-Konten- und Einzelmodus wieder auf
        if (mailObj?.__accId) emailCache.delete(getCacheKey(mailObj.__accId, mailObj.__folder || 'INBOX'));
        else if (currentFolder === 'INBOX') emailCache.delete(getCacheKey('__ALL__', 'INBOX'));
        else if (isSentFolder) emailCache.delete(getCacheKey('__ALL__', 'SENT_ALL'));

        // Select next email
        const selIdx = selectedIndexRef.current;
        if (selIdx >= newEmails.length) {
          setSelectedIndex(Math.max(0, newEmails.length - 1));
        }
        if (newEmails.length > 0 && newEmails[selIdx]) {
          loadEmailPreview(newEmails[selIdx].uid);
        } else {
          setSelectedEmail(null);
        }

        // v6.11.0: Undo-Toast — verschobene Mail lässt sich zurückholen
        if (!inTrash) {
          const undoable = MailApi.isGraph(acc) ? !!result.newId : !!mailObj?.messageId;
          setActionToast({
            text: 'In den Papierkorb verschoben',
            undo: undoable ? async () => {
              const r = await MailApi.undoMove(acc, result, actionFolder, mailObj?.messageId);
              if (r?.success) fetchEmails(false);
              else setActionToast('Rückgängig fehlgeschlagen: ' + (r?.error || 'unbekannt'));
            } : undefined,
          });
        }
      } else {
        setActionToast('Fehler beim Löschen: ' + result.error);
      }
    } catch (err) {
      setActionToast('Fehler beim Löschen: ' + err.message);
    }
    setActionLoading(null);
  }, [activeAccountId, currentFolder, getCacheKey, accountFor, isTrashFolder, isSentFolder, loadEmailPreview, fetchEmails]);

  // v6.10.0: Archivieren (Outlook-Semantik) — verschiebt in den Archiv-Ordner
  // (Graph: Well-Known "archive", IMAP: SPECIAL-USE/Name, wird bei Bedarf angelegt).
  const handleArchive = useCallback(async (uid) => {
    if (!window.electronAPI || !activeAccountId) return;

    setActionLoading(`archive-${uid}`);
    try {
      // v7.0: konto-bewusst (Alle-Konten-Modus)
      const mailObj = emailsRef.current.find(e => e.uid === uid);
      const acc = accountFor(mailObj);
      const actionUid = mailObj?.origUid ?? uid;
      const actionFolder = mailObj?.__accId ? (mailObj.__folder || 'INBOX') : currentFolder;
      const result = await MailApi.archive(acc, actionUid, actionFolder);
      if (result.success) {
        bgLoadAbortRef.current = true;
        const newEmails = emailsRef.current.filter(e => e.uid !== uid);
        setEmails(newEmails);
        const cacheKey = getCacheKey(activeAccountId, currentFolder);
        emailCache.set(cacheKey, { data: newEmails, hasMore: hasMoreRef.current, timestamp: Date.now() });
        await removeEmailFromIndexedDB(acc?.id || activeAccountId, actionFolder, actionUid);
        // v7.0: Gegenmodus-Cache invalidieren (siehe handleDelete)
        if (mailObj?.__accId) emailCache.delete(getCacheKey(mailObj.__accId, mailObj.__folder || 'INBOX'));
        else if (currentFolder === 'INBOX') emailCache.delete(getCacheKey('__ALL__', 'INBOX'));
        else if (isSentFolder) emailCache.delete(getCacheKey('__ALL__', 'SENT_ALL'));
        const selIdx = selectedIndexRef.current;
        if (selIdx >= newEmails.length) {
          setSelectedIndex(Math.max(0, newEmails.length - 1));
        }
        if (newEmails.length > 0 && newEmails[selIdx]) {
          loadEmailPreview(newEmails[selIdx].uid);
        } else {
          setSelectedEmail(null);
        }

        // v6.11.0: Undo-Toast — archivierte Mail lässt sich zurückholen
        const undoable = MailApi.isGraph(acc) ? !!result.newId : !!mailObj?.messageId;
        setActionToast({
          text: 'Archiviert',
          undo: undoable ? async () => {
            const r = await MailApi.undoMove(acc, result, actionFolder, mailObj?.messageId);
            if (r?.success) fetchEmails(false);
            else setActionToast('Rückgängig fehlgeschlagen: ' + (r?.error || 'unbekannt'));
          } : undefined,
        });
      } else {
        setActionToast('Archivieren fehlgeschlagen: ' + (result?.error || 'unbekannt'));
      }
    } catch (err) {
      setActionToast('Archivieren fehlgeschlagen: ' + err.message);
    }
    setActionLoading(null);
  }, [activeAccountId, currentFolder, getCacheKey, accountFor, isSentFolder, loadEmailPreview, fetchEmails]);

  // v6.8.1: Einzel-Löschen erst nach Bestätigung — v6.10.0: nur noch im
  // Papierkorb (dort endgültig); sonst Outlook-Semantik: direkt in den
  // Papierkorb verschieben, keine Bestätigung nötig.
  const requestDelete = useCallback((uid) => {
    if (isTrashFolder(currentFolder)) setConfirmDeleteUid(uid);
    else handleDelete(uid);
  }, [isTrashFolder, currentFolder, handleDelete]);

  const confirmSingleDelete = useCallback(() => {
    const uid = confirmDeleteUid;
    setConfirmDeleteUid(null);
    if (uid != null) handleDelete(uid);
  }, [confirmDeleteUid, handleDelete]);

  // v2.3.0: Multi-Select Handlers
  const handleCheckboxChange = useCallback((uid, shiftKey) => {
    // v6.9.6: Shift-Range über die GEFILTERTE (sichtbare) Liste — vorher lief
    // der Bereich über die ungefilterte Liste und konnte bei aktivem Filter
    // unsichtbare Mails mit auswählen (Risiko: unbeabsichtigtes Löschen).
    const list = filteredEmailsRef.current;
    const lastIdx = lastClickedIndexRef.current;
    const clickedIndex = list.findIndex(e => e.uid === uid);

    setSelectedUids(prev => {
      const newSet = new Set(prev);

      if (shiftKey && lastIdx !== null && clickedIndex !== -1) {
        // Shift+Click: Select range (nur sichtbare Mails)
        const start = Math.min(lastIdx, clickedIndex);
        const end = Math.max(lastIdx, clickedIndex);

        for (let i = start; i <= end; i++) {
          if (list[i]) newSet.add(list[i].uid);
        }
      } else {
        // Normal click: Toggle single
        if (newSet.has(uid)) {
          newSet.delete(uid);
        } else {
          newSet.add(uid);
        }
      }

      return newSet;
    });

    // Track last clicked index for shift-select
    setLastClickedIndex(clickedIndex);
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectedUids.size === filteredEmails.length) {
      // Deselect all
      setSelectedUids(new Set());
    } else {
      // Select all (from filtered emails)
      setSelectedUids(new Set(filteredEmails.map(e => e.uid)));
    }
  }, [filteredEmails, selectedUids]);

  const handleClearSelection = useCallback(() => {
    setSelectedUids(new Set());
    setShowCheckboxes(false);
  }, []);

  // ── Folder management ────────────────────────────────────────────────────────
  const SYSTEM_FOLDERS = new Set(['INBOX', 'Sent', 'Drafts', 'Deleted', 'Junk', 'Archive', 'Trash', 'Spam']);

  const openCreateFolder = () => {
    setFolderModalInput('');
    setFolderModalError(null);
    setFolderModal({ mode: 'create' });
  };
  const openRenameFolder = (folder) => {
    setFolderModalInput(folder.name);
    setFolderModalError(null);
    setFolderModal({ mode: 'rename', folder });
  };
  const openDeleteFolder = (folder) => {
    setFolderModalError(null);
    setFolderModal({ mode: 'delete', folder });
  };

  const submitFolderModal = async () => {
    if (!window.electronAPI || !activeAccountId) return;
    setFolderModalLoading(true);
    setFolderModalError(null);
    try {
      const { mode, folder } = folderModal;
      let result;
      const acc = getActiveAccount();
      if (mode === 'create') {
        const name = folderModalInput.trim();
        if (!name) { setFolderModalError('Bitte einen Namen eingeben.'); setFolderModalLoading(false); return; }
        result = await MailApi.createFolder(acc, name);
      } else if (mode === 'rename') {
        const name = folderModalInput.trim();
        if (!name || name === folder.name) { setFolderModalError('Bitte einen neuen Namen eingeben.'); setFolderModalLoading(false); return; }
        result = await MailApi.renameFolder(acc, folder.path, name);
      } else if (mode === 'delete') {
        result = await MailApi.deleteFolder(acc, folder.path);
      }
      if (result?.success) {
        setFolderModal(null);
        folderCache.delete(`folders:${activeAccountId}`);
        loadFolders(true);
        if (mode === 'delete' && currentFolder === folder.path) setCurrentFolder('INBOX');
      } else {
        setFolderModalError(result?.error || 'Unbekannter Fehler');
      }
    } catch (e) {
      setFolderModalError(e.message);
    }
    setFolderModalLoading(false);
  };

  const handleFolderModalKey = (e) => {
    if (e.key === 'Enter') submitFolderModal();
    if (e.key === 'Escape') setFolderModal(null);
  };

  const handleBulkDelete = useCallback(async () => {
    if (!window.electronAPI || !activeAccountId || selectedUids.size === 0) return;

    // Pause background sync to prevent deleted emails from reappearing
    bgLoadAbortRef.current = true;
    setBulkDeleting(true);
    const uidsToDelete = Array.from(selectedUids);
    let deletedCount = 0;
    
    try {
      // Perf: delete all emails in parallel instead of sequentially
      // v6.10.0: Outlook-Semantik auch für Bulk — ausserhalb des Papierkorbs
      // in den Papierkorb verschieben statt endgültig löschen.
      // v7.0: konto-bewusst pro Mail (Alle-Konten-Modus)
      const inTrash = !allMode && isTrashFolder(currentFolder);
      // v7.0: Gegenmodus-Caches invalidieren (siehe handleDelete)
      if (allMode) {
        uidsToDelete.forEach(uid => {
          const m = emailsRef.current.find(e => e.uid === uid);
          if (m?.__accId) emailCache.delete(getCacheKey(m.__accId, m.__folder || 'INBOX'));
        });
      } else if (currentFolder === 'INBOX') {
        emailCache.delete(getCacheKey('__ALL__', 'INBOX'));
      } else if (isSentFolder) {
        emailCache.delete(getCacheKey('__ALL__', 'SENT_ALL'));
      }
      const deleteResults = await Promise.allSettled(
        uidsToDelete.map(uid => {
          const mailObj = emailsRef.current.find(e => e.uid === uid);
          const acc = accountFor(mailObj);
          const actionUid = mailObj?.origUid ?? uid;
          const actionFolder = mailObj?.__accId ? (mailObj.__folder || 'INBOX') : currentFolder;
          return inTrash
            ? MailApi.deletePermanent(acc, actionUid, actionFolder)
            : MailApi.trash(acc, actionUid, actionFolder);
        })
      );
      const successUids = uidsToDelete.filter((_, i) =>
        deleteResults[i].status === 'fulfilled' && deleteResults[i].value?.success
      );
      deletedCount = successUids.length;

      // Remove successfully deleted emails from IndexedDB in parallel
      await Promise.all(
        successUids.map(uid => {
          // v7.0: konto-bewusst (Alle-Konten-Modus)
          const mailObj = emailsRef.current.find(e => e.uid === uid);
          return removeEmailFromIndexedDB(
            mailObj?.__accId || activeAccountId,
            mailObj?.__accId ? (mailObj.__folder || 'INBOX') : currentFolder,
            mailObj?.origUid ?? uid
          );
        })
      );
      
      // Update local state
      const newEmails = emails.filter(e => !selectedUids.has(e.uid));
      setEmails(newEmails);
      
      // Update cache
      const cacheKey = getCacheKey(activeAccountId, currentFolder);
      emailCache.set(cacheKey, { data: newEmails, hasMore, timestamp: Date.now() });
      
      // Clear selection
      setSelectedUids(new Set());
      setShowDeleteConfirm(false);
      
      // Select next email
      if (newEmails.length > 0) {
        const newIndex = Math.min(selectedIndex, newEmails.length - 1);
        setSelectedIndex(newIndex);
        loadEmailPreview(newEmails[newIndex].uid);
      } else {
        setSelectedEmail(null);
      }
      
      console.log(`[BulkDelete] Deleted ${deletedCount}/${uidsToDelete.length} emails`);
    } catch (err) {
      console.error('Bulk delete error:', err);
      setActionToast('Fehler beim Löschen: ' + err.message);
    }
    
    setBulkDeleting(false);
    // Re-enable background sync
    bgLoadAbortRef.current = false;
  }, [activeAccountId, currentFolder, emails, selectedUids, hasMore, getCacheKey, selectedIndex, accountFor, allMode, isTrashFolder, isSentFolder]);

  // UX: Auswahl als gelesen markieren — häufigste Triage-Aktion für
  // Newsletter/Benachrichtigungen, bisher nur einzeln möglich.
  const handleBulkMarkRead = useCallback(async () => {
    if (!window.electronAPI || !activeAccountId || selectedUids.size === 0) return;

    const uids = Array.from(selectedUids).filter(uid => {
      const email = emailsRef.current.find(e => e.uid === uid);
      return email && !email.seen;
    });
    if (uids.length === 0) { setSelectedUids(new Set()); return; }

    setActionLoading('bulk-read');
    try {
      // v7.0: konto-bewusst pro Mail (Alle-Konten-Modus)
      const results = await Promise.allSettled(
        uids.map(uid => {
          const mailObj = emailsRef.current.find(e => e.uid === uid);
          return MailApi.markRead(
            accountFor(mailObj),
            mailObj?.origUid ?? uid,
            true,
            mailObj?.__accId ? (mailObj.__folder || 'INBOX') : currentFolder
          );
        })
      );
      const successUids = new Set(uids.filter((_, i) =>
        results[i].status === 'fulfilled' && results[i].value?.success
      ));
      if (successUids.size > 0) {
        const newEmails = emailsRef.current.map(e =>
          successUids.has(e.uid) ? { ...e, seen: true } : e
        );
        setEmails(newEmails);
        const cacheKey = getCacheKey(activeAccountId, currentFolder);
        emailCache.set(cacheKey, { data: newEmails, hasMore: hasMoreRef.current, timestamp: Date.now() });
        const localStorageEnabled = localStorage.getItem('emailSettings.localStorageEnabled') !== 'false';
        if (localStorageEnabled) saveEmailsToIndexedDB(activeAccountId, currentFolder, newEmails);
        setSelectedEmail(prev => prev && successUids.has(prev.uid) ? { ...prev, seen: true } : prev);
      }
      setSelectedUids(new Set());
    } catch (err) {
      console.error('Bulk mark-read error:', err);
      setActionToast('Fehler beim Markieren: ' + err.message);
    }
    setActionLoading(null);
  }, [activeAccountId, currentFolder, selectedUids, getCacheKey, accountFor]);

  // v2.6.0: Manual categorization handler - saves sender category and updates ALL matching emails
  const handleCategorize = useCallback((email, category) => {
    if (!email) return;

    const senderEmail = SenderCategoryManager.extractEmail(email.from);
    SenderCategoryManager.setSenderCategory(senderEmail, category);

    // Update all emails from this sender in one setState call (no version counter needed)
    setManualCategories(prev => {
      const newMap = new Map(prev);
      emails.forEach(e => {
        if (SenderCategoryManager.extractEmail(e.from) === senderEmail) {
          if (category === null) newMap.delete(e.uid);
          else newMap.set(e.uid, category);
        }
      });
      return newMap;
    });

    const catName = category
      ? MANUAL_CATEGORIES.find(c => c.id === category)?.name || category
      : 'Keine';
    console.log(`[Categorize] ${senderEmail} -> ${catName}`);
  }, [emails]);

  // v2.6.0: Apply sender-based categories when email list changes (new load/folder switch)
  useEffect(() => {
    const newCategories = new Map();
    emails.forEach(email => {
      const senderCategory = SenderCategoryManager.getSenderCategory(email.from);
      if (senderCategory) newCategories.set(email.uid, senderCategory);
    });
    // Referenz nur wechseln, wenn sich inhaltlich etwas geändert hat — sonst
    // invalidiert jeder Background-Load-Batch die Filter-Memos und die Liste.
    setManualCategories(prev => {
      if (prev.size === newCategories.size) {
        let same = true;
        for (const [uid, cat] of newCategories) {
          if (prev.get(uid) !== cat) { same = false; break; }
        }
        if (same) return prev;
      }
      return newCategories;
    });
  }, [emails]);

  // v2.6.0: Get effective category for an email (manual > spam filter)
  const getEmailCategory = useCallback((email) => {
    // Manual/sender-based category takes precedence
    const manualCat = manualCategories.get(email.uid);
    if (manualCat) return manualCat;
    
    // Fall back to spam filter analysis
    const analysis = spamResults.get(email.uid);
    return analysis?.category || null;
  }, [manualCategories, spamResults]);

  // v2.9.3: Reset reply panel + attachment progress when selected email changes
  useEffect(() => {
    setReplyMode(null);
    setReplyError(null);
    setAttachProgress({});
    setReplyAttachments([]);
    setReplyDragging(false);
    replyDragDepthRef.current = 0;
    setHeaderExpanded(false);
    if (replyEditorRef.current) replyEditorRef.current.innerHTML = '';
  }, [selectedEmail?.uid]);

  // Read files into base64 for inline reply
  const addReplyFiles = useCallback((files) => {
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64 = e.target.result.split(',')[1];
        setReplyAttachments(prev => [...prev, {
          id: `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          content: base64,
          size: file.size,
        }]);
      };
      reader.readAsDataURL(file);
    });
  }, []);

  // v2.9.3: Send inline reply
  // v6.9.1: Empfänger-Felder beim Öffnen des Reply-Panels vorbelegen —
  // ab dann frei editierbar (weitere Adressen hinzufügbar).
  useEffect(() => {
    if (!replyMode || !selectedEmail) return;
    const fromAddr = extractEmailAddr(selectedEmail.from);
    if (replyMode === 'replyAll') {
      // v7.0: im Alle-Konten-Modus das Konto der Mail nutzen — sonst wird
      // die eigene Adresse nicht aus dem CC gefiltert
      const account = selectedEmail.__accId
        ? accounts.find(a => a.id === selectedEmail.__accId)
        : accounts.find(a => a.id === activeAccountId);
      const ownEmail = (account?.smtp?.fromEmail || account?.smtp?.username || account?.microsoft?.email || '').toLowerCase();
      const toAddrs = (selectedEmail.to || '').split(/[,;]/).map(extractEmailAddr).filter(Boolean);
      const ccAddrs = (selectedEmail.cc || '').split(/[,;]/).map(extractEmailAddr).filter(Boolean);
      const rest = [...new Set([...toAddrs, ...ccAddrs])]
        .filter(a => a !== fromAddr && (!ownEmail || a.toLowerCase() !== ownEmail));
      setReplyToTags(fromAddr ? [fromAddr] : []);
      setReplyCcTags(rest);
      setReplyShowCc(rest.length > 0);
    } else {
      setReplyToTags(fromAddr ? [fromAddr] : []);
      setReplyCcTags([]);
      setReplyShowCc(false);
    }
  }, [replyMode, selectedEmail, accounts, activeAccountId]);

  const handleSendReply = useCallback(async () => {
    if (!selectedEmail || !replyEditorRef.current) return;
    // v7.0: Reentry-Schutz — Cmd+Enter kann sonst während des laufenden
    // Versands erneut feuern (doppelt zugestellte Antwort).
    if (replySendingRef.current) return;
    if (replyToTags.length === 0) {
      setReplyError('Mindestens ein Empfänger nötig');
      return;
    }
    replySendingRef.current = true;
    setReplySending(true);
    setReplyError(null);

    // v7.0: im Alle-Konten-Modus über das Konto der Mail antworten
    const account = selectedEmail.__accId
      ? accounts.find(a => a.id === selectedEmail.__accId)
      : accounts.find(a => a.id === activeAccountId);
    const replyBodyHtml = replyEditorRef.current.innerHTML || '';
    const originalHtml = selectedEmail.html || `<p>${(selectedEmail.text || '').replace(/\n/g, '<br>')}</p>`;
    const fullHtml = `${replyBodyHtml}<br><br><blockquote style="border-left:3px solid #555;padding-left:1em;color:#888;margin:0 0 0 0.5em">${originalHtml}</blockquote>`;

    const emailData = {
      to: replyToTags.join(', '),
      cc: replyCcTags.length > 0 ? replyCcTags.join(', ') : undefined,
      subject: selectedEmail.subject?.startsWith('Re:') ? selectedEmail.subject : `Re: ${selectedEmail.subject || ''}`,
      text: replyEditorRef.current.innerText || '',
      html: fullHtml,
      attachments: replyAttachments.map(a => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
    };

    try {
      const result = await MailApi.send(account, emailData);
      if (result?.success) {
        setReplyMode(null);
        setReplyAttachments([]);
        if (replyEditorRef.current) replyEditorRef.current.innerHTML = '';
        // Sichtbares Erfolgs-Feedback — das blosse Verschwinden des Panels
        // war nicht von einem Abbruch unterscheidbar.
        setReplySentToast(true);
        setTimeout(() => setReplySentToast(false), 2500);
      } else {
        setReplyError(result?.error || 'Senden fehlgeschlagen');
      }
    } catch (e) {
      setReplyError(e.message);
    }
    replySendingRef.current = false;
    setReplySending(false);
  }, [selectedEmail, activeAccountId, accounts, replyAttachments, replyToTags, replyCcTags]);
  // Für Cmd+Enter im Keyboard-Effekt (siehe oben)
  sendReplyRef.current = handleSendReply;

  // v3.0.2: Save single attachment via Electron API, then open if requested
  const saveAttachment = useCallback(async (att, index, andOpen = false) => {
    if (!att.content) return;
    setAttachProgress(prev => ({ ...prev, [index]: 'saving' }));
    try {
      const result = await window.electronAPI.saveAllAttachments([att]);
      const saved = result?.results?.[0];
      if (saved?.success) {
        setAttachProgress(prev => ({ ...prev, [index]: 'done' }));
        if (andOpen && saved.path) {
          await window.electronAPI.openFile(saved.path);
        }
        setTimeout(() => setAttachProgress(prev => ({ ...prev, [index]: null })), 2000);
      } else {
        setAttachProgress(prev => ({ ...prev, [index]: 'error' }));
      }
    } catch {
      setAttachProgress(prev => ({ ...prev, [index]: 'error' }));
    }
  }, []);

  // Keyboard navigation (v2.3.0: added Ctrl+A for select all)
  useEffect(() => {
    const handleKeyDown = (e) => {
      // v7.0: Cmd/Ctrl+Enter sendet die Inline-Antwort — auch aus dem Editor
      // heraus (deshalb VOR dem Eingabefeld-Guard). e.repeat blockt Autorepeat.
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && replyMode && !e.repeat) {
        e.preventDefault();
        sendReplyRef.current?.();
        return;
      }
      // Ignore all shortcuts when typing in an input, textarea, or contentEditable (e.g. reply editor)
      if (e.target.isContentEditable || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      // Offene Modals: Escape schliesst, alle anderen Listen-Shortcuts sind
      // gesperrt (sonst löscht die Delete-Taste im Hintergrund Mails).
      if (showDeleteConfirm || confirmDeleteUid || confirmDiscardReply || folderModal || showShortcutHelp) {
        if (e.key === 'Escape') {
          if (showDeleteConfirm) setShowDeleteConfirm(false);
          else if (confirmDeleteUid) setConfirmDeleteUid(null);
          else if (confirmDiscardReply) setConfirmDiscardReply(false);
          else if (showShortcutHelp) setShowShortcutHelp(false);
          else setFolderModal(null);
        }
        return;
      }

      // v7.0: Fremde Overlays (Cmd+K-Suche, Menüs, Dialoge anderer Komponenten)
      // blockieren die Listen-Kürzel — sonst feuern r/a/f/u/j/k dahinter.
      if (snoozeMenuOpen || document.querySelector('div.fixed.inset-0')) return;

      // Ctrl+A or Cmd+A: Select all emails
      if ((e.ctrlKey || e.metaKey) && e.key === 'a' && filteredEmails.length > 0) {
        e.preventDefault();
        setShowCheckboxes(true);
        handleSelectAll();
        return;
      }

      // Escape: Clear selection
      if (e.key === 'Escape' && selectedUids.size > 0) {
        handleClearSelection();
        return;
      }

      // Delete: v6.10.0 — ausserhalb des Papierkorbs direkt in den Papierkorb
      // verschieben (Outlook-Semantik, keine Bestätigung); nur im Papierkorb
      // selbst wird endgültig gelöscht und darum bestätigt.
      if (e.key === 'Delete') {
        const inTrash = isTrashFolder(currentFolder);
        if (selectedUids.size > 0) {
          if (inTrash) setShowDeleteConfirm(true);
          else handleBulkDelete();
        } else if (filteredEmails[selectedIndex]) {
          requestDelete(filteredEmails[selectedIndex].uid);
        }
        return;
      }

      // E: Archivieren (Outlook/Gmail-Kürzel) — aktuelle Mail
      if ((e.key === 'e' || e.key === 'E') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (filteredEmails[selectedIndex]) {
          e.preventDefault();
          handleArchive(filteredEmails[selectedIndex].uid);
        }
        return;
      }

      // v7.0: Vollständiger Tastatur-Layer (Gmail/Outlook-Kürzel)
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        // ?: Kürzel-Übersicht
        if (e.key === '?') {
          e.preventDefault();
          setShowShortcutHelp(v => !v);
          return;
        }
        // R / A / F: Antworten / Allen antworten / Weiterleiten
        if (selectedEmail) {
          if (e.key === 'r' || e.key === 'R') {
            e.preventDefault();
            setReplyMode('reply');
            return;
          }
          if (e.key === 'a' || e.key === 'A') {
            e.preventDefault();
            setReplyMode('replyAll');
            return;
          }
          if ((e.key === 'f' || e.key === 'F') && onForward) {
            e.preventDefault();
            onForward(selectedEmail);
            return;
          }
        }
        // U: Gelesen/Ungelesen umschalten
        if ((e.key === 'u' || e.key === 'U') && filteredEmails[selectedIndex]) {
          e.preventDefault();
          const m = filteredEmails[selectedIndex];
          handleToggleRead(m.uid, m.seen);
          return;
        }
      }

      // J/K als Alias für Pfeiltasten (Gmail-Navigation)
      if ((e.key === 'j' || e.key === 'J') && !e.ctrlKey && !e.metaKey && selectedIndex < filteredEmails.length - 1) {
        e.preventDefault();
        const next = selectedIndex + 1;
        handleSelectEmail(next);
        emailScrollRef.current?.querySelectorAll('.cm-list-item')[next]?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
        return;
      }
      if ((e.key === 'k' || e.key === 'K') && !e.ctrlKey && !e.metaKey && selectedIndex > 0) {
        e.preventDefault();
        const prev = selectedIndex - 1;
        handleSelectEmail(prev);
        emailScrollRef.current?.querySelectorAll('.cm-list-item')[prev]?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
        return;
      }

      if (e.key === 'ArrowDown' && selectedIndex < filteredEmails.length - 1) {
        const next = selectedIndex + 1;
        handleSelectEmail(next);
        emailScrollRef.current?.querySelectorAll('.cm-list-item')[next]?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      } else if (e.key === 'ArrowUp' && selectedIndex > 0) {
        const prev = selectedIndex - 1;
        handleSelectEmail(prev);
        emailScrollRef.current?.querySelectorAll('.cm-list-item')[prev]?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      } else if (e.key === 'Enter' && selectedEmail) {
        onFullView(selectedEmail, currentFolder);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIndex, filteredEmails, selectedEmail, onFullView, currentFolder, handleDelete, handleSelectAll, handleClearSelection, selectedUids, showDeleteConfirm, folderModal, confirmDeleteUid, confirmDiscardReply, isTrashFolder, handleBulkDelete, requestDelete, handleArchive, handleSelectEmail, handleToggleRead, onForward, replyMode, showShortcutHelp, snoozeMenuOpen]);

  // Trigger loadMore when user scrolls near the bottom of the email list
  const handleEmailListScroll = useCallback((e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    if (scrollHeight - scrollTop - clientHeight < 400 && hasMore && !loadingMore) {
      loadMoreEmails();
    }
  }, [hasMore, loadingMore, loadMoreEmails]);

  const account = getActiveAccount();

  // v7.2.0: Der Kalenderteil einer Einladung gehört in die Einladungskarte,
  // nicht ins Anhang-Banner — sonst steht er doppelt da. `index` wird
  // mitgeführt, damit der bestehende Speicher-Fortschritt weiter passt.
  const attachmentsWithIndex = useMemo(
    () => (selectedEmail?.attachments || []).map((att, index) => ({ ...att, index })),
    [selectedEmail]
  );
  const calendarAttachment = useMemo(
    () => attachmentsWithIndex.find(a => a.isCalendar && a.content) || null,
    [attachmentsWithIndex]
  );
  const visibleAttachments = useMemo(
    () => (selectedEmail?.invitation ? attachmentsWithIndex.filter(a => !a.isCalendar) : attachmentsWithIndex),
    [attachmentsWithIndex, selectedEmail]
  );
  // Im vereinheitlichten Posteingang kann die Mail zu einem anderen Konto
  // gehören als dem aktiven — die Zu-/Absage muss über dessen Konto laufen.
  const invitationAccount = useMemo(() => accountFor(selectedEmail), [accountFor, selectedEmail]);

  // v1.11.1: Sort folders with INBOX first, then standard folders, then alphabetically
  const sortedFolders = useMemo(() => {
    // Priority order for standard folders
    const folderPriority = {
      'inbox': 1,
      'sent': 2,
      'drafts': 3,
      'trash': 4,
      'spam': 5,
      'archive': 6
    };
    
    const getSortPriority = (folder) => {
      // Check folder type first
      if (folder.type && folderPriority[folder.type]) {
        return folderPriority[folder.type];
      }
      // Check folder name/path
      const lowerName = (folder.name || folder.path || '').toLowerCase();
      if (lowerName === 'inbox' || lowerName === 'posteingang') return 1;
      if (lowerName.includes('sent') || lowerName.includes('gesendet')) return 2;
      if (lowerName.includes('draft') || lowerName.includes('entwürfe') || lowerName.includes('entwurf')) return 3;
      if (lowerName.includes('trash') || lowerName.includes('papierkorb') || lowerName.includes('gelöscht')) return 4;
      if (lowerName.includes('spam') || lowerName.includes('junk')) return 5;
      if (lowerName.includes('archiv') || lowerName.includes('archive')) return 6;
      return 100; // Other folders
    };
    
    const sortFolderList = (folderList) => {
      return [...folderList].sort((a, b) => {
        const priorityA = getSortPriority(a);
        const priorityB = getSortPriority(b);
        
        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }
        // Alphabetical for same priority
        return (a.name || a.path || '').localeCompare(b.name || b.path || '', 'de');
      }).map(folder => ({
        ...folder,
        children: folder.children?.length > 0 ? sortFolderList(folder.children) : folder.children
      }));
    };
    
    return sortFolderList(folders);
  }, [folders]);

  // Flat folder list for display (using sorted folders)
  const flatFolders = useMemo(() => {
    const flat = [];
    const flatten = (folderList, depth = 0) => {
      folderList.forEach(folder => {
        flat.push({ ...folder, depth });
        if (folder.children?.length > 0 && !collapsedFolders.has(folder.path)) {
          flatten(folder.children, depth + 1);
        }
      });
    };
    flatten(sortedFolders);
    return flat;
  }, [sortedFolders, collapsedFolders]);

  // IndexedDB quota warning listener
  useEffect(() => {
    const handler = () => setShowQuotaWarning(true);
    window.addEventListener(INDEXEDDB_QUOTA_EVENT, handler);
    return () => window.removeEventListener(INDEXEDDB_QUOTA_EVENT, handler);
  }, []);


  // Perf: debounce spam analysis + limit Map to current emails only
  const spamDebounceRef = useRef(null);
  useEffect(() => {
    const settings = getSpamFilterSettings();
    if (!settings.enabled || emails.length === 0) {
      setSpamResults(new Map());
      return;
    }
    if (spamDebounceRef.current) clearTimeout(spamDebounceRef.current);
    spamDebounceRef.current = setTimeout(() => {
      const results = analyzeEmails(emails, settings);
      // Perf: drop entries for emails no longer in view — prevents unbounded growth
      const currentUids = new Set(emails.map(e => e.uid));
      const cleaned = new Map();
      results.forEach((v, k) => { if (currentUids.has(k)) cleaned.set(k, v); });
      setSpamResults(cleaned);
    }, 300);
    return () => clearTimeout(spamDebounceRef.current);
  }, [emails]);

  // v1.11.0: Count unread emails
  const unreadCount = useMemo(() => {
    return emails.filter(e => !e.seen).length;
  }, [emails]);

  // v2.6.0: Category counts for inbox subfolders (includes manual + auto categories)
  const categoryCounts = useMemo(() => {
    const counts = { whitelist: 0, werbung: 0, spam: 0, schaedlich: 0, virus: 0 };
    if (currentFolder !== 'INBOX') return counts;
    
    emails.forEach(email => {
      // Check manual/sender category first
      const manualCat = manualCategories.get(email.uid);
      if (manualCat && counts.hasOwnProperty(manualCat)) {
        counts[manualCat]++;
        return;
      }
      
      // Fall back to spam filter
      const analysis = spamResults.get(email.uid);
      if (analysis?.category && counts.hasOwnProperty(analysis.category)) {
        counts[analysis.category]++;
      }
    });
    return counts;
  }, [emails, manualCategories, spamResults, currentFolder]);

  // v2.4.0: Reset category filter when folder changes
  useEffect(() => {
    if (currentFolder !== 'INBOX') {
      setCategoryFilter(null);
    }
    setShowUnreadOnly(false);
  }, [currentFolder]);

  // v2.4.0: Reset selection when category filter changes
  useEffect(() => {
    setSelectedIndex(0);
    setSelectedEmail(null);
    setSelectedUids(new Set());
    if (filteredEmails.length > 0) {
      loadEmailPreview(filteredEmails[0].uid);
    }
  }, [categoryFilter]);

  // v1.11.1: Update account stats when emails are loaded (for sidebar unread badge)
  // v7.0: nicht im Alle-Konten-Modus — sonst entsteht ein '__ALL__'-Eintrag,
  // der die Summen in Sidebar- und Dock-Badge verdoppelt.
  useEffect(() => {
    if (activeAccountId && activeAccountId !== '__ALL__' && currentFolder === 'INBOX' && emails.length > 0) {
      const unread = emails.filter(e => !e.seen).length;
      updateAccountStats(activeAccountId, {
        unread,
        total: emails.length,
        lastUpdated: Date.now()
      });
    }
  }, [activeAccountId, currentFolder, emails, updateAccountStats]);

  if (!activeAccountId) {
    return (
      <div className={`flex-1 flex items-center justify-center ${c.bgSecondary}`}>
        <div className={`text-center ${c.textSecondary}`}>
          <Email size={48} className="mx-auto mb-4 opacity-60" />
          <p>Wähle ein Konto aus der Sidebar</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={`flex-1 flex overflow-hidden ${c.bg}`}>
        {/* Folder skeleton */}
        <div className={`${c.bgSecondary} ${c.border} border-r flex flex-col`} style={{ width: '200px' }}>
          <div className={`p-3 ${c.border} border-b`}><div className="cm-skeleton h-4 w-16" /></div>
          <div className="p-3 space-y-2">
            {[100,80,90,70,85].map((w,i) => <div key={i} className="cm-skeleton h-7 rounded-xl" style={{ width: `${w}%`, animationDelay: `${i*80}ms` }} />)}
          </div>
        </div>
        {/* Email list skeleton */}
        <div className={`${c.bgSecondary} ${c.border} border-r flex flex-col`} style={{ width: '320px' }}>
          <div className={`p-4 ${c.border} border-b`}><div className="cm-skeleton h-5 w-32" /></div>
          <div className="flex-1 overflow-hidden">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className={`p-3 ${c.border} border-b`} style={{ animationDelay: `${i*60}ms` }}>
                <div className="flex gap-2 mb-2">
                  <div className="cm-skeleton h-3.5 rounded-full w-2.5" />
                  <div className="cm-skeleton h-3.5 flex-1" style={{ animationDelay: `${i*60+20}ms` }} />
                  <div className="cm-skeleton h-3 w-10" style={{ animationDelay: `${i*60+40}ms` }} />
                </div>
                <div className="cm-skeleton h-3 w-4/5 ml-4 mb-1.5" style={{ animationDelay: `${i*60+30}ms` }} />
                <div className="cm-skeleton h-3 w-2/3 ml-4" style={{ animationDelay: `${i*60+50}ms` }} />
              </div>
            ))}
          </div>
        </div>
        {/* Preview skeleton */}
        <div className={`flex-1 ${c.bg} p-6`}>
          <div className="cm-skeleton h-6 w-2/3 mb-4" />
          <div className="cm-skeleton h-4 w-1/3 mb-6" />
          {[95,88,72,80,60].map((w,i) => <div key={i} className="cm-skeleton h-3 mb-2" style={{ width: `${w}%`, animationDelay: `${i*60}ms` }} />)}
        </div>
      </div>
    );
  }

  if (error) {
    const activeAccount = getActiveAccount();
    const isMsAccount = activeAccount?.type === 'microsoft';
    return (
      <div className={`flex-1 flex items-center justify-center ${c.bgSecondary}`}>
        <div className="text-center max-w-lg px-4">
          <WarningFilled size={48} className="text-red-400 mx-auto mb-4" />
          <h3 className={`font-semibold ${c.text} mb-2`}>Verbindung fehlgeschlagen</h3>
          {!isMsAccount && activeAccount?.imap?.host && (
            <p className={`text-xs ${c.textSecondary} mb-2`}>
              {activeAccount.imap.host}:{activeAccount.imap.port} ({activeAccount.imap.username})
            </p>
          )}
          <div className="bg-red-900/20 border border-red-500/30 rounded-lg p-3 mb-3 text-left">
            <p className="text-red-400 text-sm font-mono break-all">{error}</p>
          </div>
          <p className={`text-xs ${c.textSecondary} mb-4`}>
            {isMsAccount
              ? 'Öffne die Konto-Einstellungen und verbinde das Microsoft-Konto erneut.'
              : 'Überprüfe Host, Port, Benutzername und Passwort. Bei Gmail/Outlook wird ein App-Passwort benötigt.'}
          </p>
          <div className="flex flex-wrap gap-2 justify-center">
            <button onClick={() => fetchEmails(false)} className={`px-4 py-2 ${c.accentBg} text-white rounded-lg text-sm`}>
              Erneut versuchen
            </button>
            {onNavigate && (
              <button onClick={() => onNavigate('accounts')} className={`px-4 py-2 ${c.bgTertiary} ${c.text} ${c.border} border rounded-lg text-sm`}>
                Konto-Einstellungen
              </button>
            )}
            {window.electronAPI?.openDevTools && (
              <button onClick={() => window.electronAPI.openDevTools()} className={`px-4 py-2 ${c.bgTertiary} ${c.textSecondary} ${c.border} border rounded-lg text-sm`}>
                DevTools
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex-1 flex flex-col overflow-hidden min-h-0 ${c.bg}`}>
      {/* v6.6.0: Snooze-Menu (fixed position, anchored to button) */}
      <SnoozeMenu
        open={snoozeMenuOpen}
        onClose={() => setSnoozeMenuOpen(false)}
        onPick={handleSnoozePick}
        anchorRect={snoozeAnchorRect}
      />
      {/* IndexedDB quota warning */}
      {showQuotaWarning && (
        <div className="flex items-center gap-3 px-4 py-2 bg-yellow-500/20 border-b border-yellow-500/40 text-yellow-300 text-sm flex-shrink-0">
          <WarningAlt size={16} className="flex-shrink-0" />
          <span>Offline-Speicher voll. Ältere E-Mails werden nicht mehr zwischengespeichert.</span>
          <button onClick={() => setShowQuotaWarning(false)} className="ml-auto opacity-60 hover:opacity-100"><Close size={16} /></button>
        </div>
      )}
      {/* v7.0: Tastaturkürzel-Hilfe (?-Taste) */}
      {showShortcutHelp && (
        <div className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center" onClick={() => setShowShortcutHelp(false)}>
          <div className={`${c.popover || c.card} ${c.border} border rounded-xl p-6 max-w-lg w-full mx-4 shadow-2xl`} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className={`text-lg font-semibold ${c.text}`}>Tastaturkürzel</h3>
              <button onClick={() => setShowShortcutHelp(false)} className={`p-1 rounded ${c.hover} ${c.textSecondary}`}><Close size={16} /></button>
            </div>
            <div className={`grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 text-sm ${c.text}`}>
              {[
                ['↑ / ↓  oder  J / K', 'Mail-Navigation'],
                ['Enter', 'Vollansicht öffnen'],
                ['E', 'Archivieren'],
                ['Entf', 'In den Papierkorb'],
                ['R', 'Antworten'],
                ['A', 'Allen antworten'],
                ['F', 'Weiterleiten'],
                ['U', 'Gelesen/Ungelesen'],
                ['⌘/Ctrl + Enter', 'Antwort senden'],
                ['⌘/Ctrl + A', 'Alle auswählen'],
                ['Esc', 'Auswahl aufheben / schliessen'],
                ['⌘/Ctrl + K', 'Suche'],
                ['?', 'Diese Hilfe'],
              ].map(([key, desc]) => (
                <React.Fragment key={key}>
                  <kbd className={`px-2 py-0.5 rounded ${c.bgTertiary} ${c.border} border text-xs font-mono justify-self-start`}>{key}</kbd>
                  <span className={c.textSecondary}>{desc}</span>
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      )}
      {/* v6.9.6: Aktions-Toast — ersetzt den Vollbild-Fehler bei Snooze/Löschen/Markieren/Triage.
          v6.11.0: String = Fehler; Objekt { text, undo?, error? } für Info-Toasts mit Rückgängig. */}
      {actionToast && (() => {
        const t = typeof actionToast === 'string' ? { text: actionToast, error: true } : actionToast;
        return (
          <div className={`fixed bottom-4 right-4 z-[60] flex items-center gap-3 px-4 py-3 border text-sm rounded-xl shadow-2xl max-w-sm ${
            t.error ? 'bg-red-900/95 border-red-500/40 text-red-100' : 'bg-gray-900/95 border-white/20 text-gray-100'
          }`}>
            {t.error ? <WarningAlt size={16} className="flex-shrink-0" /> : <Checkmark size={16} className="flex-shrink-0 text-green-400" />}
            <span className="break-words">{t.text}</span>
            {t.undo && (
              <button
                onClick={() => { const u = t.undo; setActionToast(null); u(); }}
                className="ml-1 px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-cyan-300 font-medium flex-shrink-0"
              >
                Rückgängig
              </button>
            )}
            <button onClick={() => setActionToast(null)} className="ml-auto opacity-60 hover:opacity-100 flex-shrink-0"><Close size={16} /></button>
          </div>
        );
      })()}
    <div className={`flex-1 flex overflow-hidden min-h-0 ${c.bg}`}>
      {/* Folder List - Resizable (v1.8.1) + v6.6.2 Hover-Expand */}
      <div
        {...folderPanel.hoverProps}
        className={`${c.bgSecondary} ${c.border} border-r flex flex-col overflow-hidden min-h-0 relative`}
        style={{
          width: folderPanel.isExpanded ? `${folderWidth}px` : `${FOLDER_COLLAPSED_WIDTH}px`,
          minWidth: folderPanel.isExpanded ? `${FOLDER_MIN_WIDTH}px` : `${FOLDER_COLLAPSED_WIDTH}px`,
          maxWidth: folderPanel.isExpanded ? `${FOLDER_MAX_WIDTH}px` : `${FOLDER_COLLAPSED_WIDTH}px`,
          alignSelf: 'stretch',
          transition: isResizingFolder ? 'none' : PANEL_TRANSITION
        }}
      >
        <div className={`p-3 ${c.border} border-b flex items-center ${folderPanel.isExpanded ? 'justify-between' : 'justify-center'}`}>
          {folderPanel.isExpanded && <h3 className={`font-medium ${c.text} text-sm`}>Ordner</h3>}
          <div className="flex items-center gap-1">
            {folderPanel.isExpanded && (
              <>
                <button
                  onClick={openCreateFolder}
                  title="Neuer Ordner"
                  className={`p-1 rounded hover:bg-white/10 transition-colors ${c.textSecondary} hover:text-cyan-400`}
                >
                  <FolderAdd size={16} />
                </button>
                <button
                  onClick={() => { folderCache.delete(`folders:${activeAccountId}`); loadFolders(true); }}
                  title="Ordner synchronisieren"
                  className={`p-1 rounded hover:bg-white/10 transition-colors ${c.textSecondary}`}
                >
                  <Renew size={16} className={loadingFolders ? 'animate-spin' : ''} />
                </button>
              </>
            )}
            <PanelModeToggle panel={folderPanel} c={c} />
          </div>
        </div>
        {folderError && (
          <div className="px-3 py-2 text-xs text-red-400 bg-red-900/20 border-b border-red-500/20 flex items-center gap-2">
            <WarningAlt size={16} className="flex-shrink-0" /> {folderError}
          </div>
        )}
        <div className="flex-1 overflow-y-auto py-2">
          {flatFolders.map(folder => (
            <div
              key={folder.path}
              onMouseEnter={() => setHoveredFolder(folder.path)}
              onMouseLeave={() => setHoveredFolder(null)}
              className="relative group/folder"
            >
              <button
                onClick={() => {
                  setCurrentFolder(folder.path);
                  if (folder.path === 'INBOX') {
                    setCategoryFilter(null);
                  }
                }}
                onDragOver={(e) => { e.preventDefault(); setDragOverFolder(folder.path); }}
                onDragLeave={() => setDragOverFolder(null)}
                onDrop={() => handleDropOnFolder(folder.path)}
                title={folderPanel.isExpanded ? '' : folder.name}
                className={`w-full text-left ${folderPanel.isExpanded ? 'px-3' : 'px-2 justify-center'} py-2 flex items-center gap-2 text-sm transition-colors ${
                  currentFolder === folder.path && !categoryFilter
                    ? `${c.accentBg} text-white`
                    : dragOverFolder === folder.path
                    ? 'bg-cyan-500/30 scale-[1.02]'
                    : `${c.textSecondary} ${c.hover}`
                }`}
                style={folderPanel.isExpanded ? { paddingLeft: `${(folder.depth * 12) + 12}px` } : undefined}
              >
                {/* Expand/Collapse arrow for INBOX virtual subfolders — nur im offenen Modus */}
                {folderPanel.isExpanded && (folder.path === 'INBOX' ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setInboxExpanded(!inboxExpanded);
                    }}
                    className="p-0.5 -ml-1 hover:bg-white/10 rounded"
                  >
                    {inboxExpanded ? (
                      <ChevronDown size={16} />
                    ) : (
                      <ChevronRight size={16} />
                    )}
                  </button>
                ) : folder.children?.length > 0 ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleFolderCollapsed(folder.path); }}
                    className="p-0.5 -ml-1 hover:bg-white/10 rounded"
                  >
                    {collapsedFolders.has(folder.path) ? (
                      <ChevronRight size={16} />
                    ) : (
                      <ChevronDown size={16} />
                    )}
                  </button>
                ) : (
                  <span className="w-4 shrink-0" />
                ))}
                {!folderPanel.isExpanded && !['inbox','sent','sentitems','drafts','trash','deleteditems','spam','junkemail','archive'].includes(folder.type) ? (
                  // Eingeklappt: Anfangsbuchstabe statt 20 identischer Ordner-Icons —
                  // sonst ist der Streifen ohne Hovern nicht unterscheidbar.
                  <span className="w-4 h-4 flex items-center justify-center text-[11px] font-bold uppercase rounded-sm bg-white/10">
                    {(folder.name || '?').charAt(0)}
                  </span>
                ) : (
                  getFolderIcon(folder.type)
                )}
                {folderPanel.isExpanded && <span className="truncate flex-1">{folder.name}</span>}
                {/* Unread count badge — auch im kollabierten Modus zeigen, wenn > 0 */}
                {folder.path === 'INBOX' && unreadCount > 0 && (
                  <span className={`${folderPanel.isExpanded ? 'px-1.5 py-0.5' : 'absolute -top-0.5 -right-0.5 w-4 h-4 flex items-center justify-center'} bg-blue-500 text-white text-[10px] rounded-full font-medium min-w-[16px] text-center`}>
                    {unreadCount > 99 ? '99' : unreadCount}
                  </span>
                )}
                {folder.unread > 0 && folder.path !== 'INBOX' && folderPanel.isExpanded && (
                  <span className="px-1.5 py-0.5 bg-blue-500/80 text-white text-xs rounded-full font-medium min-w-[20px] text-center">
                    {folder.unread}
                  </span>
                )}
              </button>
              {/* Edit / Delete buttons — only for custom (non-system) folders */}
              {hoveredFolder === folder.path && !SYSTEM_FOLDERS.has(folder.path) && (
                <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 z-10">
                  <button
                    onClick={(e) => { e.stopPropagation(); openRenameFolder(folder); }}
                    title="Umbenennen"
                    className="p-1 rounded hover:bg-white/15 text-gray-400 hover:text-cyan-400 transition-colors"
                  >
                    <Edit size={16} />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); openDeleteFolder(folder); }}
                    title="Löschen"
                    className="p-1 rounded hover:bg-white/15 text-gray-400 hover:text-red-400 transition-colors"
                  >
                    <TrashCan size={16} />
                  </button>
                </div>
              )}
              
              {/* v2.4.0: Virtual Inbox Subfolders */}
              {folder.path === 'INBOX' && inboxExpanded && (
                <div className="ml-3">
                  {INBOX_SUBFOLDERS.map(subfolder => {
                    const SubIcon = subfolder.icon;
                    const count = categoryCounts[subfolder.id] || 0;
                    const isActive = currentFolder === 'INBOX' && categoryFilter === subfolder.id;
                    
                    return (
                      <button
                        key={subfolder.id}
                        onClick={() => {
                          setCurrentFolder('INBOX');
                          setCategoryFilter(subfolder.id);
                        }}
                        className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-sm transition-colors rounded-lg my-0.5 ${
                          isActive
                            ? `${subfolder.bgColor} ${subfolder.color}`
                            : `${c.textSecondary} ${c.hover}`
                        }`}
                        style={{ paddingLeft: '24px' }}
                      >
                        <SubIcon className={`w-4 h-4 ${isActive ? subfolder.color : ''}`} />
                        <span className="truncate flex-1">{subfolder.name}</span>
                        {count > 0 && (
                          <span className={`px-1.5 py-0.5 ${subfolder.bgColor} ${subfolder.color} text-xs rounded-full font-medium min-w-[20px] text-center`}>
                            {count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
          
          {flatFolders.length === 0 && !loadingFolders && (
            <div className={`px-3 py-2 text-sm ${c.textSecondary}`}>
              <button
                onClick={() => setCurrentFolder('INBOX')}
                className={`w-full text-left flex items-center gap-2 py-2 ${
                  currentFolder === 'INBOX' ? c.accent : ''
                }`}
              >
                <MailAll size={16} />
                Posteingang
                {unreadCount > 0 && (
                  <span className="ml-auto px-1.5 py-0.5 bg-blue-500 text-white text-xs rounded-full">
                    {unreadCount}
                  </span>
                )}
              </button>
            </div>
          )}
        </div>
        
        {/* Resize Handle */}
        <div
          onMouseDown={() => setIsResizingFolder(true)}
          className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-cyan-500/50 transition-colors ${isResizingFolder ? 'bg-cyan-500' : ''}`}
          title="Ziehen zum Ändern der Breite"
        />

        {/* ── Folder Modal (create / rename / delete) ── */}
        {folderModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setFolderModal(null)}>
            <div
              className={`w-80 rounded-2xl p-6 ${c.card} border ${c.border} shadow-2xl`}
              onClick={e => e.stopPropagation()}
            >
              {folderModal.mode === 'create' && (
                <>
                  <h3 className={`text-base font-semibold ${c.text} mb-4 flex items-center gap-2`}>
                    <FolderAdd size={20} className="text-cyan-400" /> Neuer Ordner
                  </h3>
                  <input
                    autoFocus
                    type="text"
                    value={folderModalInput}
                    onChange={e => setFolderModalInput(e.target.value)}
                    onKeyDown={handleFolderModalKey}
                    placeholder="Ordnername…"
                    className={`w-full px-3 py-2 rounded-lg text-sm ${c.input} border ${c.border} focus:outline-none focus:ring-1 focus:ring-cyan-500/50 mb-3`}
                  />
                </>
              )}
              {folderModal.mode === 'rename' && (
                <>
                  <h3 className={`text-base font-semibold ${c.text} mb-4 flex items-center gap-2`}>
                    <Edit size={20} className="text-cyan-400" /> Ordner umbenennen
                  </h3>
                  <input
                    autoFocus
                    type="text"
                    value={folderModalInput}
                    onChange={e => setFolderModalInput(e.target.value)}
                    onKeyDown={handleFolderModalKey}
                    placeholder="Neuer Name…"
                    className={`w-full px-3 py-2 rounded-lg text-sm ${c.input} border ${c.border} focus:outline-none focus:ring-1 focus:ring-cyan-500/50 mb-3`}
                  />
                </>
              )}
              {folderModal.mode === 'delete' && (
                <>
                  <h3 className={`text-base font-semibold ${c.text} mb-2 flex items-center gap-2`}>
                    <TrashCan size={20} className="text-red-400" /> Ordner löschen
                  </h3>
                  <p className={`text-sm ${c.textSecondary} mb-4`}>
                    Ordner <strong className={c.text}>"{folderModal.folder.name}"</strong> dauerhaft löschen?
                    Alle enthaltenen E-Mails werden ebenfalls gelöscht.
                  </p>
                </>
              )}
              {folderModalError && (
                <p className="text-xs text-red-400 mb-3 flex items-center gap-1">
                  <WarningAlt size={16} className="flex-shrink-0" /> {folderModalError}
                </p>
              )}
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setFolderModal(null)}
                  className={`px-4 py-2 rounded-lg text-sm ${c.bgTertiary} ${c.text} ${c.hover} border ${c.border}`}
                >
                  Abbrechen
                </button>
                <button
                  onClick={submitFolderModal}
                  disabled={folderModalLoading}
                  className={`px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-1.5 ${
                    folderModal.mode === 'delete'
                      ? 'bg-red-600 hover:bg-red-500 text-white'
                      : 'bg-cyan-600 hover:bg-cyan-500 text-white'
                  }`}
                >
                  {folderModalLoading && <InProgress size={16} className="animate-spin" />}
                  {folderModal.mode === 'create' ? 'Erstellen' : folderModal.mode === 'rename' ? 'Umbenennen' : 'Löschen'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Email List - v1.12.2: Resizable, v2.3.0: Multi-Select, v6.6.2: Hover-Expand */}
      <div
        {...mailListPanel.hoverProps}
        className={`${c.bgSecondary} ${c.border} border-r flex flex-col overflow-hidden min-h-0 relative`}
        style={{
          width: mailListPanel.isExpanded ? `${emailListWidth}px` : `${EMAIL_LIST_COLLAPSED_WIDTH}px`,
          minWidth: mailListPanel.isExpanded ? `${EMAIL_LIST_MIN_WIDTH}px` : `${EMAIL_LIST_COLLAPSED_WIDTH}px`,
          maxWidth: mailListPanel.isExpanded ? `${EMAIL_LIST_MAX_WIDTH}px` : `${EMAIL_LIST_COLLAPSED_WIDTH}px`,
          alignSelf: 'stretch',
          transition: isResizingEmailList ? 'none' : PANEL_TRANSITION
        }}
      >
        {!mailListPanel.isExpanded && (
          // v6.6.2: Kollabierter Modus — Mini-Vorschau mit Avatar-Initialen + Unread-Ring.
          // Klick wählt die Mail aus (Preview rendert sich neu); Hover öffnet die Spalte
          // ohnehin nach kurzer Zeit wenn Modus = auto.
          <div className="flex flex-col h-full overflow-hidden">
            <div className={`pt-2 pb-1 px-1 ${c.border} border-b flex flex-col items-center gap-1`}>
              <PanelModeToggle panel={mailListPanel} c={c} />
              {unreadCount > 0 && (
                <span className="px-1 py-0.5 bg-blue-500 text-white text-[10px] rounded-full font-medium min-w-[18px] text-center leading-tight" title={`${unreadCount} ungelesen`}>
                  {unreadCount > 99 ? '99' : unreadCount}
                </span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {filteredEmails.length === 0 ? (
                <div className={`p-2 text-center ${c.textSecondary} text-[10px]`}>—</div>
              ) : (
                filteredEmails.slice(0, 100).map((email, index) => {
                  const av = avatarFor(email);
                  const isUnread = !email.seen;
                  const isSelected = index === selectedIndex;
                  return (
                    <button
                      key={email.uid}
                      onClick={() => handleSelectEmail(index)}
                      title={`${email.fromName || email.from}: ${email.subject || '(Kein Betreff)'}`}
                      className={`w-full px-1 py-1 flex justify-center transition-colors ${
                        isSelected ? c.bgTertiary : c.hover
                      }`}
                    >
                      <span
                        className={`relative inline-flex items-center justify-center w-9 h-9 rounded-full text-white text-xs font-semibold ${av.color} ${
                          isUnread ? 'ring-2 ring-blue-500 ring-offset-1 ring-offset-transparent' : ''
                        } ${isSelected ? 'shadow-[0_0_0_2px_rgba(6,182,212,0.7)]' : ''}`}
                      >
                        {av.initial}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
        {mailListPanel.isExpanded && (
        <div className={`p-4 ${c.border} border-b`}>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                {/* truncate statt Umbruch — lange Kontonamen brachen über 4 Zeilen um */}
                <h2 className={`font-semibold ${c.text} truncate`} title={account?.name || 'Posteingang'}>{account?.name || 'Posteingang'}</h2>
                {/* v2.4.0: Show active category filter */}
                {categoryFilter && currentFolder === 'INBOX' && (
                  <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                    INBOX_SUBFOLDERS.find(f => f.id === categoryFilter)?.bgColor || 'bg-gray-500/20'
                  } ${
                    INBOX_SUBFOLDERS.find(f => f.id === categoryFilter)?.color || 'text-gray-400'
                  }`}>
                    {INBOX_SUBFOLDERS.find(f => f.id === categoryFilter)?.name}
                    <button
                      onClick={() => setCategoryFilter(null)}
                      className="ml-1.5 hover:opacity-70 inline-flex items-center align-middle"
                      title="Filter entfernen"
                      aria-label="Kategorie-Filter entfernen"
                    >
                      <Close size={12} />
                    </button>
                  </span>
                )}
              </div>
              <p className={`text-sm ${c.textSecondary}`}>
                {filteredEmails.length} E-Mails {currentFolder !== 'INBOX' && `in ${currentFolder}`}
                {(categoryFilter || showUnreadOnly) && ` (von ${emails.length} gesamt)`}
                {!categoryFilter && !showUnreadOnly && unreadCount > 0 && (
                  <span className="ml-2 text-blue-400">({unreadCount} ungelesen)</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {/* v2.8.5: Ungelesen-Filter */}
              <button
                onClick={() => setShowUnreadOnly(v => !v)}
                className={`p-2 rounded-lg transition-colors ${showUnreadOnly ? 'bg-blue-500 text-white' : `${c.hover} ${c.textSecondary}`}`}
                title={showUnreadOnly ? 'Alle E-Mails anzeigen' : 'Nur ungelesene anzeigen'}
                aria-label={showUnreadOnly ? 'Alle E-Mails anzeigen' : 'Nur ungelesene anzeigen'}
                aria-pressed={showUnreadOnly}
              >
                <Email size={16} />
              </button>
              {/* v2.3.0: Toggle Multi-Select */}
              <button
                onClick={() => {
                  setShowCheckboxes(!showCheckboxes);
                  if (showCheckboxes) setSelectedUids(new Set());
                }}
                className={`p-2 ${showCheckboxes ? c.accentBg + ' text-white' : c.hover} rounded-lg transition-colors ${c.textSecondary}`}
                title="Mehrfachauswahl"
                aria-label="Mehrfachauswahl"
                aria-pressed={showCheckboxes}
              >
                <CheckboxChecked size={16} />
              </button>
              <button
                onClick={() => fetchEmails(false)}
                className={`p-2 ${c.hover} rounded-lg transition-colors ${c.textSecondary}`}
                title="Aktualisieren"
                aria-label="Aktualisieren"
              >
                <Renew size={16} />
              </button>
              {/* v6.6.0: AI-Triage */}
              <button
                onClick={handleRunTriage}
                disabled={triageRunning || filteredEmails.length === 0}
                className={`p-2 rounded-lg transition-colors ${triageRunning ? c.accentBg + ' text-white' : `${c.hover} ${c.textSecondary}`} disabled:opacity-50`}
                title="Mails durch AI einstufen"
                aria-label="Mails durch AI einstufen"
              >
                {triageRunning ? <InProgress size={16} className="animate-spin" /> : <Bot size={16} />}
              </button>
              {/* v6.6.2: Spalten-Modus Toggle */}
              <PanelModeToggle panel={mailListPanel} c={c} />
            </div>
          </div>
          {triageProgress && (
            <p className={`mt-2 text-xs ${c.textSecondary}`}>
              AI-Triage: {triageProgress.processed} / {triageProgress.total} verarbeitet…
            </p>
          )}
          
          {/* v2.3.0: Multi-Select Controls */}
          {showCheckboxes && (
            <div className={`mt-3 pt-3 ${c.border} border-t flex items-center justify-between gap-2`}>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSelectAll}
                  className={`px-3 py-1.5 text-xs ${c.hover} rounded-lg transition-colors ${c.textSecondary} flex items-center gap-1.5`}
                >
                  {selectedUids.size === filteredEmails.length && filteredEmails.length > 0 ? (
                    <>
                      <CloseFilled size={16} />
                      Keine
                    </>
                  ) : (
                    <>
                      <CheckboxChecked size={16} />
                      Alle
                    </>
                  )}
                </button>
                {selectedUids.size > 0 && (
                  <span className={`text-xs ${c.accent}`}>
                    {selectedUids.size} ausgewählt
                  </span>
                )}
              </div>
              
              {selectedUids.size > 0 && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleBulkMarkRead}
                    disabled={actionLoading === 'bulk-read'}
                    className={`px-3 py-1.5 text-xs ${c.hover} rounded-lg transition-colors ${c.textSecondary} flex items-center gap-1.5`}
                    title="Ausgewählte als gelesen markieren"
                  >
                    {actionLoading === 'bulk-read'
                      ? <InProgress size={16} className="animate-spin" />
                      : <Email size={16} />}
                    Gelesen
                  </button>
                  <button
                    onClick={() => {
                      // v6.10.0: Bestätigung nur im Papierkorb (endgültig) —
                      // sonst direkt in den Papierkorb verschieben.
                      if (isTrashFolder(currentFolder)) setShowDeleteConfirm(true);
                      else handleBulkDelete();
                    }}
                    className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors flex items-center gap-1.5"
                  >
                    <TrashCan size={16} />
                    Löschen ({selectedUids.size})
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        )}
        {mailListPanel.isExpanded && (
        <div
          ref={emailScrollRef}
          className="flex-1 overflow-y-auto min-h-0"
          onScroll={handleEmailListScroll}
        >
          {filteredEmails.length === 0 ? (
            <div className={`p-8 text-center ${c.textSecondary}`}>
              {showUnreadOnly ? (
                <div>
                  <CheckmarkFilled size={32} className="mx-auto mb-2 text-green-400" />
                  <p>Keine ungelesenen E-Mails</p>
                  <button
                    onClick={() => setShowUnreadOnly(false)}
                    className={`mt-2 text-sm ${c.accent} hover:underline`}
                  >
                    Alle E-Mails anzeigen
                  </button>
                </div>
              ) : categoryFilter ? (
                <div>
                  <MailAll size={32} className="mx-auto mb-2 opacity-60" />
                  <p>Keine E-Mails in dieser Kategorie</p>
                  <button
                    onClick={() => setCategoryFilter(null)}
                    className={`mt-2 text-sm ${c.accent} hover:underline`}
                  >
                    Alle E-Mails anzeigen
                  </button>
                </div>
              ) : (
                'Keine E-Mails'
              )}
            </div>
          ) : (
            <>
              {filteredEmails.map((email, index) => {
                // Outlook-artige Gruppen-Header (Heute / Gestern / …)
                const group = dateGroupOf(email.date);
                const prevGroup = index > 0 ? dateGroupOf(filteredEmails[index - 1].date) : null;
                return (
                  <React.Fragment key={email.uid}>
                    {group !== prevGroup && (
                      <div className={`sticky top-0 z-10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide ${c.bgSecondary} ${c.textSecondary} border-b ${c.border}`}>
                        {group}
                      </div>
                    )}
                    <EmailListItem
                      email={email}
                      index={index}
                      isSelected={index === selectedIndex}
                      isChecked={selectedUids.has(email.uid)}
                      onSelect={handleSelectEmail}
                      onCheckboxChange={handleCheckboxChange}
                      onDelete={requestDelete}
                      onArchive={handleArchive}
                      onToggleRead={handleToggleRead}
                      c={c}
                      actionLoading={actionLoading}
                      spamAnalysis={effectiveAnalysisMap.get(email.uid)}
                      showCheckboxes={showCheckboxes}
                      isSentFolder={isSentFolder}
                      onDragStart={setDraggedEmail}
                      triage={triageMap.get(email.uid)}
                    />
                  </React.Fragment>
                );
              })}
              {(hasMore || loadingMore) && (
                <div className="flex items-center justify-center p-4">
                  {loadingMore
                    ? <span className={`text-sm ${c.textSecondary}`}>Lade mehr...</span>
                    : <button onClick={loadMoreEmails} className={`text-sm ${c.accent} hover:underline`}>Mehr laden...</button>
                  }
                </div>
              )}
            </>
          )}
        </div>
        )}

        {/* v1.12.2: Resize Handle for email list column — nur im offenen Modus */}
        {mailListPanel.isExpanded && (
        <div
          onMouseDown={() => setIsResizingEmailList(true)}
          className={`absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-cyan-500/50 transition-colors z-10 ${isResizingEmailList ? 'bg-cyan-500' : ''}`}
          title="Ziehen zum Ändern der Mail-Liste-Breite"
        >
          <div className="absolute top-1/2 -translate-y-1/2 -left-2 w-5 h-10 flex items-center justify-center">
            <DragVertical size={16} className={`${c.textSecondary} opacity-50`} />
          </div>
        </div>
        )}
      </div>

      {/* Email Preview - v1.12.2: Takes remaining space */}
      <div
        className={`relative flex-1 flex flex-col overflow-hidden min-h-0 ${c.bg}`}
        style={{ minWidth: `${PREVIEW_MIN_WIDTH}px` }}
      >
        {replySentToast && (
          <div className="absolute bottom-6 right-6 z-50 px-4 py-2.5 bg-green-600 text-white text-sm rounded-lg shadow-lg flex items-center gap-2">
            <CheckmarkFilled size={16} />
            Antwort gesendet
          </div>
        )}
        {loadingPreview ? (
          // Skeleton loading state for email preview
          <div className="flex-1 p-6 space-y-4 animate-pulse">
            <div className={`h-6 w-3/4 rounded ${c.bgSecondary}`} />
            <div className={`h-4 w-1/2 rounded ${c.bgSecondary}`} />
            <div className={`h-4 w-1/3 rounded ${c.bgSecondary}`} />
            <div className={`h-px w-full ${c.border} border-t mt-4`} />
            <div className="space-y-3 pt-2">
              <div className={`h-4 w-full rounded ${c.bgSecondary}`} />
              <div className={`h-4 w-5/6 rounded ${c.bgSecondary}`} />
              <div className={`h-4 w-4/5 rounded ${c.bgSecondary}`} />
              <div className={`h-4 w-full rounded ${c.bgSecondary}`} />
              <div className={`h-4 w-3/4 rounded ${c.bgSecondary}`} />
            </div>
          </div>
        ) : previewError ? (
          <div className={`flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center ${c.textSecondary}`}>
            <WarningAlt size={32} className="text-amber-400" />
            <p className="text-sm">E-Mail konnte nicht geladen werden</p>
            <p className="text-xs opacity-70 max-w-sm break-words">{previewError.message}</p>
            <button
              onClick={() => loadEmailPreview(previewError.uid)}
              className={`mt-1 px-4 py-2 text-sm rounded-lg ${c.buttonBg || 'bg-cyan-600 hover:bg-cyan-500'} text-white transition-colors`}
            >
              Erneut versuchen
            </button>
          </div>
        ) : selectedEmail ? (
          <>
            {/* v1.14.0: Spam warning banner */}
            {(() => {
              const analysis = spamResults.get(selectedEmail.uid || emails[selectedIndex]?.uid);
              if (!analysis || analysis.category === 'sicher') return null;
              const style = TAG_STYLES[analysis.category];
              if (!style) return null;
              
              return (
                <div className={`px-4 py-3 ${style.bgColor} border-b ${style.borderColor} border flex items-center gap-3`}>
                  <Security size={20} className={`${style.textColor} flex-shrink-0`} />
                  <div className="flex-1">
                    <div className={`font-medium text-sm ${style.textColor}`}>
                      {style.label} — {style.description}
                    </div>
                    {analysis.reasons?.length > 0 && (
                      <div className={`text-xs ${style.textColor} opacity-75 mt-0.5`}>
                        {analysis.reasons.slice(0, 3).join(' • ')}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
            {/* v6.6.2: Kompakterer Preview-Header — weniger vertikaler Platz für Metadata */}
            <div className={`px-4 py-2 ${c.bgSecondary} ${c.border} border-b`}>
              <div className="flex justify-between items-start gap-2">
                <div className="flex-1 min-w-0">
                  <h2 className={`text-base font-semibold ${c.text} truncate leading-tight`}>
                    {selectedEmail.subject}
                  </h2>
                  <p className={`${c.textSecondary} text-xs mt-0.5 truncate`}>
                    <span className={c.text}>{selectedEmail.from}</span>
                    <span className="opacity-60"> · </span>
                    <span>{new Date(selectedEmail.date).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                  </p>
                  {/* v6.9.0: Empfänger-Header wie Outlook — kompakt mit
                      Aufklappen für die vollständige An/Cc-Liste */}
                  {(selectedEmail.to || selectedEmail.cc) && (
                    <div className={`text-xs mt-0.5 ${c.textSecondary}`}>
                      {headerExpanded ? (
                        <div className="space-y-0.5 py-0.5">
                          {selectedEmail.to && (
                            <div className="break-words">
                              <span className="opacity-60 font-medium">An: </span>
                              <span className={c.text}>{selectedEmail.to}</span>
                            </div>
                          )}
                          {selectedEmail.cc && (
                            <div className="break-words">
                              <span className="opacity-60 font-medium">Cc: </span>
                              <span className={c.text}>{selectedEmail.cc}</span>
                            </div>
                          )}
                          <button
                            onClick={() => setHeaderExpanded(false)}
                            className={`${c.accent} hover:underline flex items-center gap-0.5`}
                          >
                            <ChevronDown size={12} className="rotate-180" /> Weniger anzeigen
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setHeaderExpanded(true)}
                          className="flex items-center gap-1 max-w-full hover:underline text-left"
                          title="Alle Empfänger anzeigen"
                        >
                          <span className="truncate">
                            <span className="opacity-60">an </span>
                            {selectedEmail.to}
                            {selectedEmail.cc && <span className="opacity-60"> · Cc: {selectedEmail.cc}</span>}
                          </span>
                          <ChevronDown size={12} className="flex-shrink-0 opacity-60" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
                {/* v2.9.3: Reply buttons + full view */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => setReplyMode(replyMode === 'reply' ? null : 'reply')}
                    className={`p-2 rounded-lg transition-colors flex items-center gap-1.5 text-sm ${
                      replyMode === 'reply'
                        ? `${c.accentBg} text-white`
                        : `${c.hover} ${c.textSecondary}`
                    }`}
                    title="Antworten"
                  >
                    <Reply size={16} />
                    <span className="hidden xl:inline">Antworten</span>
                  </button>
                  <button
                    onClick={() => setReplyMode(replyMode === 'replyAll' ? null : 'replyAll')}
                    className={`p-2 rounded-lg transition-colors flex items-center gap-1.5 text-sm ${
                      replyMode === 'replyAll'
                        ? `${c.accentBg} text-white`
                        : `${c.hover} ${c.textSecondary}`
                    }`}
                    title="Allen antworten"
                  >
                    <ReplyAll size={16} />
                    <span className="hidden xl:inline">Allen</span>
                  </button>
                  <button
                    onClick={() => onForward && onForward(selectedEmail)}
                    className={`p-2 rounded-lg transition-colors flex items-center gap-1.5 text-sm ${c.hover} ${c.textSecondary}`}
                    title="Weiterleiten"
                  >
                    <SendAlt size={16} />
                    <span className="hidden xl:inline">Weiterleiten</span>
                  </button>
                  <button
                    ref={snoozeBtnRef}
                    onClick={() => {
                      const rect = snoozeBtnRef.current?.getBoundingClientRect() || null;
                      setSnoozeAnchorRect(rect);
                      setSnoozeMenuOpen(v => !v);
                    }}
                    className={`p-2 rounded-lg transition-colors flex items-center gap-1.5 text-sm ${snoozeMenuOpen ? `${c.accentBg} text-white` : `${c.hover} ${c.textSecondary}`}`}
                    title="Erinnern"
                  >
                    <Time size={16} />
                    <span className="hidden xl:inline">Erinnern</span>
                  </button>
                  {/* v6.10.0: Archivieren + Löschen direkt in der Vorschau */}
                  <button
                    onClick={() => handleArchive(selectedEmail.uid)}
                    className={`p-2 rounded-lg transition-colors flex items-center gap-1.5 text-sm ${c.hover} ${c.textSecondary}`}
                    title="Archivieren (E)"
                  >
                    <Archive size={16} />
                    <span className="hidden xl:inline">Archiv</span>
                  </button>
                  <button
                    onClick={() => requestDelete(selectedEmail.uid)}
                    className={`p-2 rounded-lg transition-colors flex items-center gap-1.5 text-sm ${c.hover} text-red-400 hover:text-red-300`}
                    title="Löschen (Entf)"
                  >
                    <TrashCan size={16} />
                  </button>
                  <div className={`w-px h-5 ${c.border} border-l mx-1`} />
                  <button
                    onClick={() => onFullView(selectedEmail, currentFolder)}
                    className={`px-3 py-2 ${c.accentBg} ${c.accentHover} text-white rounded-lg text-sm transition-colors`}
                  >
                    Vollansicht →
                  </button>
                </div>
              </div>
            </div>

            {/* v2.6.0: Manual Categorization Buttons */}
            <CategoryButtons
              email={selectedEmail}
              currentCategory={manualCategories.get(selectedEmail?.uid)}
              onCategorize={handleCategorize}
              c={c}
            />

            {/* Übersetzen-Button */}
            <TranslateBar email={selectedEmail} c={c} />

            <div className={`flex-1 overflow-auto ${c.bg} flex flex-col`}>
              {/* v2.9.3: Inline Reply Panel — oberhalb des Mails */}
              {replyMode && (
                <div
                  className={`relative border-b ${c.border} ${c.bgSecondary} flex-shrink-0`}
                  onDragEnter={(e) => {
                    if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
                    e.preventDefault();
                    replyDragDepthRef.current += 1;
                    setReplyDragging(true);
                  }}
                  onDragOver={(e) => {
                    if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                  }}
                  onDragLeave={() => {
                    replyDragDepthRef.current = Math.max(0, replyDragDepthRef.current - 1);
                    if (replyDragDepthRef.current === 0) setReplyDragging(false);
                  }}
                  onDrop={(e) => {
                    if (!e.dataTransfer?.files?.length) return;
                    e.preventDefault();
                    replyDragDepthRef.current = 0;
                    setReplyDragging(false);
                    addReplyFiles(e.dataTransfer.files);
                  }}
                >
                  {replyDragging && (
                    <div className="absolute inset-0 z-20 flex items-center justify-center rounded border-2 border-dashed border-cyan-400 bg-cyan-500/10 backdrop-blur-[1px] pointer-events-none">
                      <span className="flex items-center gap-2 text-cyan-300 text-sm font-medium">
                        <Attachment size={20} /> Dateien hier ablegen, um sie anzuhängen
                      </span>
                    </div>
                  )}
                  {/* Reply header */}
                  <div className={`px-4 py-2 border-b ${c.border} flex items-center justify-between`}>
                    <div className={`text-sm font-medium ${c.text} flex items-center gap-2`}>
                      {replyMode === 'replyAll' ? <ReplyAll size={16} /> : <Reply size={16} />}
                      <span>{replyMode === 'replyAll' ? 'Allen antworten' : 'Antworten'}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {replyError && <span className="text-xs text-red-400">{replyError}</span>}
                      <button
                        onClick={handleSendReply}
                        disabled={replySending}
                        className={`px-3 py-1.5 ${c.accentBg} ${c.accentHover} text-white rounded-lg text-sm transition-colors flex items-center gap-1.5 disabled:opacity-50`}
                      >
                        {replySending ? <><InProgress size={16} className="animate-spin" /> Sende...</> : <><Send size={16} /> Senden</>}
                      </button>
                      <button
                        onClick={() => {
                          // v6.8.1: Halb geschriebene Antwort nicht stillschweigend verwerfen
                          if (replyEditorRef.current?.innerText?.trim()) {
                            setConfirmDiscardReply(true);
                          } else {
                            setReplyMode(null);
                            setReplyError(null);
                            if (replyEditorRef.current) replyEditorRef.current.innerHTML = '';
                          }
                        }}
                        className={`p-1.5 ${c.hover} rounded ${c.textSecondary}`}
                        title="Antwort schliessen"
                        aria-label="Antwort schliessen"
                      >
                        <Close size={16} />
                      </button>
                    </div>
                  </div>

                  {/* v6.9.1: Editierbare Empfänger — weitere Adressen hinzufügbar,
                      mit Kontakte-Autocomplete wie im Compose */}
                  <div className={`px-4 py-2 border-b ${c.border} space-y-1.5`}>
                    <EmailTagInput
                      label="An:"
                      tags={replyToTags}
                      onChange={setReplyToTags}
                      placeholder="empfaenger@example.com"
                      c={c}
                    />
                    {replyShowCc ? (
                      <EmailTagInput
                        label="CC:"
                        tags={replyCcTags}
                        onChange={setReplyCcTags}
                        placeholder="cc@example.com"
                        c={c}
                      />
                    ) : (
                      <button
                        onClick={() => setReplyShowCc(true)}
                        className={`text-xs ${c.textSecondary} hover:${c.text} hover:underline ml-[76px]`}
                      >
                        + CC hinzufügen
                      </button>
                    )}
                  </div>

                  {/* Formatting toolbar */}
                  <div className={`flex items-center gap-1 px-3 py-1.5 border-b ${c.border} ${c.bg}`}>
                    {[
                      { cmd: 'bold',      label: <strong>B</strong>,  title: 'Fett (Ctrl+B)' },
                      { cmd: 'italic',    label: <em>I</em>,           title: 'Kursiv (Ctrl+I)' },
                      { cmd: 'underline', label: <span style={{textDecoration:'underline'}}>U</span>, title: 'Unterstrichen (Ctrl+U)' },
                    ].map(btn => (
                      <button
                        key={btn.cmd}
                        onMouseDown={e => { e.preventDefault(); replyEditorRef.current?.focus(); document.execCommand(btn.cmd, false, null); }}
                        title={btn.title}
                        className={`w-7 h-7 flex items-center justify-center rounded text-xs ${c.hover} ${c.textSecondary} hover:text-cyan-400`}
                      >
                        {btn.label}
                      </button>
                    ))}
                    <div className={`w-px h-4 ${c.border} border-l mx-1`} />
                    {[
                      { cmd: 'insertUnorderedList', label: '•', title: 'Aufzählungsliste' },
                      { cmd: 'insertOrderedList',   label: '1.', title: 'Nummerierte Liste' },
                    ].map(btn => (
                      <button
                        key={btn.cmd}
                        onMouseDown={e => { e.preventDefault(); replyEditorRef.current?.focus(); document.execCommand(btn.cmd, false, null); }}
                        title={btn.title}
                        className={`w-7 h-7 flex items-center justify-center rounded text-xs ${c.hover} ${c.textSecondary} hover:text-cyan-400`}
                      >
                        {btn.label}
                      </button>
                    ))}
                    <div className={`w-px h-4 ${c.border} border-l mx-1`} />
                    <button
                      onMouseDown={e => { e.preventDefault(); replyEditorRef.current?.focus(); document.execCommand('removeFormat', false, null); }}
                      title="Formatierung entfernen"
                      className={`w-7 h-7 flex items-center justify-center rounded ${c.hover} ${c.textSecondary} hover:text-cyan-400`}
                    >
                      <Close size={16} />
                    </button>
                    <div className={`w-px h-4 ${c.border} border-l mx-1`} />
                    <button
                      onClick={() => replyFileInputRef.current?.click()}
                      title="Anhang hinzufügen (oder Dateien ins Antwortfeld ziehen)"
                      className={`h-7 px-2 flex items-center gap-1.5 rounded text-xs border ${c.border} ${c.hover} ${replyAttachments.length > 0 ? 'text-cyan-400' : c.textSecondary} hover:text-cyan-400`}
                    >
                      <Attachment size={16} /> Anhang
                    </button>
                    <input
                      ref={replyFileInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={e => { addReplyFiles(e.target.files); e.target.value = ''; }}
                    />
                    {replyAttachments.length > 0 && (
                      <span className={`ml-1 text-xs ${c.textSecondary}`}>
                        {replyAttachments.length}
                      </span>
                    )}
                  </div>

                  {/* Reply attachments list */}
                  {replyAttachments.length > 0 && (
                    <div className={`px-3 py-2 border-b ${c.border} flex flex-wrap gap-1.5`}>
                      {replyAttachments.map(att => (
                        <div key={att.id} className={`flex items-center gap-1.5 px-2 py-1 rounded-lg ${c.bgTertiary} border ${c.border} text-xs`}>
                          <Attachment size={16} className={c.textSecondary} />
                          <span className={`${c.text} max-w-[120px] truncate`}>{att.filename}</span>
                          <span className={c.textSecondary}>({(att.size / 1024).toFixed(0)} KB)</span>
                          <button
                            onClick={() => setReplyAttachments(prev => prev.filter(a => a.id !== att.id))}
                            className={`${c.textSecondary} hover:text-red-400 transition-colors`}
                          >
                            <Close size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Reply editor — paste handler strips HTML to prevent XSS */}
                  <div
                    ref={replyEditorRef}
                    contentEditable
                    suppressContentEditableWarning
                    className={`min-h-[120px] max-h-[240px] overflow-y-auto p-4 focus:outline-none ${c.text}`}
                    style={{ fontSize: '14px', lineHeight: '1.6' }}
                    data-placeholder="Antwort schreiben..."
                    onPaste={(e) => {
                      e.preventDefault();
                      // v7.3.0: Eingefügte Dateien (z.B. Screenshot) als Anhang übernehmen
                      if (e.clipboardData.files?.length > 0) {
                        addReplyFiles(e.clipboardData.files);
                        return;
                      }
                      const text = e.clipboardData.getData('text/plain');
                      document.execCommand('insertText', false, text);
                    }}
                  />

                  {/* Quoted original email */}
                  <div className={`mx-4 mb-3 pl-3 border-l-2 border-gray-500 text-xs ${c.textSecondary} max-h-20 overflow-hidden`}>
                    <p className="font-medium mb-1">
                      Am {new Date(selectedEmail.date).toLocaleString('de-DE')} schrieb {selectedEmail.from}:
                    </p>
                    <div className="opacity-70 line-clamp-3">
                      {selectedEmail.text?.slice(0, 200) || selectedEmail.html?.replace(/<[^>]*>/g, '').slice(0, 200)}
                    </div>
                  </div>
                </div>
              )}

              {/* Email content — flex-shrink-0 damit Reply-Panel den Inhalt nicht
                  zusammenstaucht und der Container scrollen kann (v6.7.2) */}
              <div className="p-6 flex-shrink-0">
                {/* v6.14.0: Anhänge ÜBER dem Mailtext in einem markanten Banner —
                    vorher standen sie unter der Mail und waren ohne Scrollen
                    unsichtbar (wurden dadurch leicht übersehen). */}
                {/* v7.2.0: Einladung zuoberst — vorher steckten die Termindaten
                    unlesbar im namenlosen .ics-Anhang. */}
                {selectedEmail.invitation && (
                  <InvitationCard
                    invitation={selectedEmail.invitation}
                    account={invitationAccount}
                    icsAttachment={calendarAttachment}
                    icsState={calendarAttachment ? attachProgress[calendarAttachment.index] : null}
                    onSaveIcs={() => calendarAttachment && saveAttachment(calendarAttachment, calendarAttachment.index, false)}
                    onOpenIcs={() => calendarAttachment && saveAttachment(calendarAttachment, calendarAttachment.index, true)}
                  />
                )}
                {visibleAttachments.length > 0 && (
                  <div className="mb-4 p-3 rounded-xl border border-amber-500/50 bg-amber-500/10">
                    <h4 className="font-semibold text-amber-400 mb-2 flex items-center gap-2 text-sm">
                      <Attachment size={18} />
                      {visibleAttachments.length === 1
                        ? '1 Anhang'
                        : `${visibleAttachments.length} Anhänge`}
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {visibleAttachments.map((att) => {
                        const i = att.index;
                        const prog = attachProgress[i];
                        const hasContent = !!att.content;
                        return (
                          <div key={`${selectedEmail.uid}-${att.filename}-${i}`} className={`flex items-center gap-2 px-3 py-2 ${c.bgTertiary} ${c.border} border rounded-lg text-sm ${c.text}`}>
                            <Attachment size={16} className="flex-shrink-0" />
                            <span className="truncate">{att.filename}</span>
                            {att.size && <span className={`text-xs ${c.textSecondary}`}>({(att.size / 1024).toFixed(1)} KB)</span>}
                            {hasContent && (
                              <>
                                <button
                                  onClick={() => saveAttachment(att, i, false)}
                                  disabled={prog === 'saving'}
                                  title="Speichern"
                                  className={`p-1 rounded hover:bg-blue-500/20 text-blue-400 transition-colors disabled:opacity-50`}
                                >
                                  {prog === 'saving' ? <InProgress size={16} className="animate-spin" /> : prog === 'done' ? <CheckmarkFilled size={16} className="text-green-400" /> : <Download size={16} />}
                                </button>
                                <button
                                  onClick={() => saveAttachment(att, i, true)}
                                  disabled={prog === 'saving'}
                                  title="Öffnen"
                                  className={`p-1 rounded hover:bg-green-500/20 text-green-400 transition-colors disabled:opacity-50`}
                                >
                                  <FolderOpen size={16} />
                                </button>
                              </>
                            )}
                            {prog === 'error' && <span className="text-xs text-red-400">Fehler</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {selectedEmail.html ? (
                  <EmailHtmlFrame html={selectedEmail.html} fontFamily={previewFontStyle} />
                ) : (
                  <pre className={`${c.text} whitespace-pre-wrap`} style={{ fontFamily: previewFontStyle }}>
                    {selectedEmail.text}
                  </pre>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className={`flex-1 flex items-center justify-center ${c.textSecondary}`}>
            Wähle eine E-Mail aus
          </div>
        )}
      </div>
      
      {/* v6.8.1: Antwort-verwerfen-Bestätigung */}
      {confirmDiscardReply && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className={`${c.bgSecondary} ${c.border} border rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl`}>
            <h3 className={`text-lg font-semibold ${c.text} mb-2`}>Antwort verwerfen?</h3>
            <p className={`text-sm ${c.textSecondary} mb-6`}>
              Deine angefangene Antwort geht verloren.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDiscardReply(false)}
                className={`px-4 py-2 ${c.hover} ${c.border} border rounded-lg transition-colors ${c.text}`}
                autoFocus
              >
                Weiter schreiben
              </button>
              <button
                onClick={() => {
                  setConfirmDiscardReply(false);
                  setReplyMode(null);
                  setReplyError(null);
                  if (replyEditorRef.current) replyEditorRef.current.innerHTML = '';
                }}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
              >
                Verwerfen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* v2.3.0: Delete Confirmation Modal — v6.8.1: auch für Einzel-Löschen */}
      {(showDeleteConfirm || confirmDeleteUid != null) && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className={`${c.bgSecondary} ${c.border} border rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl`}>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-red-500/20 rounded-full">
                <TrashCan size={24} className="text-red-400" />
              </div>
              <div>
                <h3 className={`text-lg font-semibold ${c.text}`}>
                  {confirmDeleteUid != null ? 'E-Mail löschen?' : 'E-Mails löschen?'}
                </h3>
                <p className={`text-sm ${c.textSecondary} truncate max-w-xs`}>
                  {confirmDeleteUid != null
                    ? (emails.find(e => e.uid === confirmDeleteUid)?.subject || '1 E-Mail wird gelöscht')
                    : `${selectedUids.size} E-Mail${selectedUids.size > 1 ? 's' : ''} werden gelöscht`}
                </p>
              </div>
            </div>

            <p className={`text-sm ${c.textSecondary} mb-6`}>
              {/* v6.10.0: Dialog erscheint nur noch im Papierkorb — dort ist Löschen endgültig */}
              {confirmDeleteUid != null
                ? 'Die E-Mail wird endgültig gelöscht und kann nicht wiederhergestellt werden.'
                : 'Die E-Mails werden endgültig gelöscht und können nicht wiederhergestellt werden.'}
            </p>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setShowDeleteConfirm(false); setConfirmDeleteUid(null); }}
                className={`px-4 py-2 ${c.hover} ${c.border} border rounded-lg transition-colors ${c.text}`}
                disabled={bulkDeleting}
                autoFocus
              >
                Abbrechen
              </button>
              <button
                onClick={confirmDeleteUid != null ? confirmSingleDelete : handleBulkDelete}
                disabled={bulkDeleting}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors flex items-center gap-2"
              >
                {bulkDeleting ? (
                  <>
                    <InProgress size={16} className="animate-spin" />
                    Lösche...
                  </>
                ) : (
                  <>
                    <TrashCan size={16} />
                    Löschen
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}

export default InboxSplitView;
