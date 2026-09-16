// ─── Pure Functions (v7.0) ───────────────────────────────────────────────────
// Sicherheits- und logikkritische Funktionen ohne Electron-/IO-Abhängigkeit,
// aus main.js extrahiert, damit sie testbar sind (tests/pure.test.js).
// main.js bindet sie per require ein — Verhalten unverändert.

// Versionsvergleich für die Update-Pipeline: 1 (v1 neuer), -1 (älter), 0 (gleich)
function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

// Update-Sicherheit: nur offizielle GitHub-Release-URLs des eigenen Repos
function isTrustedUpdateUrl(url) {
  try {
    const u = new URL(String(url));
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    const okHost = host === 'github.com' || host === 'objects.githubusercontent.com' || host === 'release-assets.githubusercontent.com';
    if (!okHost) return false;
    // github.com muss auf das offizielle Repo zeigen; die CDN-Hosts liefern nur Assets aus
    if (host === 'github.com' && !u.pathname.startsWith('/Zenovs/coremail/')) return false;
    return true;
  } catch (_) {
    return false;
  }
}

// SSRF-Schutz (Unsubscribe): nur öffentliche https-Hosts, keine privaten Bereiche
function isSafePublicHttpsUrl(rawUrl) {
  try {
    const u = new URL(String(rawUrl));
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return false;
    // IPv6-Loopback / IPv4 in privaten Bereichen ablehnen
    if (host === '::1' || host.startsWith('[')) return false;
    const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (m) {
      const [a, b] = [parseInt(m[1], 10), parseInt(m[2], 10)];
      if (a === 10 || a === 127 || a === 0 ||
          (a === 172 && b >= 16 && b <= 31) ||
          (a === 192 && b === 168) ||
          (a === 169 && b === 254) ||
          (a === 100 && b >= 64 && b <= 127)) return false;
    }
    return true;
  } catch (_) {
    return false;
  }
}

// Mail-Regeln: eine Bedingung gegen eine Mail prüfen
function matchCondition(email, condition) {
  const { field, op = 'contains', value = '' } = condition || {};
  if (!value) return false;
  let haystack = '';
  if (field === 'from')         haystack = (email.from || '');
  else if (field === 'to')      haystack = (email.to || '') + ' ' + (email.cc || '');
  else if (field === 'subject') haystack = (email.subject || '');
  else return false;
  const a = haystack.toLowerCase();
  const b = value.toLowerCase();
  switch (op) {
    case 'equals':     return a === b;
    case 'startsWith': return a.startsWith(b);
    case 'endsWith':   return a.endsWith(b);
    case 'contains':
    default:           return a.includes(b);
  }
}

// Mail-Regeln: greift die Regel auf diese Mail?
function matchRule(email, rule) {
  if (!rule.enabled) return false;
  const conds = Array.isArray(rule.conditions) ? rule.conditions : [];
  if (conds.length === 0) return false;
  if (rule.matchAll === false) return conds.some(c => matchCondition(email, c));
  return conds.every(c => matchCondition(email, c));
}


// ─── iCalendar / Meeting-Einladungen (v7.2.0) ───────────────────────────────
// Parser für text/calendar-Teile (RFC 5545). Bewusst ohne Fremdbibliothek und
// ohne IO, damit er hier getestet werden kann und sowohl im Main-Prozess
// (IMAP/Graph) als auch im Renderer nutzbar bleibt.

// RFC 5545 §3.1: Zeilen dürfen umgebrochen sein — eine Folgezeile beginnt mit
// einem Space oder Tab und gehört an die vorige angehängt.
function unfoldIcsLines(text) {
  const raw = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const out = [];
  for (const line of raw) {
    if (/^[ \t]/.test(line) && out.length > 0) {
      out[out.length - 1] += line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out.filter(l => l.length > 0);
}

// TEXT-Werte sind escaped: \n \, \; \\  (RFC 5545 §3.3.11)
function icsUnescapeText(value) {
  return String(value || '')
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

// "DTSTART;TZID=Europe/Zurich:20260401T090000" → { name, params, value }
// Doppelpunkte innerhalb von Anführungszeichen (CN="Muster, Max") trennen nicht.
function parseIcsLine(line) {
  let inQuotes = false;
  let colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === ':' && !inQuotes) { colon = i; break; }
  }
  if (colon === -1) return null;

  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);

  // Parameter am Semikolon trennen — ebenfalls quote-bewusst
  const segments = [];
  let current = '';
  inQuotes = false;
  for (const ch of head) {
    if (ch === '"') { inQuotes = !inQuotes; current += ch; }
    else if (ch === ';' && !inQuotes) { segments.push(current); current = ''; }
    else current += ch;
  }
  segments.push(current);

  const name = (segments.shift() || '').trim().toUpperCase();
  const params = {};
  for (const seg of segments) {
    const eq = seg.indexOf('=');
    if (eq === -1) continue;
    const key = seg.slice(0, eq).trim().toUpperCase();
    let val = seg.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    params[key] = val;
  }
  return { name, params, value };
}

