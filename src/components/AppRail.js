import React from 'react';
import { Email, Calendar, Time, Bot, Filter, Group, Settings, Book } from '@carbon/icons-react';
import { useTheme } from '../context/ThemeContext';
import { useAccountStats } from '../context/AccountContext';

// ─── v8.0: App-Leiste (wie die linke Leiste in Outlook) ──────────────────────
//
// Ersetzt die breite, beim Hovern auf- und zuklappende Sidebar. Die Leiste ist
// schmal und steht still; Konten und Ordner liegen neu zusammen in der
// Ordner-Spalte des Posteingangs. Die Beschriftung erscheint als Tooltip.

const TOP_ITEMS = [
  { id: 'inbox',    label: 'E-Mail',        Icon: Email    },
  { id: 'calendar', label: 'Kalender',      Icon: Calendar },
  { id: 'snoozed',  label: 'Erinnerungen',  Icon: Time     },
];

const BOTTOM_ITEMS = [
  { id: 'ai',       label: 'KI-Assistent',  Icon: Bot      },
  { id: 'rules',    label: 'Mail-Regeln',   Icon: Filter   },
  { id: 'accounts', label: 'Konten',        Icon: Group    },
  { id: 'settings', label: 'Einstellungen', Icon: Settings },
  { id: 'logbuch',  label: 'Logbuch',       Icon: Book     },
];

// Verfassen und Vollansicht gehören zum Bereich «E-Mail»
const MAIL_VIEWS = new Set(['inbox', 'compose', 'emailView']);

function RailButton({ item, active, onClick, badge, c }) {
  const { Icon, label } = item;
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={`relative w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
        active ? `${c.selected} ${c.accent}` : `${c.textSecondary} ${c.paneHover}`
      }`}
    >
      {active && <span className="absolute left-0 top-2 bottom-2 w-[3px] rounded-r bg-current" aria-hidden="true" />}
      <Icon size={20} />
      {badge > 0 && (
        <span
          className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-ms-red text-white text-[10px] font-semibold flex items-center justify-center leading-none"
          aria-label={`${badge} ungelesen`}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
}

function AppRail({ currentView, onNavigate }) {
  const { currentTheme } = useTheme();
  const accountStats = useAccountStats();
  const c = currentTheme.colors;

  const totalUnread = Object.entries(accountStats || {})
    .filter(([id]) => id !== '__ALL__')
    .reduce((n, [, s]) => n + (s?.unread || 0), 0);

  const isActive = (id) => (id === 'inbox' ? MAIL_VIEWS.has(currentView) : currentView === id);

  return (
    <aside
      className={`w-14 flex-shrink-0 flex flex-col items-center py-2 gap-1 ${c.rail} ${c.border} border-r select-none`}
      aria-label="Hauptnavigation"
    >
      {/* Logo */}
      <button
        onClick={() => onNavigate('inbox')}
        title="CoreMail"
        className="w-10 h-10 mb-1 flex items-center justify-center rounded-lg"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="28" height="28" aria-hidden="true">
          <defs>
            <linearGradient id="railGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#0A0A0F" />
              <stop offset="100%" stopColor="#1A1A24" />
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="200" height="200" rx="40" fill="url(#railGrad)" />
          <g transform="translate(100,100)">
            <path d="M 40 -55 A 65 65 0 1 0 40 55" fill="none" stroke="#06B6D4" strokeWidth="6" strokeLinecap="round" />
            <path d="M 32 -45 A 53 53 0 1 0 32 45" fill="none" stroke="#22D3EE" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
            <path d="M -50 -8 L -25 0 L -50 8 Z" fill="#06B6D4" />
            <circle cx="-35" cy="0" r="3" fill="#22D3EE" />
            <circle cx="-20" cy="0" r="3" fill="#22D3EE" />
            <circle cx="-5" cy="0" r="3" fill="#22D3EE" />
          </g>
        </svg>
      </button>

      {TOP_ITEMS.map(item => (
        <RailButton
          key={item.id}
          item={item}
          c={c}
          active={isActive(item.id)}
          onClick={() => onNavigate(item.id)}
          badge={item.id === 'inbox' ? totalUnread : 0}
        />
      ))}

      <div className="flex-1" />

      {BOTTOM_ITEMS.map(item => (
        <RailButton
          key={item.id}
          item={item}
          c={c}
          active={isActive(item.id)}
          onClick={() => onNavigate(item.id)}
        />
      ))}
    </aside>
  );
}

export default AppRail;
