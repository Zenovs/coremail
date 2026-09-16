// Tests für die sicherheitskritischen pure Functions (lib/pure.js) — v7.0.
// Läuft mit dem eingebauten Node-Test-Runner: `npm test`
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compareVersions, isTrustedUpdateUrl, isSafePublicHttpsUrl, matchCondition, matchRule } = require('../lib/pure');

// ── compareVersions (Update-Pipeline) ────────────────────────────────────────
test('compareVersions: Grundfälle', () => {
  assert.equal(compareVersions('7.0.0', '6.14.0'), 1);
  assert.equal(compareVersions('6.14.0', '7.0.0'), -1);
  assert.equal(compareVersions('6.13.1', '6.13.1'), 0);
});

test('compareVersions: unterschiedliche Längen und zweistellige Teile', () => {
  assert.equal(compareVersions('6.13', '6.13.0'), 0);
  assert.equal(compareVersions('6.13.10', '6.13.9'), 1);
  assert.equal(compareVersions('10.0.0', '9.9.9'), 1);
});

// ── isTrustedUpdateUrl (Update-Sicherheit) ───────────────────────────────────
test('isTrustedUpdateUrl: akzeptiert nur offizielle Release-Quellen', () => {
  assert.equal(isTrustedUpdateUrl('https://github.com/Zenovs/coremail/releases/download/v7.0.0/x.AppImage'), true);
  assert.equal(isTrustedUpdateUrl('https://objects.githubusercontent.com/foo'), true);
  assert.equal(isTrustedUpdateUrl('https://release-assets.githubusercontent.com/foo'), true);
});

test('isTrustedUpdateUrl: lehnt fremde Repos, Hosts und Protokolle ab', () => {
  assert.equal(isTrustedUpdateUrl('https://github.com/attacker/repo/releases/x.AppImage'), false);
  assert.equal(isTrustedUpdateUrl('http://github.com/Zenovs/coremail/releases/x'), false);
  assert.equal(isTrustedUpdateUrl('https://evil.com/Zenovs/coremail/'), false);
  assert.equal(isTrustedUpdateUrl('https://github.com.evil.com/Zenovs/coremail/'), false);
  assert.equal(isTrustedUpdateUrl('not a url'), false);
  assert.equal(isTrustedUpdateUrl(null), false);
});

// ── isSafePublicHttpsUrl (SSRF-Schutz) ───────────────────────────────────────
test('isSafePublicHttpsUrl: öffentliche https-Hosts sind erlaubt', () => {
  assert.equal(isSafePublicHttpsUrl('https://example.com/unsubscribe?id=1'), true);
  assert.equal(isSafePublicHttpsUrl('https://8.8.8.8/x'), true);
});

test('isSafePublicHttpsUrl: private/lokale Ziele werden abgelehnt', () => {
  assert.equal(isSafePublicHttpsUrl('http://example.com/'), false);
  assert.equal(isSafePublicHttpsUrl('https://localhost/x'), false);
  assert.equal(isSafePublicHttpsUrl('https://intern.local/x'), false);
  assert.equal(isSafePublicHttpsUrl('https://127.0.0.1/x'), false);
  assert.equal(isSafePublicHttpsUrl('https://10.1.2.3/x'), false);
  assert.equal(isSafePublicHttpsUrl('https://172.16.0.1/x'), false);
  assert.equal(isSafePublicHttpsUrl('https://172.31.255.255/x'), false);
  assert.equal(isSafePublicHttpsUrl('https://192.168.1.1/x'), false);
  assert.equal(isSafePublicHttpsUrl('https://169.254.1.1/x'), false);
  assert.equal(isSafePublicHttpsUrl('https://100.64.0.1/x'), false);
  assert.equal(isSafePublicHttpsUrl('https://[::1]/x'), false);
  assert.equal(isSafePublicHttpsUrl('https://0.0.0.0/x'), false);
});

// ── matchCondition / matchRule (Mail-Regeln) ─────────────────────────────────
const mail = { from: 'Newsletter <news@shop.example>', to: 'dario@firma.ch', cc: 'team@firma.ch', subject: 'Grosse Sommer-Aktion' };

