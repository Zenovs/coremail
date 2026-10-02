import React, { useEffect, useRef, useCallback } from 'react';
import { Search, Close, Filter, Calendar, Email, Flag, ChevronDown, ChevronUp, InProgress, WarningAlt } from '@carbon/icons-react';
import Attachment from './PaperclipIcon';
import { useTheme } from '../context/ThemeContext';
import { useSearch } from '../context/SearchContext';
import { useAccounts } from '../context/AccountContext';
import SearchResults from './SearchResults';

export default function GlobalSearch({ onSelectEmail }) {
  const { currentTheme } = useTheme();
  const c = currentTheme.colors;
  const { accounts, categories } = useAccounts();
  const {
    isSearchOpen,
    searchQuery,
    isSearching,
    searchError,
    suggestions,
    searchStats,
    filters,
    showFilters,
    closeSearch,
    performSearch,
    updateSearchQuery,
    setShowFilters,
    updateFilter,
    resetFilters,
    searchResults
  } = useSearch();

  const inputRef = useRef(null);
  const containerRef = useRef(null);

  // Focus input when search opens
  useEffect(() => {
    if (isSearchOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isSearchOpen]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isSearchOpen) {
        closeSearch();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isSearchOpen, closeSearch]);

  // Handle search submit
  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    performSearch(searchQuery);
  }, [performSearch, searchQuery]);

  // Handle suggestion click
  const handleSuggestionClick = useCallback((suggestion) => {
    updateSearchQuery(suggestion.subject);
    performSearch(suggestion.subject);
  }, [updateSearchQuery, performSearch]);

  if (!isSearchOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={closeSearch}
      />
      
      {/* Search Container */}
      <div 
        ref={containerRef}
        className={`relative w-full max-w-4xl mx-4 ${c.card} rounded-xl shadow-2xl border ${c.border} overflow-hidden`}
        style={{ maxHeight: 'calc(100vh - 160px)' }}
      >
        {/* Search Header */}
        <form onSubmit={handleSubmit} className="p-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <Search size={20} className={c.textSecondary} />
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => updateSearchQuery(e.target.value)}
              placeholder="Mails durchsuchen... (Betreff, Absender, Text)"
              className={`flex-1 bg-transparent ${c.text} text-lg outline-none placeholder:${c.textSecondary}`}
              autoComplete="off"
            />
            {isSearching && (
              <InProgress size={20} className="text-orange-500 animate-spin" />
            )}
            <button
              type="button"
              onClick={() => setShowFilters(!showFilters)}
              className={`p-2 rounded-lg transition-colors ${showFilters ? 'bg-orange-500/20 text-orange-500' : `${c.buttonSecondary}`}`}
              title="Filter anzeigen"
            >
              <Filter size={20} />
              {showFilters ? <ChevronUp size={16} className="ml-1 inline" /> : <ChevronDown size={16} className="ml-1 inline" />}
            </button>
            <button
              type="button"
              onClick={closeSearch}
              className={`p-2 rounded-lg ${c.buttonSecondary} hover:bg-red-500/20 hover:text-red-500 transition-colors`}
              title="Schliessen"
            >
              <Close size={20} />
            </button>
          </div>

          {/* Quick Search Hint */}
          <div className={`mt-2 text-xs ${c.textSecondary}`}>
            Drücke <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-300">Enter</kbd> für vollständige Suche oder
            <kbd className="px-1.5 py-0.5 bg-gray-700 rounded text-gray-300 ml-1">Esc</kbd> zum Schliessen
          </div>
        </form>

        {/* Advanced Filters */}
        {showFilters && (
          <div className="p-4 border-b border-gray-700 bg-gray-900/50">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Account Filter */}
              <div>
                <label className={`block text-xs ${c.textSecondary} mb-1`}>Konto</label>
                <select
                  value={filters.accountIds[0] || ''}
                  onChange={(e) => updateFilter('accountIds', e.target.value ? [e.target.value] : [])}
                  className={`w-full px-3 py-2 rounded-lg ${c.input} ${c.text} text-sm`}
                >
                  <option value="">Alle Konten</option>
                  {accounts.map(acc => (
                    <option key={acc.id} value={acc.id}>{acc.name}</option>
                  ))}
                </select>
              </div>

              {/* Date From */}
              <div>
                <label className={`block text-xs ${c.textSecondary} mb-1`}>
                  <Calendar size={16} className="inline mr-1" />
                  Von Datum
                </label>
                <input
                  type="date"
                  value={filters.dateFrom || ''}
                  onChange={(e) => updateFilter('dateFrom', e.target.value || null)}
                  className={`w-full px-3 py-2 rounded-lg ${c.input} ${c.text} text-sm`}
                />
              </div>

              {/* Date To */}
              <div>
                <label className={`block text-xs ${c.textSecondary} mb-1`}>
                  <Calendar size={16} className="inline mr-1" />
                  Bis Datum
                </label>
                <input
                  type="date"
                  value={filters.dateTo || ''}
                  onChange={(e) => updateFilter('dateTo', e.target.value || null)}
                  className={`w-full px-3 py-2 rounded-lg ${c.input} ${c.text} text-sm`}
                />
              </div>

              {/* Folder Filter */}
              <div>
                <label className={`block text-xs ${c.textSecondary} mb-1`}>Ordner</label>
                <select
                  value={filters.folders[0] || '*'}
                  onChange={(e) => updateFilter('folders', e.target.value === '*' ? [] : [e.target.value])}
                  className={`w-full px-3 py-2 rounded-lg ${c.input} ${c.text} text-sm`}
                >
                  <option value="*">Alle Ordner</option>
                  <option value="INBOX">Posteingang</option>
                  <option value="Sent">Gesendet</option>
                  <option value="Drafts">Entwürfe</option>
                  <option value="Archive">Archiv</option>
                </select>
              </div>
            </div>

            {/* Toggle Filters */}
            <div className="flex flex-wrap gap-4 mt-4">
              <label className={`flex items-center gap-2 cursor-pointer ${c.text} text-sm`}>
                <input
                  type="checkbox"
                  checked={filters.unreadOnly}
                  onChange={(e) => updateFilter('unreadOnly', e.target.checked)}
                  className="w-4 h-4 rounded accent-orange-500"
                />
                <Email size={16} />
                Nur ungelesene
              </label>

              <label className={`flex items-center gap-2 cursor-pointer ${c.text} text-sm`}>
                <input
                  type="checkbox"
                  checked={filters.flaggedOnly}
                  onChange={(e) => updateFilter('flaggedOnly', e.target.checked)}
                  className="w-4 h-4 rounded accent-orange-500"
                />
                <Flag size={16} />
                Nur markierte
              </label>

              <label className={`flex items-center gap-2 cursor-pointer ${c.text} text-sm`}>
                <input
                  type="checkbox"
                  checked={filters.hasAttachments}
                  onChange={(e) => updateFilter('hasAttachments', e.target.checked)}
                  className="w-4 h-4 rounded accent-orange-500"
                />
                <Attachment size={16} />
                Mit Anhängen
              </label>

              <button
                type="button"
                onClick={resetFilters}
                className={`ml-auto text-sm ${c.textSecondary} hover:text-orange-500 transition-colors`}
              >
                Filter zurücksetzen
              </button>
            </div>
          </div>
        )}

        {/* Suggestions (Quick Search) */}
        {suggestions.length > 0 && !isSearching && searchResults.length === 0 && (
          <div className="p-2 border-b border-gray-700">
            <div className={`px-2 py-1 text-xs ${c.textSecondary}`}>Vorschläge</div>
            {suggestions.map((suggestion) => (
              <button
                key={suggestion.uid}
                onClick={() => handleSuggestionClick(suggestion)}
                className={`w-full px-3 py-2 text-left rounded-lg hover:bg-gray-700/50 transition-colors flex items-center gap-3`}
              >
                <Email size={16} className={`${c.textSecondary} flex-shrink-0`} />
                <div className="flex-1 min-w-0">
                  <div className={`${c.text} text-sm truncate`}>{suggestion.subject}</div>
                  <div className={`${c.textSecondary} text-xs truncate`}>{suggestion.from}</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Error Message */}
        {searchError && (
          <div className="p-4 bg-red-500/10 border-b border-red-500/20">
            <p className="text-red-400 text-sm flex items-center gap-1.5"><WarningAlt size={16} className="flex-shrink-0" /> {searchError}</p>
          </div>
        )}

        {/* Search Stats */}
        {searchStats && !isSearching && (
          <div className={`px-4 py-2 border-b border-gray-700 ${c.textSecondary} text-xs flex items-center justify-between`}>
            <span>
              {searchStats.totalFound} Ergebnisse für "{searchStats.query}"
              {searchStats.totalFound > 200 && " (max. 200 angezeigt)"}
            </span>
            <span>
              {searchStats.searchedAccounts} Konto(en) durchsucht
            </span>
          </div>
        )}

        {/* Search Results */}
        <div className="overflow-y-auto" style={{ maxHeight: '60vh' }}>
          <SearchResults 
            results={searchResults} 
            isSearching={isSearching}
            query={searchQuery}
            onSelectEmail={(email) => {
              onSelectEmail?.(email);
              closeSearch();
            }}
          />
        </div>

        {/* Search Errors from accounts */}
        {searchStats?.errors && searchStats.errors.length > 0 && (
          <div className="p-3 border-t border-gray-700 bg-yellow-500/10">
            <div className="text-yellow-500 text-xs flex items-start gap-1">
              <WarningAlt size={16} className="flex-shrink-0 mt-0.5" /> Einige Konten konnten nicht durchsucht werden:
              {searchStats.errors.map((err, idx) => (
                <span key={idx} className="ml-2">{err.accountName}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
