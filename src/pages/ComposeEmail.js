import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTheme } from '../context/ThemeContext';
import { useAccounts } from '../context/AccountContext';
import EscapeCloser from '../components/EscapeCloser';
import EmailTagInput from '../components/EmailTagInput';
import UrlPromptDialog from '../components/UrlPromptDialog';
import MailApi from '../services/MailApi';
import { sanitizeEmailHtml } from '../utils/sanitizeHtml';
import {
  TextBold, TextItalic, TextUnderline, TextStrikethrough,
  ListNumbered, ListBulleted,
  TextAlignLeft, TextAlignCenter, TextAlignRight,
  TextClearFormat,
  Document, DocumentBlank, Portfolio, Money, Template, Code,
  Close, Send, Checkmark, InProgress, Edit, PenFountain, View, Time, Link,
  Image, DocumentPdf, Music, Video, Box
} from '@carbon/icons-react';
import Attachment from '../components/PaperclipIcon';

// ─── HTML-Vorlagen ───────────────────────────────────────────────────────────
const HTML_TEMPLATES = [
  {
    id: 'blank',
    name: 'Leer',
    Icon: DocumentBlank,
    html: '<p></p>',
  },
  {
    id: 'formal',
    name: 'Formeller Brief',
    Icon: Portfolio,
    html: `<p>Sehr geehrte Damen und Herren,</p>
<p>ich schreibe Ihnen bezüglich <em>[Thema]</em>.</p>
<p>[Ihr Text hier]</p>
<p>Für Rückfragen stehe ich Ihnen gerne zur Verfügung.</p>
<p>Mit freundlichen Grüßen</p>`,
  },
  {
    id: 'newsletter',
    name: 'Newsletter',
    Icon: Document,
    html: `<div style="max-width:600px;margin:0 auto;font-family:Arial,sans-serif;color:#333">
  <h2 style="color:#0891b2;border-bottom:2px solid #0891b2;padding-bottom:8px">Betreff des Newsletters</h2>
  <p>Hallo,</p>
  <p>hier sind unsere neuesten Informationen für Sie:</p>
  <h3 style="color:#0891b2">Abschnitt 1</h3>
  <p>Inhalt des ersten Abschnitts...</p>
  <h3 style="color:#0891b2">Abschnitt 2</h3>
  <p>Inhalt des zweiten Abschnitts...</p>
  <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
  <p style="color:#999;font-size:12px">Sie erhalten diese E-Mail, weil Sie sich für unseren Newsletter angemeldet haben.</p>
</div>`,
  },
  {
    id: 'offer',
    name: 'Angebot',
    Icon: Money,
    html: `<p>Sehr geehrte Damen und Herren,</p>
<p>wir freuen uns, Ihnen folgendes Angebot zu unterbreiten:</p>
<table style="border-collapse:collapse;width:100%;margin:16px 0;font-size:14px">
  <thead>
    <tr style="background:#0891b2;color:white">
      <th style="padding:10px;text-align:left;border:1px solid #0891b2">Position</th>
      <th style="padding:10px;text-align:left;border:1px solid #0891b2">Beschreibung</th>
      <th style="padding:10px;text-align:right;border:1px solid #0891b2">Preis</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td style="padding:8px;border:1px solid #ddd">1</td>
      <td style="padding:8px;border:1px solid #ddd">Leistung/Produkt</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right">€ 0,00</td>
    </tr>
    <tr style="background:#f9f9f9">
      <td colspan="2" style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:bold">Gesamt (netto)</td>
      <td style="padding:8px;border:1px solid #ddd;text-align:right;font-weight:bold">€ 0,00</td>
    </tr>
  </tbody>
</table>
<p>Dieses Angebot ist gültig bis [Datum].</p>
<p>Mit freundlichen Grüßen</p>`,
  },
  {
    id: 'custom',
    name: 'HTML einfügen',
    Icon: Code,
    html: null, // will open paste dialog
  },
];

// ─── Toolbar-Konfiguration ────────────────────────────────────────────────────
const TOOLBAR = [
  [
    { cmd: 'bold',         Icon: TextBold,          title: 'Fett (Ctrl+B)' },
    { cmd: 'italic',       Icon: TextItalic,        title: 'Kursiv (Ctrl+I)' },
    { cmd: 'underline',    Icon: TextUnderline,     title: 'Unterstrichen (Ctrl+U)' },
    { cmd: 'strikeThrough',Icon: TextStrikethrough, title: 'Durchgestrichen' },
  ],
  [
    { cmd: 'insertOrderedList',   Icon: ListNumbered, title: 'Nummerierte Liste' },
    { cmd: 'insertUnorderedList', Icon: ListBulleted, title: 'Aufzählungsliste' },
  ],
  [
    { cmd: 'justifyLeft',   Icon: TextAlignLeft,    title: 'Links' },
    { cmd: 'justifyCenter', Icon: TextAlignCenter,  title: 'Zentriert' },
    { cmd: 'justifyRight',  Icon: TextAlignRight,   title: 'Rechts' },
  ],
  [
    { cmd: 'removeFormat',  Icon: TextClearFormat,  title: 'Formatierung entfernen' },
  ],
];

const HEADINGS = [
  { label: 'Normal', tag: 'div' },
  { label: 'H1',     tag: 'h1' },
  { label: 'H2',     tag: 'h2' },
  { label: 'H3',     tag: 'h3' },
];

// ─── Hilfsfunktionen ──────────────────────────────────────────────────────────
const formatFileSize = (bytes) => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

const getFileIcon = (contentType, filename) => {
  if (contentType.startsWith('image/')) return Image;
  if (contentType === 'application/pdf') return DocumentPdf;
  if (contentType.includes('zip') || contentType.includes('archive')) return Box;
  if (contentType.startsWith('video/')) return Video;
  if (contentType.startsWith('audio/')) return Music;
  return DocumentBlank;
};