test('matchCondition: Felder und Operatoren', () => {
  assert.equal(matchCondition(mail, { field: 'from', op: 'contains', value: 'shop.example' }), true);
  assert.equal(matchCondition(mail, { field: 'subject', op: 'startsWith', value: 'grosse' }), true);
  assert.equal(matchCondition(mail, { field: 'subject', op: 'endsWith', value: 'aktion' }), true);
  assert.equal(matchCondition(mail, { field: 'to', op: 'contains', value: 'team@firma.ch' }), true); // to umfasst cc
  assert.equal(matchCondition(mail, { field: 'subject', op: 'equals', value: 'grosse sommer-aktion' }), true);
  assert.equal(matchCondition(mail, { field: 'from', op: 'contains', value: 'anders' }), false);
});

test('matchCondition: leere/kaputte Bedingungen greifen nie', () => {
  assert.equal(matchCondition(mail, { field: 'from', value: '' }), false);
  assert.equal(matchCondition(mail, { field: 'unbekannt', value: 'x' }), false);
  assert.equal(matchCondition(mail, null), false);
});

test('matchRule: matchAll-Semantik und Deaktivierung', () => {
  const c1 = { field: 'from', value: 'shop.example' };
  const c2 = { field: 'subject', value: 'aktion' };
  const cNo = { field: 'subject', value: 'rechnung' };
  assert.equal(matchRule(mail, { enabled: true, conditions: [c1, c2] }), true);           // AND (Default)
  assert.equal(matchRule(mail, { enabled: true, conditions: [c1, cNo] }), false);         // AND scheitert
  assert.equal(matchRule(mail, { enabled: true, matchAll: false, conditions: [cNo, c2] }), true); // OR
  assert.equal(matchRule(mail, { enabled: false, conditions: [c1] }), false);             // deaktiviert
  assert.equal(matchRule(mail, { enabled: true, conditions: [] }), false);                // leer greift nie
});

// ── parseICalendar (Meeting-Einladungen, v7.2.0) ─────────────────────────────
const { parseICalendar, isCalendarPart, parseIcsDate, unfoldIcsLines, icsUnescapeText, describeRRule } = require('../lib/pure');

// Outlook-typische Einladung: gefaltete Zeilen, TZID, Attendees, Teams-Link
const OUTLOOK_ICS = [
  'BEGIN:VCALENDAR',
  'PRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN',
  'VERSION:2.0',
  'METHOD:REQUEST',
  'BEGIN:VTIMEZONE',
  'TZID:W. Europe Standard Time',
  'BEGIN:STANDARD',
  'DTSTART:16011028T030000',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'ORGANIZER;CN="Muster, Max":mailto:max@firma.ch',
  'ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=Dario:mailto:d',
  ' ario@schnyder-werbung.ch',
  'ATTENDEE;ROLE=OPT-PARTICIPANT;CN=Anna:mailto:anna@firma.ch',
  'DTSTART;TZID=Europe/Zurich:20260401T090000',
  'DTEND;TZID=Europe/Zurich:20260401T103000',
  'UID:040000008200E00074C5B7101A82E008',
  'SEQUENCE:0',
  'SUMMARY;LANGUAGE=de-CH:Projekt-Update Q2',
  'LOCATION:Sitzungszimmer 3\\, 2. OG',
  'DESCRIPTION:Bitte Unterlagen mitbringen.\\nBeginn p\\ünktlich.',
  'STATUS:CONFIRMED',
  'BEGIN:VALARM',
  'TRIGGER:-PT15M',
  'SUMMARY:Erinnerung',
  'END:VALARM',
  'END:VEVENT',
  'END:VCALENDAR'
].join('\r\n');

test('parseICalendar: liest Outlook-Einladung inkl. gefalteter Zeilen', () => {
  const inv = parseICalendar(OUTLOOK_ICS);
  assert.equal(inv.method, 'REQUEST');
  assert.equal(inv.summary, 'Projekt-Update Q2');
  assert.equal(inv.location, 'Sitzungszimmer 3, 2. OG');
  assert.equal(inv.status, 'CONFIRMED');
  assert.equal(inv.allDay, false);
  assert.equal(inv.isCancelled, false);
  // Europe/Zurich im April = UTC+2
  assert.equal(inv.start, '2026-04-01T07:00:00.000Z');
  assert.equal(inv.end, '2026-04-01T08:30:00.000Z');
});

