import React, { useEffect, useRef, useState } from 'react';
import { Time, Close } from '@carbon/icons-react';
import { useTheme } from '../context/ThemeContext';

// v6.6.0: Snooze-Picker. Presets + freie Zeitwahl.
// onPick(wakeAtMs)  → wird mit dem absoluten Wake-Up-Timestamp aufgerufen.
// onClose()         → schliesst ohne Aktion.
function SnoozeMenu({ open, onClose, onPick, anchorRect = null }) {
  const { currentTheme } = useTheme();
  const c = currentTheme.colors;
  const popupRef = useRef(null);
  const [customMode, setCustomMode] = useState(false);
  const [customDate, setCustomDate] = useState('');
  const [customTime, setCustomTime] = useState('');

  useEffect(() => {
    if (!open) {
      setCustomMode(false);
      setCustomDate('');
      setCustomTime('');
    }
  }, [open]);

  // Klick ausserhalb → schliessen
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (popupRef.current && !popupRef.current.contains(e.target)) onClose?.();
    };
    const onEsc = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open, onClose]);

  if (!open) return null;

  // Presets — alle relativ zu jetzt, gerundet auf volle Minute.
  const presets = (() => {
    const now = new Date();
    const inMinutes = (m) => new Date(now.getTime() + m * 60 * 1000);
    const today18 = new Date(now);
    today18.setHours(18, 0, 0, 0);
    const tomorrow9 = new Date(now);
    tomorrow9.setDate(tomorrow9.getDate() + 1);
    tomorrow9.setHours(9, 0, 0, 0);
    const tomorrow18 = new Date(now);
    tomorrow18.setDate(tomorrow18.getDate() + 1);
    tomorrow18.setHours(18, 0, 0, 0);
    const nextMonday9 = new Date(now);
    const dayDelta = (8 - nextMonday9.getDay()) % 7 || 7;
    nextMonday9.setDate(nextMonday9.getDate() + dayDelta);
    nextMonday9.setHours(9, 0, 0, 0);
    const items = [
      { label: 'In 1 Stunde',          when: inMinutes(60) },
      { label: 'In 3 Stunden',         when: inMinutes(180) },
    ];
    if (today18 > now) items.push({ label: `Heute Abend (${today18.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })})`, when: today18 });
    items.push(
      { label: `Morgen früh (${tomorrow9.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })})`,   when: tomorrow9 },
      { label: `Morgen Abend (${tomorrow18.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })})`, when: tomorrow18 },
      { label: `Nächste Woche (Mo ${nextMonday9.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })})`, when: nextMonday9 }
    );
    return items;
  })();

  const submitCustom = () => {
    if (!customDate || !customTime) return;
    const dt = new Date(`${customDate}T${customTime}`);
    if (isNaN(dt.getTime())) return;
    if (dt.getTime() <= Date.now()) return;
    onPick?.(dt.getTime());
  };

  // Position: fix unter Anker, rechtsbündig wenn Platz reicht
  const style = anchorRect
    ? {
        position: 'fixed',
        top: anchorRect.bottom + 6,
        left: Math.max(8, Math.min(window.innerWidth - 280, anchorRect.left)),
        width: 280,
        zIndex: 10000
      }
    : { position: 'fixed', top: 80, right: 24, width: 280, zIndex: 10000 };

  // Format min datetime-local für Custom-Input (jetzt + 1 Minute) — aus
  // lokalen Komponenten; toISOString() wäre UTC und nahe Mitternacht einen Tag daneben.
  const minLocal = (() => {
    const d = new Date(Date.now() + 60 * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  })();

  return (
    <div
      ref={popupRef}
      style={style}
      className={`${c.bgSecondary} ${c.border} border rounded-xl shadow-2xl overflow-hidden`}
    >
      <div className={`px-3 py-2 flex items-center justify-between border-b ${c.border}`}>
        <span className={`text-sm font-medium ${c.text} flex items-center gap-2`}>
          <Time size={16} /> Erinnern in…
        </span>
        <button onClick={onClose} className={`p-1 ${c.hover} rounded ${c.textSecondary}`} title="Schliessen">
          <Close size={16} />
        </button>
      </div>

      {!customMode ? (
        <div className="py-1">
          {presets.map((p, i) => (
            <button
              key={i}
              onClick={() => onPick?.(p.when.getTime())}
              className={`w-full text-left px-3 py-2 text-sm ${c.text} ${c.hover} flex items-center justify-between`}
            >
              <span>{p.label}</span>
              <span className={`text-xs ${c.textSecondary}`}>
                {p.when.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' })}
              </span>
            </button>
          ))}
          <div className={`mx-3 my-1 border-t ${c.border}`} />
          <button
            onClick={() => setCustomMode(true)}
            className={`w-full text-left px-3 py-2 text-sm ${c.text} ${c.hover}`}
          >
            Eigenes Datum…
          </button>
        </div>
      ) : (
        <div className="p-3 flex flex-col gap-2">
          <input
            type="date"
            value={customDate}
            min={minLocal.slice(0, 10)}
            onChange={(e) => setCustomDate(e.target.value)}
            className={`px-2 py-1.5 ${c.bgTertiary} ${c.text} ${c.border} border rounded-md text-sm outline-none`}
          />
          <input
            type="time"
            value={customTime}
            onChange={(e) => setCustomTime(e.target.value)}
            className={`px-2 py-1.5 ${c.bgTertiary} ${c.text} ${c.border} border rounded-md text-sm outline-none`}
          />
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => setCustomMode(false)}
              className={`flex-1 px-2 py-1.5 ${c.bgTertiary} ${c.hover} ${c.text} text-sm rounded-md`}
            >
              Zurück
            </button>
            <button
              onClick={submitCustom}
              disabled={!customDate || !customTime}
              className="flex-1 px-2 py-1.5 bg-accentbg hover:bg-accentbghover disabled:opacity-40 text-white text-sm rounded-md"
            >
              Erinnern
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default SnoozeMenu;
