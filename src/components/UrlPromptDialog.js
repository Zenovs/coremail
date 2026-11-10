import React, { useState, useEffect, useRef } from 'react';

// v6.9.6: Ersatz für window.prompt() — Electron unterstützt prompt() nicht
// (gibt immer null zurück), damit waren "Link einfügen" im Compose und
// Link/Bild im Signatur-Editor komplett funktionslos.
//
// onSubmit erhält eine bereinigte URL oder null (bei leerer Eingabe/Abbruch).
// Gefährliche Schemata (javascript:, data:, vbscript:, file:) werden
// verworfen; Eingaben ohne Schema bekommen automatisch https:// vorangestellt.
export function sanitizeUserUrl(raw) {
  const t = (raw || '').trim();
  if (!t || t === 'https://') return null;
  if (/^(javascript|data|vbscript|file):/i.test(t)) return null;
  if (/^(https?:\/\/|mailto:|tel:|sms:)/i.test(t)) return t;
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return null; // unbekanntes Schema → ablehnen
  return 'https://' + t.replace(/^\/+/, '');
}

function UrlPromptDialog({ title, open, onSubmit, onClose, c, placeholder = 'https://…' }) {
  const [value, setValue] = useState('https://');
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setValue('https://');
      setError(null);
      // Fokus erst nach dem Rendern setzen
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  if (!open) return null;

  const submit = () => {
    const t = value.trim();
    // Leer/unverändert = Abbruch
    if (!t || t === 'https://') { onClose(); return; }
    const url = sanitizeUserUrl(t);
    if (!url) {
      // Ungültige Eingabe NICHT still verwerfen — Dialog bleibt offen
      setError('Ungültige URL — erlaubt sind http(s)://, mailto: oder eine Domain wie example.com');
      return;
    }
    onSubmit(url);
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50" onMouseDown={onClose}>
      <div
        className={`${c.popover || c.card} ${c.border} border rounded-xl p-4 w-96 shadow-2xl`}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className={`text-sm font-medium ${c.text} mb-2`}>{title}</div>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={e => { setValue(e.target.value); if (error) setError(null); }}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
            if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
          }}
          placeholder={placeholder}
          className={`w-full px-3 py-2 rounded-lg ${c.input} border outline-none focus:ring-2 focus:ring-accent text-sm ${error ? 'ring-2 ring-red-500' : ''}`}
        />
        {error && (
          <div className="text-xs text-red-400 mt-2">{error}</div>
        )}
        <div className="flex justify-end gap-2 mt-3">
          <button
            type="button"
            onClick={onClose}
            className={`px-3 py-1.5 rounded-lg text-sm ${c.bgTertiary} ${c.text} ${c.hover}`}
          >
            Abbrechen
          </button>
          <button
            type="button"
            onClick={submit}
            className={`px-3 py-1.5 rounded-lg text-sm ${c.accentBg} text-white`}
          >
            Einfügen
          </button>
        </div>
      </div>
    </div>
  );
}

export default UrlPromptDialog;
