import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useTheme } from '../context/ThemeContext';
import { useAccounts } from '../context/AccountContext';
import { Edit, Portfolio, PenFountain, Checkmark, Link, Image, TrashCan, Email, Add, Star, StarFilled, Information } from '@carbon/icons-react';
import UrlPromptDialog from '../components/UrlPromptDialog';

// Datenformat:
//   signatures[accountId] = {
//     enabled: boolean,
//     defaultId: string|null,
//     items: [{ id, name, html, text }],
//     // Top-level (Backward-Compat für ComposeEmail): zeigt auf Default-Item
//     html: string, text: string, name: string
//   }

function genId() {
  return 'sig_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

// Migrationslogik: alte Form { enabled, html, text, name } → neue Form mit items[]
function migrateAccountSignature(sig) {
  if (!sig) return { enabled: false, defaultId: null, items: [], html: '', text: '', name: '' };
  if (Array.isArray(sig.items)) {
    // Bereits neues Format — nur sicherstellen dass top-level mit Default sync ist
    const def = sig.items.find(i => i.id === sig.defaultId) || sig.items[0] || null;
    return {
      enabled: !!sig.enabled,
      defaultId: def?.id || null,
      items: sig.items,
      html: def?.html || '',
      text: def?.text || '',
      name: def?.name || ''
    };
  }
  // Alt → neu konvertieren
  if (sig.html || sig.text || sig.name) {
    const id = genId();
    return {
      enabled: !!sig.enabled,
      defaultId: id,
      items: [{ id, name: sig.name || 'Standard', html: sig.html || '', text: sig.text || '' }],
      html: sig.html || '',
      text: sig.text || '',
      name: sig.name || 'Standard'
    };
  }
  return { enabled: false, defaultId: null, items: [], html: '', text: '', name: '' };
}

function SignatureEditor() {
  const { currentTheme } = useTheme();
  const { accounts } = useAccounts();
  const c = currentTheme.colors;

  const [signatures, setSignatures] = useState({}); // {accountId: AccountSignatures}
  const [selectedAccountId, setSelectedAccountId] = useState(null);
  const [activeSignatureId, setActiveSignatureId] = useState(null);
  const [saved, setSaved] = useState(false);
  const [editorMode, setEditorMode] = useState('visual');
  const [showPlaceholderHelp, setShowPlaceholderHelp] = useState(false);
  const editorRef = useRef(null);
  // v6.9.6: URL-Dialog (Ersatz für window.prompt, das Electron nicht kennt);
  // mode: 'link' | 'image'. Selektion wird gesichert, weil der Dialog den
  // Fokus stiehlt und execCommand sie sonst verliert.
  const [urlDialogMode, setUrlDialogMode] = useState(null);
  const savedSelectionRef = useRef(null);

  useEffect(() => {
    loadSignatures();
  }, []);

  useEffect(() => {
    if (accounts.length > 0 && !selectedAccountId) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts, selectedAccountId]);

  // Beim Wechseln des Kontos: erste/Default-Signatur aktiv setzen
  useEffect(() => {
    if (!selectedAccountId) { setActiveSignatureId(null); return; }
    const accSig = signatures[selectedAccountId];
    if (!accSig || !Array.isArray(accSig.items) || accSig.items.length === 0) {
      setActiveSignatureId(null);
      return;
    }
    const targetId = accSig.defaultId && accSig.items.some(i => i.id === accSig.defaultId)
      ? accSig.defaultId
      : accSig.items[0].id;
    setActiveSignatureId(targetId);
  }, [selectedAccountId, signatures]);

  const loadSignatures = async () => {
    if (window.electronAPI?.loadSignatures) {
      const result = await window.electronAPI.loadSignatures();
      if (result.success) {
        const raw = result.signatures || {};
        const migrated = {};
        let didMigrate = false;
        for (const [accId, sig] of Object.entries(raw)) {
          const migrated_ = migrateAccountSignature(sig);
          if (sig && !Array.isArray(sig.items)) didMigrate = true;
          migrated[accId] = migrated_;
        }
        setSignatures(migrated);
        if (didMigrate) {
          // Persistiere die migrierten Daten direkt
          window.electronAPI?.saveSignatures?.(migrated);
        }
      }
    }
  };

  const persistSignatures = async (next) => {
    setSignatures(next);
    if (window.electronAPI?.saveSignatures) {
      await window.electronAPI.saveSignatures(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  const accountSignatures = useMemo(() => {
    return signatures[selectedAccountId] || { enabled: false, defaultId: null, items: [] };
  }, [signatures, selectedAccountId]);

  const activeItem = useMemo(() => {
    return accountSignatures.items.find(i => i.id === activeSignatureId) || null;
  }, [accountSignatures, activeSignatureId]);

  // Sync top-level Felder (Backward-Compat) mit Default-Item
  const buildAccountSig = (items, defaultId, enabled) => {
    const def = items.find(i => i.id === defaultId) || items[0] || null;
    return {
      enabled,
      defaultId: def?.id || null,
      items,
      html: def?.html || '',
      text: def?.text || '',
      name: def?.name || ''
    };
  };

  const updateAccountSignatures = (mutator) => {
    const cur = accountSignatures;
    const next = mutator({ ...cur, items: [...cur.items] });
    const synced = buildAccountSig(next.items, next.defaultId, next.enabled);
    persistSignatures({ ...signatures, [selectedAccountId]: synced });
  };

  const updateActiveItem = (updates) => {
    if (!activeItem) return;
    updateAccountSignatures(s => {
      s.items = s.items.map(i => i.id === activeItem.id ? { ...i, ...updates } : i);
      return s;
    });
  };

  const addNewSignature = (preset = null) => {
    const id = genId();
    const item = preset
      ? { id, name: preset.name, html: preset.html, text: preset.text }
      : { id, name: `Signatur ${accountSignatures.items.length + 1}`, html: '', text: '' };
    updateAccountSignatures(s => {
      s.items.push(item);
      // Erste Signatur wird automatisch Default
      if (!s.defaultId) s.defaultId = id;
      return s;
    });
    setActiveSignatureId(id);
  };

  const deleteSignature = (id) => {
    updateAccountSignatures(s => {
      s.items = s.items.filter(i => i.id !== id);
      if (s.defaultId === id) s.defaultId = s.items[0]?.id || null;
      return s;
    });
    if (activeSignatureId === id) {
      setActiveSignatureId(accountSignatures.items.find(i => i.id !== id)?.id || null);
    }
  };

  const setAsDefault = (id) => {
    updateAccountSignatures(s => {
      s.defaultId = id;
      return s;
    });
  };

  const setEnabled = (enabled) => {
    updateAccountSignatures(s => {
      s.enabled = enabled;
      return s;
    });
  };

  const applyFormat = (command, value = null) => {
    document.execCommand(command, false, value);
    updateContentFromEditor();
  };

  const updateContentFromEditor = () => {
    if (editorRef.current && activeItem) {
      const html = editorRef.current.innerHTML;
      const text = editorRef.current.innerText;
      updateActiveItem({ html, text });
    }
  };

  const handleHtmlCodeChange = (e) => {
    if (!activeItem) return;
    const html = e.target.value;
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    updateActiveItem({ html, text: tmp.innerText });
    if (editorRef.current) editorRef.current.innerHTML = html;
  };

  const switchMode = (mode) => {
    if (editorMode === 'visual' && editorRef.current) {
      updateContentFromEditor();
    }
    setEditorMode(mode);
  };

  const openUrlDialog = (mode) => {
    const sel = window.getSelection();
    savedSelectionRef.current = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
    setUrlDialogMode(mode);
  };

  const insertLink = () => openUrlDialog('link');
  const insertImage = () => openUrlDialog('image');

  const applyUrl = (url) => {
    const mode = urlDialogMode;
    setUrlDialogMode(null);
    if (!url) return;
    editorRef.current?.focus();
    const sel = window.getSelection();
    if (savedSelectionRef.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedSelectionRef.current);
    }
    applyFormat(mode === 'image' ? 'insertImage' : 'createLink', url);
  };

  const insertPlaceholder = (placeholder) => {
    const selectedAccount = accounts.find(a => a.id === selectedAccountId);
    let value = placeholder;
    switch (placeholder) {
      case '{{name}}': value = selectedAccount?.name || 'Name'; break;
      case '{{email}}': value = selectedAccount?.smtp?.fromEmail || selectedAccount?.smtp?.username || 'email@example.com'; break;
      case '{{date}}': value = new Date().toLocaleDateString('de-DE'); break;
      case '{{company}}': value = 'Firma'; break;
      case '{{phone}}': value = '+49 123 456789'; break;
      default: break;
    }
    document.execCommand('insertText', false, value);
    updateContentFromEditor();
  };

  // Editor-DOM mit aktuellem Item synchronisieren wenn aktiver Signatur-ID wechselt
  useEffect(() => {
    if (editorRef.current && activeItem) {
      if (editorRef.current.innerHTML !== activeItem.html) {
        editorRef.current.innerHTML = activeItem.html || '';
      }
    }
  }, [activeSignatureId, editorMode]); // eslint-disable-line

  const selectedAccount = accounts.find(a => a.id === selectedAccountId);

  // Vorlagen
  const templates = [
    {
      name: 'Einfach', desc: 'MfG + Name', Icon: Edit,
      getHtml: (acc) => `<p>Mit freundlichen Grüßen</p><p><strong>${acc.name}</strong></p>`,
      getText: (acc) => `Mit freundlichen Grüßen\n${acc.name}`
    },
    {
      name: 'Professionell', desc: 'Name + E-Mail + Trennlinie', Icon: Portfolio,
      getHtml: (acc) => {
        const email = acc.smtp?.fromEmail || acc.smtp?.username || '';
        return `<p style="border-top: 1px solid #ccc; padding-top: 12px; margin-top: 12px;">Mit freundlichen Grüßen</p><p><strong>${acc.name}</strong></p><p style="color: #666; font-size: 12px;">E-Mail: <a href="mailto:${email}">${email}</a></p>`;
      },
      getText: (acc) => {
        const email = acc.smtp?.fromEmail || acc.smtp?.username || '';
        return `---\nMit freundlichen Grüßen\n${acc.name}\nE-Mail: ${email}`;
      }
    },
    {
      name: 'Minimal', desc: 'Nur Name', Icon: Edit,
      getHtml: (acc) => `<p style="color: #666;">— ${acc.name}</p>`,
      getText: (acc) => `— ${acc.name}`
    },
    {
      name: 'Modern', desc: 'Mit Kontakt-Block', Icon: PenFountain,
      getHtml: (acc) => {
        const email = acc.smtp?.fromEmail || acc.smtp?.username || '';
        return `<div style="font-family: Arial, sans-serif;"><p style="margin: 0; font-size: 14px;"><strong>${acc.name}</strong></p><p style="margin: 4px 0; font-size: 12px; color: #666;">${email}</p></div>`;
      },
      getText: (acc) => {
        const email = acc.smtp?.fromEmail || acc.smtp?.username || '';
        return `${acc.name}\n${email}`;
      }
    }
  ];

  const applyTemplateAsNew = (template) => {
    if (!selectedAccount) return;
    addNewSignature({
      name: template.name,
      html: template.getHtml(selectedAccount),
      text: template.getText(selectedAccount)
    });
  };

  const applyTemplateToActive = (template) => {
    if (!selectedAccount || !activeItem) return;
    const html = template.getHtml(selectedAccount);
    const text = template.getText(selectedAccount);
    updateActiveItem({ html, text });
    if (editorRef.current) editorRef.current.innerHTML = html;
  };

  return (
    <div className="space-y-6">
      {/* v6.9.6: URL-Dialog für Link/Bild einfügen */}
      <UrlPromptDialog
        title={urlDialogMode === 'image' ? 'Bild-URL einfügen' : 'Link einfügen'}
        open={urlDialogMode !== null}
        onSubmit={applyUrl}
        onClose={() => setUrlDialogMode(null)}
        c={c}
      />
      {/* Saved Banner */}
      {saved && (
        <div className="p-3 bg-green-900/20 border border-green-600 rounded-lg text-green-400 text-center inline-flex items-center justify-center gap-1 w-full">
          <Checkmark size={16} /> Signatur gespeichert
        </div>
      )}

      {/* Account Selection */}
      {accounts.length > 1 && (
        <div className={`${c.card} ${c.border} border rounded-xl p-6`}>
          <h3 className={`text-lg font-semibold ${c.text} mb-4 inline-flex items-center gap-2`}><Email size={20} /> Konto auswählen</h3>
          <div className="flex flex-wrap gap-2">
            {accounts.map(account => {
              const accSig = signatures[account.id];
              const count = accSig?.items?.length || 0;
              return (
                <button
                  key={account.id}
                  onClick={() => setSelectedAccountId(account.id)}
                  className={`px-4 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                    selectedAccountId === account.id
                      ? `${c.accentBg} text-white`
                      : `${c.bgTertiary} ${c.hover} ${c.text}`
                  }`}
                >
                  <span>{account.name}</span>
                  {count > 0 && (
                    <span className={`text-xs px-1.5 py-0.5 rounded ${selectedAccountId === account.id ? 'bg-white/20' : c.bgSecondary}`}>
                      {count}
                    </span>
                  )}
                  {accSig?.enabled && (
                    <Checkmark size={16} className="text-green-400" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {selectedAccount && (
        <>
          {/* Enable + Liste der Signaturen */}
          <div className={`${c.card} ${c.border} border rounded-xl p-6`}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <span className={`font-semibold ${c.text} inline-flex items-center gap-2`}><PenFountain size={16} /> Signaturen für „{selectedAccount.name}"</span>
                <p className={`text-sm ${c.textSecondary}`}>
                  Beim Senden wird die <strong>Standard-Signatur</strong> angehängt.
                  Du kannst beim Verfassen jederzeit eine andere wählen.
                </p>
              </div>
              <div className="relative">
                <input
                  type="checkbox"
                  checked={accountSignatures.enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="sr-only"
                />
                <div
                  onClick={() => setEnabled(!accountSignatures.enabled)}
                  className={`w-14 h-7 rounded-full transition-colors cursor-pointer ${
                    accountSignatures.enabled ? 'bg-accentbg' : c.bgTertiary
                  }`}
                >
                  <div className={`absolute top-0.5 w-6 h-6 bg-white rounded-full transition-transform ${
                    accountSignatures.enabled ? 'translate-x-7' : 'translate-x-0.5'
                  }`} />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              {accountSignatures.items.length === 0 && (
                <p className={`text-sm ${c.textSecondary} text-center py-4`}>
                  Noch keine Signatur — füge unten eine hinzu.
                </p>
              )}
              {accountSignatures.items.map(item => {
                const isActive = item.id === activeSignatureId;
                const isDefault = item.id === accountSignatures.defaultId;
                return (
                  <div
                    key={item.id}
                    className={`flex items-center gap-2 p-3 rounded-lg border transition-colors cursor-pointer ${
                      isActive ? `${c.accentBorder || 'border-accent'} ${c.bgTertiary}` : `${c.border} ${c.hover}`
                    }`}
                    onClick={() => setActiveSignatureId(item.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`font-medium ${c.text} truncate`}>{item.name || 'Unbenannt'}</span>
                        {isDefault && (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-accent/15 text-accent">
                            <StarFilled size={12} /> Standard
                          </span>
                        )}
                      </div>
                      <p className={`text-xs ${c.textSecondary} truncate mt-0.5`}>
                        {(item.text || '').replace(/\s+/g, ' ').slice(0, 80) || <em>Leer</em>}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {!isDefault && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setAsDefault(item.id); }}
                          title="Als Standard setzen"
                          className={`p-2 ${c.hover} rounded text-gray-400 hover:text-accent`}
                        >
                          <Star size={16} />
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm(`Signatur „${item.name}" wirklich löschen?`)) deleteSignature(item.id);
                        }}
                        title="Löschen"
                        className={`p-2 ${c.hover} rounded text-gray-400 hover:text-red-400`}
                      >
                        <TrashCan size={16} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              onClick={() => addNewSignature()}
              className={`mt-4 w-full inline-flex items-center justify-center gap-2 py-2 ${c.accentBg} text-white rounded-lg text-sm hover:opacity-90`}
            >
              <Add size={16} /> Neue Signatur
            </button>
          </div>

          {/* Editor (nur wenn aktive Signatur vorhanden) */}
          {activeItem && (
            <div className={`${c.card} ${c.border} border rounded-xl p-6`}>
              <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <Edit size={20} className={c.accent} />
                  <input
                    type="text"
                    value={activeItem.name}
                    onChange={(e) => updateActiveItem({ name: e.target.value })}
                    placeholder="Name der Signatur"
                    className={`flex-1 min-w-0 px-3 py-1.5 ${c.input} border ${c.border} rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent`}
                  />
                </div>
                <div className="flex gap-1">
                  {[
                    { key: 'visual', label: 'Bearbeiten' },
                    { key: 'html', label: 'HTML-Code' },
                    { key: 'preview', label: 'Vorschau' },
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => switchMode(key)}
                      className={`px-3 py-1 rounded text-sm transition-colors ${
                        editorMode === key ? `${c.accentBg} text-white` : `${c.bgTertiary} ${c.text}`
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {editorMode === 'html' && (
                <div>
                  <textarea
                    value={activeItem.html || ''}
                    onChange={handleHtmlCodeChange}
                    spellCheck={false}
                    className={`w-full min-h-[200px] p-4 font-mono text-sm ${c.input} border ${c.border} rounded-lg focus:outline-none focus:ring-2 focus:ring-accent resize-y`}
                    placeholder="<p>HTML hier eingeben...</p>"
                  />
                </div>
              )}

              {editorMode === 'visual' && (
                <>
                  <div className={`flex flex-wrap gap-1 p-2 ${c.bgSecondary} rounded-t-lg border ${c.border}`}>
                    <button onClick={() => applyFormat('bold')} className={`p-2 ${c.hover} rounded ${c.text} font-bold`} title="Fett">B</button>
                    <button onClick={() => applyFormat('italic')} className={`p-2 ${c.hover} rounded ${c.text} italic`} title="Kursiv">I</button>
                    <button onClick={() => applyFormat('underline')} className={`p-2 ${c.hover} rounded ${c.text} underline`} title="Unterstrichen">U</button>
                    <div className={`w-px h-6 ${c.bgTertiary} self-center mx-1`} />
                    <button onClick={() => applyFormat('justifyLeft')} className={`p-2 ${c.hover} rounded ${c.text}`} title="Linksbündig">⫷</button>
                    <button onClick={() => applyFormat('justifyCenter')} className={`p-2 ${c.hover} rounded ${c.text}`} title="Zentriert">☰</button>
                    <button onClick={() => applyFormat('justifyRight')} className={`p-2 ${c.hover} rounded ${c.text}`} title="Rechtsbündig">⫸</button>
                    <div className={`w-px h-6 ${c.bgTertiary} self-center mx-1`} />
                    <button onClick={insertLink} className={`p-2 ${c.hover} rounded ${c.text}`} title="Link einfügen"><Link size={16} /></button>
                    <button onClick={insertImage} className={`p-2 ${c.hover} rounded ${c.text}`} title="Bild einfügen"><Image size={16} /></button>
                    <div className={`w-px h-6 ${c.bgTertiary} self-center mx-1`} />
                    <select onChange={(e) => applyFormat('fontSize', e.target.value)} className={`px-2 py-1 ${c.bgTertiary} ${c.text} rounded text-sm`} defaultValue="3">
                      <option value="1">Klein</option>
                      <option value="3">Normal</option>
                      <option value="5">Groß</option>
                      <option value="7">Sehr groß</option>
                    </select>
                    <input type="color" onChange={(e) => applyFormat('foreColor', e.target.value)} className="w-8 h-8 rounded cursor-pointer" title="Textfarbe" defaultValue="#ffffff" />
                    <div className={`w-px h-6 ${c.bgTertiary} self-center mx-1`} />
                    <button onClick={() => setShowPlaceholderHelp(!showPlaceholderHelp)} className={`px-2 py-1 ${c.hover} rounded ${c.textSecondary} text-sm`} title="Platzhalter">{'{...}'}</button>
                  </div>

                  {showPlaceholderHelp && (
                    <div className={`flex flex-wrap gap-2 p-3 ${c.bgTertiary} border-x ${c.border}`}>
                      <span className={`text-xs ${c.textSecondary} w-full mb-1`}>Klicke um einzufügen:</span>
                      {[
                        { key: '{{name}}', label: 'Name' },
                        { key: '{{email}}', label: 'E-Mail' },
                        { key: '{{date}}', label: 'Datum' },
                        { key: '{{company}}', label: 'Firma' },
                        { key: '{{phone}}', label: 'Telefon' }
                      ].map(p => (
                        <button key={p.key} onClick={() => insertPlaceholder(p.key)} className={`px-2 py-1 ${c.bgSecondary} ${c.hover} ${c.text} rounded text-xs`}>
                          {p.label}
                        </button>
                      ))}
                    </div>
                  )}

                  <div
                    ref={editorRef}
                    contentEditable
                    onInput={updateContentFromEditor}
                    className={`min-h-[200px] p-4 ${c.input} border ${c.border} ${showPlaceholderHelp ? '' : 'border-t-0'} rounded-b-lg focus:outline-none focus:ring-2 focus:ring-accent`}
                    style={{ color: 'white' }}
                  />
                </>
              )}

              {editorMode === 'preview' && (
                <div className="p-6 bg-white rounded-lg min-h-[200px]">
                  <p className="text-gray-500 text-sm mb-4">--- Vorschau ---</p>
                  <div className="text-gray-800" dangerouslySetInnerHTML={{ __html: activeItem.html || '<em>Keine Inhalte</em>' }} />
                </div>
              )}
            </div>
          )}

          {/* Vorlagen */}
          <div className={`${c.card} ${c.border} border rounded-xl p-6`}>
            <h3 className={`text-lg font-semibold ${c.text} mb-2 inline-flex items-center gap-2`}><Portfolio size={20} /> Vorlagen</h3>
            <p className={`text-sm ${c.textSecondary} mb-4`}>
              {activeItem
                ? 'Klick wendet die Vorlage auf die aktive Signatur an. Mit „+ Als neue Signatur" wird sie als zusätzlicher Eintrag angelegt.'
                : 'Lege zuerst eine Signatur an oder klicke direkt eine Vorlage als Startpunkt.'}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {templates.map((template, index) => {
                const TplIcon = template.Icon;
                return (
                  <div key={index} className={`p-3 ${c.bgSecondary} rounded-lg`}>
                    <TplIcon size={20} className="mb-2" />
                    <span className={`text-sm font-medium ${c.text} block`}>{template.name}</span>
                    <p className={`text-xs ${c.textSecondary} mt-1 mb-2`}>{template.desc}</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => applyTemplateAsNew(template)}
                        className={`flex-1 px-2 py-1 ${c.accentBg} text-white text-xs rounded inline-flex items-center justify-center gap-1`}
                      >
                        <Add size={12} /> Neu
                      </button>
                      {activeItem && (
                        <button
                          onClick={() => applyTemplateToActive(template)}
                          className={`flex-1 px-2 py-1 ${c.bgTertiary} ${c.text} text-xs rounded`}
                          title="Vorlage in die aktive Signatur übernehmen"
                        >
                          Anwenden
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tipps */}
          <div className={`${c.card} ${c.border} border rounded-xl p-6`}>
            <h3 className={`text-lg font-semibold ${c.text} mb-4 inline-flex items-center gap-2`}><Information size={20} /> Tipps</h3>
            <ul className={`space-y-2 text-sm ${c.textSecondary}`}>
              <li>• Pro Konto sind beliebig viele Signaturen möglich (z.B. „Geschäftlich", „Privat", „Kurz").</li>
              <li>• Die <strong>Standard-Signatur</strong> wird automatisch verwendet — markiere sie mit dem Stern-Symbol.</li>
              <li>• Beim Verfassen einer E-Mail kannst du jederzeit eine andere Signatur auswählen.</li>
              <li>• Platzhalter wie <code>{'{{name}}'}</code> werden beim Einfügen automatisch ersetzt.</li>
            </ul>
          </div>
        </>
      )}

      {accounts.length === 0 && (
        <div className={`${c.card} ${c.border} border rounded-xl p-8 text-center`}>
          <Email size={48} className={`mx-auto mb-4 ${c.textSecondary}`} />
          <h3 className={`text-lg font-semibold ${c.text} mb-2`}>Keine Konten vorhanden</h3>
          <p className={`${c.textSecondary}`}>
            Füge zuerst ein E-Mail-Konto hinzu, um Signaturen zu erstellen.
          </p>
        </div>
      )}
    </div>
  );
}

export default SignatureEditor;
