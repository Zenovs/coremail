import React, { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import { ChevronLeft, ChevronRight, Add, Close, Location, TrashCan, Checkmark, Calendar } from '@carbon/icons-react';
import { useTheme } from '../context/ThemeContext';
import { useAccounts } from '../context/AccountContext';

// ── Constants ────────────────────────────────────────────────────────────────
const WEEKDAYS_SHORT = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const WEEKDAYS_LONG  = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const HOUR_HEIGHT  = 56; // px per hour in week/day view
const DAY_START    = 0;  // first visible hour (midnight — scroll to 07:00 on mount)
const DAY_END      = 23; // last visible hour
const SCROLL_TO_H  = 7;  // default scroll position: 07:00
const HOURS = Array.from({ length: DAY_END - DAY_START + 1 }, (_, i) => DAY_START + i);

const SHOW_AS_COLORS = {
  busy:             'bg-accentbg',
  tentative:        'bg-yellow-500',
  free:             'bg-green-500',
  oof:              'bg-red-500',
  workingElsewhere: 'bg-purple-500',
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun
  const diff = (day === 0 ? -6 : 1 - day); // shift to Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
}

function getDaysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }
function getFirstDayOfMonth(year, month) {
  const d = new Date(year, month, 1).getDay();
  return d === 0 ? 6 : d - 1; // Mon-based
}

function formatHour(h) { return `${String(h).padStart(2,'0')}:00`; }
function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
}
function toLocalDatetimeValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function toDateValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}