test('parseICalendar: Organizer und Attendees mit Quoting und Faltung', () => {
  const inv = parseICalendar(OUTLOOK_ICS);
  assert.equal(inv.organizer.name, 'Muster, Max');
  assert.equal(inv.organizer.email, 'max@firma.ch');
  assert.equal(inv.attendees.length, 2);
  assert.equal(inv.attendees[0].email, 'dario@schnyder-werbung.ch');
  assert.equal(inv.attendees[0].rsvp, true);
  assert.equal(inv.attendees[0].optional, false);
  assert.equal(inv.attendees[1].optional, true);
});

test('parseICalendar: VALARM-Properties überschreiben das Event nicht', () => {
  const inv = parseICalendar(OUTLOOK_ICS);
  assert.equal(inv.summary, 'Projekt-Update Q2'); // nicht "Erinnerung"
  assert.match(inv.description, /^Bitte Unterlagen mitbringen\.\n/);
});

test('parseICalendar: Absage wird als solche erkannt', () => {
  const ics = OUTLOOK_ICS.replace('METHOD:REQUEST', 'METHOD:CANCEL').replace('STATUS:CONFIRMED', 'STATUS:CANCELLED');
  const inv = parseICalendar(ics);
  assert.equal(inv.method, 'CANCEL');
  assert.equal(inv.isCancelled, true);
});

test('parseICalendar: UTC-Zeiten und DURATION statt DTEND', () => {
  const ics = [
    'BEGIN:VCALENDAR', 'METHOD:REQUEST', 'BEGIN:VEVENT',
    'DTSTART:20260401T080000Z', 'DURATION:PT1H30M',
    'SUMMARY:Standup', 'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n');
  const inv = parseICalendar(ics);
  assert.equal(inv.start, '2026-04-01T08:00:00.000Z');
  assert.equal(inv.end, '2026-04-01T09:30:00.000Z');
});

test('parseICalendar: Ganztagestermin bleibt datumsrein', () => {
  const ics = [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT',
    'DTSTART;VALUE=DATE:20260401', 'DTEND;VALUE=DATE:20260402',
    'SUMMARY:Betriebsausflug', 'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n');
  const inv = parseICalendar(ics);
  assert.equal(inv.allDay, true);
  assert.equal(inv.start, '2026-04-01');
  assert.equal(inv.end, '2026-04-02');
});

test('parseICalendar: unbekannte TZID stürzt nicht ab', () => {
  const ics = [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT',
    'DTSTART;TZID=W. Europe Standard Time:20260401T090000',
    'SUMMARY:Alt-Outlook', 'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n');
  const inv = parseICalendar(ics);
  assert.equal(inv.summary, 'Alt-Outlook');
  assert.ok(inv.start && !Number.isNaN(Date.parse(inv.start)));
});

test('parseICalendar: Teams-Link wird aus dem Text gezogen', () => {
  const ics = [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART:20260401T080000Z',
    'SUMMARY:Online', 'DESCRIPTION:Beitreten: https://teams.microsoft.com/l/meetup-join/abc123 .',
    'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n');
  assert.equal(parseICalendar(ics).meetingUrl, 'https://teams.microsoft.com/l/meetup-join/abc123');
});

test('parseICalendar: Serientermin mit RECURRENCE-ID nimmt den Master', () => {
  const ics = [
    'BEGIN:VCALENDAR', 'METHOD:REQUEST',
    'BEGIN:VEVENT', 'RECURRENCE-ID:20260408T080000Z', 'DTSTART:20260408T080000Z', 'SUMMARY:Ausnahme', 'END:VEVENT',
    'BEGIN:VEVENT', 'DTSTART:20260401T080000Z', 'RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=WE;COUNT=10', 'SUMMARY:Serie', 'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');
  const inv = parseICalendar(ics);
  assert.equal(inv.summary, 'Serie');
  assert.equal(inv.recurrence, 'Wöchentlich am Mittwoch, 10×');
});

test('parseICalendar: liefert null für Nicht-Kalendertext', () => {
  assert.equal(parseICalendar('Hallo, das ist eine normale Mail'), null);
  assert.equal(parseICalendar(''), null);
  assert.equal(parseICalendar(null), null);
  assert.equal(parseICalendar('BEGIN:VCALENDAR\r\nEND:VCALENDAR'), null);
});