// Offset einer Zeitzone zum gegebenen UTC-Zeitpunkt, in Millisekunden.
// Nutzt Intl statt einer tz-Datenbank — in Node wie im Browser verfügbar.
function timeZoneOffsetMs(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const parts = {};
  for (const p of dtf.formatToParts(date)) parts[p.type] = p.value;
  let hour = parseInt(parts.hour, 10);
  if (hour === 24) hour = 0; // manche ICUs liefern 24 statt 00
  const asUtc = Date.UTC(
    parseInt(parts.year, 10), parseInt(parts.month, 10) - 1, parseInt(parts.day, 10),
    hour, parseInt(parts.minute, 10), parseInt(parts.second, 10)
  );
  return asUtc - date.getTime();
}

// Wanduhrzeit in einer Zeitzone → echter UTC-Zeitpunkt.
// Zwei Durchläufe, damit auch DST-Wechseltage korrekt aufgelöst werden.
function wallClockToUtc(y, mo, d, h, mi, s, timeZone) {
  const naive = Date.UTC(y, mo - 1, d, h, mi, s);
  try {
    let offset = timeZoneOffsetMs(new Date(naive), timeZone);
    offset = timeZoneOffsetMs(new Date(naive - offset), timeZone);
    return new Date(naive - offset);
  } catch (_) {
    // Unbekannte TZID (z.B. Outlook-Eigennamen wie "W. Europe Standard Time"):
    // als lokale Zeit des Rechners interpretieren statt die Mail zu verlieren.
    return new Date(y, mo - 1, d, h, mi, s);
  }
}

// DTSTART/DTEND/DTSTAMP-Werte parsen.
// Liefert { iso, allDay } — bei allDay ist iso ein reines Datum (YYYY-MM-DD).
function parseIcsDate(value, params = {}) {
  const v = String(value || '').trim();
  if (!v) return null;

  const dateOnly = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dateOnly || (params.VALUE || '').toUpperCase() === 'DATE') {
    const m = dateOnly || v.match(/^(\d{4})(\d{2})(\d{2})/);
    if (!m) return null;
    return { iso: `${m[1]}-${m[2]}-${m[3]}`, allDay: true };
  }

  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, zulu] = m;
  const num = (x) => parseInt(x, 10);

  if (zulu) {
    return { iso: new Date(Date.UTC(num(y), num(mo) - 1, num(d), num(h), num(mi), num(s))).toISOString(), allDay: false };
  }
  if (params.TZID) {
    const dt = wallClockToUtc(num(y), num(mo), num(d), num(h), num(mi), num(s), params.TZID);
    return { iso: dt.toISOString(), allDay: false, tzid: params.TZID };
  }
  // Ohne Z und ohne TZID: "floating time" — lokale Zeit des Betrachters
  return { iso: new Date(num(y), num(mo) - 1, num(d), num(h), num(mi), num(s)).toISOString(), allDay: false, floating: true };
}

// "mailto:max@firma.ch" → "max@firma.ch"
function stripMailto(value) {
  return String(value || '').replace(/^mailto:/i, '').trim();
}

function parseIcsPerson(line) {
  if (!line) return null;
  const email = stripMailto(line.value);
  const name = line.params.CN ? icsUnescapeText(line.params.CN) : '';
  if (!email && !name) return null;
  return {
    name: name || email,
    email,
    role: line.params.ROLE || null,
    partstat: line.params.PARTSTAT || null,
    rsvp: String(line.params.RSVP || '').toUpperCase() === 'TRUE',
    optional: (line.params.ROLE || '').toUpperCase() === 'OPT-PARTICIPANT'
  };
}

const RRULE_DAYS = {
  MO: 'Montag', TU: 'Dienstag', WE: 'Mittwoch', TH: 'Donnerstag',
  FR: 'Freitag', SA: 'Samstag', SU: 'Sonntag'
};