// ── Event Form Modal ─────────────────────────────────────────────────────────
const EventModal = memo(({ event, defaultDate, onSave, onDelete, onClose, c }) => {
  const isNew = !event?.id;
  const p = n => String(n).padStart(2, '0');
  const defaultDay = defaultDate || new Date();
  const ds = `${defaultDay.getFullYear()}-${p(defaultDay.getMonth()+1)}-${p(defaultDay.getDate())}`;

  const [title,    setTitle]    = useState(event?.title || '');
  const [isAllDay, setIsAllDay] = useState(event?.isAllDay || false);
  const [start,    setStart]    = useState(event ? (event.isAllDay ? toDateValue(event.start) : toLocalDatetimeValue(event.start)) : `${ds}T09:00`);
  const [end,      setEnd]      = useState(event ? (event.isAllDay ? toDateValue(event.end)   : toLocalDatetimeValue(event.end))   : `${ds}T10:00`);
  const [location, setLocation] = useState(event?.location || '');
  const [notes,    setNotes]    = useState(event?.preview  || '');
  const [saving,   setSaving]   = useState(false);

  const handleSave = async () => {
    if (!title.trim()) return;
    setSaving(true);
    await onSave({
      id: event?.id,
      title: title.trim(),
      start: isAllDay ? new Date(start).toISOString() : new Date(start).toISOString(),
      end:   isAllDay ? new Date(end).toISOString()   : new Date(end).toISOString(),
      location, notes, isAllDay,
    });
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className={`${c.bgSecondary} ${c.border} border rounded-xl shadow-2xl w-full max-w-md mx-4 p-5`}
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className={`font-semibold ${c.text}`}>{isNew ? 'Neuer Termin' : 'Termin bearbeiten'}</h3>
          <button onClick={onClose} className={`p-1 rounded-lg ${c.hover} ${c.textSecondary}`}><Close size={16} /></button>
        </div>

        <div className="space-y-3">
          <input type="text" placeholder="Titel" value={title} onChange={e => setTitle(e.target.value)} autoFocus
            className={`w-full px-3 py-2 ${c.bgTertiary} ${c.text} ${c.border} border rounded-lg text-sm focus:outline-none focus:border-accent`}/>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="allday" checked={isAllDay} onChange={e => setIsAllDay(e.target.checked)} className="rounded"/>
            <label htmlFor="allday" className={`text-sm ${c.textSecondary}`}>Ganztägig</label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {['Start','Ende'].map((lbl, idx) => (
              <div key={lbl}>
                <label className={`text-xs ${c.textSecondary} mb-1 block`}>{lbl}</label>
                <input type={isAllDay ? 'date' : 'datetime-local'}
                  value={idx === 0 ? start : end}
                  onChange={e => idx === 0 ? setStart(e.target.value) : setEnd(e.target.value)}
                  className={`w-full px-2 py-1.5 ${c.bgTertiary} ${c.text} ${c.border} border rounded-lg text-xs focus:outline-none focus:border-accent`}/>
              </div>
            ))}
          </div>

          <input type="text" placeholder="Ort (optional)" value={location} onChange={e => setLocation(e.target.value)}
            className={`w-full px-3 py-2 ${c.bgTertiary} ${c.text} ${c.border} border rounded-lg text-sm focus:outline-none focus:border-accent`}/>

          <textarea placeholder="Notizen (optional)" value={notes} onChange={e => setNotes(e.target.value)} rows={3}
            className={`w-full px-3 py-2 ${c.bgTertiary} ${c.text} ${c.border} border rounded-lg text-sm focus:outline-none focus:border-accent resize-none`}/>
        </div>

        <div className="flex items-center justify-between mt-4">
          {!isNew && onDelete
            ? <button onClick={() => onDelete(event.id)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-red-400 hover:bg-red-500/10"><TrashCan size={16} /> Löschen</button>
            : <div/>}
          <div className="flex gap-2">
            <button onClick={onClose} className={`px-4 py-1.5 rounded-lg text-sm ${c.bgTertiary} ${c.text} ${c.hover}`}>Abbrechen</button>
            <button onClick={handleSave} disabled={saving || !title.trim()}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm bg-accentbg hover:bg-accentbghover text-white disabled:opacity-50">
              {saving ? '…' : <><Checkmark size={16} /> Speichern</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

// ── Month View ───────────────────────────────────────────────────────────────
const MonthView = memo(({ year, month, events, today, onDayClick, onEventClick, c }) => {
  const firstDay    = getFirstDayOfMonth(year, month);
  const daysInMonth = getDaysInMonth(year, month);
  const daysInPrev  = getDaysInMonth(year, month === 0 ? 11 : month - 1);
  const cells = [];

  for (let i = firstDay - 1; i >= 0; i--) {
    const d = month === 0 ? new Date(year-1,11,daysInPrev-i) : new Date(year,month-1,daysInPrev-i);
    cells.push({ date: d, current: false });
  }
  for (let d = 1; d <= daysInMonth; d++) cells.push({ date: new Date(year,month,d), current: true });
  const remaining = 42 - cells.length;
  for (let d = 1; d <= remaining; d++) {
    const dt = month === 11 ? new Date(year+1,0,d) : new Date(year,month+1,d);
    cells.push({ date: dt, current: false });
  }

  return (
    <div className="flex-1 overflow-auto">
      {/* Day headers */}
      <div className={`grid grid-cols-7 border-b ${c.border} sticky top-0 ${c.bgSecondary} z-10`}>
        {WEEKDAYS_SHORT.map(d => (
          <div key={d} className={`py-2 text-center text-xs font-medium ${c.textSecondary} border-r ${c.border} last:border-r-0`}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((cell, idx) => {
          const isToday = isSameDay(cell.date, today);
          const dayEvts = events.filter(e => isSameDay(new Date(e.start), cell.date));
          return (
            <div key={idx}
              onClick={() => onDayClick(cell.date)}
              className={`min-h-[90px] p-1 border-b border-r ${c.border} cursor-pointer transition-colors ${cell.current ? c.hover : 'opacity-40'}`}>
              <div className={`text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full mb-1 ${isToday ? 'bg-accentbg text-white' : c.textSecondary}`}>
                {cell.date.getDate()}
              </div>
              <div className="space-y-0.5 overflow-hidden">
                {dayEvts.slice(0,3).map(e => (
                  <div key={e.id} onClick={ev => { ev.stopPropagation(); onEventClick(e); }}
                    title={e.title}
                    className={`text-xs px-1.5 py-0.5 rounded truncate text-white cursor-pointer hover:opacity-80 ${SHOW_AS_COLORS[e.showAs] || 'bg-accentbg'}`}>
                    {!e.isAllDay && <span className="opacity-80 mr-1">{formatTime(e.start)}</span>}
                    {e.title}
                  </div>
                ))}
                {dayEvts.length > 3 && <div className={`text-xs ${c.textSecondary} pl-1`}>+{dayEvts.length-3} weitere</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

// ── Week View ────────────────────────────────────────────────────────────────
const WeekView = memo(({ weekStart, events, today, onSlotClick, onEventClick, c }) => {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = SCROLL_TO_H * HOUR_HEIGHT;
  }, [weekStart]);

  const getEventsForDay = (day) => events.filter(e => !e.isAllDay && isSameDay(new Date(e.start), day));
  const getAllDayForDay = (day) => events.filter(e => e.isAllDay && isSameDay(new Date(e.start), day));

  const eventStyle = (e) => {
    const start = new Date(e.start);
    const end   = new Date(e.end);
    const startMins = (start.getHours() - DAY_START) * 60 + start.getMinutes();
    const endMins   = Math.max((end.getHours() - DAY_START) * 60 + end.getMinutes(), startMins + 30);
    const top    = Math.max(0, startMins / 60 * HOUR_HEIGHT);
    const height = Math.max(24, (endMins - startMins) / 60 * HOUR_HEIGHT - 2);
    return { position: 'absolute', top, height, left: '2px', right: '2px' };
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* All-day row */}
      <div className={`flex border-b ${c.border} flex-shrink-0`}>
        <div className={`w-14 flex-shrink-0 text-xs ${c.textSecondary} px-1 py-1 text-right border-r ${c.border}`}>All-day</div>
        {days.map((day, di) => {
          const isToday = isSameDay(day, today);
          const allDay  = getAllDayForDay(day);
          return (
            <div key={di} className={`flex-1 min-h-[28px] border-r ${c.border} last:border-r-0 px-0.5 py-0.5`}>
              {allDay.map(e => (
                <div key={e.id} onClick={() => onEventClick(e)}
                  className={`text-xs px-1 py-0.5 rounded truncate text-white cursor-pointer mb-0.5 ${SHOW_AS_COLORS[e.showAs]||'bg-accentbg'}`}>
                  {e.title}
                </div>
              ))}
              <div className={`text-xs font-medium text-center py-0.5 ${isToday ? 'text-accent' : c.textSecondary}`}>
                {WEEKDAYS_SHORT[di]} {day.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Scrollable time grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="flex" style={{ height: HOURS.length * HOUR_HEIGHT }}>
          {/* Time labels */}
          <div className={`w-14 flex-shrink-0 border-r ${c.border}`}>
            {HOURS.map(h => (
              <div key={h} style={{ height: HOUR_HEIGHT }} className={`text-xs ${c.textSecondary} text-right px-2 pt-1 border-b ${c.border}`}>
                {formatHour(h)}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((day, di) => {
            const isToday = isSameDay(day, today);
            const dayEvts = getEventsForDay(day);
            return (
              <div key={di} className={`flex-1 relative border-r ${c.border} last:border-r-0 ${isToday ? 'bg-accent/10' : ''}`}>
                {HOURS.map(h => (
                  <div key={h} style={{ height: HOUR_HEIGHT }}
                    className={`border-b ${c.border} cursor-pointer hover:bg-white/5`}
                    onClick={() => {
                      const d = new Date(day);
                      d.setHours(h, 0, 0, 0);
                      onSlotClick(d);
                    }}
                  />
                ))}
                {dayEvts.map(e => (
                  <div key={e.id} style={eventStyle(e)} onClick={() => onEventClick(e)}
                    className={`text-xs text-white rounded px-1 py-0.5 overflow-hidden cursor-pointer hover:opacity-80 z-10 ${SHOW_AS_COLORS[e.showAs]||'bg-accentbg'}`}>
                    <div className="font-medium truncate">{e.title}</div>
                    <div className="opacity-80 truncate">{formatTime(e.start)}–{formatTime(e.end)}</div>
                    {e.location && <div className="opacity-70 truncate flex items-center gap-0.5"><Location size={16} />{e.location}</div>}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
});

// ── Day View ─────────────────────────────────────────────────────────────────
const DayView = memo(({ date, events, today, onSlotClick, onEventClick, c }) => {
  const scrollRef = useRef(null);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = SCROLL_TO_H * HOUR_HEIGHT;
  }, [date]);

  const dayEvts    = events.filter(e => !e.isAllDay && isSameDay(new Date(e.start), date));
  const allDayEvts = events.filter(e =>  e.isAllDay && isSameDay(new Date(e.start), date));
  const isToday    = isSameDay(date, today);

  const eventStyle = (e) => {
    const start = new Date(e.start);
    const end   = new Date(e.end);
    const startMins = (start.getHours() - DAY_START) * 60 + start.getMinutes();
    const endMins   = Math.max((end.getHours() - DAY_START) * 60 + end.getMinutes(), startMins + 30);
    return {
      position: 'absolute',
      top:    Math.max(0, startMins / 60 * HOUR_HEIGHT),
      height: Math.max(24, (endMins - startMins) / 60 * HOUR_HEIGHT - 2),
      left: '2px', right: '2px',
    };
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className={`border-b ${c.border} flex-shrink-0 px-4 py-2`}>
        <div className={`text-base font-semibold ${isToday ? 'text-accent' : c.text}`}>
          {WEEKDAYS_LONG[((date.getDay() + 6) % 7)]}, {date.getDate()}. {MONTHS[date.getMonth()]} {date.getFullYear()}
        </div>
        {allDayEvts.map(e => (
          <div key={e.id} onClick={() => onEventClick(e)}
            className={`mt-1 text-xs px-2 py-0.5 rounded text-white inline-block cursor-pointer mr-1 ${SHOW_AS_COLORS[e.showAs]||'bg-accentbg'}`}>
            {e.title}
          </div>
        ))}
      </div>

      {/* Time grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="flex" style={{ height: HOURS.length * HOUR_HEIGHT }}>
          <div className={`w-14 flex-shrink-0 border-r ${c.border}`}>
            {HOURS.map(h => (
              <div key={h} style={{ height: HOUR_HEIGHT }} className={`text-xs ${c.textSecondary} text-right px-2 pt-1 border-b ${c.border}`}>
                {formatHour(h)}
              </div>
            ))}
          </div>
          <div className={`flex-1 relative ${isToday ? 'bg-accent/10' : ''}`}>
            {HOURS.map(h => (
              <div key={h} style={{ height: HOUR_HEIGHT }}
                className={`border-b ${c.border} cursor-pointer hover:bg-white/5`}
                onClick={() => { const d = new Date(date); d.setHours(h, 0, 0, 0); onSlotClick(d); }}
              />
            ))}
            {dayEvts.map(e => (
              <div key={e.id} style={eventStyle(e)} onClick={() => onEventClick(e)}
                className={`text-xs text-white rounded px-2 py-1 overflow-hidden cursor-pointer hover:opacity-80 z-10 ${SHOW_AS_COLORS[e.showAs]||'bg-accentbg'}`}>
                <div className="font-medium">{e.title}</div>
                <div className="opacity-80">{formatTime(e.start)} – {formatTime(e.end)}</div>
                {e.location && <div className="opacity-70 flex items-center gap-1"><Location size={16} />{e.location}</div>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
});

// ── Main CalendarView ─────────────────────────────────────────────────────────
export default function CalendarView() {
  const { currentTheme } = useTheme();
  const { accounts, activeAccountId } = useAccounts();
  const c = currentTheme.colors;

  // Stabil pro Mount — ein frisches Date-Objekt pro Render brach React.memo
  // aller Subviews, die dann pro Render alle 42 Zellen × Events neu filterten.
  const today = useMemo(() => new Date(), []);
  const [viewMode,  setViewMode]  = useState('month'); // 'month'|'week'|'day'
  const [viewDate,  setViewDate]  = useState(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  const [events,    setEvents]    = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState(null);
  const [editEvent, setEditEvent] = useState(null);  // null=closed, {}=new, event obj=edit
  const [defaultDate, setDefaultDate] = useState(null);
  const [selectedAccount, setSelectedAccount] = useState(null);

  const m365Accounts = accounts.filter(a => a.type === 'microsoft');

  useEffect(() => {
    if (m365Accounts.length === 0) return;
    setSelectedAccount(prev =>
      prev && m365Accounts.find(a => a.id === prev) ? prev
        : (m365Accounts.find(a => a.id === activeAccountId)?.id || m365Accounts[0].id)
    );
  }, [m365Accounts, activeAccountId]); // eslint-disable-line

  // Compute date range to fetch based on viewMode + viewDate
  const getDateRange = useCallback(() => {
    if (viewMode === 'day') {
      const s = new Date(viewDate); s.setHours(0,0,0,0);
      const e = new Date(viewDate); e.setHours(23,59,59,999);
      return { startDate: s.toISOString(), endDate: e.toISOString() };
    }
    if (viewMode === 'week') {
      const s = startOfWeek(viewDate);
      const e = addDays(s, 6); e.setHours(23,59,59,999);
      return { startDate: s.toISOString(), endDate: e.toISOString() };
    }
    // month — fetch full month
    const s = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
    const e = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0, 23, 59, 59);
    return { startDate: s.toISOString(), endDate: e.toISOString() };
  }, [viewMode, viewDate]);

  const loadEvents = useCallback(async () => {
    if (!selectedAccount) return;
    setLoading(true); setError(null);
    try {
      const result = await window.electronAPI.calendarGetEvents(selectedAccount, getDateRange());
      if (result.success) {
        setEvents(result.events);
      } else {
        const msg = result.error || '';
        if (msg === 'TOKEN_EXPIRED' || msg.includes('TOKEN_EXPIRED')) {
          setError('Microsoft-Token abgelaufen. Bitte Konto erneut verbinden: Einstellungen → Kontenverwaltung → Erneut anmelden.');
        } else if (msg.includes('403') || msg.includes('AccessDenied')) {
          setError('Kalender-Zugriff verweigert. Bitte das Microsoft-Konto erneut verbinden (Einstellungen → Kontenverwaltung → Erneut anmelden), damit Kalender-Berechtigungen neu beantragt werden.');
        } else {
          setError(msg || 'Fehler beim Laden der Termine');
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedAccount, getDateRange]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  // Navigation
  const navigate = (dir) => { // dir: -1 | 0 | 1
    if (dir === 0) { setViewDate(new Date(today.getFullYear(), today.getMonth(), today.getDate())); return; }
    setViewDate(prev => {
      const d = new Date(prev);
      if (viewMode === 'day')   d.setDate(d.getDate() + dir);
      if (viewMode === 'week')  d.setDate(d.getDate() + dir * 7);
      if (viewMode === 'month') d.setMonth(d.getMonth() + dir);
      return d;
    });
  };

  // Header title
  const headerTitle = () => {
    if (viewMode === 'month') return `${MONTHS[viewDate.getMonth()]} ${viewDate.getFullYear()}`;
    if (viewMode === 'week') {
      const ws = startOfWeek(viewDate);
      const we = addDays(ws, 6);
      return ws.getMonth() === we.getMonth()
        ? `${ws.getDate()}. – ${we.getDate()}. ${MONTHS[ws.getMonth()]} ${ws.getFullYear()}`
        : `${ws.getDate()}. ${MONTHS[ws.getMonth()]} – ${we.getDate()}. ${MONTHS[we.getMonth()]} ${ws.getFullYear()}`;
    }
    return `${WEEKDAYS_LONG[((viewDate.getDay()+6)%7)]}, ${viewDate.getDate()}. ${MONTHS[viewDate.getMonth()]} ${viewDate.getFullYear()}`;
  };

  // Event handlers
  const handleDayClick = (date) => { setDefaultDate(date); setEditEvent({}); };
  const handleSlotClick = (date) => { setDefaultDate(date); setEditEvent({}); };
  const handleEventClick = (event) => { setDefaultDate(null); setEditEvent(event); };

  const handleSave = async (data) => {
    try {
      const result = data.id
        ? await window.electronAPI.calendarUpdateEvent(selectedAccount, data.id, data)
        : await window.electronAPI.calendarCreateEvent(selectedAccount, data);
      if (result.success) { setEditEvent(null); loadEvents(); }
      else setError(result.error || 'Speichern fehlgeschlagen');
    } catch (err) { setError(err.message); }
  };

  const handleDelete = async (eventId) => {
    if (!window.confirm('Termin wirklich löschen?')) return;
    try {
      const result = await window.electronAPI.calendarDeleteEvent(selectedAccount, eventId);
      if (result.success) { setEditEvent(null); loadEvents(); }
      else setError(result.error || 'Löschen fehlgeschlagen');
    } catch (err) { setError(err.message); }
  };

  if (m365Accounts.length === 0) {
    return (
      <div className={`flex-1 flex items-center justify-center ${c.bg}`}>
        <div className="text-center">
          <Calendar size={48} className={`mx-auto mb-4 ${c.textSecondary}`} />
          <h3 className={`font-semibold ${c.text} mb-2`}>Kein Microsoft 365-Konto verbunden</h3>
          <p className={`text-sm ${c.textSecondary}`}>Der Kalender ist nur mit Microsoft 365-Konten verfügbar.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex-1 flex flex-col overflow-hidden ${c.bg}`}>
      {/* Header */}
      <div className={`px-4 py-3 ${c.border} border-b flex items-center justify-between gap-4 flex-wrap flex-shrink-0`}>
        {/* Navigation */}
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(-1)} className={`p-1.5 rounded-lg ${c.hover} ${c.textSecondary}`}><ChevronLeft size={16} /></button>
          <h2 className={`font-semibold ${c.text} text-base min-w-[220px] text-center`}>{headerTitle()}</h2>
          <button onClick={() => navigate(1)}  className={`p-1.5 rounded-lg ${c.hover} ${c.textSecondary}`}><ChevronRight size={16} /></button>
          <button onClick={() => navigate(0)} className={`px-3 py-1 rounded-lg text-xs ${c.bgTertiary} ${c.text} ${c.hover} ${c.border} border`}>Heute</button>
        </div>

        {/* View toggle */}
        <div className={`flex rounded-lg overflow-hidden border ${c.border}`}>
          {[['day','Tag'],['week','Woche'],['month','Monat']].map(([id, label]) => (
            <button key={id} onClick={() => setViewMode(id)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${viewMode === id ? 'bg-accentbg text-white' : `${c.bgTertiary} ${c.textSecondary} ${c.hover}`}`}>
              {label}
            </button>
          ))}
        </div>

        {/* Account selector + New event */}
        <div className="flex items-center gap-2">
          {m365Accounts.length > 1 && (
            <select value={selectedAccount || ''} onChange={e => setSelectedAccount(e.target.value)}
              className={`px-2 py-1.5 text-xs ${c.bgTertiary} ${c.text} ${c.border} border rounded-lg focus:outline-none`}>
              {m365Accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          {loading && <span className={`text-xs ${c.textSecondary} animate-pulse`}>Lade…</span>}
          <button onClick={() => { setDefaultDate(viewDate); setEditEvent({}); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-accentbg hover:bg-accentbghover text-white">
            <Add size={16} /> Neuer Termin
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="px-4 py-2 bg-red-900/20 border-b border-red-500/30 flex-shrink-0">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* View content */}
      {viewMode === 'month' && (
        <MonthView
          year={viewDate.getFullYear()} month={viewDate.getMonth()}
          events={events} today={today}
          onDayClick={handleDayClick} onEventClick={handleEventClick} c={c}
        />
      )}
      {viewMode === 'week' && (
        <WeekView
          weekStart={startOfWeek(viewDate)}
          events={events} today={today}
          onSlotClick={handleSlotClick} onEventClick={handleEventClick} c={c}
        />
      )}
      {viewMode === 'day' && (
        <DayView
          date={viewDate} events={events} today={today}
          onSlotClick={handleSlotClick} onEventClick={handleEventClick} c={c}
        />
      )}

      {/* Event modal */}
      {editEvent !== null && (
        <EventModal
          event={editEvent?.id ? editEvent : null}
          defaultDate={defaultDate}
          onSave={handleSave}
          onDelete={editEvent?.id ? handleDelete : null}
          onClose={() => setEditEvent(null)}
          c={c}
        />
      )}
    </div>
  );
}