// ─── Hauptkomponente ──────────────────────────────────────────────────────────
function ComposeEmail({ onBack, replyTo: replyToProp = null, composeData = null }) {
  const { currentTheme } = useTheme();
  const { activeAccountId, accounts } = useAccounts();
  const c = currentTheme.colors;

  // Normalise: App.js passes composeData, some callers pass replyTo directly
  const replyTo = replyToProp || composeData?.originalEmail || null;
  const isForward = composeData?.type === 'forward';
  const isReplyAll = composeData?.type === 'replyAll';

  // Helper: works for both IMAP (smtp.fromEmail) and M365 (microsoft.email) accounts
  const getAccountEmail = (acc) =>
    acc?.type === 'microsoft'
      ? (acc.microsoft?.email || acc.name || '')
      : (acc?.smtp?.fromEmail || acc?.smtp?.username || '');

  // --- Formularfelder ---
  const replyToAddr = isReplyAll
    ? [replyTo?.from, ...(replyTo?.cc ? replyTo.cc.split(',').map(s => s.trim()) : [])].filter(Boolean)
    : replyTo?.from ? [replyTo.from] : [];
  const [toTags,  setToTags]  = useState(isForward ? [] : replyToAddr);
  const [ccTags,  setCcTags]  = useState([]);
  const [bccTags, setBccTags] = useState([]);
  const [form, setForm] = useState({
    subject: replyTo
      ? (isForward ? `Fwd: ${replyTo.subject}` : `Re: ${replyTo.subject}`)
      : '',
  });
  // v7.0: '__ALL__' (vereinheitlichter Posteingang) ist kein sendefähiges
  // Konto — dann mit dem ersten echten Konto starten
  const [selectedAccountId, setSelectedAccountId] = useState(
    activeAccountId === '__ALL__' ? (accounts[0]?.id ?? null) : activeAccountId
  );
  const [senderName, setSenderName] = useState('');

  // --- Editor ---
  const editorRef  = useRef(null);
  const [editorMode,  setEditorMode]  = useState('richtext'); // 'richtext' | 'html' | 'preview'
  const [htmlSource,  setHtmlSource]  = useState('');
  const initialEditorTextRef = useRef('');
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  // --- Templates ---
  const [showTemplates,  setShowTemplates]  = useState(false);
  const [customHtmlPaste, setCustomHtmlPaste] = useState('');
  const [showCustomPaste, setShowCustomPaste] = useState(false);

  // --- Senden & Undo ---
  const [sending, setSending] = useState(false);
  const [showSchedulePicker, setShowSchedulePicker] = useState(false);
  const [scheduleDateTime, setScheduleDateTime] = useState('');
  const [error,   setError]   = useState(null);
  const [success, setSuccess] = useState(false);
  const [undoCountdown, setUndoCountdown] = useState(null);
  const undoTimerRef = useRef(null);
  const undoCancelledRef = useRef(false);
  // Draft autosave key — unique per new compose vs. reply/forward
  const draftKey = replyTo ? null : 'composeDraft';

  // --- Anhänge ---
  const [attachments,    setAttachments]    = useState([]);
  const [uploadProgress, setUploadProgress] = useState({});
  const [isDragging,     setIsDragging]     = useState(false);
  const fileInputRef = useRef(null);
  const dropZoneRef  = useRef(null);

  // v6.9.6: Link-Dialog (Ersatz für window.prompt, das Electron nicht kennt)
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const savedSelectionRef = useRef(null);
  // v7.0: stabiler Zugriff auf handleSend für den Cmd+Enter-Listener
  const handleSendRef = useRef(null);

  // --- Signatur ---
  const [signatures,            setSignatures]            = useState({});
  const [useSignature,          setUseSignature]          = useState(true);
  const [showSignaturePreview,  setShowSignaturePreview]  = useState(false);
  const [selectedSignatureId,   setSelectedSignatureId]   = useState(null); // null = Default
  const sigInsertedRef = useRef(false);

  // ── Initialisierung ─────────────────────────────────────────────────────────
  useEffect(() => {
    loadSignatures();
    // Draft restore on mount (new compose only)
    if (draftKey) {
      try {
        const saved = localStorage.getItem(draftKey);
        if (saved) {
          const draft = JSON.parse(saved);
          if (draft.to?.length) setToTags(draft.to);
          if (draft.subject) setForm(f => ({ ...f, subject: draft.subject }));
          if (draft.html && editorRef.current) editorRef.current.innerHTML = draft.html;
        }
      } catch (_) {}
    }
    return () => {
      // Cleanup undo timer on unmount to prevent state updates after unmount
      if (undoTimerRef.current) clearInterval(undoTimerRef.current);
    };
  }, []); // eslint-disable-line

  // Draft autosave every 10s (new compose only)
  useEffect(() => {
    if (!draftKey) return;
    const id = setInterval(() => {
      try {
        const html = editorMode === 'richtext' ? editorRef.current?.innerHTML : htmlSource;
        localStorage.setItem(draftKey, JSON.stringify({ to: toTags, subject: form.subject, html }));
      } catch (_) {}
    }, 10000);
    return () => clearInterval(id);
  }, [draftKey, toTags, form.subject, editorMode, htmlSource]);

  // Absendername aus Konto übernehmen
  useEffect(() => {
    const acc = accounts.find(a => a.id === selectedAccountId);
    setSenderName(acc?.displayName || '');
  }, [selectedAccountId, accounts]);

  // Antwort-Zitat / Weiterleitung in Editor einfügen
  useEffect(() => {
    if (editorRef.current && replyTo) {
      // Sicherheit: Mail-HTML wird hier in einen live contentEditable eingefügt
      // (nicht sandboxed) — ohne Sanitizing würde `<img onerror>` beim Antworten
      // Renderer-Code mit vollem electronAPI-Zugriff ausführen.
      const quoted = replyTo.html
        ? sanitizeEmailHtml(replyTo.html)
        : (replyTo.text || '').replace(/\n/g, '<br>');
      // v6.6.0: Smart-Compose-Vorschlag, falls vorhanden, oben einfügen
      const aiPrefix = composeData?.aiDraft
        ? `<div>${composeData.aiDraft.replace(/\n/g, '<br>')}</div><br>`
        : '<p></p><br>';
      // v6.7.5: Zitierte Mail in weißen Container wrappen — HTML-Mails
      // erwarten weißen Hintergrund, Text-Mails wären auf dem dunklen
      // Editor-Background unleserlich (weiße Text-Farbe vom dark-theme erbt).
      const quoteWrapStyle = 'background:#ffffff;color:#222;padding:12px 16px;border-radius:6px;margin-top:8px;font-family:sans-serif;';
      if (isForward) {
        const header = `<div style="${quoteWrapStyle}font-size:13px;border-left:3px solid #06b6d4;"><p style="margin:0 0 8px 0"><strong>Weitergeleitete Nachricht</strong><br>Von: ${replyTo.from || ''}<br>An: ${replyTo.to || ''}<br>Datum: ${replyTo.date ? new Date(replyTo.date).toLocaleString('de-DE') : ''}<br>Betreff: ${replyTo.subject || ''}</p><div>${quoted}</div></div>`;
        editorRef.current.innerHTML = `${aiPrefix}<hr>${header}`;
      } else {
        editorRef.current.innerHTML =
          `${aiPrefix}<blockquote style="border-left:3px solid #06b6d4;padding:0;margin:0;"><div style="${quoteWrapStyle}">${quoted}</div></blockquote>`;
      }
      // Baseline für die Verwerfen-Erkennung: alles, was der Nutzer darüber
      // hinaus tippt, gilt als ungespeicherte Eingabe (Replies haben keinen Draft).
      initialEditorTextRef.current = editorRef.current.innerText;
    }
  }, [replyTo, isForward]); // eslint-disable-line

  // Beim Weiterleiten: Originalanhänge übernehmen (nur einmal beim Mount)
  useEffect(() => {
    if (!isForward || !Array.isArray(replyTo?.attachments) || replyTo.attachments.length === 0) return;
    const carried = replyTo.attachments
      .filter(att => att && att.content && att.filename)
      .map(att => ({
        id: `fwd-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        filename: att.filename,
        contentType: att.contentType || 'application/octet-stream',
        size: att.size || 0,
        content: att.content,
        loaded: true
      }));
    if (carried.length > 0) setAttachments(prev => [...carried, ...prev]);
  }, []); // eslint-disable-line

  const loadSignatures = async () => {
    if (window.electronAPI?.loadSignatures) {
      const result = await window.electronAPI.loadSignatures();
      if (result.success) setSignatures(result.signatures);
    }
  };

  // Signatur des aktiven Kontos auswählen.
  // Neues Format: signatures[accountId] = { enabled, defaultId, items: [...], html, text } (top-level html/text = Default).
  // Altes Format: { enabled, html, text } — beides funktioniert dank top-level-Feldern.
  const accSig = signatures[selectedAccountId] || null;
  const sigItems = Array.isArray(accSig?.items) ? accSig.items : null;
  // Effektive Signatur: explizit gewählte oder Default (top-level html)
  const pickedItem = sigItems && selectedSignatureId
    ? sigItems.find(i => i.id === selectedSignatureId)
    : null;
  const currentSignature = pickedItem
    ? { enabled: !!accSig?.enabled, html: pickedItem.html, text: pickedItem.text, name: pickedItem.name }
    : accSig;
  const hasSignature = currentSignature?.enabled && currentSignature?.html;

  // Bei Account-Wechsel: ausgewählte Signatur-ID zurücksetzen (Default des neuen Kontos)
  useEffect(() => { setSelectedSignatureId(null); }, [selectedAccountId]);

  // Insert / remove signature element directly in editor so user sees it while composing.
  // We mark the element with data-coremail-sig so toggle and re-render can find it.
  useEffect(() => {
    if (!editorRef.current) return;
    const existingSig = editorRef.current.querySelector('[data-coremail-sig]');

    if (useSignature && hasSignature) {
      if (!existingSig) {
        const el = document.createElement('div');
        el.setAttribute('data-coremail-sig', '1');
        el.innerHTML = `<hr style="margin:20px 0;border:none;border-top:1px solid #ddd">${currentSignature.html}`;
        editorRef.current.appendChild(el);
        sigInsertedRef.current = true;
      } else {
        // Update content when account changes
        existingSig.innerHTML = `<hr style="margin:20px 0;border:none;border-top:1px solid #ddd">${currentSignature.html}`;
      }
    } else if (!useSignature && existingSig) {
      existingSig.remove();
      sigInsertedRef.current = false;
    }
  }, [hasSignature, useSignature, selectedAccountId, selectedSignatureId]); // eslint-disable-line

  // ── Editor-Modus wechseln ───────────────────────────────────────────────────
  const switchMode = (mode) => {
    if (mode === editorMode) return;

    // Capture current HTML before any state change
    let currentHtml = htmlSource;
    if (editorMode === 'richtext' && editorRef.current) {
      currentHtml = editorRef.current.innerHTML;
      setHtmlSource(currentHtml);
    }

    setEditorMode(mode);

    // When switching to richtext: editorRef.current is null now (div not yet in DOM).
    // Schedule restore AFTER React re-renders and attaches the ref.
    if (mode === 'richtext') {
      setTimeout(() => {
        if (editorRef.current) editorRef.current.innerHTML = currentHtml;
      }, 50);
    }
  };

  const getEditorHtml = useCallback(() => {
    if (editorMode === 'html') return htmlSource;
    return editorRef.current?.innerHTML || '';
  }, [editorMode, htmlSource]);

  const getEditorText = useCallback(() => {
    if (editorMode === 'html') return htmlSource.replace(/<[^>]*>/g, '');
    return editorRef.current?.innerText || '';
  }, [editorMode, htmlSource]);

  const getPreviewHtml = useCallback(() => {
    let html = getEditorHtml();
    if (useSignature && hasSignature) {
      html += `<hr style="margin:20px 0;border:none;border-top:1px solid #ddd"><div>${currentSignature.html}</div>`;
    }
    return html;
  }, [getEditorHtml, useSignature, hasSignature, currentSignature]);

  // ── Formatierung ─────────────────────────────────────────────────────────────
  const execFormat = (cmd, value = null) => {
    editorRef.current?.focus();
    document.execCommand(cmd, false, value);
  };

  // v6.9.6: window.prompt() existiert in Electron nicht — eigener Dialog.
  // Die Text-Selektion muss vor dem Öffnen gesichert werden, weil der Dialog
  // den Fokus stiehlt und execCommand('createLink') sie sonst verliert.
  const insertLink = () => {
    const sel = window.getSelection();
    savedSelectionRef.current = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
    setLinkDialogOpen(true);
  };

  const applyLink = (url) => {
    setLinkDialogOpen(false);
    if (!url) return;
    editorRef.current?.focus();
    const sel = window.getSelection();
    if (savedSelectionRef.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedSelectionRef.current);
    }
    execFormat('createLink', url);
  };

  const applyHeading = (tag) => {
    editorRef.current?.focus();
    document.execCommand('formatBlock', false, tag);
  };

  const setFontColor = (color) => {
    execFormat('foreColor', color);
  };

  // ── Templates ────────────────────────────────────────────────────────────────
  const insertTemplate = (tpl) => {
    if (tpl.id === 'custom') {
      setShowCustomPaste(true);
      return;
    }
    if (editorMode === 'html') {
      setHtmlSource(tpl.html);
    } else if (editorRef.current) {
      editorRef.current.innerHTML = tpl.html;
      editorRef.current.focus();
    }
    setShowTemplates(false);
  };

  const applyCustomHtml = () => {
    const safe = sanitizeEmailHtml(customHtmlPaste);
    if (editorMode === 'html') {
      setHtmlSource(safe);
    } else if (editorRef.current) {
      editorRef.current.innerHTML = safe;
      editorRef.current.focus();
      setHtmlSource(safe);
    }
    setShowCustomPaste(false);
    setShowTemplates(false);
    setCustomHtmlPaste('');
  };

  // ── Anhänge ──────────────────────────────────────────────────────────────────
  const addFiles = (files) => {
    const newAttachments = files.map(file => {
      const reader = new FileReader();
      const id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Throttle progress updates via rAF — prevents 50+ re-renders per large file
      let rafPending = false;
      let latestPct = 0;
      reader.onprogress = (ev) => {
        if (!ev.lengthComputable) return;
        latestPct = Math.round((ev.loaded / ev.total) * 100);
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(() => {
          rafPending = false;
          setUploadProgress(prev => ({ ...prev, [id]: latestPct }));
        });
      };
      reader.onload = (ev) => {
        setAttachments(prev => prev.map(a =>
          a.id === id ? { ...a, content: ev.target.result.split(',')[1], loaded: true } : a
        ));
        setUploadProgress(prev => { const n = { ...prev }; delete n[id]; return n; });
      };
      reader.readAsDataURL(file);
      return { id, filename: file.name, contentType: file.type || 'application/octet-stream', size: file.size, content: null, loaded: false };
    });
    setAttachments(prev => [...prev, ...newAttachments]);
  };

  const handleDragEnter = (e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); };
  const handleDragLeave = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.currentTarget === dropZoneRef.current) setIsDragging(false);
  };
  const handleDragOver  = (e) => { e.preventDefault(); e.stopPropagation(); };
  const handleDrop      = (e) => {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) addFiles(files);
  };

  const getTotalSize = () => attachments.reduce((s, a) => s + a.size, 0);

  // ── Undo Send ────────────────────────────────────────────────────────────────
  const cancelSend = () => {
    undoCancelledRef.current = true;
    clearInterval(undoTimerRef.current);
    setUndoCountdown(null);
  };

  // ── Senden ───────────────────────────────────────────────────────────────────
  // v7.0: Cmd/Ctrl+Enter sendet — auch aus Editor/Eingabefeldern heraus.
  // e.repeat verhindert Autorepeat bei gehaltener Taste; die eigentliche
  // Reentry-Sicherung sitzt in handleSend selbst (Review-Befund v7.0).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.repeat) {
        e.preventDefault();
        handleSendRef.current?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const handleSend = async (scheduledAt = null) => {
    // v7.0: Reentry-Schutz — Cmd+Enter umging die disabled-Logik der Buttons.
    // Ohne diesen Guard konnte ein zweiter Aufruf im 5s-Undo-Fenster das
    // Undo-Intervall verwaisen lassen (wiederholter Versand derselben Mail).
    if (sending || success || undoCountdown !== null) return;
    if (toTags.length === 0) { setError('Bitte mindestens einen Empfänger eingeben'); return; }
    if (!form.subject) { setError('Bitte Betreff ausfüllen'); return; }
    if (attachments.some(a => !a.loaded)) { setError('Bitte warten, bis alle Anhänge geladen sind'); return; }

    const bodyHtml = getEditorHtml(); // signature is already in the editor DOM
    const bodyText = getEditorText();
    const emailData = {
      fromName: senderName,
      to: toTags.join(', '),
      cc: ccTags.length > 0 ? ccTags.join(', ') : undefined,
      bcc: bccTags.length > 0 ? bccTags.join(', ') : undefined,
      subject: form.subject,
      text: bodyText,
      html: bodyHtml,
      attachments: attachments.map(a => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
      // Threading: pass original message-id so the reply is correctly threaded
      ...(replyTo?.messageId && !isForward && {
        inReplyTo:  replyTo.messageId,
        references: replyTo.messageId,
      }),
    };
    const activeAcc = accounts.find(a => a.id === selectedAccountId);

    // Zeitversetzt senden
    if (scheduledAt) {
      const result = await window.electronAPI.scheduledAdd({
        ...emailData,
        sendAt: scheduledAt,
        accountId: selectedAccountId,
        accountType: activeAcc?.type || 'imap',
      });
      if (result?.success) { if (draftKey) localStorage.removeItem(draftKey); setSuccess(true); setTimeout(() => onBack(), 2000); }
      else setError(result?.error || 'Planung fehlgeschlagen');
      return;
    }

    // Undo-Send: 5-Sekunden-Fenster
    setError(null);
    undoCancelledRef.current = false;
    setUndoCountdown(5);
    let remaining = 5;
    undoTimerRef.current = setInterval(() => {
      remaining -= 1;
      setUndoCountdown(remaining);
      if (remaining <= 0) {
        clearInterval(undoTimerRef.current);
        setUndoCountdown(null);
        if (!undoCancelledRef.current) executeSend(emailData, activeAcc);
      }
    }, 1000);
  };
  // Für den Cmd+Enter-Listener (siehe oben) — bei jedem Render aktuell
  handleSendRef.current = () => handleSend(null);

  const executeSend = async (emailData, activeAcc) => {
    setSending(true); setError(null);
    try {
      let result;
      if (activeAcc && selectedAccountId) {
        // v6.11.0: zentrale Graph/IMAP-Weiche über die MailApi-Fassade
        result = await MailApi.send(activeAcc, emailData);
      } else {
        result = await window.electronAPI.sendEmail(emailData); // Legacy-Fallback ohne Konto
      }

      if (result.success) {
        if (draftKey) localStorage.removeItem(draftKey);
        setSuccess(true);
        window.electronAPI.logAdd('email_sent',
          `E-Mail gesendet: ${form.subject || '(kein Betreff)'}`,
          `An: ${toTags.join(', ')}${ccTags.length ? ' | CC: ' + ccTags.join(', ') : ''}${attachments.length ? ' | ' + attachments.length + ' Anhang/Anhänge' : ''}`
        ).catch(() => {});
        setTimeout(() => onBack(), 2000);
      } else setError(result.error);
    } catch (e) { setError(e.message); }
    setSending(false);
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div
      ref={dropZoneRef}
      className={`flex-1 flex flex-col overflow-hidden min-h-0 ${c.bg} relative`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag-Overlay */}
      {isDragging && (
        <div className="absolute inset-0 bg-cyan-500/10 border-4 border-dashed border-cyan-500 z-50 flex items-center justify-center backdrop-blur-sm">
          <div className={`text-center ${c.text}`}>
            <Attachment size={64} className="mx-auto mb-4 text-cyan-400" />
            <p className="text-xl font-semibold">Dateien hier ablegen</p>
          </div>
        </div>
      )}

      {/* v6.9.6: Link-einfügen-Dialog */}
      <UrlPromptDialog
        title="Link einfügen"
        open={linkDialogOpen}
        onSubmit={applyLink}
        onClose={() => setLinkDialogOpen(false)}
        c={c}
      />

      {/* Header */}
      <header className={`px-6 py-3 ${c.border} border-b ${c.bgSecondary} flex-shrink-0`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                // v6.8.1: Replies/Weiterleitungen haben keinen Draft-Autosave —
                // getippten Text nicht ohne Nachfrage verwerfen.
                const dirty = !draftKey && editorRef.current &&
                  editorRef.current.innerText.trim() !== (initialEditorTextRef.current || '').trim();
                if (dirty) setShowDiscardConfirm(true);
                else onBack();
              }}
              title="Zurück" aria-label="Zurück zum Posteingang"
              className={`p-2 ${c.hover} rounded-lg ${c.textSecondary}`}
            >←</button>
            <h2 className={`text-base font-semibold ${c.text}`}>{isForward ? 'Weiterleiten' : replyTo ? 'Antworten' : 'Neue E-Mail'}</h2>
          </div>
          <div className="flex items-center gap-2">
            {attachments.length > 0 && (
              <span className={`text-xs ${c.textSecondary} flex items-center gap-1`}><Attachment size={16} /> {attachments.length} ({formatFileSize(getTotalSize())})</span>
            )}
            {/* Templates Button */}
            <button
              onClick={() => setShowTemplates(!showTemplates)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-1 ${showTemplates ? 'bg-cyan-500/30 text-cyan-400' : `${c.bgTertiary} ${c.hover} ${c.textSecondary}`}`}
            >
              <Template size={16} /> Vorlagen
            </button>
            {/* Zeitversetzt senden */}
            <div className="relative">
              <button
                onClick={() => setShowSchedulePicker(p => !p)}
                disabled={sending || success || undoCountdown !== null}
                title="Zeitversetzt senden"
                className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${c.bgSecondary} ${c.border} border ${c.text} ${c.hover} disabled:opacity-40 inline-flex items-center gap-1`}
              >
                <Time size={16} />
              </button>
              {showSchedulePicker && (
                <div className={`absolute right-0 top-full mt-2 p-3 rounded-xl shadow-xl ${c.bg} ${c.border} border z-50 min-w-[260px]`}>
                  <p className={`text-xs font-medium ${c.text} mb-2`}>Senden um:</p>
                  <input
                    type="datetime-local"
                    value={scheduleDateTime}
                    onChange={e => setScheduleDateTime(e.target.value)}
                    min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
                    className={`w-full text-sm rounded-lg px-3 py-1.5 ${c.bgSecondary} ${c.text} ${c.border} border outline-none`}
                  />
                  <button
                    onClick={() => {
                      if (!scheduleDateTime) return;
                      handleSend(new Date(scheduleDateTime).getTime());
                      setShowSchedulePicker(false);
                    }}
                    disabled={!scheduleDateTime}
                    className={`mt-2 w-full py-1.5 rounded-lg text-sm text-white ${c.accentBg} ${c.accentHover} disabled:opacity-40 transition-colors`}
                  >
                    Einplanen
                  </button>
                </div>
              )}
            </div>

            {/* Senden / Undo */}
            <button
              onClick={() => handleSend()}
              disabled={sending || success || undoCountdown !== null}
              className={`px-5 py-1.5 ${c.accentBg} ${c.accentHover} text-white rounded-lg text-sm transition-colors disabled:opacity-50 inline-flex items-center gap-1`}
            >
              {sending ? <><InProgress size={16} className="animate-spin" /> Sende...</> : success ? <><Checkmark size={16} /> Gesendet!</> : <><Send size={16} /> Senden</>}
            </button>
          </div>
        </div>
      </header>

      {/* Hauptbereich */}
      <div className="flex flex-1 min-h-0">
        {/* Formular (scrollbar) */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="max-w-3xl mx-auto space-y-3">

            {/* Undo-Send Banner */}
            {undoCountdown !== null && (
              <div className="flex items-center justify-between p-3 bg-blue-500/20 border border-blue-500/50 rounded-lg">
                <span className="text-sm text-blue-300 flex items-center gap-2">
                  <Send size={16} /> E-Mail wird in <strong>{undoCountdown}s</strong> gesendet…
                </span>
                <button
                  onClick={cancelSend}
                  className="px-3 py-1 rounded-lg text-sm font-medium bg-blue-500 hover:bg-blue-600 text-white transition-colors"
                >
                  Abbrechen
                </button>
              </div>
            )}

            {/* Fehler / Erfolg */}
            {error && <div className="p-3 bg-red-900/20 border border-red-600 rounded-lg text-red-400 text-sm">{error}</div>}
            {success && <div className="p-3 bg-green-900/20 border border-green-600 rounded-lg text-green-400 text-sm flex items-center gap-2"><Checkmark size={16} /> E-Mail erfolgreich gesendet!</div>}

            {/* Von-Bereich */}
            <div className={`${c.bgSecondary} ${c.border} border rounded-lg p-4 space-y-3`}>
              <div className="flex items-start gap-3">
                <span className={`text-sm ${c.textSecondary} w-16 flex-shrink-0 mt-2`}>Von:</span>
                <div className="flex-1 space-y-2">
                  {/* Konto-Auswahl */}
                  {accounts.length > 1 ? (
                    <select
                      value={selectedAccountId || ''}
                      onChange={e => setSelectedAccountId(e.target.value)}
                      className={`w-full px-3 py-1.5 rounded-lg ${c.input} text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500`}
                    >
                      {accounts.map(acc => (
                        <option key={acc.id} value={acc.id}>
                          {getAccountEmail(acc)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className={`text-sm ${c.textSecondary}`}>
                      {getAccountEmail(accounts[0]) || '–'}
                    </div>
                  )}
                  {/* Absendername-Override */}
                  <div className="flex items-center gap-2">
                    <span className={`text-xs ${c.textSecondary} flex-shrink-0`}>Angezeigter Name:</span>
                    <input
                      type="text"
                      value={senderName}
                      onChange={e => setSenderName(e.target.value)}
                      placeholder="z. B. Max Mustermann"
                      className={`flex-1 px-3 py-1 rounded ${c.input} text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500`}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* An / CC / BCC — Tag-Eingabe */}
            <div className={`${c.bgSecondary} ${c.border} border rounded-lg p-4 space-y-2`}>
              <EmailTagInput
                label="An:"
                tags={toTags}
                onChange={setToTags}
                placeholder="empfaenger@example.com — Enter oder Komma zum Hinzufügen"
                c={c}
                isLarge
              />
              <EmailTagInput
                label="CC:"
                tags={ccTags}
                onChange={setCcTags}
                placeholder="cc@example.com"
                c={c}
              />
              <EmailTagInput
                label="BCC:"
                tags={bccTags}
                onChange={setBccTags}
                placeholder="bcc@example.com"
                c={c}
              />
            </div>

            {/* Betreff */}
            <div className={`${c.bgSecondary} ${c.border} border rounded-lg p-4`}>
              <div className="flex items-center gap-3">
                <label className={`text-sm ${c.textSecondary} w-16 flex-shrink-0`}>Betreff:</label>
                <input
                  type="text"
                  value={form.subject}
                  onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                  placeholder="Betreff eingeben..."
                  className={`flex-1 px-3 py-1.5 rounded-lg ${c.input} text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500`}
                />
              </div>
            </div>

            {/* Anhänge */}
            <div className={`${c.bgSecondary} ${c.border} border rounded-lg p-4`}>
              <div className="flex items-center justify-between mb-2">
                <span className={`text-sm ${c.textSecondary} flex items-center gap-1`}><Attachment size={16} /> Anhänge</span>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className={`px-3 py-1 ${c.bgTertiary} ${c.hover} ${c.text} rounded text-xs transition-colors`}
                >
                  + Hinzufügen
                </button>
                <input ref={fileInputRef} type="file" multiple onChange={e => addFiles(Array.from(e.target.files))} className="hidden" />
              </div>
              {attachments.length === 0 ? (
                <div className={`border-2 border-dashed ${c.border} rounded-lg p-4 text-center`}>
                  <p className={`${c.textSecondary} text-xs`}>Ziehe Dateien hierher oder klicke "Hinzufügen"</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {attachments.map(att => (
                    <div key={att.id} className={`flex items-center justify-between p-2 ${c.bgTertiary} rounded-lg`}>
                      <div className="flex items-center gap-2 min-w-0">
                        {(() => { const FileIcon = getFileIcon(att.contentType, att.filename); return <FileIcon size={16} className="flex-shrink-0" />; })()}
                        <div className="min-w-0">
                          <p className={`text-xs ${c.text} truncate`}>{att.filename}</p>
                          <p className={`text-xs ${c.textSecondary}`}>{formatFileSize(att.size)}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {!att.loaded && uploadProgress[att.id] !== undefined && (
                          <div className="w-16 h-1 bg-gray-600 rounded-full">
                            <div className="h-full bg-cyan-500 rounded-full" style={{ width: `${uploadProgress[att.id]}%` }} />
                          </div>
                        )}
                        {att.loaded && <Checkmark size={16} className="text-green-400" />}
                        <button onClick={() => setAttachments(prev => prev.filter(a => a.id !== att.id))}
                          className={`p-0.5 ${c.hover} rounded text-red-400`}><Close size={16} /></button>
                      </div>
                    </div>
                  ))}
                  <p className={`text-xs ${c.textSecondary}`}>Gesamt: {formatFileSize(getTotalSize())}</p>
                </div>
              )}
            </div>

            {/* Nachricht / Editor */}
            <div className={`${c.bgSecondary} ${c.border} border rounded-lg overflow-hidden`}>
              {/* Editor-Tabs */}
              <div className={`flex items-center gap-0 border-b ${c.border} ${c.bgTertiary}`}>
                {[
                  { id: 'richtext', label: 'Bearbeiten', Icon: Edit },
                  { id: 'html',     label: 'HTML',       Icon: Code },
                  { id: 'preview',  label: 'Vorschau',   Icon: View },
                ].map(tab => {
                  const TabIcon = tab.Icon;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => switchMode(tab.id)}
                      className={`px-4 py-2 text-xs font-medium transition-colors border-b-2 inline-flex items-center gap-1 ${
                        editorMode === tab.id
                          ? 'border-cyan-500 text-cyan-400'
                          : `border-transparent ${c.textSecondary} hover:text-cyan-400`
                      }`}
                    >
                      <TabIcon size={16} /> {tab.label}
                    </button>
                  );
                })}
              </div>

              {/* Toolbar (nur im richtext-Modus) */}
              {editorMode === 'richtext' && (
                <div className={`flex flex-wrap items-center gap-1 px-3 py-2 border-b ${c.border} ${c.bg}`}>
                  {/* Überschriften */}
                  <select
                    onChange={e => applyHeading(e.target.value)}
                    defaultValue="div"
                    className={`px-2 py-1 rounded text-xs ${c.input} focus:outline-none mr-1`}
                  >
                    {HEADINGS.map(h => <option key={h.tag} value={h.tag}>{h.label}</option>)}
                  </select>

                  {/* Trennlinie */}
                  <div className={`w-px h-5 ${c.border} border-l mx-1`} />

                  {/* Format-Buttons */}
                  {TOOLBAR.map((group, gi) => (
                    <React.Fragment key={gi}>
                      {group.map((btn, bi) => {
                        const BtnIcon = btn.Icon;
                        return (
                          <button
                            key={bi}
                            onMouseDown={e => { e.preventDefault(); execFormat(btn.cmd); }}
                            title={btn.title}
                            className={`w-7 h-7 flex items-center justify-center rounded ${c.hover} ${c.textSecondary} hover:text-cyan-400 transition-colors`}
                          >
                            <BtnIcon size={16} />
                          </button>
                        );
                      })}
                      {gi < TOOLBAR.length - 1 && (
                        <div className={`w-px h-5 ${c.border} border-l mx-1`} />
                      )}
                    </React.Fragment>
                  ))}

                  <div className={`w-px h-5 ${c.border} border-l mx-1`} />

                  {/* Link */}
                  <button
                    onMouseDown={e => { e.preventDefault(); insertLink(); }}
                    title="Link einfügen"
                    aria-label="Link einfügen"
                    className={`w-7 h-7 flex items-center justify-center rounded text-xs ${c.hover} ${c.textSecondary} hover:text-cyan-400`}
                  >
                    <Link size={16} />
                  </button>

                  {/* Schriftfarbe */}
                  <div className="relative flex items-center" title="Schriftfarbe">
                    <input
                      type="color"
                      defaultValue="#ffffff"
                      onChange={e => setFontColor(e.target.value)}
                      className="w-7 h-7 rounded cursor-pointer border-0 bg-transparent p-0.5"
                      title="Schriftfarbe"
                    />
                  </div>
                </div>
              )}

              {/* Editor-Inhalt — v6.7.3: kein maxHeight/overflow mehr, Editor
                  wächst mit Inhalt, der äussere Form-Container scrollt. Vermeidet
                  doppelt verschachtelte Scrollbereiche, die sich beim Wheel anfühlen
                  als ob nichts scrollt. */}
              {editorMode === 'richtext' && (
                <div
                  ref={editorRef}
                  contentEditable
                  suppressContentEditableWarning
                  className={`w-full min-h-64 p-4 ${c.text} focus:outline-none`}
                  style={{ fontSize: '14px', lineHeight: '1.6' }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      // Standardverhalten: neuer <p>-Block statt <br>
                    }
                  }}
                />
              )}

              {editorMode === 'html' && (
                <textarea
                  value={htmlSource}
                  onChange={e => setHtmlSource(e.target.value)}
                  placeholder="<p>HTML-Quellcode eingeben...</p>"
                  className={`w-full min-h-64 p-4 ${c.input} font-mono text-xs focus:outline-none resize-none border-0`}
                  style={{ minHeight: '320px', maxHeight: '480px' }}
                />
              )}

              {editorMode === 'preview' && (
                <div className="p-4 bg-white" style={{ minHeight: '320px', maxHeight: '480px', overflowY: 'auto' }}>
                  <div
                    className="text-gray-800 text-sm"
                    dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(getPreviewHtml()) }}
                  />
                </div>
              )}
            </div>

            {/* Signatur */}
            {hasSignature && (
              <div className={`flex items-center gap-3 px-2 flex-wrap`}>
                <input
                  type="checkbox"
                  id="useSignature"
                  checked={useSignature}
                  onChange={e => setUseSignature(e.target.checked)}
                  className="w-4 h-4 rounded accent-cyan-500"
                />
                <label htmlFor="useSignature" className={`${c.textSecondary} cursor-pointer text-xs flex items-center gap-1`}><PenFountain size={16} /> Signatur anhängen</label>
                {/* Picker — nur anzeigen wenn mehr als eine Signatur konfiguriert */}
                {sigItems && sigItems.length > 1 && useSignature && (
                  <select
                    value={selectedSignatureId || (accSig?.defaultId || '')}
                    onChange={(e) => setSelectedSignatureId(e.target.value || null)}
                    className={`text-xs px-2 py-1 ${c.bgTertiary} ${c.text} ${c.border} border rounded`}
                    title="Signatur auswählen"
                  >
                    {sigItems.map(item => (
                      <option key={item.id} value={item.id}>
                        {item.name || 'Unbenannt'}{item.id === accSig?.defaultId ? ' (Standard)' : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {!hasSignature && (
              <p className={`text-xs ${c.textSecondary} text-center`}>
                Tipp: Unter Einstellungen → Signaturen kannst du E-Mail-Signaturen erstellen.
              </p>
            )}
          </div>
        </div>

      </div>

      {/* Escape schliesst die Overlays — konsistent mit der globalen Suche */}
      {(showTemplates || showCustomPaste || showDiscardConfirm) && (
        <EscapeCloser onEscape={() => {
          if (showDiscardConfirm) setShowDiscardConfirm(false);
          else if (showCustomPaste) { setShowCustomPaste(false); setCustomHtmlPaste(''); }
          else setShowTemplates(false);
        }} />
      )}

      {/* v6.8.1: Verwerfen-Bestätigung für Reply/Forward */}
      {showDiscardConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className={`${c.bgSecondary} ${c.border} border rounded-xl shadow-2xl p-6 max-w-md w-full mx-4`}>
            <h3 className={`text-lg font-semibold ${c.text} mb-2`}>Nachricht verwerfen?</h3>
            <p className={`text-sm ${c.textSecondary} mb-6`}>
              Deine angefangene Nachricht geht verloren.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDiscardConfirm(false)}
                className={`px-4 py-2 ${c.hover} ${c.border} border rounded-lg transition-colors ${c.text}`}
                autoFocus
              >
                Weiter schreiben
              </button>
              <button
                onClick={onBack}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors"
              >
                Verwerfen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Vorlagen-Panel (Overlay) */}
      {showTemplates && (
        <div className="absolute inset-0 z-40 flex items-start justify-center pt-20 bg-black/40" onClick={() => setShowTemplates(false)}>
          <div
            className={`${c.bgSecondary} ${c.border} border rounded-xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden`}
            onClick={e => e.stopPropagation()}
          >
            <div className={`px-5 py-4 border-b ${c.border} flex items-center justify-between`}>
              <h3 className={`font-semibold ${c.text} flex items-center gap-2`}><Template size={20} /> HTML-Vorlage auswählen</h3>
              <button onClick={() => setShowTemplates(false)} className={`${c.textSecondary} hover:${c.text}`}><Close size={16} /></button>
            </div>
            <div className="p-5 grid grid-cols-2 gap-3 max-h-96 overflow-y-auto">
              {HTML_TEMPLATES.map(tpl => {
                const TplIcon = tpl.Icon;
                return (
                <button
                  key={tpl.id}
                  onClick={() => insertTemplate(tpl)}
                  className={`p-4 ${c.bgTertiary} ${c.hover} rounded-xl text-left border ${c.border} transition-colors group`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <TplIcon size={20} className={c.text} />
                    <span className={`font-medium ${c.text} text-sm`}>{tpl.name}</span>
                  </div>
                  {tpl.html && (
                    <div className="bg-white rounded p-2 text-xs text-gray-700 max-h-20 overflow-hidden pointer-events-none select-none"
                      dangerouslySetInnerHTML={{ __html: tpl.html }} />
                  )}
                  {!tpl.html && (
                    <p className={`text-xs ${c.textSecondary}`}>Eigenes HTML einfügen</p>
                  )}
                </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Custom-HTML-Paste-Dialog */}
      {showCustomPaste && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className={`${c.bgSecondary} ${c.border} border rounded-xl shadow-2xl w-full max-w-2xl mx-4`}>
            <div className={`px-5 py-4 border-b ${c.border} flex items-center justify-between`}>
              <h3 className={`font-semibold ${c.text} flex items-center gap-2`}><Code size={20} /> HTML einfügen</h3>
              <button onClick={() => { setShowCustomPaste(false); setCustomHtmlPaste(''); }} className={`${c.textSecondary}`}><Close size={16} /></button>
            </div>
            <div className="p-5 space-y-4">
              <textarea
                value={customHtmlPaste}
                onChange={e => setCustomHtmlPaste(e.target.value)}
                placeholder="HTML-Code hier einfügen..."
                className={`w-full h-56 px-4 py-3 rounded-lg ${c.input} font-mono text-xs focus:outline-none focus:ring-2 focus:ring-cyan-500 resize-none`}
                autoFocus
              />
              {customHtmlPaste && (
                <div>
                  <p className={`text-xs ${c.textSecondary} mb-2`}>Vorschau:</p>
                  <div className="bg-white rounded-lg p-3 max-h-40 overflow-y-auto">
                    <div className="text-gray-800 text-sm" dangerouslySetInnerHTML={{ __html: customHtmlPaste }} />
                  </div>
                </div>
              )}
              <div className="flex gap-3 justify-end">
                <button onClick={() => { setShowCustomPaste(false); setCustomHtmlPaste(''); }}
                  className={`px-4 py-2 ${c.bgTertiary} ${c.text} rounded-lg text-sm`}>
                  Abbrechen
                </button>
                <button onClick={applyCustomHtml} disabled={!customHtmlPaste.trim()}
                  className={`px-4 py-2 ${c.accentBg} ${c.accentHover} text-white rounded-lg text-sm disabled:opacity-50`}>
                  Einfügen
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ComposeEmail;