// RRULE in einen lesbaren deutschen Satz übersetzen (Kurzform, kein Vollparser).
function describeRRule(rrule) {
  if (!rrule) return null;
  const parts = {};
  for (const chunk of String(rrule).split(';')) {
    const eq = chunk.indexOf('=');
    if (eq === -1) continue;
    parts[chunk.slice(0, eq).trim().toUpperCase()] = chunk.slice(eq + 1).trim();
  }
  const interval = parseInt(parts.INTERVAL || '1', 10) || 1;
  const freq = (parts.FREQ || '').toUpperCase();

  let text;
  if (freq === 'DAILY')        text = interval === 1 ? 'Täglich' : `Alle ${interval} Tage`;
  else if (freq === 'WEEKLY')  text = interval === 1 ? 'Wöchentlich' : `Alle ${interval} Wochen`;
  else if (freq === 'MONTHLY') text = interval === 1 ? 'Monatlich' : `Alle ${interval} Monate`;
  else if (freq === 'YEARLY')  text = interval === 1 ? 'Jährlich' : `Alle ${interval} Jahre`;
  else if (freq === 'HOURLY')  text = interval === 1 ? 'Stündlich' : `Alle ${interval} Stunden`;
  else return null;

  if (parts.BYDAY && (freq === 'WEEKLY' || freq === 'MONTHLY')) {
    const days = parts.BYDAY.split(',')
      .map(d => RRULE_DAYS[d.replace(/^[+-]?\d+/, '').toUpperCase()])
      .filter(Boolean);
    if (days.length) text += ` am ${days.join(', ')}`;
  }
  if (parts.COUNT) text += `, ${parts.COUNT}×`;
  if (parts.UNTIL) {
    const until = parseIcsDate(parts.UNTIL, {});
    if (until) text += `, bis ${until.iso.slice(0, 10).split('-').reverse().join('.')}`;
  }
  return text;
}

