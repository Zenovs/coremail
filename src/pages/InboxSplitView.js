import React, { useState, useEffect, useCallback, useMemo, memo, useRef } from 'react';
import {
  TrashCan, Email, EmailNew, Renew, MailAll, Send, Document,
  WarningAlt, Archive, Folder, Security,
  CheckboxChecked, Checkbox, CloseFilled, ChevronDown, ChevronRight,
  Bullhorn, Misuse, Debug, Tag, Close, Checkmark, CheckmarkFilled, Reply, ReplyAll, SendAlt,
  Download, FolderOpen, Earth, InProgress, FolderAdd, Edit, WarningFilled, Time, Bot,
  Add, Search, SidePanelClose, SidePanelOpen, Launch, Keyboard
} from '@carbon/icons-react';
import Attachment from '../components/PaperclipIcon';
import { useTheme, SheetTheme, SHEET_COLORS } from '../context/ThemeContext';
import { useAccounts, useAccountStats } from '../context/AccountContext';
import { useSearch } from '../context/SearchContext';
import MailApi from '../services/MailApi';
import EmailHtmlFrame from '../components/EmailHtmlFrame';
import SnoozeMenu from '../components/SnoozeMenu';
import EmailTagInput from '../components/EmailTagInput';
import InvitationCard from '../components/InvitationCard';
import { getCategoryIcon } from './CategorySettings';

// ─── v8.0: Outlook-artiges Layout ────────────────────────────────────────────
//
//   ┌────┬──────────────┬──────────────────┬──────────────────────────────┐
//   │Rail│ Kommandoleiste (Neue E-Mail · Löschen · Archiv · Antworten …) │
//   │    ├──────────────┼──────────────────┼──────────────────────────────┤
//   │    │ Konten +     │ Mail-Liste       │ Lese-Blatt (immer weiss)     │
//   │    │ Ordner       │                  │                              │
//   └────┴──────────────┴──────────────────┴──────────────────────────────┘
//
// Die Spalten stehen still (kein Hover-Auf-/Zuklappen mehr); nur die Ordner-
// Spalte lässt sich bewusst auf Icons einklappen. Breiten sind per Drag
// einstellbar und werden gespeichert.

// Deterministische Farb-Palette für Avatar-Hintergründe. Hash auf Absender →
// stabile Farbe pro Person (wie die Initialen-Avatare in Outlook).
const AVATAR_COLORS = [
  'bg-accentbg', 'bg-blue-600', 'bg-indigo-600', 'bg-violet-600',
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

// "Name <mail@x>" → "Name"; nur Adresse → Adresse. Outlook zeigt in der
// Liste den Namen, die Adresse steht im Lese-Blatt darunter.
const displayNameOf = (s) => {
  const raw = String(s || '').trim();
  if (!raw) return '';
  const m = raw.match(/^"?([^"<]*)"?\s*<([^>]+)>/);
  if (m) return (m[1] || '').trim() || m[2].trim();
  return raw.replace(/^["']+|["']+$/g, '');
};
// Mehrere Empfänger ("a <x>, b <y>") → "a, b"
const displayNamesOf = (s) => String(s || '')
  .split(/,(?![^<]*>)/)
  .map(displayNameOf)
  .filter(Boolean)
  .join(', ');
const addressOf = (s) => {
  const m = String(s || '').match(/<([^>]+)>/);
  return (m ? m[1] : String(s || '')).trim();
};

// Button der Kommandoleiste: Icon + Beschriftung (ab 1024px Fensterbreite)
const CmdButton = ({ Icon, label, onClick, disabled, active, danger, c, btnRef, title, showLabel = true }) => (
  <button
    ref={btnRef}
    onClick={onClick}
    disabled={disabled}
    title={title || label}
    aria-label={label}
    aria-pressed={active ? true : undefined}
    className={`cm-cmd ${
      active
        ? `${c.selected} ${c.accent}`
        : danger
          ? `${c.text} ${c.hover} hover:text-ms-red`
          : `${c.text} ${c.hover}`
    }`}
  >
    <Icon size={18} className={active ? '' : c.textSecondary} />
    {showLabel && <span className="hidden xl:inline">{label}</span>}
  </button>
);
import { getCurrentFont } from './FontSettings';
import { analyzeEmails, getSpamFilterSettings, TAG_STYLES } from '../utils/SpamFilter';
import SenderCategoryManager from '../services/SenderCategoryManager';

// v2.4.0: Virtuelle Posteingangs-Unterordner (Spam-Filter-Kategorien).
// v8.0: Badge-Farben über die cm-badge-Klassen (hell/dunkel automatisch).
const INBOX_SUBFOLDERS = [
  { id: 'werbung',    name: 'Werbung',          icon: Bullhorn,        badge: 'orange' },
  { id: 'spam',       name: 'Spam',             icon: Misuse,          badge: 'red' },
  { id: 'schaedlich', name: 'Schädlich',        icon: WarningAlt,      badge: 'yellow' },
  { id: 'virus',      name: 'Virus',            icon: Debug,           badge: 'purple' },
  { id: 'whitelist',  name: 'Vertrauenswürdig', icon: CheckmarkFilled, badge: 'green' },
];

// v2.6.0: Manuelle Absender-Einstufung
const MANUAL_CATEGORIES = [
  { id: 'whitelist',  name: 'Vertrauenswürdig', Icon: CheckmarkFilled, badge: 'green' },
  { id: 'werbung',    name: 'Werbung',          Icon: Bullhorn,        badge: 'orange' },
  { id: 'spam',       name: 'Spam',             Icon: Misuse,          badge: 'red' },
  { id: 'schaedlich', name: 'Schädlich',        Icon: WarningAlt,      badge: 'yellow' },
  { id: 'virus',      name: 'Virus',            Icon: Debug,           badge: 'purple' },
];

// v2.6.0 / v8.0: Absender einstufen — zusammengeklappt ein einzelner Text-
// Button im Lese-Blatt; die fünf Kategorie-Chips erscheinen erst auf Klick.
// Vorher stand die komplette Button-Leiste dauerhaft über jeder Mail.
const CategoryButtons = memo(({ email, currentCategory, onCategorize, c }) => {
  const [open, setOpen] = useState(false);
  const senderCategory = SenderCategoryManager.getSenderCategory(email?.from);
  const active = currentCategory || senderCategory || null;
  const activeDef = MANUAL_CATEGORIES.find(x => x.id === active);

  useEffect(() => { setOpen(false); }, [email?.uid]);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={() => setOpen(o => !o)}
        className={`inline-flex items-center gap-1.5 text-xs ${c.textSecondary} hover:underline`}
        title="Absender einstufen (gilt für alle Mails dieses Absenders)"
        aria-expanded={open}
      >
        <Tag size={14} />
        {activeDef ? (
          <>
            <span>Absender:</span>
            <span className={`cm-badge cm-badge-${activeDef.badge}`}><span>{activeDef.name}</span></span>
          </>
        ) : (
          <span>Absender einstufen</span>
        )}
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          {MANUAL_CATEGORIES.map(cat => {
            const isActive = active === cat.id;
            const CatIcon = cat.Icon;
            return (
              <button
                key={cat.id}
                onClick={() => onCategorize(email, isActive ? null : cat.id)}
                className={`cm-badge cm-badge-${cat.badge} ${isActive ? 'ring-1 ring-current' : 'opacity-75 hover:opacity-100'}`}
                title={`Absender als ${cat.name} markieren`}
                aria-pressed={isActive}
              >
                <CatIcon size={12} />
                <span>{cat.name}</span>
                {isActive && <Checkmark size={12} />}
              </button>
            );
          })}
          {active && (
            <button
              onClick={() => onCategorize(email, null)}
              className={`text-xs ${c.textSecondary} hover:underline`}
              title="Einstufung entfernen"
            >
              Entfernen
            </button>
          )}
        </>
      )}
    </div>
  );
});

