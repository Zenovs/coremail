import React, { useState, useEffect, useRef } from 'react';

// ─── E-Mail-Tag-Eingabe mit Adress-Autocomplete (v6.9.0, wie Outlook) ────────
function EmailTagInput({ label, tags, onChange, placeholder, c, isLarge = false }) {
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [highlightIdx, setHighlightIdx] = useState(0);
  const inputRef = useRef(null);
  const suggestDebounceRef = useRef(null);

  const isValidEmail = (val) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(val.trim());

  // Vorschläge aus dem Kontakte-Speicher laden (debounced)
  useEffect(() => {
    if (suggestDebounceRef.current) clearTimeout(suggestDebounceRef.current);
    const q = inputValue.trim();
    if (q.length < 1 || !window.electronAPI?.contactsSuggest) {
      setSuggestions([]);
      return;
    }
    suggestDebounceRef.current = setTimeout(async () => {
      try {
        const r = await window.electronAPI.contactsSuggest(q, 6);
        if (r?.success) {
          setSuggestions((r.contacts || []).filter(s => !tags.includes(s.email)));
          setHighlightIdx(0);
        }
      } catch (_) {}
    }, 120);
    return () => clearTimeout(suggestDebounceRef.current);
  }, [inputValue, tags]);

  const addTag = (val) => {
    // Support paste with multiple addresses (comma/semicolon separated)
    const parts = val.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
    const newTags = parts.filter(p => isValidEmail(p) && !tags.includes(p));
    if (newTags.length > 0) onChange([...tags, ...newTags]);
    setInputValue('');
    setSuggestions([]);
  };

  const pickSuggestion = (s) => {
    if (!tags.includes(s.email)) onChange([...tags, s.email]);
    setInputValue('');
    setSuggestions([]);
    inputRef.current?.focus();
  };

  const removeTag = (index) => {
    onChange(tags.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e) => {
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightIdx(i => Math.min(i + 1, suggestions.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightIdx(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        pickSuggestion(suggestions[highlightIdx]);
        return;
      }
      if (e.key === 'Escape') {
        e.stopPropagation();
        setSuggestions([]);
        return;
      }
    }
    if ((e.key === 'Enter' || e.key === ',' || e.key === ';' || e.key === 'Tab') && inputValue.trim()) {
      e.preventDefault();
      addTag(inputValue.trim());
    } else if (e.key === 'Backspace' && !inputValue && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };

  const handleBlur = () => {
    // Kleiner Delay, damit ein Klick auf einen Vorschlag (mousedown) noch greift
    setTimeout(() => setSuggestions([]), 150);
    if (inputValue.trim()) addTag(inputValue.trim());
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text');
    addTag(pasted);
  };

  return (
    <div className="flex items-start gap-3">
      <label className={`${isLarge ? 'text-sm' : 'text-xs'} ${c.textSecondary} w-16 flex-shrink-0 pt-2`}>
        {label}
      </label>
      <div className="flex-1 relative">
      <div
        className={`flex flex-wrap gap-1.5 px-3 py-2 rounded-lg ${c.input} focus-within:ring-2 focus-within:ring-accent cursor-text min-h-[36px]`}
        onClick={() => inputRef.current?.focus()}
      >
        {tags.map((tag, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-accent/15 text-accent border border-accent/30 rounded-md text-xs font-medium flex-shrink-0"
          >
            {tag}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); removeTag(i); }}
              className="hover:text-white hover:bg-accent/20 rounded-full w-3.5 h-3.5 flex items-center justify-center leading-none"
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
          onPaste={handlePaste}
          placeholder={tags.length === 0 ? placeholder : ''}
          className="flex-1 bg-transparent outline-none text-sm min-w-[140px]"
          style={{ minWidth: tags.length > 0 ? '80px' : '140px' }}
        />
      </div>

      {/* Adress-Vorschläge aus gelernten Kontakten (↑↓ + Enter, Klick) */}
      {suggestions.length > 0 && (
        <div className={`absolute top-full left-0 right-0 mt-1 z-50 rounded-lg shadow-2xl ${c.popover || c.bgSecondary || 'bg-dark-800'} ${c.border} border py-1 max-h-56 overflow-y-auto`}>
          {suggestions.map((s, i) => (
            <button
              key={s.email}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pickSuggestion(s)}
              onMouseEnter={() => setHighlightIdx(i)}
              className={`w-full text-left px-3 py-2 flex items-center gap-2 ${i === highlightIdx ? 'bg-accent/15' : ''}`}
            >
              <span className="w-7 h-7 rounded-full bg-accent/15 text-accent flex items-center justify-center text-xs font-semibold flex-shrink-0 uppercase">
                {(s.name || s.email).charAt(0)}
              </span>
              <span className="min-w-0">
                {s.name && <span className={`block text-sm ${c.text} truncate`}>{s.name}</span>}
                <span className={`block text-xs ${c.textSecondary} truncate`}>{s.email}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}

export default EmailTagInput;
