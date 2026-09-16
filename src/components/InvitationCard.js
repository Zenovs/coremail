// ─── InvitationCard — Meeting-Einladungen sichtbar machen (v7.2.0) ───────────
//
// Vorher landete der text/calendar-Teil einer Einladung als namenloser Anhang
// im Anhang-Banner: nicht lesbar, nicht zu öffnen, Termindaten unsichtbar.
// Diese Karte zeigt Titel, Zeitraum, Ort, Organisator und Teilnehmer direkt
// über dem Mailtext und bietet die passenden Aktionen an:
//   • Microsoft 365: Zusagen / Vorbehalt / Absagen (Graph beantwortet den Termin)
//   • Einladung aus .ics: in den M365-Kalender übernehmen
//   • Immer: .ics speichern bzw. mit der System-Kalender-App öffnen
import React, { useState, useMemo } from 'react';
import {
  Calendar, Time, Location, Group, Checkmark, CheckmarkFilled, Close,
  Download, FolderOpen, InProgress, WarningFilled, Earth, ChevronDown, ChevronRight
} from '@carbon/icons-react';
import { useTheme } from '../context/ThemeContext';

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

// Ganztagestermine kommen als reines Datum (YYYY-MM-DD) — ohne Zeitzonen-Shift
// parsen, sonst rutscht der Termin je nach Zeitzone auf den Vortag.
function toDate(value) {
  if (!value) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const d = dateOnly ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDay(date) {
  return `${WEEKDAYS[date.getDay()]}, ${date.toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })}`;
}

function formatTime(date) {
  return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

// "Dienstag, 01. April 2026 · 09:00 – 10:30 Uhr" bzw. mehrtägig/ganztägig
export function formatInvitationRange(invitation) {
  const start = toDate(invitation?.start);
  if (!start) return 'Zeitpunkt unbekannt';
  const end = toDate(invitation?.end);

  if (invitation.allDay) {
    // DTEND ist bei Ganztagesterminen exklusiv — letzter echter Tag ist end - 1
    const lastDay = end ? new Date(end.getTime() - 86400000) : null;
    if (lastDay && lastDay.toDateString() !== start.toDateString()) {
      return `${formatDay(start)} – ${formatDay(lastDay)} · ganztägig`;
    }
    return `${formatDay(start)} · ganztägig`;
  }
  if (!end) return `${formatDay(start)} · ab ${formatTime(start)} Uhr`;
  if (start.toDateString() === end.toDateString()) {
    return `${formatDay(start)} · ${formatTime(start)} – ${formatTime(end)} Uhr`;
  }
  return `${formatDay(start)}, ${formatTime(start)} Uhr – ${formatDay(end)}, ${formatTime(end)} Uhr`;
}

const PARTSTAT_LABEL = {
  ACCEPTED: 'zugesagt',
  DECLINED: 'abgesagt',
  TENTATIVE: 'unter Vorbehalt',
  'NEEDS-ACTION': 'offen',
  DELEGATED: 'delegiert'
};

const PARTSTAT_STYLE = {
  ACCEPTED: 'text-green-400',
  DECLINED: 'text-red-400',
  TENTATIVE: 'text-amber-400',
  DELEGATED: 'text-blue-400'
};

const METHOD_BADGE = {
  REQUEST: { label: 'Einladung', className: 'bg-blue-500/20 text-blue-300 border-blue-500/40' },
  CANCEL:  { label: 'Absage',    className: 'bg-red-500/20 text-red-300 border-red-500/40' },
  REPLY:   { label: 'Antwort',   className: 'bg-purple-500/20 text-purple-300 border-purple-500/40' },
  COUNTER: { label: 'Gegenvorschlag', className: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  PUBLISH: { label: 'Termin',    className: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40' }
};

export default function InvitationCard({ invitation, account, icsAttachment, onSaveIcs, onOpenIcs, icsState }) {
  const { currentTheme } = useTheme();
  const c = currentTheme.colors;
  const [showDetails, setShowDetails] = useState(false);
  const [busy, setBusy] = useState(null);
  const [result, setResult] = useState(null);
  const [answered, setAnswered] = useState(null);

  const isGraphAccount = account?.type === 'microsoft';
  const canRespond = isGraphAccount && !!invitation?.eventId && invitation?.method === 'REQUEST';
  const canImport = isGraphAccount && !invitation?.eventId && !!invitation?.start && !invitation?.isCancelled;

  const badge = METHOD_BADGE[invitation?.method] || METHOD_BADGE.PUBLISH;
  const range = useMemo(() => formatInvitationRange(invitation), [invitation]);
  const myResponse = answered || invitation?.myResponse;

  const attendees = invitation?.attendees || [];
  const accepted = attendees.filter(a => a.partstat === 'ACCEPTED').length;
  const declined = attendees.filter(a => a.partstat === 'DECLINED').length;

  const respond = async (response) => {
    setBusy(response);
    setResult(null);
    try {
      const res = await window.electronAPI.calendarRespondToEvent(account.id, invitation.eventId, response, {});
      if (res?.success) {
        setAnswered(response === 'accept' ? 'ACCEPTED' : response === 'decline' ? 'DECLINED' : 'TENTATIVE');
        setResult({ ok: true, message: 'Antwort gesendet und im Kalender eingetragen.' });
      } else {
        setResult({ ok: false, message: res?.error || 'Antwort konnte nicht gesendet werden.' });
      }
    } catch (err) {
      setResult({ ok: false, message: err.message });
    } finally {
      setBusy(null);
    }
  };

  const importToCalendar = async () => {
    setBusy('import');
    setResult(null);
    try {
      const res = await window.electronAPI.calendarImportInvitation(account.id, invitation);
      setResult(res?.success
        ? { ok: true, message: 'Termin wurde in den Kalender übernommen.' }
        : { ok: false, message: res?.error || 'Übernahme fehlgeschlagen.' });
    } catch (err) {
      setResult({ ok: false, message: err.message });
    } finally {
      setBusy(null);
    }
  };

  if (!invitation) return null;

  const accentBorder = invitation.isCancelled ? 'border-red-500/50 bg-red-500/10' : 'border-blue-500/50 bg-blue-500/10';

  return (
    <div className={`mb-4 rounded-xl border ${accentBorder} overflow-hidden`}>
      {/* Kopf: Art der Nachricht + Titel */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg flex-shrink-0 ${invitation.isCancelled ? 'bg-red-500/20' : 'bg-blue-500/20'}`}>
            <Calendar size={24} className={invitation.isCancelled ? 'text-red-400' : 'text-blue-400'} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`px-2 py-0.5 text-xs rounded-full border ${badge.className}`}>{badge.label}</span>
              {invitation.recurrence && (
                <span className={`px-2 py-0.5 text-xs rounded-full border ${c.border} ${c.textSecondary}`}>
                  {invitation.recurrence}
                </span>
              )}
              {invitation.isOutOfDate && (
                <span className="px-2 py-0.5 text-xs rounded-full border border-amber-500/40 bg-amber-500/20 text-amber-300">
                  Veraltet — es gibt eine neuere Einladung
                </span>
              )}
            </div>
            <h3 className={`text-lg font-semibold ${c.text} ${invitation.isCancelled ? 'line-through' : ''} break-words`}>
              {invitation.summary}
            </h3>
          </div>
        </div>

        {/* Eckdaten */}
        <div className="mt-3 space-y-2 text-sm">
          <div className={`flex items-start gap-2 ${c.text}`}>
            <Time size={16} className={`mt-0.5 flex-shrink-0 ${c.textSecondary}`} />
            <span>{range}</span>
          </div>
          {invitation.location && (
            <div className={`flex items-start gap-2 ${c.text}`}>
              <Location size={16} className={`mt-0.5 flex-shrink-0 ${c.textSecondary}`} />
              <span className="break-words">{invitation.location}</span>
            </div>
          )}
          {invitation.organizer && (
            <div className={`flex items-start gap-2 ${c.textSecondary}`}>
              <Group size={16} className="mt-0.5 flex-shrink-0" />
              <span className="break-words">
                Organisiert von {invitation.organizer.name}
                {invitation.organizer.email && invitation.organizer.email !== invitation.organizer.name
                  ? ` (${invitation.organizer.email})` : ''}
              </span>
            </div>
          )}
          {invitation.meetingUrl && (
            <div className="flex items-start gap-2">
              <Earth size={16} className={`mt-0.5 flex-shrink-0 ${c.textSecondary}`} />
              <button
                onClick={() => window.electronAPI.openExternal(invitation.meetingUrl)}
                className={`${c.accent} hover:underline text-left break-all`}
              >
                Online teilnehmen
              </button>
            </div>
          )}
        </div>

        {/* Eigener Status, sobald bekannt */}
        {myResponse && myResponse !== 'NEEDS-ACTION' && (
          <div className={`mt-3 text-sm ${PARTSTAT_STYLE[myResponse] || c.textSecondary} flex items-center gap-2`}>
            <CheckmarkFilled size={16} />
            Du hast {PARTSTAT_LABEL[myResponse] || 'geantwortet'}.
          </div>
        )}

        {/* Aktionen */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {canRespond && (
            <>
              <button
                onClick={() => respond('accept')}
                disabled={!!busy}
                className="px-3 py-1.5 rounded-lg text-sm text-white bg-green-600 hover:bg-green-500 disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
              >
                {busy === 'accept' ? <InProgress size={16} className="animate-spin" /> : <Checkmark size={16} />} Zusagen
              </button>
              <button
                onClick={() => respond('tentative')}
                disabled={!!busy}
                className="px-3 py-1.5 rounded-lg text-sm text-white bg-amber-600 hover:bg-amber-500 disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
              >
                {busy === 'tentative' ? <InProgress size={16} className="animate-spin" /> : <Time size={16} />} Mit Vorbehalt
              </button>
              <button
                onClick={() => respond('decline')}
                disabled={!!busy}
                className="px-3 py-1.5 rounded-lg text-sm text-white bg-red-600 hover:bg-red-500 disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
              >
                {busy === 'decline' ? <InProgress size={16} className="animate-spin" /> : <Close size={16} />} Absagen
              </button>
            </>
          )}

          {canImport && (
            <button
              onClick={importToCalendar}
              disabled={!!busy}
              className={`px-3 py-1.5 rounded-lg text-sm text-white ${c.accentBg} ${c.accentHover} disabled:opacity-50 transition-colors inline-flex items-center gap-1.5`}
            >
              {busy === 'import' ? <InProgress size={16} className="animate-spin" /> : <Calendar size={16} />} In Kalender übernehmen
            </button>
          )}

          {icsAttachment && (
            <>
              <button
                onClick={onOpenIcs}
                disabled={icsState === 'saving'}
                className={`px-3 py-1.5 rounded-lg text-sm ${c.bgTertiary} ${c.hover} ${c.text} ${c.border} border disabled:opacity-50 transition-colors inline-flex items-center gap-1.5`}
              >
                {icsState === 'saving' ? <InProgress size={16} className="animate-spin" /> : <FolderOpen size={16} />} Im Kalender-Programm öffnen
              </button>
              <button
                onClick={onSaveIcs}
                disabled={icsState === 'saving'}
                className={`px-3 py-1.5 rounded-lg text-sm ${c.bgTertiary} ${c.hover} ${c.text} ${c.border} border disabled:opacity-50 transition-colors inline-flex items-center gap-1.5`}
              >
                <Download size={16} /> ICS speichern
              </button>
            </>
          )}
        </div>

        {icsState === 'error' && (
          <p className="mt-2 text-sm text-red-400">Die Kalenderdatei konnte nicht gespeichert werden.</p>
        )}

        {result && (
          <div className={`mt-3 px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${
            result.ok ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
          }`}>
            {result.ok ? <Checkmark size={16} /> : <WarningFilled size={16} />} {result.message}
          </div>
        )}

        {/* IMAP-Konten haben kein Kalender-Backend — sagen, was stattdessen geht */}
        {!isGraphAccount && invitation.method === 'REQUEST' && !invitation.isCancelled && (
          <p className={`mt-3 text-xs ${c.textSecondary}`}>
            {icsAttachment
              ? 'Zu- und Absagen direkt aus CoreMail gibt es nur für Microsoft-365-Konten. Öffne die Einladung in deinem Kalender-Programm oder antworte dem Organisator per Mail.'
              : 'Zu- und Absagen direkt aus CoreMail gibt es nur für Microsoft-365-Konten. Antworte dem Organisator per Mail.'}
          </p>
        )}
      </div>

      {/* Teilnehmer + Beschreibung ausklappbar — hält die Karte kompakt */}
      {(attendees.length > 0 || invitation.description) && (
        <div className={`border-t ${c.border}`}>
          <button
            onClick={() => setShowDetails(v => !v)}
            className={`w-full px-4 py-2 flex items-center gap-2 text-sm ${c.textSecondary} ${c.hover} transition-colors`}
          >
            {showDetails ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            {attendees.length > 0
              ? `${attendees.length} ${attendees.length === 1 ? 'Teilnehmer' : 'Teilnehmende'}`
              : 'Details'}
            {attendees.length > 0 && (accepted > 0 || declined > 0) && (
              <span className="text-xs">
                ({accepted > 0 ? `${accepted} zugesagt` : ''}{accepted > 0 && declined > 0 ? ', ' : ''}{declined > 0 ? `${declined} abgesagt` : ''})
              </span>
            )}
          </button>

          {showDetails && (
            <div className="px-4 pb-4 space-y-3">
              {attendees.length > 0 && (
                <ul className="space-y-1">
                  {attendees.map((a, i) => (
                    <li key={`${a.email || a.name}-${i}`} className={`text-sm flex items-center gap-2 ${c.text}`}>
                      <span className="truncate">{a.name}{a.email && a.email !== a.name ? ` (${a.email})` : ''}</span>
                      {a.optional && <span className={`text-xs ${c.textSecondary}`}>optional</span>}
                      <span className={`text-xs ml-auto flex-shrink-0 ${PARTSTAT_STYLE[a.partstat] || c.textSecondary}`}>
                        {PARTSTAT_LABEL[a.partstat] || 'offen'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {invitation.description && (
                <div className={`text-sm whitespace-pre-wrap ${c.textSecondary} ${c.bgTertiary} rounded-lg p-3 max-h-64 overflow-y-auto`}>
                  {invitation.description}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