// Übersetzen: kleiner Text-Button im Lese-Blatt; Ergebnis erscheint als Block
// darunter (basis-full in der Werkzeugzeile).
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
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setOpen(o => !o)}
          disabled={loading}
          className={`inline-flex items-center gap-1.5 text-xs ${c.textSecondary} hover:underline disabled:opacity-50`}
          title="Mail übersetzen"
          aria-expanded={open}
        >
          {loading ? <Renew size={14} className="animate-spin" /> : <Earth size={14} />}
          <span>{loading ? 'Übersetze…' : result ? `Übersetzt → ${result.lang}` : 'Übersetzen'}</span>
          <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>

        {open && (
          <div className={`absolute top-full left-0 mt-1 z-50 min-w-[170px] rounded-lg shadow-xl ${c.popover} ${c.border} border py-1`}>
            {enabledLanguages.map(code => (
              <button
                key={code}
                onClick={() => translate(code)}
                className={`w-full text-left px-3 py-1.5 text-sm ${c.text} ${c.hover} flex items-center justify-between gap-4`}
              >
                <span>{LANG_NAMES[code] || code}</span>
                <span className={`text-xs ${c.textSecondary}`}>{code}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Übersetzungs-Ergebnis */}
      {(result || error) && (
        <div className={`basis-full mt-2 rounded-lg border ${c.border} overflow-hidden`}>
          <div className={`px-3 py-1.5 ${c.bgSecondary} flex items-center gap-2 border-b ${c.border}`}>
            <Earth size={14} className={c.accent} />
            <span className={`text-xs font-medium ${c.text}`}>
              {result ? `Übersetzung → ${LANG_NAMES[result.lang] || result.lang}` : 'Übersetzungsfehler'}
            </span>
            <button
              onClick={() => { setResult(null); setError(null); }}
              className={`ml-auto text-xs ${c.textSecondary} hover:underline inline-flex items-center gap-1`}
            >
              <Close size={12} /> Schliessen
            </button>
          </div>
          <div className="p-3">
            {error
              ? <p className="text-sm text-ms-red">{error}</p>
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

// Spaltenbreiten (v8.0: neue Standardwerte für das Outlook-Layout)
const FOLDER_MIN_WIDTH = 190;
const FOLDER_MAX_WIDTH = 420;
const FOLDER_DEFAULT_WIDTH = 250;
const FOLDER_COLLAPSED_WIDTH = 48;

const EMAIL_LIST_MIN_WIDTH = 280;
const EMAIL_LIST_MAX_WIDTH = 640;
const EMAIL_LIST_DEFAULT_WIDTH = 380;

const PREVIEW_MIN_WIDTH = 360;

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

// v1.14.0 / v8.0: Spam-Kategorie als kleines Badge (hell/dunkel automatisch)
const SPAM_BADGE_COLOR = { werbung: 'orange', spam: 'red', schaedlich: 'yellow', virus: 'purple', whitelist: 'green', sicher: 'green' };
const SpamTagBadge = memo(({ category }) => {
  if (!category || category === 'sicher') return null;
  const style = TAG_STYLES[category];
  if (!style) return null;
  return (
    <span className={`cm-badge cm-badge-${SPAM_BADGE_COLOR[category] || 'gray'}`} title={style.description}>
      <span>{style.label}</span>
    </span>
  );
});

// v6.6.0: Triage-Badge der AI-Kategorisierung
const TRIAGE_BADGE = {
  urgent:        ['red',   'Dringend'],
  important:     ['amber', 'Wichtig'],
  informational: ['blue',  'Info'],
  newsletter:    ['gray',  'Newsletter'],
  automated:     ['gray',  'Auto']
};
const TriageBadge = memo(({ triage }) => {
  if (!triage?.category) return null;
  const s = TRIAGE_BADGE[triage.category];
  if (!s) return null;
  return (
    <span
      className={`cm-badge cm-badge-${s[0]}`}
      title={triage.reasoning ? `${triage.reasoning} (${Math.round((triage.confidence || 0) * 100)}%)` : ''}
    >
      <span>{s[1]}</span>
    </span>
  );
});

// Mail-Zeile wie in Outlook: Avatar · Absender + Zeit · Betreff (+ Büroklammer)
// · Vorschau + Badges. Ungelesen = fetter Absender, blauer Betreff und blauer
// Balken am linken Rand. Ausgewählt = hinterlegte Zeile.
const EmailListItem = memo(({ email, index, isSelected, isChecked, onSelect, onCheckboxChange, onDelete, onArchive, onToggleRead, c, actionLoading, spamAnalysis, showCheckboxes, isSentFolder, onDragStart, triage }) => {
  const isUnread = !email.seen;
  const spamCategory = spamAnalysis?.category;
  const showSpam = spamCategory && spamCategory !== 'sicher' && spamCategory !== 'whitelist';
  const who = isSentFolder
    ? displayNamesOf(email.to || email.from)
    : (email.fromName || displayNameOf(email.from));
  const av = avatarFor(email);
  const accShort = email.__accName
    ? (email.__accName.length > 16 ? email.__accName.slice(0, 15) + '…' : email.__accName)
    : null;

  const handleCheckboxClick = (e) => {
    e.stopPropagation();
    onCheckboxChange(email.uid, e.shiftKey);
  };

  return (
    <div
      onClick={() => onSelect(index)}
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart?.(email); }}
      className={`cm-list-item relative group select-none cursor-pointer pl-3 pr-3 py-2.5 border-b ${c.border} ${
        isUnread ? 'cm-unread-bar' : ''
      } ${isSelected || isChecked ? c.selected : c.hover}`}
      aria-selected={isSelected}
    >
      <div className="flex items-start gap-3">
        {showCheckboxes ? (
          <button
            onClick={handleCheckboxClick}
            className="mt-1.5 flex-shrink-0"
            aria-label={isChecked ? 'Auswahl aufheben' : 'Auswählen'}
          >
            {isChecked
              ? <CheckboxChecked size={18} className={c.accent} />
              : <Checkbox size={18} className={c.textSecondary} />}
          </button>
        ) : (
          <span
            className={`mt-0.5 w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-white text-xs font-semibold ${av.color}`}
            aria-hidden="true"
          >
            {av.initial}
          </span>
        )}

        <div className="flex-1 min-w-0">
          {/* Zeile 1: Absender + Zeit */}
          <div className="flex items-baseline justify-between gap-2">
            <span className={`text-sm truncate ${isUnread ? 'font-semibold' : ''} ${c.text}`} title={isSentFolder ? (email.to || '') : (email.from || '')}>
              {isSentFolder && <span className={`font-normal ${c.textSecondary}`}>An: </span>}
              {who || '(Unbekannt)'}
            </span>
            <span
              className={`text-xs flex-shrink-0 group-hover:invisible ${isUnread ? `font-semibold ${c.unread}` : c.textSecondary}`}
              title={new Date(email.date).toLocaleString('de-DE')}
            >
              {formatListDate(email.date)}
            </span>
          </div>

          {/* Zeile 2: Betreff + Anhang */}
          <div className="flex items-center gap-2">
            <span className={`text-[13px] truncate flex-1 min-w-0 ${isUnread ? `font-semibold ${c.unread}` : c.text}`}>
              {email.subject || '(Kein Betreff)'}
            </span>
            {(email.hasAttachments || email.hasAttachment) && (
              <Attachment size={14} className={`${c.textSecondary} flex-shrink-0`} aria-label="Enthält Anhang" />
            )}
          </div>

          {/* Zeile 3: Vorschau + Badges */}
          {(email.preview || showSpam || triage || accShort) && (
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`text-xs ${c.textSecondary} truncate flex-1 min-w-0`}>
                {email.preview}
              </span>
              {accShort && (
                <span className="cm-badge cm-badge-gray" title={email.__accName}><span>{accShort}</span></span>
              )}
              {showSpam && <SpamTagBadge category={spamCategory} />}
              <TriageBadge triage={triage} />
            </div>
          )}
        </div>
      </div>

      {/* Schnellaktionen beim Hovern (verdecken die Zeit, statt dauerhaft
          Platz zu reservieren) */}
      <div className={`absolute right-2 top-1.5 hidden group-hover:flex items-center gap-0.5 ${c.popover} border ${c.border} rounded-md shadow-sm px-0.5`}>
        <button
          onClick={(e) => { e.stopPropagation(); onToggleRead(email.uid, email.seen); }}
          className={`p-1.5 ${c.hover} rounded ${c.textSecondary}`}
          title={email.seen ? 'Als ungelesen markieren (U)' : 'Als gelesen markieren (U)'}
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
        <button
          onClick={(e) => { e.stopPropagation(); onArchive(email.uid); }}
          className={`p-1.5 ${c.hover} rounded ${c.textSecondary}`}
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
          className={`p-1.5 ${c.hover} rounded ${c.textSecondary} hover:text-ms-red`}
          title="Löschen (Entf)"
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
  const {
    activeAccountId, setActiveAccountId, getActiveAccount, accounts, updateAccountStats,
    categories, getAccountsByCategory
  } = useAccounts();
  const accountStats = useAccountStats();
  const { openSearch } = useSearch();
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
  const [inboxExpanded, setInboxExpanded] = useState(false); // v8.0: Unterordner standardmässig zu
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


  // v6.6.0: Snooze — Set von "accountId|folder|uid", die aktuell gesnoozt sind.
  // Filtert betroffene Mails aus dem Inbox-View. Wird per IPC bei Mount,
  // Account-/Folder-Wechsel und beim 'snooze:woke'-Event aktualisiert.
  const [snoozedKeys, setSnoozedKeys] = useState(() => new Set());
  const [snoozeMenuOpen, setSnoozeMenuOpen] = useState(false);
  const [snoozeAnchorRect, setSnoozeAnchorRect] = useState(null);
  const snoozeBtnRef = useRef(null);
  
  // v8.0: Ordner-Spalte bewusst einklappbar (Icons) — kein Hover-Auf-/Zuklappen mehr
  const [folderPaneCollapsed, setFolderPaneCollapsed] = useState(() => {
    try { return localStorage.getItem('inbox.folderPaneCollapsed') === '1'; } catch { return false; }
  });
  const toggleFolderPane = useCallback(() => {
    setFolderPaneCollapsed(v => {
      try { localStorage.setItem('inbox.folderPaneCollapsed', v ? '0' : '1'); } catch {}
      return !v;
    });
  }, []);
  // Konten-Gruppen (Kategorien) in der Ordner-Spalte ein-/ausklappen
  const [collapsedCats, setCollapsedCats] = useState(() => new Set());
  const toggleCat = (id) => setCollapsedCats(prev => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  // Spam-Filter aktiv? Nur dann die virtuellen Unterordner unter dem Posteingang anbieten
  const spamFilterEnabled = useMemo(() => {
    try { return !!getSpamFilterSettings().enabled; } catch { return true; }
  }, []);
  const folderPaneRef = useRef(null);
  const listPaneRef = useRef(null);

  // Resizable folder column (v1.8.1)
  const [folderWidth, setFolderWidth] = useState(() => {
    const saved = parseInt(localStorage.getItem('inbox.folderColumnWidth'), 10);
    return Number.isFinite(saved)
      ? Math.min(FOLDER_MAX_WIDTH, Math.max(FOLDER_MIN_WIDTH, saved))
      : FOLDER_DEFAULT_WIDTH;
  });
  const [isResizingFolder, setIsResizingFolder] = useState(false);

  // v1.12.2: Resizable email list column
  const [emailListWidth, setEmailListWidth] = useState(() => {
    const saved = parseInt(localStorage.getItem('inbox.emailListColumnWidth'), 10);
    return Number.isFinite(saved)
      ? Math.min(EMAIL_LIST_MAX_WIDTH, Math.max(EMAIL_LIST_MIN_WIDTH, saved))
      : EMAIL_LIST_DEFAULT_WIDTH;
  });
  const [isResizingEmailList, setIsResizingEmailList] = useState(false);

  // Handle column resize — rAF-throttled. Breite = Mausposition minus linker
  // Rand der jeweiligen Spalte (unabhängig von Rail- und Nachbarbreiten).
  useEffect(() => {
    if (!isResizingFolder && !isResizingEmailList) return;

    let frameId = null;
    let lastClientX = 0;

    const handleMouseMove = (e) => {
      lastClientX = e.clientX;
      if (frameId) return;
      frameId = requestAnimationFrame(() => {
        frameId = null;
        if (isResizingFolder) {
          const left = folderPaneRef.current?.getBoundingClientRect().left ?? 0;
          setFolderWidth(Math.max(FOLDER_MIN_WIDTH, Math.min(FOLDER_MAX_WIDTH, lastClientX - left)));
        }
        if (isResizingEmailList) {
          const left = listPaneRef.current?.getBoundingClientRect().left ?? 0;
          setEmailListWidth(Math.max(EMAIL_LIST_MIN_WIDTH, Math.min(EMAIL_LIST_MAX_WIDTH, lastClientX - left)));
        }
      });
    };

    const handleMouseUp = () => {
      if (frameId) { cancelAnimationFrame(frameId); frameId = null; }
      if (isResizingFolder) { setIsResizingFolder(false); localStorage.setItem('inbox.folderColumnWidth', String(folderWidth)); }
      if (isResizingEmailList) { setIsResizingEmailList(false); localStorage.setItem('inbox.emailListColumnWidth', String(emailListWidth)); }
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
  }, [isResizingFolder, isResizingEmailList, folderWidth, emailListWidth]);


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
        // v8.0: N → Neue E-Mail (wie Outlook/Gmail)
        if ((e.key === 'n' || e.key === 'N') && onNavigate) {
          e.preventDefault();
          onNavigate('compose');
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
  }, [selectedIndex, filteredEmails, selectedEmail, onFullView, currentFolder, handleDelete, handleSelectAll, handleClearSelection, selectedUids, showDeleteConfirm, folderModal, confirmDeleteUid, confirmDiscardReply, isTrashFolder, handleBulkDelete, requestDelete, handleArchive, handleSelectEmail, handleToggleRead, onForward, onNavigate, replyMode, showShortcutHelp, snoozeMenuOpen]);

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

  // ── v8.0: Ableitungen für Kommandoleiste, Ordner-Spalte und Listenkopf ─────
  const s = SHEET_COLORS; // Lese-Blatt ist in jedem Theme hell
  const totalUnread = Object.entries(accountStats || {})
    .filter(([id]) => id !== '__ALL__')
    .reduce((n, [, st]) => n + (st?.unread || 0), 0);
  const currentFolderName = (() => {
    if (allMode) return currentFolder === 'SENT_ALL' ? 'Gesendet (alle Konten)' : 'Posteingang (alle Konten)';
    const all = (folders || []).flatMap(f => [f, ...(f.children || [])]);
    const f = all.find(x => x.path === currentFolder);
    if (f) return f.name;
    return currentFolder === 'INBOX' ? 'Posteingang' : String(currentFolder).split(/[./]/).pop();
  })();
  const showAccountSection = accounts.length > 1;
  const accountGroups = (() => {
    const groups = categories
      .map(cat => ({ cat, accounts: getAccountsByCategory(cat.id) }))
      .filter(g => g.accounts.length > 0);
    const known = new Set(categories.map(cat => cat.id));
    const rest = accounts.filter(a => !known.has(a.categoryId));
    if (rest.length > 0) groups.push({ cat: { id: '__rest__', name: 'Weitere', color: '#8a8886', icon: 'tag' }, accounts: rest });
    return groups;
  })();
  const activeCategoryDef = categoryFilter ? INBOX_SUBFOLDERS.find(f => f.id === categoryFilter) : null;
  const selectedSpam = selectedEmail ? spamResults.get(selectedEmail.uid || emails[selectedIndex]?.uid) : null;
  const selectedSpamColor = selectedSpam && selectedSpam.category !== 'sicher' ? (SPAM_BADGE_COLOR[selectedSpam.category] || 'gray') : null;
  const sheetDate = (d) => {
    const dt = new Date(d);
    if (isNaN(dt)) return '';
    return dt.toLocaleString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  const openSnooze = () => {
    const rect = snoozeBtnRef.current?.getBoundingClientRect() || null;
    setSnoozeAnchorRect(rect);
    setSnoozeMenuOpen(v => !v);
  };
  const closeReply = () => {
    // v6.8.1: Halb geschriebene Antwort nicht stillschweigend verwerfen
    if (replyEditorRef.current?.innerText?.trim()) {
      setConfirmDiscardReply(true);
    } else {
      setReplyMode(null);
      setReplyError(null);
      if (replyEditorRef.current) replyEditorRef.current.innerHTML = '';
    }
  };

  // Ordner-Zeile (offen und eingeklappt) — eine Funktion statt doppeltem JSX
  const renderFolderRow = (folder) => {
    const isActive = currentFolder === folder.path && !categoryFilter;
    const isDragOver = dragOverFolder === folder.path;
    const inboxUnread = folder.path === 'INBOX' ? unreadCount : (folder.unread || 0);
    const canCollapse = folder.path === 'INBOX'
      ? (spamFilterEnabled && !allMode)
      : (folder.children?.length > 0);
    const isOpen = folder.path === 'INBOX' ? inboxExpanded : !collapsedFolders.has(folder.path);
    const toggle = (e) => {
      e.stopPropagation();
      if (folder.path === 'INBOX') setInboxExpanded(v => !v);
      else toggleFolderCollapsed(folder.path);
    };
    if (folderPaneCollapsed) {
      return (
        <button
          onClick={() => { setCurrentFolder(folder.path); if (folder.path === 'INBOX') setCategoryFilter(null); }}
          onDragOver={(e) => { e.preventDefault(); setDragOverFolder(folder.path); }}
          onDragLeave={() => setDragOverFolder(null)}
          onDrop={() => handleDropOnFolder(folder.path)}
          title={folder.name}
          aria-label={folder.name}
          className={`relative w-9 h-9 mx-auto my-0.5 rounded-md flex items-center justify-center ${
            isActive ? `${c.selected} ${c.accent}` : isDragOver ? 'bg-ms-blue/20' : `${c.textSecondary} ${c.paneHover}`
          }`}
        >
          {['inbox','sent','sentitems','drafts','trash','deleteditems','spam','junkemail','archive'].includes(folder.type)
            ? getFolderIcon(folder.type)
            : <span className="text-[11px] font-bold uppercase">{(folder.name || '?').charAt(0)}</span>}
          {inboxUnread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-ms-blue text-white text-[10px] font-semibold flex items-center justify-center leading-none">
              {inboxUnread > 99 ? '99' : inboxUnread}
            </span>
          )}
        </button>
      );
    }
    return (
      <button
        onClick={() => { setCurrentFolder(folder.path); if (folder.path === 'INBOX') setCategoryFilter(null); }}
        onDragOver={(e) => { e.preventDefault(); setDragOverFolder(folder.path); }}
        onDragLeave={() => setDragOverFolder(null)}
        onDrop={() => handleDropOnFolder(folder.path)}
        className={`w-full text-left h-8 pr-2 flex items-center gap-1.5 text-sm rounded-md transition-colors ${
          isActive
            ? `${c.selected} ${c.text} font-semibold`
            : isDragOver
              ? 'bg-ms-blue/20'
              : `${c.text} ${c.paneHover}`
        }`}
        style={{ paddingLeft: `${(folder.depth || 0) * 14 + 6}px` }}
        aria-current={isActive ? 'true' : undefined}
      >
        {canCollapse ? (
          <span
            role="button"
            tabIndex={-1}
            onClick={toggle}
            className={`w-5 h-5 flex items-center justify-center rounded ${c.textSecondary} hover:bg-black/5`}
            aria-label={isOpen ? 'Einklappen' : 'Ausklappen'}
          >
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <span className={`${isActive ? c.accent : c.textSecondary} flex-shrink-0`}>{getFolderIcon(folder.type)}</span>
        <span className="truncate flex-1">{folder.name}</span>
        {inboxUnread > 0 && (
          <span className={`text-xs font-semibold ${c.accent} tabular-nums`}>{inboxUnread > 999 ? '999+' : inboxUnread}</span>
        )}
      </button>
    );
  };

  if (!activeAccountId) {
    return (
      <div className={`flex-1 flex items-center justify-center ${c.bg}`}>
        <div className={`text-center ${c.textSecondary} max-w-sm px-6`}>
          <Email size={44} className="mx-auto mb-4 opacity-40" />
          <p className={`text-base font-semibold ${c.text} mb-1`}>Noch kein Konto eingerichtet</p>
          <p className="text-sm mb-5">Füge ein IMAP- oder Microsoft-365-Konto hinzu, um deine E-Mails hier zu sehen.</p>
          {onNavigate && (
            <button onClick={() => onNavigate('accounts')} className={`px-4 py-2 ${c.accentBg} ${c.accentHover} text-white rounded-md text-sm font-medium`}>
              Konto hinzufügen
            </button>
          )}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className={`flex-1 flex flex-col overflow-hidden ${c.bg}`}>
        <div className={`h-12 flex-shrink-0 flex items-center gap-2 px-3 ${c.bgSecondary} ${c.border} border-b`}>
          <div className="cm-skeleton h-8 w-32" />
          <div className="cm-skeleton h-8 w-24 ml-3" />
          <div className="cm-skeleton h-8 w-28" />
        </div>
        <div className="flex-1 flex overflow-hidden">
          <div className={`${c.pane} ${c.border} border-r flex flex-col`} style={{ width: folderPaneCollapsed ? FOLDER_COLLAPSED_WIDTH : folderWidth }}>
            <div className="p-3 space-y-2">
              {[100,80,90,70,85,60].map((w,i) => <div key={i} className="cm-skeleton h-7" style={{ width: `${w}%`, animationDelay: `${i*80}ms` }} />)}
            </div>
          </div>
          <div className={`${c.list} ${c.border} border-r flex flex-col`} style={{ width: emailListWidth }}>
            <div className={`p-3 ${c.border} border-b`}><div className="cm-skeleton h-5 w-32" /></div>
            <div className="flex-1 overflow-hidden">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className={`px-3 py-2.5 ${c.border} border-b flex gap-3`} style={{ animationDelay: `${i*60}ms` }}>
                  <div className="cm-skeleton h-8 w-8 rounded-full flex-shrink-0" />
                  <div className="flex-1">
                    <div className="flex gap-2 mb-1.5">
                      <div className="cm-skeleton h-3.5 flex-1" style={{ animationDelay: `${i*60+20}ms` }} />
                      <div className="cm-skeleton h-3 w-10" style={{ animationDelay: `${i*60+40}ms` }} />
                    </div>
                    <div className="cm-skeleton h-3 w-4/5 mb-1.5" style={{ animationDelay: `${i*60+30}ms` }} />
                    <div className="cm-skeleton h-3 w-2/3" style={{ animationDelay: `${i*60+50}ms` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="flex-1 cm-sheet p-6">
            <div className="cm-skeleton h-6 w-2/3 mb-4" />
            <div className="cm-skeleton h-4 w-1/3 mb-6" />
            {[95,88,72,80,60].map((w,i) => <div key={i} className="cm-skeleton h-3 mb-2" style={{ width: `${w}%`, animationDelay: `${i*60}ms` }} />)}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    const activeAccount = getActiveAccount();
    const isMsAccount = activeAccount?.type === 'microsoft';
    return (
      <div className={`flex-1 flex items-center justify-center ${c.bg}`}>
        <div className="text-center max-w-lg px-4">
          <WarningFilled size={44} className="text-ms-red mx-auto mb-4" />
          <h3 className={`font-semibold ${c.text} mb-2`}>Verbindung fehlgeschlagen</h3>
          {!isMsAccount && activeAccount?.imap?.host && (
            <p className={`text-xs ${c.textSecondary} mb-2`}>
              {activeAccount.imap.host}:{activeAccount.imap.port} ({activeAccount.imap.username})
            </p>
          )}
          <div className="cm-banner cm-banner-red mb-3 text-left">
            <p className="text-sm font-mono break-all">{error}</p>
          </div>
          <p className={`text-xs ${c.textSecondary} mb-4`}>
            {isMsAccount
              ? 'Öffne die Konto-Einstellungen und verbinde das Microsoft-Konto erneut.'
              : 'Überprüfe Host, Port, Benutzername und Passwort. Bei Gmail/Outlook wird ein App-Passwort benötigt.'}
          </p>
          <div className="flex flex-wrap gap-2 justify-center">
            <button onClick={() => fetchEmails(false)} className={`px-4 py-2 ${c.accentBg} ${c.accentHover} text-white rounded-md text-sm font-medium`}>
              Erneut versuchen
            </button>
            {onNavigate && (
              <button onClick={() => onNavigate('accounts')} className={`px-4 py-2 ${c.bgTertiary} ${c.text} ${c.border} border rounded-md text-sm`}>
                Konto-Einstellungen
              </button>
            )}
            {window.electronAPI?.openDevTools && (
              <button onClick={() => window.electronAPI.openDevTools()} className={`px-4 py-2 ${c.bgTertiary} ${c.textSecondary} ${c.border} border rounded-md text-sm`}>
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
        <div className="cm-banner cm-banner-amber rounded-none border-x-0 border-t-0 flex-shrink-0">
          <WarningAlt size={16} className="flex-shrink-0" />
          <span>Offline-Speicher voll. Ältere E-Mails werden nicht mehr zwischengespeichert.</span>
          <button onClick={() => setShowQuotaWarning(false)} className="ml-auto opacity-60 hover:opacity-100" aria-label="Schliessen"><Close size={16} /></button>
        </div>
      )}

      {/* v7.0: Tastaturkürzel-Hilfe (?-Taste) */}
      {showShortcutHelp && (
        <div className="fixed inset-0 z-[70] bg-black/40 flex items-center justify-center" onClick={() => setShowShortcutHelp(false)}>
          <div className={`${c.popover} ${c.border} border rounded-xl p-6 max-w-lg w-full mx-4 shadow-2xl`} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className={`text-lg font-semibold ${c.text}`}>Tastaturkürzel</h3>
              <button onClick={() => setShowShortcutHelp(false)} className={`p-1 rounded ${c.hover} ${c.textSecondary}`} aria-label="Schliessen"><Close size={16} /></button>
            </div>
            <div className={`grid grid-cols-[auto_1fr] gap-x-5 gap-y-1.5 text-sm ${c.text}`}>
              {[
                ['↑ / ↓  oder  J / K', 'Mail-Navigation'],
                ['Enter', 'Vollansicht öffnen'],
                ['N', 'Neue E-Mail'],
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
                  <kbd className="cm-kbd justify-self-start font-mono">{key}</kbd>
                  <span className={c.textSecondary}>{desc}</span>
                </React.Fragment>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* v6.9.6: Aktions-Toast. v6.11.0: String = Fehler; Objekt { text, undo?, error? } für Info-Toasts mit Rückgängig. */}
      {actionToast && (() => {
        const t = typeof actionToast === 'string' ? { text: actionToast, error: true } : actionToast;
        return (
          <div className={`fixed bottom-4 right-4 z-[60] flex items-center gap-3 px-4 py-3 border text-sm rounded-lg shadow-2xl max-w-sm ${
            t.error ? 'cm-banner-red' : `${c.popover} ${c.border} ${c.text}`
          }`}>
            {t.error ? <WarningAlt size={16} className="flex-shrink-0" /> : <Checkmark size={16} className="flex-shrink-0 text-green-500" />}
            <span className="break-words">{t.text}</span>
            {t.undo && (
              <button
                onClick={() => { const u = t.undo; setActionToast(null); u(); }}
                className={`ml-1 px-2 py-1 rounded-md ${c.bgTertiary} ${c.accent} font-medium flex-shrink-0`}
              >
                Rückgängig
              </button>
            )}
            <button onClick={() => setActionToast(null)} className="ml-auto opacity-60 hover:opacity-100 flex-shrink-0" aria-label="Schliessen"><Close size={16} /></button>
          </div>
        );
      })()}

      {/* ── Kommandoleiste (wie das vereinfachte Menüband in Outlook) ── */}
      <div className={`h-12 flex-shrink-0 flex items-center gap-0.5 px-2 overflow-hidden ${c.bgSecondary} ${c.border} border-b`} role="toolbar" aria-label="Aktionen">
        <button
          onClick={toggleFolderPane}
          title={folderPaneCollapsed ? 'Ordner-Spalte ausklappen' : 'Ordner-Spalte einklappen'}
          aria-label={folderPaneCollapsed ? 'Ordner-Spalte ausklappen' : 'Ordner-Spalte einklappen'}
          className={`cm-cmd w-9 !px-0 justify-center ${c.textSecondary} ${c.hover}`}
        >
          {folderPaneCollapsed ? <SidePanelOpen size={18} /> : <SidePanelClose size={18} />}
        </button>
        <button
          onClick={() => onNavigate && onNavigate('compose')}
          className={`cm-cmd ml-1 ${c.accentBg} ${c.accentHover} text-white shadow-sm`}
          title="Neue E-Mail (N)"
        >
          <Add size={18} />
          <span>Neue E-Mail</span>
        </button>
        <div className={`w-px h-6 mx-2 ${c.border} border-l`} />
        <CmdButton c={c} Icon={TrashCan} label="Löschen" title="Löschen (Entf)" danger disabled={!selectedEmail} onClick={() => requestDelete(selectedEmail.uid)} />
        <CmdButton c={c} Icon={Archive} label="Archivieren" title="Archivieren (E)" disabled={!selectedEmail} onClick={() => handleArchive(selectedEmail.uid)} />
        <div className={`w-px h-6 mx-2 ${c.border} border-l`} />
        <CmdButton c={c} Icon={Reply} label="Antworten" title="Antworten (R)" disabled={!selectedEmail} active={replyMode === 'reply'} onClick={() => setReplyMode(replyMode === 'reply' ? null : 'reply')} />
        <CmdButton c={c} Icon={ReplyAll} label="Allen antworten" title="Allen antworten (A)" disabled={!selectedEmail} active={replyMode === 'replyAll'} onClick={() => setReplyMode(replyMode === 'replyAll' ? null : 'replyAll')} />
        <CmdButton c={c} Icon={SendAlt} label="Weiterleiten" title="Weiterleiten (F)" disabled={!selectedEmail || !onForward} onClick={() => onForward(selectedEmail)} />
        <div className={`w-px h-6 mx-2 ${c.border} border-l`} />
        <CmdButton c={c} btnRef={snoozeBtnRef} Icon={Time} label="Erinnern" disabled={!selectedEmail} active={snoozeMenuOpen} onClick={openSnooze} />
        <CmdButton
          c={c}
          Icon={selectedEmail?.seen === false ? Email : EmailNew}
          label={selectedEmail?.seen === false ? 'Als gelesen' : 'Als ungelesen'}
          title="Gelesen/Ungelesen (U)"
          disabled={!selectedEmail}
          onClick={() => handleToggleRead(selectedEmail.uid, selectedEmail.seen)}
        />
        <div className="flex-1" />
        <button
          onClick={openSearch}
          className={`h-8 flex items-center gap-2 px-3 rounded-md border ${c.border} ${c.list} ${c.textSecondary} text-sm ${c.hover} w-9 justify-center lg:justify-start lg:w-52 xl:w-64 flex-shrink min-w-0`}
          title="Suchen (⌘/Ctrl + K)"
          aria-label="E-Mails durchsuchen"
        >
          <Search size={16} className="flex-shrink-0" />
          <span className="hidden lg:inline flex-1 text-left truncate">E-Mails durchsuchen</span>
          <kbd className="cm-kbd hidden xl:inline">⌘K</kbd>
        </button>
        <button
          onClick={() => setShowShortcutHelp(true)}
          title="Tastaturkürzel (?)"
          aria-label="Tastaturkürzel anzeigen"
          className={`cm-cmd w-9 !px-0 justify-center ml-1 ${c.textSecondary} ${c.hover}`}
        >
          <Keyboard size={18} />
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* ── Ordner-Spalte: Konten + Ordner (v8.0 zusammengeführt) ── */}
        <div
          ref={folderPaneRef}
          className={`${c.pane} ${c.border} border-r flex flex-col overflow-hidden min-h-0 relative flex-shrink-0`}
          style={{ width: folderPaneCollapsed ? FOLDER_COLLAPSED_WIDTH : folderWidth }}
        >
          {folderError && !folderPaneCollapsed && (
            <div className="cm-banner cm-banner-red rounded-none border-x-0 border-t-0 text-xs">
              <WarningAlt size={16} className="flex-shrink-0" /> {folderError}
            </div>
          )}

          <div className={`flex-1 overflow-y-auto overflow-x-hidden ${folderPaneCollapsed ? 'py-2 px-1' : 'py-2 px-2'}`}>
            {/* Konten */}
            {showAccountSection && !folderPaneCollapsed && (
              <div className="mb-3">
                <div className={`px-2 pt-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide ${c.textSecondary}`}>Konten</div>
                <button
                  onClick={() => setActiveAccountId('__ALL__')}
                  className={`w-full text-left h-8 px-2 flex items-center gap-2 text-sm rounded-md transition-colors ${
                    allMode ? `${c.selected} ${c.text} font-semibold` : `${c.text} ${c.paneHover}`
                  }`}
                  aria-current={allMode ? 'true' : undefined}
                >
                  <MailAll size={16} className={allMode ? c.accent : c.textSecondary} />
                  <span className="truncate flex-1">Alle Konten</span>
                  {totalUnread > 0 && <span className={`text-xs font-semibold ${c.accent} tabular-nums`}>{totalUnread > 999 ? '999+' : totalUnread}</span>}
                </button>
                {accountGroups.map(({ cat, accounts: accs }) => {
                  const CatIcon = getCategoryIcon(cat.icon);
                  const isCollapsed = collapsedCats.has(cat.id);
                  const showGroupHeader = accountGroups.length > 1;
                  return (
                    <div key={cat.id} className="mt-0.5">
                      {showGroupHeader && (
                        <button
                          onClick={() => toggleCat(cat.id)}
                          className={`w-full text-left h-7 px-1 flex items-center gap-1.5 text-xs rounded-md ${c.textSecondary} ${c.paneHover}`}
                          aria-expanded={!isCollapsed}
                        >
                          {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                          <span className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0" style={{ backgroundColor: cat.color }}>
                            <CatIcon size={10} className="text-white" />
                          </span>
                          <span className="truncate font-medium">{cat.name}</span>
                        </button>
                      )}
                      {!isCollapsed && accs.map(acc => {
                        const isActiveAcc = activeAccountId === acc.id;
                        const n = accountStats?.[acc.id]?.unread || 0;
                        return (
                          <button
                            key={acc.id}
                            onClick={() => setActiveAccountId(acc.id)}
                            className={`w-full text-left h-8 pr-2 flex items-center gap-2 text-sm rounded-md transition-colors ${
                              isActiveAcc ? `${c.selected} ${c.text} font-semibold` : `${c.text} ${c.paneHover}`
                            }`}
                            style={{ paddingLeft: showGroupHeader ? 24 : 8 }}
                            title={acc.name}
                            aria-current={isActiveAcc ? 'true' : undefined}
                          >
                            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${acc.type === 'microsoft' ? 'bg-ms-blue' : 'bg-emerald-500'}`} aria-hidden="true" />
                            <span className="truncate flex-1">{acc.displayName || acc.name}</span>
                            {n > 0 && <span className={`text-xs font-semibold ${c.accent} tabular-nums`}>{n > 999 ? '999+' : n}</span>}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Ordner */}
            {!folderPaneCollapsed && (
              <div className={`px-2 pt-1 pb-1.5 flex items-center gap-1 ${c.textSecondary}`}>
                <span className="text-[11px] font-semibold uppercase tracking-wide truncate flex-1" title={allMode ? 'Alle Konten' : (account?.name || '')}>
                  {showAccountSection ? (allMode ? 'Alle Konten' : (account?.displayName || account?.name || 'Ordner')) : 'Ordner'}
                </span>
                {!allMode && (
                  <>
                    <button onClick={openCreateFolder} title="Neuer Ordner" aria-label="Neuer Ordner" className={`p-1 rounded ${c.paneHover}`}>
                      <FolderAdd size={14} />
                    </button>
                    <button
                      onClick={() => { folderCache.delete(`folders:${activeAccountId}`); loadFolders(true); }}
                      title="Ordner synchronisieren"
                      aria-label="Ordner synchronisieren"
                      className={`p-1 rounded ${c.paneHover}`}
                    >
                      <Renew size={14} className={loadingFolders ? 'animate-spin' : ''} />
                    </button>
                  </>
                )}
              </div>
            )}

            {flatFolders.map(folder => (
              <div
                key={folder.path}
                onMouseEnter={() => setHoveredFolder(folder.path)}
                onMouseLeave={() => setHoveredFolder(null)}
                className="relative"
              >
                {renderFolderRow(folder)}

                {/* Umbenennen / Löschen — nur eigene Ordner, nur offen */}
                {!folderPaneCollapsed && hoveredFolder === folder.path && !SYSTEM_FOLDERS.has(folder.path) && !allMode && (
                  <div className={`absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 z-10 ${c.pane} rounded-md`}>
                    <button
                      onClick={(e) => { e.stopPropagation(); openRenameFolder(folder); }}
                      title="Umbenennen"
                      aria-label="Umbenennen"
                      className={`p-1 rounded ${c.paneHover} ${c.textSecondary}`}
                    >
                      <Edit size={14} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); openDeleteFolder(folder); }}
                      title="Löschen"
                      aria-label="Ordner löschen"
                      className={`p-1 rounded ${c.paneHover} ${c.textSecondary} hover:text-ms-red`}
                    >
                      <TrashCan size={14} />
                    </button>
                  </div>
                )}

                {/* v2.4.0: Virtuelle Unterordner des Posteingangs (Spam-Filter) */}
                {folder.path === 'INBOX' && inboxExpanded && spamFilterEnabled && !allMode && !folderPaneCollapsed && (
                  <div>
                    {INBOX_SUBFOLDERS.map(subfolder => {
                      const SubIcon = subfolder.icon;
                      const count = categoryCounts[subfolder.id] || 0;
                      const isActive = currentFolder === 'INBOX' && categoryFilter === subfolder.id;
                      return (
                        <button
                          key={subfolder.id}
                          onClick={() => { setCurrentFolder('INBOX'); setCategoryFilter(subfolder.id); }}
                          className={`w-full text-left h-7 pr-2 flex items-center gap-1.5 text-[13px] rounded-md transition-colors ${
                            isActive ? `${c.selected} ${c.text} font-semibold` : `${c.textSecondary} ${c.paneHover}`
                          }`}
                          style={{ paddingLeft: '32px' }}
                          aria-current={isActive ? 'true' : undefined}
                        >
                          <SubIcon size={14} className="flex-shrink-0" />
                          <span className="truncate flex-1">{subfolder.name}</span>
                          {count > 0 && <span className={`text-xs tabular-nums ${isActive ? c.accent : c.textSecondary}`}>{count}</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}

            {flatFolders.length === 0 && !loadingFolders && !folderPaneCollapsed && (
              <button
                onClick={() => setCurrentFolder('INBOX')}
                className={`w-full text-left h-8 px-2 flex items-center gap-2 text-sm rounded-md ${currentFolder === 'INBOX' ? `${c.selected} font-semibold` : c.paneHover} ${c.text}`}
              >
                <MailAll size={16} className={c.textSecondary} />
                Posteingang
                {unreadCount > 0 && <span className={`ml-auto text-xs font-semibold ${c.accent}`}>{unreadCount}</span>}
              </button>
            )}
          </div>

          {!folderPaneCollapsed && (
            <div
              onMouseDown={() => setIsResizingFolder(true)}
              className={`cm-resizer ${isResizingFolder ? 'active' : ''}`}
              title="Ziehen zum Ändern der Breite"
            />
          )}

          {/* ── Folder Modal (create / rename / delete) ── */}
          {folderModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setFolderModal(null)}>
              <div
                className={`w-80 rounded-xl p-6 ${c.popover} border ${c.border} shadow-2xl`}
                onClick={e => e.stopPropagation()}
              >
                {folderModal.mode === 'create' && (
                  <>
                    <h3 className={`text-base font-semibold ${c.text} mb-4 flex items-center gap-2`}>
                      <FolderAdd size={20} className={c.accent} /> Neuer Ordner
                    </h3>
                    <input
                      autoFocus
                      type="text"
                      value={folderModalInput}
                      onChange={e => setFolderModalInput(e.target.value)}
                      onKeyDown={handleFolderModalKey}
                      placeholder="Ordnername…"
                      className={`w-full px-3 py-2 rounded-md text-sm ${c.input} border focus:outline-none mb-3`}
                    />
                  </>
                )}
                {folderModal.mode === 'rename' && (
                  <>
                    <h3 className={`text-base font-semibold ${c.text} mb-4 flex items-center gap-2`}>
                      <Edit size={20} className={c.accent} /> Ordner umbenennen
                    </h3>
                    <input
                      autoFocus
                      type="text"
                      value={folderModalInput}
                      onChange={e => setFolderModalInput(e.target.value)}
                      onKeyDown={handleFolderModalKey}
                      placeholder="Neuer Name…"
                      className={`w-full px-3 py-2 rounded-md text-sm ${c.input} border focus:outline-none mb-3`}
                    />
                  </>
                )}
                {folderModal.mode === 'delete' && (
                  <>
                    <h3 className={`text-base font-semibold ${c.text} mb-2 flex items-center gap-2`}>
                      <TrashCan size={20} className="text-ms-red" /> Ordner löschen
                    </h3>
                    <p className={`text-sm ${c.textSecondary} mb-4`}>
                      Ordner <strong className={c.text}>"{folderModal.folder.name}"</strong> dauerhaft löschen?
                      Alle enthaltenen E-Mails werden ebenfalls gelöscht.
                    </p>
                  </>
                )}
                {folderModalError && (
                  <p className="text-xs text-ms-red mb-3 flex items-center gap-1">
                    <WarningAlt size={16} className="flex-shrink-0" /> {folderModalError}
                  </p>
                )}
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setFolderModal(null)}
                    className={`px-4 py-2 rounded-md text-sm ${c.bgTertiary} ${c.text} ${c.hover} border ${c.border}`}
                  >
                    Abbrechen
                  </button>
                  <button
                    onClick={submitFolderModal}
                    disabled={folderModalLoading}
                    className={`px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50 flex items-center gap-1.5 text-white ${
                      folderModal.mode === 'delete' ? 'bg-red-600 hover:bg-red-500' : `${c.accentBg} ${c.accentHover}`
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

        {/* ── Mail-Liste ── */}
        <div
          ref={listPaneRef}
          className={`${c.list} ${c.border} border-r flex flex-col overflow-hidden min-h-0 relative flex-shrink-0`}
          style={{ width: emailListWidth }}
        >
          {/* Listenkopf: Ordnername · Zähler · Werkzeuge · Alle/Ungelesen */}
          <div className={`px-3 pt-2.5 pb-2 ${c.border} border-b flex-shrink-0`}>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 className={`text-[15px] font-semibold ${c.text} truncate leading-tight`} title={currentFolderName}>{currentFolderName}</h2>
                <p className={`text-xs ${c.textSecondary} truncate mt-0.5`}>
                  {filteredEmails.length} {filteredEmails.length === 1 ? 'E-Mail' : 'E-Mails'}
                  {(categoryFilter || showUnreadOnly) && ` von ${emails.length}`}
                  {!categoryFilter && !showUnreadOnly && unreadCount > 0 && ` · ${unreadCount} ungelesen`}
                </p>
              </div>
              <div className="flex items-center gap-0.5 flex-shrink-0">
                <button
                  onClick={() => {
                    setShowCheckboxes(!showCheckboxes);
                    if (showCheckboxes) setSelectedUids(new Set());
                  }}
                  className={`p-1.5 rounded-md transition-colors ${showCheckboxes ? `${c.selected} ${c.accent}` : `${c.hover} ${c.textSecondary}`}`}
                  title="Mehrfachauswahl"
                  aria-label="Mehrfachauswahl"
                  aria-pressed={showCheckboxes}
                >
                  <CheckboxChecked size={16} />
                </button>
                <button
                  onClick={() => fetchEmails(false)}
                  className={`p-1.5 ${c.hover} rounded-md transition-colors ${c.textSecondary}`}
                  title="Aktualisieren"
                  aria-label="Aktualisieren"
                >
                  <Renew size={16} />
                </button>
                <button
                  onClick={handleRunTriage}
                  disabled={triageRunning || filteredEmails.length === 0}
                  className={`p-1.5 rounded-md transition-colors ${triageRunning ? `${c.selected} ${c.accent}` : `${c.hover} ${c.textSecondary}`} disabled:opacity-40`}
                  title="Mails durch KI einstufen"
                  aria-label="Mails durch KI einstufen"
                >
                  {triageRunning ? <InProgress size={16} className="animate-spin" /> : <Bot size={16} />}
                </button>
              </div>
            </div>

            <div className="mt-2 flex items-center justify-between gap-2">
              <div className={`inline-flex rounded-md border ${c.border} p-0.5 ${c.bgTertiary}`} role="tablist" aria-label="Filter">
                <button
                  role="tab"
                  aria-selected={!showUnreadOnly}
                  onClick={() => setShowUnreadOnly(false)}
                  className={`px-2.5 h-6 text-xs rounded transition-colors ${!showUnreadOnly ? `${c.list} ${c.text} font-semibold shadow-sm` : c.textSecondary}`}
                >
                  Alle
                </button>
                <button
                  role="tab"
                  aria-selected={showUnreadOnly}
                  onClick={() => setShowUnreadOnly(true)}
                  className={`px-2.5 h-6 text-xs rounded transition-colors ${showUnreadOnly ? `${c.list} ${c.text} font-semibold shadow-sm` : c.textSecondary}`}
                >
                  Ungelesen{unreadCount > 0 ? ` ${unreadCount}` : ''}
                </button>
              </div>
              {activeCategoryDef && currentFolder === 'INBOX' && (
                <span className={`cm-badge cm-badge-${activeCategoryDef.badge}`}>
                  <span>{activeCategoryDef.name}</span>
                  <button onClick={() => setCategoryFilter(null)} className="inline-flex" title="Filter entfernen" aria-label="Kategorie-Filter entfernen">
                    <Close size={12} />
                  </button>
                </span>
              )}
              {triageProgress && !activeCategoryDef && (
                <span className={`text-xs ${c.textSecondary} truncate`}>KI: {triageProgress.processed}/{triageProgress.total}</span>
              )}
            </div>

            {/* v2.3.0: Multi-Select Controls */}
            {showCheckboxes && (
              <div className={`mt-2 pt-2 ${c.border} border-t flex items-center justify-between gap-2`}>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSelectAll}
                    className={`px-2 py-1 text-xs ${c.hover} rounded-md ${c.textSecondary} flex items-center gap-1.5`}
                  >
                    {selectedUids.size === filteredEmails.length && filteredEmails.length > 0
                      ? <><CloseFilled size={14} /> Keine</>
                      : <><CheckboxChecked size={14} /> Alle</>}
                  </button>
                  {selectedUids.size > 0 && (
                    <span className={`text-xs font-medium ${c.accent}`}>{selectedUids.size} ausgewählt</span>
                  )}
                </div>
                {selectedUids.size > 0 && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={handleBulkMarkRead}
                      disabled={actionLoading === 'bulk-read'}
                      className={`px-2 py-1 text-xs ${c.hover} rounded-md ${c.text} flex items-center gap-1.5 border ${c.border}`}
                      title="Ausgewählte als gelesen markieren"
                    >
                      {actionLoading === 'bulk-read' ? <InProgress size={14} className="animate-spin" /> : <Email size={14} />}
                      Gelesen
                    </button>
                    <button
                      onClick={() => {
                        if (isTrashFolder(currentFolder)) setShowDeleteConfirm(true);
                        else handleBulkDelete();
                      }}
                      className="px-2 py-1 text-xs bg-red-600 hover:bg-red-500 text-white rounded-md flex items-center gap-1.5"
                    >
                      <TrashCan size={14} />
                      Löschen ({selectedUids.size})
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          <div
            ref={emailScrollRef}
            className="flex-1 overflow-y-auto min-h-0"
            onScroll={handleEmailListScroll}
          >
            {filteredEmails.length === 0 ? (
              <div className={`p-8 text-center ${c.textSecondary}`}>
                {showUnreadOnly ? (
                  <div>
                    <CheckmarkFilled size={32} className="mx-auto mb-2 text-green-500" />
                    <p className="text-sm">Keine ungelesenen E-Mails</p>
                    <button onClick={() => setShowUnreadOnly(false)} className={`mt-2 text-sm ${c.accent} hover:underline`}>
                      Alle E-Mails anzeigen
                    </button>
                  </div>
                ) : categoryFilter ? (
                  <div>
                    <MailAll size={32} className="mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Keine E-Mails in dieser Kategorie</p>
                    <button onClick={() => setCategoryFilter(null)} className={`mt-2 text-sm ${c.accent} hover:underline`}>
                      Alle E-Mails anzeigen
                    </button>
                  </div>
                ) : (
                  <div>
                    <MailAll size={32} className="mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Keine E-Mails in diesem Ordner</p>
                  </div>
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
                        <div className={`sticky top-0 z-10 px-3 py-1 text-xs font-semibold ${c.list} ${c.textSecondary} border-b ${c.border}`}>
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
                      ? <span className={`text-sm ${c.textSecondary}`}>Lade mehr…</span>
                      : <button onClick={loadMoreEmails} className={`text-sm ${c.accent} hover:underline`}>Mehr laden…</button>
                    }
                  </div>
                )}
              </>
            )}
          </div>

          <div
            onMouseDown={() => setIsResizingEmailList(true)}
            className={`cm-resizer ${isResizingEmailList ? 'active' : ''}`}
            title="Ziehen zum Ändern der Breite"
          />
        </div>

        {/* ── Lese-Blatt (immer weiss) ── */}
        <div
          className={`relative flex-1 flex flex-col overflow-hidden min-h-0 ${c.bg}`}
          style={{ minWidth: `${PREVIEW_MIN_WIDTH}px` }}
        >
          {replySentToast && (
            <div className="absolute bottom-6 right-6 z-50 px-4 py-2.5 bg-green-600 text-white text-sm rounded-md shadow-lg flex items-center gap-2">
              <CheckmarkFilled size={16} />
              Antwort gesendet
            </div>
          )}
          {loadingPreview ? (
            <div className="cm-sheet flex-1 p-6 space-y-4">
              <div className="cm-skeleton h-6 w-3/4" />
              <div className="flex items-center gap-3">
                <div className="cm-skeleton h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <div className="cm-skeleton h-3.5 w-1/3" />
                  <div className="cm-skeleton h-3 w-1/4" />
                </div>
              </div>
              <div className="space-y-3 pt-4">
                <div className="cm-skeleton h-3.5 w-full" />
                <div className="cm-skeleton h-3.5 w-5/6" />
                <div className="cm-skeleton h-3.5 w-4/5" />
                <div className="cm-skeleton h-3.5 w-full" />
                <div className="cm-skeleton h-3.5 w-3/4" />
              </div>
            </div>
          ) : previewError ? (
            <div className={`cm-sheet flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center ${s.textSecondary}`}>
              <WarningAlt size={32} className="text-amber-500" />
              <p className="text-sm">E-Mail konnte nicht geladen werden</p>
              <p className="text-xs opacity-70 max-w-sm break-words">{previewError.message}</p>
              <button
                onClick={() => loadEmailPreview(previewError.uid)}
                className={`mt-1 px-4 py-2 text-sm rounded-md ${s.accentBg} ${s.accentHover} text-white`}
              >
                Erneut versuchen
              </button>
            </div>
          ) : selectedEmail ? (
            <SheetTheme>
              <div className="cm-sheet flex-1 flex flex-col overflow-hidden min-h-0">
                {/* Kopf: Betreff · Absender · Empfänger · Aktionen */}
                <div className={`px-6 pt-5 pb-3 border-b ${s.border} flex-shrink-0`}>
                  <h2 className={`text-xl font-semibold ${s.text} leading-snug break-words`}>
                    {selectedEmail.subject || '(Kein Betreff)'}
                  </h2>
                  <div className="mt-3 flex items-start gap-3">
                    {(() => { const av = avatarFor(selectedEmail); return (
                      <span className={`w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-white text-sm font-semibold ${av.color}`} aria-hidden="true">
                        {av.initial}
                      </span>
                    ); })()}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline justify-between gap-x-3 flex-wrap">
                        <span className={`text-[15px] font-semibold ${s.text} truncate min-w-[10rem]`}>{selectedEmail.fromName || displayNameOf(selectedEmail.from) || selectedEmail.from}</span>
                        <span className={`text-xs ${s.textSecondary} flex-shrink-0`} title={new Date(selectedEmail.date).toLocaleString('de-DE')}>{sheetDate(selectedEmail.date)}</span>
                      </div>
                      {addressOf(selectedEmail.from) !== (selectedEmail.fromName || displayNameOf(selectedEmail.from)) && (
                        <div className={`text-xs ${s.textSecondary} truncate`}>{addressOf(selectedEmail.from)}</div>
                      )}
                      {/* v6.9.0: Empfänger wie Outlook — kompakt, aufklappbar */}
                      {(selectedEmail.to || selectedEmail.cc) && (
                        <div className={`text-xs mt-0.5 ${s.textSecondary}`}>
                          {headerExpanded ? (
                            <div className="space-y-0.5 py-0.5">
                              {selectedEmail.to && (
                                <div className="break-words"><span className="font-medium">An: </span><span className={s.text}>{selectedEmail.to}</span></div>
                              )}
                              {selectedEmail.cc && (
                                <div className="break-words"><span className="font-medium">Cc: </span><span className={s.text}>{selectedEmail.cc}</span></div>
                              )}
                              <button onClick={() => setHeaderExpanded(false)} className={`${s.accent} hover:underline flex items-center gap-0.5`}>
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
                                <span>An: </span>
                                {displayNamesOf(selectedEmail.to)}
                                {selectedEmail.cc && <span> · Cc: {displayNamesOf(selectedEmail.cc)}</span>}
                              </span>
                              <ChevronDown size={12} className="flex-shrink-0" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      <button
                        onClick={() => setReplyMode(replyMode === 'reply' ? null : 'reply')}
                        className={`p-2 rounded-md transition-colors ${replyMode === 'reply' ? `${s.selected} ${s.accent}` : `${s.hover} ${s.textSecondary}`}`}
                        title="Antworten (R)"
                        aria-label="Antworten"
                      >
                        <Reply size={18} />
                      </button>
                      <button
                        onClick={() => setReplyMode(replyMode === 'replyAll' ? null : 'replyAll')}
                        className={`p-2 rounded-md transition-colors ${replyMode === 'replyAll' ? `${s.selected} ${s.accent}` : `${s.hover} ${s.textSecondary}`}`}
                        title="Allen antworten (A)"
                        aria-label="Allen antworten"
                      >
                        <ReplyAll size={18} />
                      </button>
                      <button
                        onClick={() => onForward && onForward(selectedEmail)}
                        className={`p-2 rounded-md transition-colors ${s.hover} ${s.textSecondary}`}
                        title="Weiterleiten (F)"
                        aria-label="Weiterleiten"
                      >
                        <SendAlt size={18} />
                      </button>
                      <div className={`w-px h-5 mx-1 ${s.border} border-l`} />
                      <button
                        onClick={() => onFullView(selectedEmail, currentFolder)}
                        className={`p-2 rounded-md transition-colors ${s.hover} ${s.textSecondary}`}
                        title="In der Vollansicht öffnen (Enter)"
                        aria-label="In der Vollansicht öffnen"
                      >
                        <Launch size={18} />
                      </button>
                    </div>
                  </div>

                  {/* Werkzeugzeile: Übersetzen · Absender einstufen */}
                  <div className="mt-3 flex items-center gap-4 flex-wrap">
                    <TranslateBar email={selectedEmail} c={s} />
                    <CategoryButtons
                      email={selectedEmail}
                      currentCategory={manualCategories.get(selectedEmail?.uid)}
                      onCategorize={handleCategorize}
                      c={s}
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-auto flex flex-col">
                  {/* v1.14.0: Spam-Warnung */}
                  {selectedSpam && selectedSpam.category !== 'sicher' && TAG_STYLES[selectedSpam.category] && (
                    <div className={`mx-6 mt-4 cm-banner cm-banner-${selectedSpamColor}`}>
                      <Security size={20} className="flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm">
                          {TAG_STYLES[selectedSpam.category].label} — {TAG_STYLES[selectedSpam.category].description}
                        </div>
                        {selectedSpam.reasons?.length > 0 && (
                          <div className="text-xs opacity-80 mt-0.5">
                            {selectedSpam.reasons.slice(0, 3).join(' • ')}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* v2.9.3: Inline-Antwort — oberhalb der Mail */}
                  {replyMode && (
                    <div
                      className={`relative mx-6 mt-4 rounded-lg border ${s.border} ${s.bgSecondary} flex-shrink-0 overflow-hidden`}
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
                        <div className="absolute inset-0 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-ms-blue bg-ms-tint/70 pointer-events-none">
                          <span className="flex items-center gap-2 text-ms-blue text-sm font-medium">
                            <Attachment size={20} /> Dateien hier ablegen, um sie anzuhängen
                          </span>
                        </div>
                      )}
                      {/* Reply header */}
                      <div className={`px-4 py-2 border-b ${s.border} flex items-center justify-between`}>
                        <div className={`text-sm font-semibold ${s.text} flex items-center gap-2`}>
                          {replyMode === 'replyAll' ? <ReplyAll size={16} /> : <Reply size={16} />}
                          <span>{replyMode === 'replyAll' ? 'Allen antworten' : 'Antworten'}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {replyError && <span className="text-xs text-ms-red">{replyError}</span>}
                          <button
                            onClick={handleSendReply}
                            disabled={replySending}
                            className={`px-3 py-1.5 ${s.accentBg} ${s.accentHover} text-white rounded-md text-sm font-medium flex items-center gap-1.5 disabled:opacity-50`}
                            title="Senden (⌘/Ctrl + Enter)"
                          >
                            {replySending ? <><InProgress size={16} className="animate-spin" /> Sende…</> : <><Send size={16} /> Senden</>}
                          </button>
                          <button
                            onClick={closeReply}
                            className={`p-1.5 ${s.hover} rounded-md ${s.textSecondary}`}
                            title="Antwort schliessen"
                            aria-label="Antwort schliessen"
                          >
                            <Close size={16} />
                          </button>
                        </div>
                      </div>

                      {/* v6.9.1: Editierbare Empfänger mit Autocomplete */}
                      <div className={`px-4 py-2 border-b ${s.border} space-y-1.5 ${s.bg}`}>
                        <EmailTagInput label="An:" tags={replyToTags} onChange={setReplyToTags} placeholder="empfaenger@example.com" c={s} />
                        {replyShowCc ? (
                          <EmailTagInput label="CC:" tags={replyCcTags} onChange={setReplyCcTags} placeholder="cc@example.com" c={s} />
                        ) : (
                          <button onClick={() => setReplyShowCc(true)} className={`text-xs ${s.textSecondary} hover:underline ml-[76px]`}>
                            + CC hinzufügen
                          </button>
                        )}
                      </div>

                      {/* Formatting toolbar */}
                      <div className={`flex items-center gap-1 px-3 py-1.5 border-b ${s.border} ${s.bg}`}>
                        {[
                          { cmd: 'bold',      label: <strong>B</strong>,  title: 'Fett (Ctrl+B)' },
                          { cmd: 'italic',    label: <em>I</em>,           title: 'Kursiv (Ctrl+I)' },
                          { cmd: 'underline', label: <span style={{textDecoration:'underline'}}>U</span>, title: 'Unterstrichen (Ctrl+U)' },
                        ].map(btn => (
                          <button
                            key={btn.cmd}
                            onMouseDown={e => { e.preventDefault(); replyEditorRef.current?.focus(); document.execCommand(btn.cmd, false, null); }}
                            title={btn.title}
                            className={`w-7 h-7 flex items-center justify-center rounded text-xs ${s.hover} ${s.text}`}
                          >
                            {btn.label}
                          </button>
                        ))}
                        <div className={`w-px h-4 ${s.border} border-l mx-1`} />
                        {[
                          { cmd: 'insertUnorderedList', label: '•', title: 'Aufzählungsliste' },
                          { cmd: 'insertOrderedList',   label: '1.', title: 'Nummerierte Liste' },
                        ].map(btn => (
                          <button
                            key={btn.cmd}
                            onMouseDown={e => { e.preventDefault(); replyEditorRef.current?.focus(); document.execCommand(btn.cmd, false, null); }}
                            title={btn.title}
                            className={`w-7 h-7 flex items-center justify-center rounded text-xs ${s.hover} ${s.text}`}
                          >
                            {btn.label}
                          </button>
                        ))}
                        <div className={`w-px h-4 ${s.border} border-l mx-1`} />
                        <button
                          onMouseDown={e => { e.preventDefault(); replyEditorRef.current?.focus(); document.execCommand('removeFormat', false, null); }}
                          title="Formatierung entfernen"
                          className={`w-7 h-7 flex items-center justify-center rounded ${s.hover} ${s.textSecondary}`}
                        >
                          <Close size={16} />
                        </button>
                        <div className={`w-px h-4 ${s.border} border-l mx-1`} />
                        <button
                          onClick={() => replyFileInputRef.current?.click()}
                          title="Anhang hinzufügen (oder Dateien ins Antwortfeld ziehen)"
                          className={`h-7 px-2 flex items-center gap-1.5 rounded text-xs border ${s.border} ${s.hover} ${replyAttachments.length > 0 ? s.accent : s.text}`}
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
                          <span className={`ml-1 text-xs ${s.textSecondary}`}>{replyAttachments.length}</span>
                        )}
                      </div>

                      {/* Reply attachments list */}
                      {replyAttachments.length > 0 && (
                        <div className={`px-3 py-2 border-b ${s.border} flex flex-wrap gap-1.5 ${s.bg}`}>
                          {replyAttachments.map(att => (
                            <div key={att.id} className={`flex items-center gap-1.5 px-2 py-1 rounded-md ${s.bgTertiary} border ${s.border} text-xs`}>
                              <Attachment size={14} className={s.textSecondary} />
                              <span className={`${s.text} max-w-[140px] truncate`}>{att.filename}</span>
                              <span className={s.textSecondary}>({(att.size / 1024).toFixed(0)} KB)</span>
                              <button
                                onClick={() => setReplyAttachments(prev => prev.filter(a => a.id !== att.id))}
                                className={`${s.textSecondary} hover:text-ms-red`}
                                aria-label="Anhang entfernen"
                              >
                                <Close size={14} />
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
                        className={`min-h-[120px] max-h-[260px] overflow-y-auto p-4 focus:outline-none ${s.text} ${s.bg}`}
                        style={{ fontSize: '14px', lineHeight: '1.6' }}
                        data-placeholder="Antwort schreiben…"
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
                      <div className={`mx-4 mb-3 pl-3 border-l-2 ${s.border} text-xs ${s.textSecondary} max-h-20 overflow-hidden`}>
                        <p className="font-medium mb-1">
                          Am {new Date(selectedEmail.date).toLocaleString('de-DE')} schrieb {displayNameOf(selectedEmail.from)}:
                        </p>
                        <div className="opacity-70 line-clamp-3">
                          {selectedEmail.text?.slice(0, 200) || selectedEmail.html?.replace(/<[^>]*>/g, '').slice(0, 200)}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Inhalt — flex-shrink-0, damit das Antwort-Panel nichts staucht (v6.7.2) */}
                  <div className="px-6 py-5 flex-shrink-0">
                    {/* v7.2.0: Einladung zuoberst */}
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
                    {/* v6.14.0: Anhänge über dem Mailtext — gut sichtbar, aber ruhig */}
                    {visibleAttachments.length > 0 && (
                      <div className="mb-5 rounded-lg border border-[#f2dd86] bg-[#fff8df] p-3">
                        <div className="flex items-center gap-2 text-sm font-semibold text-[#7a5a00] mb-2">
                          <Attachment size={16} />
                          {visibleAttachments.length === 1 ? '1 Anhang' : `${visibleAttachments.length} Anhänge`}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {visibleAttachments.map((att) => {
                            const i = att.index;
                            const prog = attachProgress[i];
                            const hasContent = !!att.content;
                            return (
                              <div key={`${selectedEmail.uid}-${att.filename}-${i}`} className={`flex items-center gap-2 pl-3 pr-1.5 py-1.5 bg-white border ${s.border} rounded-md text-sm ${s.text}`}>
                                <Attachment size={14} className={`flex-shrink-0 ${s.textSecondary}`} />
                                <span className="truncate max-w-[260px]" title={att.filename}>{att.filename}</span>
                                {att.size && <span className={`text-xs ${s.textSecondary}`}>{(att.size / 1024).toFixed(0)} KB</span>}
                                {hasContent && (
                                  <>
                                    <button
                                      onClick={() => saveAttachment(att, i, false)}
                                      disabled={prog === 'saving'}
                                      title="Speichern"
                                      aria-label="Anhang speichern"
                                      className={`p-1 rounded ${s.hover} ${s.accent} disabled:opacity-50`}
                                    >
                                      {prog === 'saving' ? <InProgress size={16} className="animate-spin" /> : prog === 'done' ? <CheckmarkFilled size={16} className="text-green-600" /> : <Download size={16} />}
                                    </button>
                                    <button
                                      onClick={() => saveAttachment(att, i, true)}
                                      disabled={prog === 'saving'}
                                      title="Öffnen"
                                      aria-label="Anhang öffnen"
                                      className={`p-1 rounded ${s.hover} ${s.textSecondary} disabled:opacity-50`}
                                    >
                                      <FolderOpen size={16} />
                                    </button>
                                  </>
                                )}
                                {prog === 'error' && <span className="text-xs text-ms-red">Fehler</span>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {selectedEmail.html ? (
                      <EmailHtmlFrame html={selectedEmail.html} fontFamily={previewFontStyle} />
                    ) : (
                      <div className={`${s.text} whitespace-pre-wrap text-sm leading-relaxed`} style={{ fontFamily: previewFontStyle }}>
                        {selectedEmail.text}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </SheetTheme>
          ) : (
            <div className={`flex-1 flex flex-col items-center justify-center gap-2 ${c.textSecondary} px-6 text-center`}>
              <Email size={40} className="opacity-30" />
              <p className="text-sm">Keine E-Mail ausgewählt</p>
              <p className="text-xs opacity-70">Wähle links eine Nachricht aus, um sie hier zu lesen.</p>
            </div>
          )}
        </div>
      </div>

      {/* v6.8.1: Antwort-verwerfen-Bestätigung */}
      {confirmDiscardReply && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className={`${c.popover} ${c.border} border rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl`}>
            <h3 className={`text-lg font-semibold ${c.text} mb-2`}>Antwort verwerfen?</h3>
            <p className={`text-sm ${c.textSecondary} mb-6`}>Deine angefangene Antwort geht verloren.</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDiscardReply(false)}
                className={`px-4 py-2 ${c.hover} ${c.border} border rounded-md text-sm ${c.text}`}
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
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-md text-sm"
              >
                Verwerfen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* v2.3.0: Delete Confirmation Modal — v6.8.1: auch für Einzel-Löschen */}
      {(showDeleteConfirm || confirmDeleteUid != null) && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className={`${c.popover} ${c.border} border rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl`}>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 rounded-full" style={{ background: 'var(--cm-badge-red-bg)' }}>
                <TrashCan size={24} className="text-ms-red" />
              </div>
              <div className="min-w-0">
                <h3 className={`text-lg font-semibold ${c.text}`}>
                  {confirmDeleteUid != null ? 'E-Mail endgültig löschen?' : 'E-Mails endgültig löschen?'}
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
                className={`px-4 py-2 ${c.hover} ${c.border} border rounded-md text-sm ${c.text}`}
                disabled={bulkDeleting}
                autoFocus
              >
                Abbrechen
              </button>
              <button
                onClick={confirmDeleteUid != null ? confirmSingleDelete : handleBulkDelete}
                disabled={bulkDeleting}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-md text-sm flex items-center gap-2"
              >
                {bulkDeleting ? <><InProgress size={16} className="animate-spin" /> Lösche…</> : <><TrashCan size={16} /> Löschen</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default InboxSplitView;
