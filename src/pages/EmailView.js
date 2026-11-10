import React, { useState, useEffect } from 'react';
import {
  TrashCan, Email, EmailNew, Reply, ReplyAll, SendAlt, ArrowLeft, InProgress,
  WarningFilled, WarningAlt, Close, Checkmark, Download, FolderOpen, View,
  Image, DocumentPdf, DocumentBlank, Music, Video, Box, NotificationOff, Bot, Archive
} from '@carbon/icons-react';
import Attachment from '../components/PaperclipIcon';
import { useTheme, SheetTheme, SHEET_COLORS } from '../context/ThemeContext';
import { useAccounts } from '../context/AccountContext';
import MailApi from '../services/MailApi';
import LoadingSpinner from '../components/LoadingSpinner';
import EmailHtmlFrame from '../components/EmailHtmlFrame';
import EscapeCloser from '../components/EscapeCloser';
import InvitationCard from '../components/InvitationCard';

const EmailView = ({ email, onBack, onReply, onReplyAll, onForward, currentFolder = 'INBOX' }) => {
  const { currentTheme } = useTheme();
  const { activeAccountId, getActiveAccount } = useAccounts();
  // v6.11.0: Alle Mail-Aktionen laufen über die MailApi-Fassade — sie
  // entscheidet zentral Graph vs IMAP. Die frühere Pro-Aktion-Weiche hier
  // verursachte die Bugs v6.9.3 (markAsRead) und v6.9.6 (Laden/Löschen).
  const markReadFor = React.useCallback(
    (uid, isRead) => MailApi.markRead(getActiveAccount?.(), uid, isRead, currentFolder),
    [getActiveAccount, currentFolder]
  );
  const [fullEmail, setFullEmail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({});
  const [previewAttachment, setPreviewAttachment] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [isRead, setIsRead] = useState(email?.seen ?? true);
  const [unsubscribing, setUnsubscribing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [unsubscribeResult, setUnsubscribeResult] = useState(null); // { success, message } | null
  // v6.6.0: AI Smart Compose
  const [aiOpen, setAiOpen] = useState(false);
  const [aiTone, setAiTone] = useState('neutral');
  const [aiLength, setAiLength] = useState('medium');
  const [aiIntent, setAiIntent] = useState('custom');
  const [aiHint, setAiHint] = useState('');
  const [aiDraft, setAiDraft] = useState(null); // { draft, gaps, tone_used, length_used }
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const c = currentTheme.colors;
  const s = SHEET_COLORS; // v8.0: Mailinhalt liegt in jedem Theme auf einem weissen Blatt

  const handleGenerateDraft = async () => {
    if (!window.electronAPI?.aiSmartCompose) {
      setAiError('AI-API nicht verfügbar');
      return;
    }
    setAiLoading(true);
    setAiError(null);
    setAiDraft(null);
    const original = fullEmail || email;
    const r = await window.electronAPI.aiSmartCompose({
      originalEmail: {
        from: original.from || '', subject: original.subject || '',
        text: original.text || (original.html ? original.html.replace(/<[^>]+>/g, ' ') : '')
      },
      intent: aiIntent, tone: aiTone, length: aiLength, userHint: aiHint
    });
    setAiLoading(false);
    if (r?.success && r.result?.draft) {
      setAiDraft(r.result);
    } else {
      setAiError(r?.error || 'Konnte keinen Vorschlag generieren');
    }
  };

  const handleApplyDraft = () => {
    if (!aiDraft?.draft || !onReply) return;
    onReply(fullEmail || email, { aiDraft: aiDraft.draft });
    setAiOpen(false);
    setAiDraft(null);
  };

  const handleUnsubscribe = async () => {
    if (!fullEmail?.listUnsubscribe || unsubscribing) return;
    const lu = fullEmail.listUnsubscribe;
    const askConfirm = !lu.oneClick; // bei one-click direkt, sonst kurze Bestätigung
    if (askConfirm) {
      const ok = window.confirm(
        'Vom Newsletter / dieser Liste abmelden?\n\n' +
        (lu.http ? 'Es wird ' + (lu.mailto ? 'eine Abmeldungs-Mail gesendet (oder eine Webseite geöffnet).' : 'eine Webseite geöffnet.') : 'Es wird eine Abmeldungs-Mail gesendet.')
      );
      if (!ok) return;
    }
    setUnsubscribing(true);
    setUnsubscribeResult(null);
    try {
      const result = await window.electronAPI.unsubscribeFromList({
        listUnsubscribe: lu, accountId: activeAccountId
      });
      setUnsubscribeResult(result);
    } catch (e) {
      setUnsubscribeResult({ success: false, error: e.message });
    } finally {
      setUnsubscribing(false);
    }
  };

  useEffect(() => {
    const fetchFullEmail = async () => {
      if (!email) return;
      
      // If email already has html/text, use it directly (from split view)
      if (email.html || email.text) {
        setFullEmail(email);
        setIsRead(email.seen ?? true);
        setLoading(false);
        
        // Mark as read on open if setting is "onOpen" (v1.8.1)
        const markMode = localStorage.getItem('emailSettings.markAsReadMode') || 'onClick';
        if (markMode === 'onOpen' && !email.seen && window.electronAPI && activeAccountId) {
          markReadFor(email.uid, true);
          setIsRead(true);
        }
        return;
      }
      
      setLoading(true);
      setError(null);

      try {
        if (!window.electronAPI) {
          setFullEmail({
            ...email,
            html: '<p>Dies ist eine Demo-E-Mail.</p>',
            text: 'Dies ist eine Demo-E-Mail.',
            attachments: []
          });
          setLoading(false);
          return;
        }

        const result = await MailApi.fetchOne(getActiveAccount?.(), email.uid, currentFolder);
        
        if (result.success) {
          setFullEmail(result.email);

          // Volltext-Index mit komplettem Body aktualisieren
          if (window.electronAPI?.searchIndexEmail) {
            window.electronAPI.searchIndexEmail({
              accountId: activeAccountId,
              folder: currentFolder,
              uid: email.uid,
              messageId: result.email.messageId || null,
              subject: result.email.subject || '',
              from: result.email.from || '',
              to: result.email.to || '',
              cc: result.email.cc || '',
              date: result.email.date || null,
              body: result.email.text || '',
              html: result.email.html || null,
              hasAttachments: (result.email.attachments || []).length > 0,
              seen: true
            }).catch(() => {});
          }

          // Mark as read on open if setting is "onOpen" (v1.8.1)
          const markMode = localStorage.getItem('emailSettings.markAsReadMode') || 'onClick';
          if (markMode === 'onOpen' && !email.seen) {
            markReadFor(email.uid, true);
            setIsRead(true);
          }
        } else {
          setError(result.error);
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchFullEmail();
  }, [email, activeAccountId, currentFolder]);

  // === EMAIL ACTIONS ===
  // v6.10.0: Outlook-Semantik — ausserhalb des Papierkorbs in den Papierkorb
  // verschieben; nur dort selbst endgültig löschen (mit Bestätigung).
  // Exakter Vergleich des letzten Pfadsegments — Substring hätte harmlose
  // Ordner wie "Gelöschte Projekte" als Papierkorb behandelt.
  const TRASH_NAMES = ['trash', 'deleted items', 'deleted', 'deleted messages', 'papierkorb', 'gelöschte elemente', 'geloeschte elemente', 'bin', 'corbeille', 'cestino', 'papelera'];
  const isInTrashFolder = TRASH_NAMES.includes(String(currentFolder || '').split(/[./]/).pop().toLowerCase());

  const handleDelete = async () => {
    if (!window.electronAPI || !activeAccountId || !email?.uid) return;
    setShowDeleteConfirm(false);
    setActionLoading('delete');
    try {
      const acc = getActiveAccount?.();
      const result = isInTrashFolder
        ? await MailApi.deletePermanent(acc, email.uid, currentFolder)
        : await MailApi.trash(acc, email.uid, currentFolder);
      if (result.success) {
        onBack?.(); // Go back to list after deletion
      } else {
        setActionError('Fehler beim Löschen: ' + result.error);
      }
    } catch (err) {
      setActionError('Fehler: ' + err.message);
    }
    setActionLoading(null);
  };

  // v6.10.0: Archivieren aus der Vollansicht
  const handleArchive = async () => {
    if (!window.electronAPI || !activeAccountId || !email?.uid) return;
    setActionLoading('archive');
    try {
      const result = await MailApi.archive(getActiveAccount?.(), email.uid, currentFolder);
      if (result.success) {
        onBack?.();
      } else {
        setActionError('Archivieren fehlgeschlagen: ' + (result?.error || 'unbekannt'));
      }
    } catch (err) {
      setActionError('Archivieren fehlgeschlagen: ' + err.message);
    }
    setActionLoading(null);
  };

  const handleToggleRead = async () => {
    if (!window.electronAPI || !activeAccountId || !email?.uid) return;
    
    setActionLoading('read');
    try {
      const newReadState = !isRead;
      const result = await markReadFor(email.uid, newReadState);
      if (result.success) {
        setIsRead(newReadState);
      } else {
        setActionError('Fehler: ' + result.error);
      }
    } catch (err) {
      setActionError('Fehler: ' + err.message);
    }
    setActionLoading(null);
  };

  const handleReply = () => {
    if (onReply) {
      onReply(fullEmail || email);
    }
  };

  const handleReplyAll = () => {
    if (onReplyAll) {
      onReplyAll(fullEmail || email);
    } else if (onReply) {
      // Fallback to regular reply if replyAll not provided
      onReply(fullEmail || email, { replyAll: true });
    }
  };

  const handleForward = () => {
    if (onForward) {
      onForward(fullEmail || email);
    } else if (onReply) {
      // Fallback to regular reply if forward not provided
      onReply(fullEmail || email, { forward: true });
    }
  };

  const formatDate = (date) => {
    return new Date(date).toLocaleString('de-DE', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // v7.2.0: Der Kalenderteil einer Einladung wird in der Einladungskarte
  // angeboten und darum aus dem Anhang-Banner ausgeblendet. Der ursprüngliche
  // Index bleibt am Objekt, damit die Fortschrittsanzeige weiter stimmt.
  const attachmentsWithIndex = React.useMemo(
    () => (fullEmail?.attachments || []).map((att, index) => ({ ...att, index })),
    [fullEmail]
  );
  const calendarAttachment = React.useMemo(
    () => attachmentsWithIndex.find(a => a.isCalendar && a.content) || null,
    [attachmentsWithIndex]
  );
  const visibleAttachments = React.useMemo(
    () => (fullEmail?.invitation ? attachmentsWithIndex.filter(a => !a.isCalendar) : attachmentsWithIndex),
    [attachmentsWithIndex, fullEmail]
  );

  const downloadAttachment = async (attachment, index, andOpen = false) => {
    setDownloadProgress(prev => ({ ...prev, [index]: 'downloading' }));
    try {
      const result = await window.electronAPI.saveAllAttachments([attachment]);
      const saved = result?.results?.[0];
      if (saved?.success) {
        setDownloadProgress(prev => ({ ...prev, [index]: 'done' }));
        if (andOpen && saved.path) {
          await window.electronAPI.openFile(saved.path);
        }
        setTimeout(() => setDownloadProgress(prev => ({ ...prev, [index]: null })), 2000);
      } else {
        setDownloadProgress(prev => ({ ...prev, [index]: 'error' }));
      }
    } catch (e) {
      setDownloadProgress(prev => ({ ...prev, [index]: 'error' }));
    }
  };

  const downloadAllAttachments = async () => {
    // v7.2.0: nur die sichtbaren Anhänge — der Kalenderteil einer Einladung
    // hat seinen eigenen Knopf in der Einladungskarte und wäre sonst ein
    // ungefragter Extra-Download hinter der Anzahl im Banner.
    if (!visibleAttachments.length) return;

    setDownloadingAll(true);

    try {
      if (window.electronAPI?.saveAllAttachments) {
        const result = await window.electronAPI.saveAllAttachments(visibleAttachments);
        if (result.success) {
          visibleAttachments.forEach((att) => {
            setDownloadProgress(prev => ({ ...prev, [att.index]: 'done' }));
          });
          setTimeout(() => setDownloadProgress({}), 2000);
        }
      } else {
        for (const att of visibleAttachments) {
          await downloadAttachment(att, att.index);
          await new Promise(r => setTimeout(r, 500));
        }
      }
    } catch (e) {
      console.error('Download error:', e);
    }
    
    setDownloadingAll(false);
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // Anhänge ohne Content-Type kommen vor (z.B. eingebettete Kalenderteile) —
  // ohne den String-Fallback riss die ganze Mailansicht mit einem TypeError ab.
  const getFileIcon = (rawType, filename) => {
    const contentType = String(rawType || '');
    if (contentType.startsWith('image/')) return Image;
    if (contentType === 'application/pdf') return DocumentPdf;
    if (contentType.includes('zip') || contentType.includes('archive')) return Box;
    if (contentType.startsWith('video/')) return Video;
    if (contentType.startsWith('audio/')) return Music;
    return DocumentBlank;
  };

  const isPreviewable = (rawType) => {
    const contentType = String(rawType || '');
    return contentType.startsWith('image/') || contentType === 'application/pdf';
  };

  if (loading) {
    return (
      <div className={`flex-1 flex items-center justify-center ${c.bg}`}>
        <LoadingSpinner message="E-Mail wird geladen..." />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex-1 flex flex-col items-center justify-center p-8 ${c.bg}`}>
        <WarningFilled size={48} className="text-red-400 mb-4" />
        <h3 className={`text-lg font-medium ${c.text} mb-2`}>Fehler beim Laden</h3>
        <p className={`${c.textSecondary} text-center max-w-md mb-4`}>{error}</p>
        <button
          onClick={onBack}
          className={`px-4 py-2 ${c.accentBg} ${c.accentHover} text-white rounded-md text-sm font-medium transition-colors`}
        >
          Zurück zum Posteingang
        </button>
      </div>
    );
  }

  if (!fullEmail) return null;

  return (
    <div className={`flex-1 flex flex-col overflow-hidden ${c.bg}`}>
      {/* Kopfleiste (v8.0): wie die Kommandoleiste im Posteingang */}
      <header className={`h-12 flex-shrink-0 px-2 ${c.border} border-b ${c.bgSecondary} flex items-center gap-0.5`} role="toolbar" aria-label="Aktionen">
        <button onClick={onBack} className={`cm-cmd ${c.text} ${c.hover}`} title="Zurück zur Liste">
          <ArrowLeft size={18} className={c.textSecondary} />
          <span className="hidden xl:inline">Zurück</span>
        </button>
        <div className={`w-px h-6 mx-2 ${c.border} border-l`} />
        <button
          onClick={() => (isInTrashFolder ? setShowDeleteConfirm(true) : handleDelete())}
          disabled={actionLoading === 'delete'}
          className={`cm-cmd ${c.text} ${c.hover} hover:text-ms-red`}
          title="Löschen"
          aria-label="Löschen"
        >
          {actionLoading === 'delete' ? <InProgress size={18} className="animate-spin" /> : <TrashCan size={18} className={c.textSecondary} />}
          <span className="hidden xl:inline">Löschen</span>
        </button>
        <button
          onClick={handleArchive}
          disabled={actionLoading === 'archive'}
          className={`cm-cmd ${c.text} ${c.hover}`}
          title="Archivieren"
          aria-label="Archivieren"
        >
          {actionLoading === 'archive' ? <InProgress size={18} className="animate-spin" /> : <Archive size={18} className={c.textSecondary} />}
          <span className="hidden xl:inline">Archivieren</span>
        </button>
        <div className={`w-px h-6 mx-2 ${c.border} border-l`} />
        <button onClick={handleReply} className={`cm-cmd ${c.text} ${c.hover}`} title="Antworten">
          <Reply size={18} className={c.textSecondary} />
          <span className="hidden xl:inline">Antworten</span>
        </button>
        <button onClick={handleReplyAll} className={`cm-cmd ${c.text} ${c.hover}`} title="Allen antworten">
          <ReplyAll size={18} className={c.textSecondary} />
          <span className="hidden xl:inline">Allen antworten</span>
        </button>
        <button onClick={handleForward} className={`cm-cmd ${c.text} ${c.hover}`} title="Weiterleiten">
          <SendAlt size={18} className={c.textSecondary} />
          <span className="hidden xl:inline">Weiterleiten</span>
        </button>
        <div className={`w-px h-6 mx-2 ${c.border} border-l`} />
        <button
          onClick={handleToggleRead}
          disabled={actionLoading === 'read'}
          className={`cm-cmd ${c.text} ${c.hover}`}
          title={isRead ? 'Als ungelesen markieren' : 'Als gelesen markieren'}
        >
          {actionLoading === 'read'
            ? <InProgress size={18} className="animate-spin" />
            : isRead ? <EmailNew size={18} className={c.textSecondary} /> : <Email size={18} className={c.textSecondary} />}
          <span className="hidden xl:inline">{isRead ? 'Als ungelesen' : 'Als gelesen'}</span>
        </button>
        {/* v6.6.0: AI Antwort vorschlagen */}
        <button
          onClick={() => setAiOpen(v => !v)}
          className={`cm-cmd ${aiOpen ? `${c.selected} ${c.accent}` : `${c.text} ${c.hover}`}`}
          title="Antwort vorschlagen (KI)"
          aria-pressed={aiOpen}
        >
          <Bot size={18} className={aiOpen ? '' : c.textSecondary} />
          <span className="hidden xl:inline">KI-Antwort</span>
        </button>
      </header>

      <SheetTheme>
        <div className="cm-sheet flex-1 flex flex-col overflow-hidden min-h-0">
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-5xl mx-auto px-8 py-6">
      {/* v6.6.0: Smart-Compose Panel */}
      {aiOpen && (
        <div className={`mb-4 px-4 py-3 rounded-lg ${s.bgSecondary} ${s.border} border`}>
          <div className="flex items-center justify-between mb-3">
            <h3 className={`text-sm font-medium ${s.text} flex items-center gap-2`}>
              <Bot size={16} className={s.accent} /> Antwort vorschlagen
            </h3>
            <button onClick={() => { setAiOpen(false); setAiDraft(null); setAiError(null); }} className={`p-1 ${s.hover} rounded ${s.textSecondary}`}>
              <Close size={16} />
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-3">
            <div>
              <label className={`block text-xs ${s.textSecondary} mb-1`}>Absicht</label>
              <select
                value={aiIntent}
                onChange={(e) => setAiIntent(e.target.value)}
                className={`w-full px-2 py-1.5 ${s.bgTertiary} ${s.text} ${s.border} border rounded-md text-sm outline-none`}
              >
                <option value="custom">Frei</option>
                <option value="accept">Zusagen</option>
                <option value="decline">Ablehnen</option>
                <option value="defer">Verschieben</option>
                <option value="ask_clarification">Nachfragen</option>
                <option value="acknowledge">Bestätigen</option>
              </select>
            </div>
            <div>
              <label className={`block text-xs ${s.textSecondary} mb-1`}>Tonfall</label>
              <select
                value={aiTone}
                onChange={(e) => setAiTone(e.target.value)}
                className={`w-full px-2 py-1.5 ${s.bgTertiary} ${s.text} ${s.border} border rounded-md text-sm outline-none`}
              >
                <option value="formal">Formell</option>
                <option value="neutral">Neutral</option>
                <option value="casual">Locker</option>
              </select>
            </div>
            <div>
              <label className={`block text-xs ${s.textSecondary} mb-1`}>Länge</label>
              <select
                value={aiLength}
                onChange={(e) => setAiLength(e.target.value)}
                className={`w-full px-2 py-1.5 ${s.bgTertiary} ${s.text} ${s.border} border rounded-md text-sm outline-none`}
              >
                <option value="short">Kurz</option>
                <option value="medium">Mittel</option>
                <option value="long">Ausführlich</option>
              </select>
            </div>
          </div>

          <input
            type="text"
            value={aiHint}
            onChange={(e) => setAiHint(e.target.value)}
            placeholder="Optional: Hinweis (z.B. 'Termin am Donnerstag 14h zusagen')"
            className={`w-full px-3 py-2 ${s.bgTertiary} ${s.text} ${s.border} border rounded-md text-sm outline-none mb-3`}
          />

          <button
            onClick={handleGenerateDraft}
            disabled={aiLoading}
            className={`px-3 py-1.5 ${s.accentBg} ${s.accentHover} text-white text-sm rounded-md font-medium flex items-center gap-2 disabled:opacity-50`}
          >
            {aiLoading ? <InProgress size={14} className="animate-spin" /> : <Bot size={14} />}
            {aiLoading ? 'Generiere…' : (aiDraft ? 'Neu generieren' : 'Vorschlag generieren')}
          </button>

          {aiError && (
            <div className="mt-3 p-2 cm-banner cm-banner-red text-sm">{aiError}</div>
          )}

          {aiDraft && (
            <div className="mt-3 space-y-2">
              <textarea
                value={aiDraft.draft}
                onChange={(e) => setAiDraft({ ...aiDraft, draft: e.target.value })}
                rows={Math.min(15, Math.max(5, (aiDraft.draft.match(/\n/g) || []).length + 2))}
                className={`w-full px-3 py-2 ${s.bgTertiary} ${s.text} ${s.border} border rounded-md text-sm outline-none font-sans resize-y whitespace-pre-wrap`}
              />
              {aiDraft.gaps?.length > 0 && (
                <div className="p-2 cm-banner cm-banner-amber text-xs block">
                  <strong>Lücken die du noch ergänzen musst:</strong>
                  <ul className="list-disc list-inside mt-1">
                    {aiDraft.gaps.map((g, i) => <li key={i}>{g}</li>)}
                  </ul>
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleApplyDraft}
                  className={`px-3 py-1.5 ${s.accentBg} ${s.accentHover} text-white text-sm rounded-lg flex items-center gap-2`}
                >
                  <Checkmark size={14} /> Übernehmen + öffnen
                </button>
                <button
                  onClick={() => { navigator.clipboard.writeText(aiDraft.draft); }}
                  className={`px-3 py-1.5 ${s.bgTertiary} ${s.hover} ${s.text} text-sm rounded-lg`}
                >
                  In Zwischenablage
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Action Error Banner */}
      {actionError && (
        <div className="mb-4 p-3 cm-banner cm-banner-red justify-between">
          <span className="text-sm">{actionError}</span>
          <button onClick={() => setActionError(null)} className="opacity-70 hover:opacity-100 ml-3"><Close size={16} /></button>
        </div>
      )}

      {/* List-Unsubscribe Banner */}
      {fullEmail?.listUnsubscribe && !unsubscribeResult && (
        <div className="mb-4 px-4 py-3 cm-banner cm-banner-blue justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <NotificationOff size={20} className="flex-shrink-0" />
            <div className="min-w-0">
              <p className={`text-sm font-medium ${s.text}`}>Newsletter / Liste</p>
              <p className={`text-xs ${s.textSecondary}`}>
                Diese E-Mail enthält einen Abmeldungs-Hinweis ({fullEmail.listUnsubscribe.oneClick ? 'One-Click' : (fullEmail.listUnsubscribe.http ? 'Web' : 'E-Mail')}).
              </p>
            </div>
          </div>
          <button
            onClick={handleUnsubscribe}
            disabled={unsubscribing}
            className="px-4 py-1.5 bg-ms-blue hover:bg-ms-blue-dark disabled:opacity-50 text-white rounded-md text-sm font-medium transition-colors inline-flex items-center gap-2 flex-shrink-0"
          >
            {unsubscribing ? <><InProgress size={16} className="animate-spin" /> Melde ab…</> : <><NotificationOff size={16} /> Abmelden</>}
          </button>
        </div>
      )}

      {/* Unsubscribe Result */}
      {unsubscribeResult && (
        <div className={`mb-4 px-4 py-3 rounded-lg flex items-center justify-between gap-4 ${
          unsubscribeResult.success
            ? 'cm-banner cm-banner-green'
            : 'cm-banner cm-banner-red'
        }`}>
          <div className="flex items-center gap-3 min-w-0">
            {unsubscribeResult.success
              ? <Checkmark size={20} className="flex-shrink-0" />
              : <WarningAlt size={20} className="flex-shrink-0" />}
            <span className="text-sm">
              {unsubscribeResult.success ? unsubscribeResult.message : (unsubscribeResult.error || 'Abmeldung fehlgeschlagen')}
            </span>
          </div>
          <button onClick={() => setUnsubscribeResult(null)} className="opacity-70 hover:opacity-100 ml-2"><Close size={16} /></button>
        </div>
      )}

      {/* Kopf der Mail: Betreff · Absender · Empfänger · Datum */}
      <h1 className={`text-2xl font-semibold ${s.text} leading-snug break-words mb-4`}>
        {fullEmail.subject || '(Kein Betreff)'}
      </h1>
      <div className={`flex items-start gap-3 pb-5 border-b ${s.border}`}>
        {(() => {
          const raw = String(fullEmail.from || '').trim();
          const m = raw.match(/^"?([^"<]*)"?\s*<([^>]+)>/);
          const name = (m ? (m[1] || '').trim() : raw.replace(/^["']+|["']+$/g, '')) || (m ? m[2] : raw);
          const addr = m ? m[2].trim() : '';
          return (
            <>
              <div className={`w-11 h-11 ${s.accentBg} rounded-full flex items-center justify-center flex-shrink-0`}>
                <span className="text-white font-semibold text-base">{(name || '?').charAt(0).toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-x-3 flex-wrap">
                  <span className={`text-[15px] font-semibold ${s.text} truncate min-w-[10rem]`}>{name}</span>
                  <span className={`text-xs ${s.textSecondary} flex-shrink-0`}>{formatDate(fullEmail.date)}</span>
                </div>
                {addr && addr !== name && <div className={`text-xs ${s.textSecondary} truncate`}>{addr}</div>}
          <div className={`text-xs ${s.textSecondary} mt-0.5 break-words`}>
            <span className="font-medium">An: </span>{fullEmail.to}
            {fullEmail.cc && <><span className="font-medium"> · Cc: </span>{fullEmail.cc}</>}
          </div>
          {!isRead && (
            <span className="cm-badge cm-badge-blue mt-1.5"><span>Ungelesen</span></span>
          )}
              </div>
            </>
          );
        })()}
      </div>

      {/* E-Mail Inhalt */}
      <div className="pt-5">
          {/* v7.2.0: Einladung zuoberst */}
          {fullEmail.invitation && (
            <InvitationCard
              invitation={fullEmail.invitation}
              account={getActiveAccount?.()}
              icsAttachment={calendarAttachment}
              icsState={calendarAttachment ? (downloadProgress[calendarAttachment.index] === 'downloading' ? 'saving' : downloadProgress[calendarAttachment.index]) : null}
              onSaveIcs={() => calendarAttachment && downloadAttachment(calendarAttachment, calendarAttachment.index, false)}
              onOpenIcs={() => calendarAttachment && downloadAttachment(calendarAttachment, calendarAttachment.index, true)}
            />
          )}

          {/* v6.14.0: Anhänge über dem Mailtext — gut sichtbar, aber ruhig */}
          {visibleAttachments.length > 0 && (
            <div className="mb-5 rounded-lg border border-[#f2dd86] bg-[#fff8df] p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-[#7a5a00] flex items-center gap-2">
                  <Attachment size={16} />
                  {visibleAttachments.length === 1 ? '1 Anhang' : `${visibleAttachments.length} Anhänge`}
                </h3>
                <button
                  onClick={downloadAllAttachments}
                  disabled={downloadingAll}
                  className={`px-3 py-1 ${s.accentBg} ${s.accentHover} text-white text-sm rounded-md font-medium transition-colors disabled:opacity-50 flex items-center gap-2`}
                >
                  {downloadingAll
                    ? <><InProgress size={16} className="animate-spin" /> Lade…</>
                    : <><Download size={16} /> Alle herunterladen</>}
                </button>
              </div>

              <div className="grid gap-2">
                {visibleAttachments.map((att) => {
                  const index = att.index;
                  return (
                  <div
                    key={`${fullEmail.uid}-${att.filename}-${index}`}
                    className={`bg-white rounded-md border ${s.border} overflow-hidden`}
                  >
                    {att.contentType?.startsWith('image/') && (
                      <div
                        className={`w-full h-32 ${s.bgTertiary} flex items-center justify-center cursor-pointer`}
                        onClick={() => setPreviewAttachment(att)}
                      >
                        <img
                          src={`data:${att.contentType};base64,${att.content}`}
                          alt={att.filename}
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>
                    )}

                    {att.contentType === 'application/pdf' && (
                      <div
                        className={`w-full h-24 ${s.bgTertiary} flex items-center justify-center cursor-pointer`}
                        onClick={() => setPreviewAttachment(att)}
                      >
                        <div className="text-center">
                          <DocumentPdf size={28} className={`mx-auto mb-1 ${s.textSecondary}`} />
                          <span className={`text-xs ${s.textSecondary}`}>Klicken für Vorschau</span>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between px-3 py-2">
                      <div className="flex items-center gap-3 min-w-0">
                        {(() => { const FileIcon = getFileIcon(att.contentType, att.filename); return <FileIcon size={20} className={`flex-shrink-0 ${s.textSecondary}`} />; })()}
                        <div className="min-w-0">
                          <p className={`text-sm ${s.text} truncate`}>{att.filename}</p>
                          <p className={`text-xs ${s.textSecondary}`}>
                            {formatFileSize(att.size)} • {att.contentType?.split('/')[1]?.toUpperCase() || 'Datei'}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {downloadProgress[index] === 'done' ? (
                          <span className="text-green-600 text-sm flex items-center gap-1"><Checkmark size={16} /> Geladen</span>
                        ) : downloadProgress[index] === 'downloading' ? (
                          <InProgress size={16} className={`${s.accent} animate-spin`} />
                        ) : downloadProgress[index] === 'error' ? (
                          <span className="text-ms-red text-sm flex items-center gap-1"><Close size={16} /> Fehler</span>
                        ) : (
                          <>
                            {isPreviewable(att.contentType) && (
                              <button
                                onClick={() => setPreviewAttachment(att)}
                                className={`px-2.5 py-1 border ${s.border} ${s.hover} ${s.text} rounded-md text-sm transition-colors inline-flex items-center gap-1`}
                              >
                                <View size={16} /> Vorschau
                              </button>
                            )}
                            <button
                              onClick={() => downloadAttachment(att, index, false)}
                              className={`px-2.5 py-1 border ${s.border} ${s.hover} ${s.accent} rounded-md text-sm transition-colors flex items-center gap-1`}
                            >
                              <Download size={16} /> Speichern
                            </button>
                            <button
                              onClick={() => downloadAttachment(att, index, true)}
                              className={`px-2.5 py-1 border ${s.border} ${s.hover} ${s.text} rounded-md text-sm transition-colors flex items-center gap-1`}
                            >
                              <FolderOpen size={16} /> Öffnen
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  );
                })}
              </div>
            </div>
          )}

          {fullEmail.html ? (
            <EmailHtmlFrame html={fullEmail.html} />
          ) : (
            <div className={`whitespace-pre-wrap text-sm leading-relaxed ${s.text}`}>
              {fullEmail.text}
            </div>
          )}
      </div>
            </div>
          </div>
        </div>
      </SheetTheme>

      {/* v6.8.1: Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <EscapeCloser onEscape={() => setShowDeleteConfirm(false)} />
          <div className={`${c.popover} border ${c.border} rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl`}>
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 rounded-full" style={{ background: 'var(--cm-badge-red-bg)' }}>
                <TrashCan size={24} className="text-ms-red" />
              </div>
              <div className="min-w-0">
                <h3 className={`text-lg font-semibold ${c.text}`}>E-Mail löschen?</h3>
                <p className={`text-sm ${c.textSecondary} truncate`}>{fullEmail?.subject || email?.subject || ''}</p>
              </div>
            </div>
            <p className={`text-sm ${c.textSecondary} mb-6`}>
              {/* v6.10.0: Dialog erscheint nur noch im Papierkorb — dort ist Löschen endgültig */}
              Die E-Mail wird endgültig gelöscht und kann nicht wiederhergestellt werden.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className={`px-4 py-2 ${c.hover} ${c.border} border rounded-lg transition-colors ${c.text}`}
                autoFocus
              >
                Abbrechen
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-lg transition-colors flex items-center gap-2"
              >
                <TrashCan size={16} />
                Löschen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Attachment Preview Modal */}
      {previewAttachment && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-8"
          onClick={() => setPreviewAttachment(null)}
        >
          <EscapeCloser onEscape={() => setPreviewAttachment(null)} />
          <div 
            className={`max-w-4xl max-h-full ${c.popover} border ${c.border} rounded-xl overflow-hidden`}
            onClick={e => e.stopPropagation()}
          >
            <div className={`flex items-center justify-between p-4 ${c.border} border-b`}>
              <h3 className={`font-medium ${c.text}`}>{previewAttachment.filename}</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => downloadAttachment(previewAttachment, fullEmail?.attachments?.indexOf(previewAttachment) ?? -1)}
                  className={`px-3 py-1 ${c.accentBg} ${c.accentHover} text-white rounded-md text-sm transition-colors flex items-center gap-1`}
                >
                  <Download size={16} /> Download
                </button>
                <button
                  onClick={() => setPreviewAttachment(null)}
                  className={`p-2 ${c.hover} rounded-lg transition-colors ${c.textSecondary}`}
                >
                  <Close size={16} />
                </button>
              </div>
            </div>
            <div className="p-4 max-h-[70vh] overflow-auto bg-gray-900">
              {previewAttachment.contentType?.startsWith('image/') ? (
                <img 
                  src={`data:${previewAttachment.contentType};base64,${previewAttachment.content}`}
                  alt={previewAttachment.filename}
                  className="max-w-full mx-auto"
                />
              ) : previewAttachment.contentType === 'application/pdf' ? (
                <iframe
                  src={`data:application/pdf;base64,${previewAttachment.content}`}
                  className="w-full h-[60vh]"
                  title={previewAttachment.filename}
                />
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EmailView;