test('isCalendarPart: erkennt Kalenderteile an Typ oder Dateiname', () => {
  assert.equal(isCalendarPart({ contentType: 'text/calendar; method=REQUEST' }), true);
  assert.equal(isCalendarPart({ contentType: 'application/ics' }), true);
  assert.equal(isCalendarPart({ filename: 'invite.ICS' }), true);
  assert.equal(isCalendarPart({ name: 'meeting.ics' }), true);
  assert.equal(isCalendarPart({ contentType: 'application/pdf', filename: 'rechnung.pdf' }), false);
  assert.equal(isCalendarPart(null), false);
});

test('unfoldIcsLines / icsUnescapeText: RFC-5545-Grundlagen', () => {
  assert.deepEqual(unfoldIcsLines('A:1\r\n 2\r\nB:3'), ['A:12', 'B:3']);
  assert.equal(icsUnescapeText('a\\, b\; c\\nd'), 'a, b; c\nd');
});

test('describeRRule: gängige Wiederholungen auf Deutsch', () => {
  assert.equal(describeRRule('FREQ=DAILY'), 'Täglich');
  assert.equal(describeRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR'), 'Alle 2 Wochen am Montag, Freitag');
  assert.equal(describeRRule('FREQ=MONTHLY;UNTIL=20261231T000000Z'), 'Monatlich, bis 31.12.2026');
  assert.equal(describeRRule(null), null);
});

test('parseIcsDate: Randfälle', () => {
  assert.equal(parseIcsDate('', {}), null);
  assert.equal(parseIcsDate('kaputt', {}), null);
  assert.deepEqual(parseIcsDate('20260401', {}), { iso: '2026-04-01', allDay: true });
});

// ── normalizeAttachments / extractInvitation (v7.2.0) ────────────────────────
const { normalizeAttachments, extractInvitation, attachmentFilename } = require('../lib/pure');

const b64 = (text) => Buffer.from(text, 'utf8').toString('base64');

test('normalizeAttachments: namenloser Kalenderteil bekommt einen echten Dateinamen', () => {
  // Genau der Auslöser des Bugs: mailparser liefert text/calendar ohne filename.
  // Die Datei landete als "anhang" ohne Endung auf der Platte und liess sich
  // vom System nicht öffnen.
  const [cal] = normalizeAttachments([{ filename: undefined, contentType: 'text/calendar', content: b64(OUTLOOK_ICS) }]);
  assert.equal(cal.filename, 'einladung.ics');
  assert.equal(cal.isCalendar, true);
});

test('normalizeAttachments: sonstige namenlose Anhänge bekommen eine Endung', () => {
  const list = normalizeAttachments([
    { filename: undefined, contentType: 'image/png', content: 'AA==' },
    { filename: 'bericht.pdf', contentType: 'application/pdf', content: 'AA==' }
  ]);
  assert.equal(list[0].filename, 'anhang-1.png');
  assert.equal(list[0].isCalendar, false);
  assert.equal(list[1].filename, 'bericht.pdf'); // vorhandener Name bleibt
});

test('attachmentFilename: Randfälle ohne Typ', () => {
  assert.equal(attachmentFilename({}, 2), 'anhang-3.dat');
  assert.equal(attachmentFilename({ contentType: 'application/octet-stream' }, 0), 'anhang-1.octetstream');
});

test('extractInvitation: liest den Termin aus dem base64-Kalenderteil', () => {
  const atts = normalizeAttachments([{ contentType: 'text/calendar', content: b64(OUTLOOK_ICS) }]);
  const inv = extractInvitation(atts, null);
  assert.equal(inv.summary, 'Projekt-Update Q2');
  assert.equal(inv.method, 'REQUEST');
  assert.equal(inv.filename, 'einladung.ics');
});

test('extractInvitation: greift auch auf den Textteil zurück', () => {
  const inv = extractInvitation([], { text: OUTLOOK_ICS });
  assert.equal(inv.summary, 'Projekt-Update Q2');
});

test('extractInvitation: normale Mails liefern keine Einladung', () => {
  assert.equal(extractInvitation([{ contentType: 'application/pdf', content: b64('%PDF-1.4') }], { text: 'Hallo' }), null);
  assert.equal(extractInvitation([], null), null);
  assert.equal(extractInvitation(null, null), null);
});

test('extractInvitation: kaputter Kalenderteil bricht die Mailansicht nicht', () => {
  const atts = normalizeAttachments([{ contentType: 'text/calendar', content: b64('BEGIN:VCALENDAR\r\nkaputt') }]);
  assert.equal(extractInvitation(atts, null), null);
});