// Teams-/Zoom-/Meet-Link aus den bekannten X-Properties oder dem Freitext ziehen
function extractMeetingUrl(props, text) {
  const direct = props['X-MICROSOFT-SKYPETEAMSMEETINGURL'] || props['X-GOOGLE-CONFERENCE'];
  if (direct) return direct;
  const m = String(text || '').match(
    /https:\/\/(?:teams\.microsoft\.com|teams\.live\.com|[\w.-]*zoom\.us|meet\.google\.com|[\w.-]*webex\.com|meet\.jit\.si|whereby\.com)\/[^\s"'<>\])]+/i
  );
  return m ? m[0].replace(/[.,;:]+$/, '') : null;
}

// Haupteinstieg: Rohtext eines text/calendar-Teils → Einladungsobjekt (oder null).
// Bei mehreren VEVENTs gewinnt die Serien-Master-Komponente (ohne RECURRENCE-ID).
function parseICalendar(icsText) {
  const lines = unfoldIcsLines(icsText);
  if (!lines.length) return null;
  if (!lines.some(l => /^BEGIN:VCALENDAR/i.test(l) || /^BEGIN:VEVENT/i.test(l))) return null;

  let method = null;
  const events = [];
  let current = null;

  for (const line of lines) {
    const parsed = parseIcsLine(line);
    if (!parsed) continue;
    const { name, value } = parsed;

    if (name === 'BEGIN' && value.toUpperCase() === 'VEVENT') {
      current = { props: {}, lines: {}, attendees: [] };
      continue;
    }
    if (name === 'END' && value.toUpperCase() === 'VEVENT') {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) {
      if (name === 'METHOD') method = value.trim().toUpperCase();
      continue;
    }
    // Innerhalb von VALARM/VTIMEZONE stehende Properties nicht ins Event mischen
    if (name === 'BEGIN' || name === 'END') {
      current.skip = (name === 'BEGIN') ? value.toUpperCase() : null;
      continue;
    }
    if (current.skip) continue;

    if (name === 'ATTENDEE') {
      const person = parseIcsPerson(parsed);
      if (person) current.attendees.push(person);
    } else {
      current.props[name] = value;
      current.lines[name] = parsed;
    }
  }

  if (!events.length) return null;
  const ev = events.find(e => !e.props['RECURRENCE-ID']) || events[0];
  const p = ev.props;

  const start = ev.lines.DTSTART ? parseIcsDate(ev.lines.DTSTART.value, ev.lines.DTSTART.params) : null;
  let end = ev.lines.DTEND ? parseIcsDate(ev.lines.DTEND.value, ev.lines.DTEND.params) : null;

  // Kein DTEND: DURATION auswerten (RFC 5545 §3.3.6), sonst offen lassen
  if (!end && p.DURATION && start && !start.allDay) {
    const d = String(p.DURATION).match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
    if (d) {
      const sign = d[1] === '-' ? -1 : 1;
      const ms = ((parseInt(d[2] || 0, 10) * 7 + parseInt(d[3] || 0, 10)) * 86400
        + parseInt(d[4] || 0, 10) * 3600 + parseInt(d[5] || 0, 10) * 60 + parseInt(d[6] || 0, 10)) * 1000;
      end = { iso: new Date(new Date(start.iso).getTime() + sign * ms).toISOString(), allDay: false };
    }
  }

  const description = icsUnescapeText(p.DESCRIPTION || '');
  const location = icsUnescapeText(p.LOCATION || '');
  const status = (p.STATUS || '').toUpperCase() || null;

  return {
    method: method || 'PUBLISH',
    uid: p.UID || null,
    sequence: p.SEQUENCE ? parseInt(p.SEQUENCE, 10) : 0,
    status,
    summary: icsUnescapeText(p.SUMMARY || '') || '(Kein Titel)',
    description,
    location,
    url: p.URL || null,
    start: start ? start.iso : null,
    end: end ? end.iso : null,
    allDay: !!(start && start.allDay),
    timeZone: (start && start.tzid) || null,
    organizer: parseIcsPerson(ev.lines.ORGANIZER),
    attendees: ev.attendees,
    rrule: p.RRULE || null,
    recurrence: describeRRule(p.RRULE),
    meetingUrl: extractMeetingUrl(p, `${location}\n${description}\n${p.URL || ''}`),
    isCancelled: method === 'CANCEL' || status === 'CANCELLED'
  };
}

// Erkennt den Kalenderteil einer Mail — text/calendar, application/ics oder
// schlicht eine .ics-Datei im Anhang.
function isCalendarPart(att) {
  if (!att) return false;
  const type = String(att.contentType || '').toLowerCase();
  const name = String(att.filename || att.name || '').toLowerCase();
  return type.startsWith('text/calendar')
    || type.startsWith('application/ics')
    || type.startsWith('text/x-vcalendar')
    || type.startsWith('application/hbs-vcs')
    || name.endsWith('.ics')
    || name.endsWith('.vcs');
}

// Einladungen kommen als text/calendar-Teil. mailparser reicht diesen Teil als
// Anhang durch — meist OHNE Dateiname. Er landete dadurch als namenlose Datei
// im Anhang-Banner, liess sich nicht öffnen und die Termindaten blieben
// unsichtbar. Beides wird hier behoben: sprechender Dateiname + geparster
// Termin, den der Renderer als Einladungskarte darstellt.

function attachmentFilename(att, index = 0) {
  if (att && att.filename) return att.filename;
  if (isCalendarPart(att)) return 'einladung.ics';
  const type = String(att?.contentType || '').toLowerCase();
  const ext = (type.split('/')[1] || 'dat').split(';')[0].replace(/[^a-z0-9]/g, '') || 'dat';
  return `anhang-${index + 1}.${ext}`;
}

// Anhangsliste normalisieren: Dateiname garantiert, Kalenderteile markiert.
// `content` ist hier bereits base64 (so verlassen Anhänge den Main-Prozess).
function normalizeAttachments(list) {
  return (list || []).map((att, i) => ({
    ...att,
    filename: attachmentFilename(att, i),
    isCalendar: isCalendarPart(att)
  }));
}

// Kalenderteil → Einladungsobjekt. Liefert null, wenn die Mail keine ist.
function extractInvitation(attachments, parsed) {
  try {
    for (const att of attachments || []) {
      if (!att.isCalendar && !isCalendarPart(att)) continue;
      let text = '';
      if (Buffer.isBuffer(att.content)) text = att.content.toString('utf8');
      else if (typeof att.content === 'string') text = Buffer.from(att.content, 'base64').toString('utf8');
      if (!text) continue;
      const invitation = parseICalendar(text);
      if (invitation) return { ...invitation, filename: att.filename || 'einladung.ics' };
    }
    // Fallback: einzelne Server liefern das VCALENDAR direkt im Textteil
    const body = parsed?.text || '';
    if (/BEGIN:VCALENDAR/i.test(body)) {
      const invitation = parseICalendar(body);
      if (invitation) return { ...invitation, filename: 'einladung.ics' };
    }
  } catch (err) {
    console.error('[Einladung] Parsen fehlgeschlagen:', err.message);
  }
  return null;
}

module.exports = {
  compareVersions, isTrustedUpdateUrl, isSafePublicHttpsUrl, matchCondition, matchRule,
  // v7.2.0 — Meeting-Einladungen
  parseICalendar, isCalendarPart, parseIcsDate, parseIcsLine, unfoldIcsLines,
  icsUnescapeText, describeRRule, wallClockToUtc,
  attachmentFilename, normalizeAttachments, extractInvitation
};
