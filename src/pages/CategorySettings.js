import React, { useState } from 'react';
import {
  Add, Edit, TrashCan, Close, Checkmark, ColorPalette,
  Portfolio, User, Star, Tag, Favorite, Flag, Bookmark, Flash,
  Bee, Earth, Email, Home, Security, Folder
} from '@carbon/icons-react';
import { useTheme } from '../context/ThemeContext';
import { useAccounts } from '../context/AccountContext';

const PRESET_COLORS = [
  '#3b82f6', // Blue
  '#22c55e', // Green
  '#8b5cf6', // Purple
  '#f59e0b', // Amber
  '#ef4444', // Red
  '#ec4899', // Pink
  '#14b8a6', // Teal
  '#6366f1', // Indigo
  '#84cc16', // Lime
  '#f97316', // Orange
  '#06b6d4', // Cyan
  '#a855f7', // Violet
];

// v1.11.0: Icon options for categories
const CATEGORY_ICONS = [
  { id: 'briefcase', icon: Portfolio, name: 'Arbeit' },
  { id: 'user',      icon: User,      name: 'Person' },
  { id: 'star',      icon: Star,      name: 'Stern' },
  { id: 'tag',       icon: Tag,       name: 'Tag' },
  { id: 'heart',     icon: Favorite,  name: 'Herz' },
  { id: 'flag',      icon: Flag,      name: 'Flagge' },
  { id: 'bookmark',  icon: Bookmark,  name: 'Lesezeichen' },
  { id: 'zap',       icon: Flash,     name: 'Blitz' },
  { id: 'coffee',    icon: Bee,       name: 'Kaffee' },
  { id: 'globe',     icon: Earth,     name: 'Globus' },
  { id: 'mail',      icon: Email,     name: 'Mail' },
  { id: 'home',      icon: Home,      name: 'Haus' },
  { id: 'shield',    icon: Security,  name: 'Schild' },
  { id: 'folder',    icon: Folder,    name: 'Ordner' },
];

// Get icon component by id
export const getCategoryIcon = (iconId) => {
  const iconDef = CATEGORY_ICONS.find(i => i.id === iconId);
  return iconDef ? iconDef.icon : Tag;
};

function CategorySettings() {
  const { currentTheme } = useTheme();
  const { categories, addCategory, updateCategory, deleteCategory, getAccountsByCategory } = useAccounts();
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState('');
  const [editIcon, setEditIcon] = useState('tag');
  const [showColorPicker, setShowColorPicker] = useState(null);
  const [showIconPicker, setShowIconPicker] = useState(null);
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#3b82f6');
  const [newIcon, setNewIcon] = useState('tag');
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null); // { categoryId, message }
  const c = currentTheme.colors;

  const handleStartEdit = (category) => {
    setEditingId(category.id);
    setEditName(category.name);
    setEditColor(category.color);
    setEditIcon(category.icon || 'tag');
    setShowColorPicker(null);
    setShowIconPicker(null);
    setIsAdding(false);
  };

  const handleSaveEdit = async () => {
    if (!editName.trim()) {
      setError('Name darf nicht leer sein');
      return;
    }
    
    await updateCategory(editingId, {
      name: editName.trim(),
      color: editColor,
      icon: editIcon
    });
    
    setEditingId(null);
    setEditName('');
    setEditColor('');
    setEditIcon('tag');
    setError('');
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditColor('');
    setEditIcon('tag');
    setError('');
  };

  const handleDelete = (categoryId) => {
    const accounts = getAccountsByCategory(categoryId);
    const message = accounts.length > 0
      ? `Diese Kategorie enthält ${accounts.length} Konto(en). Die Konten werden zur Kategorie "Sonstiges" verschoben. Fortfahren?`
      : 'Diese Kategorie wirklich löschen?';
    setConfirmDelete({ categoryId, message });
  };

  const handleDeleteConfirmed = async () => {
    if (!confirmDelete) return;
    await deleteCategory(confirmDelete.categoryId);
    setConfirmDelete(null);
  };

  const handleStartAdd = () => {
    setIsAdding(true);
    setNewName('');
    setNewColor('#3b82f6');
    setNewIcon('tag');
    setEditingId(null);
    setError('');
  };

  const handleSaveAdd = async () => {
    if (!newName.trim()) {
      setError('Name darf nicht leer sein');
      return;
    }
    
    await addCategory({
      name: newName.trim(),
      color: newColor,
      icon: newIcon
    });
    
    setIsAdding(false);
    setNewName('');
    setNewColor('#3b82f6');
    setNewIcon('tag');
    setError('');
  };

  const handleCancelAdd = () => {
    setIsAdding(false);
    setNewName('');
    setNewColor('#3b82f6');
    setNewIcon('tag');
    setError('');
  };

  // Check if category is deletable (not default categories)
  const isDeletable = (categoryId) => {
    return !['work', 'personal', 'other'].includes(categoryId);
  };

  // Icon Picker Component
  const IconPicker = ({ value, onChange, pickerId }) => {
    const IconComponent = getCategoryIcon(value);
    return (
      <div className="relative">
        <button
          onClick={() => setShowIconPicker(showIconPicker === pickerId ? null : pickerId)}
          className={`w-10 h-10 rounded-lg border-2 ${c.border} flex items-center justify-center ${c.bgTertiary} hover:bg-opacity-80 transition-colors`}
          title="Icon wählen"
        >
          <IconComponent size={20} style={{ color: editingId ? editColor : newColor }} />
        </button>
        {showIconPicker === pickerId && (
          <div className={`absolute top-12 left-0 z-20 p-3 ${c.card} ${c.border} border rounded-xl shadow-xl min-w-[200px]`}>
            <p className={`text-xs ${c.textSecondary} mb-2`}>Icon wählen:</p>
            <div className="grid grid-cols-5 gap-2">
              {CATEGORY_ICONS.map(({ id, icon: Icon, name }) => (
                <button
                  key={id}
                  onClick={() => { onChange(id); setShowIconPicker(null); }}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all hover:scale-110 ${value === id ? 'ring-2 ring-accent bg-accent/15' : c.hover}`}
                  title={name}
                >
                  <Icon size={16} style={{ color: editingId ? editColor : newColor }} />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className={`${c.card} ${c.border} border rounded-xl p-6`}>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className={`text-lg font-semibold ${c.text}`}>Kategorien verwalten</h3>
            <p className={`text-sm ${c.textSecondary} mt-1`}>
              Organisiere deine E-Mail-Konten in Kategorien
            </p>
          </div>
          <button
            onClick={handleStartAdd}
            disabled={isAdding}
            className={`px-4 py-2 ${c.accentBg} ${c.accentHover} text-white rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50`}
          >
            <Add size={16} />
            Neue Kategorie
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-900/20 border border-red-600 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Add New Category Form */}
        {isAdding && (
          <div className={`mb-4 p-4 ${c.bgSecondary} rounded-xl ${c.border} border`}>
            <h4 className={`font-medium ${c.text} mb-3`}>Neue Kategorie erstellen</h4>
            <div className="flex items-center gap-3">
              {/* Icon Picker */}
              <IconPicker value={newIcon} onChange={setNewIcon} pickerId="new-icon" />
              
              <div className="flex-1">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Kategoriename"
                  className={`w-full px-4 py-2 ${c.bgTertiary} ${c.text} ${c.border} border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent`}
                  autoFocus
                />
              </div>
              <div className="relative">
                <button
                  onClick={() => setShowColorPicker(showColorPicker === 'new' ? null : 'new')}
                  className={`w-10 h-10 rounded-lg border-2 ${c.border} flex items-center justify-center`}
                  style={{ backgroundColor: newColor }}
                  title="Farbe wählen"
                >
                  <ColorPalette size={20} className="text-white drop-shadow" />
                </button>
                {showColorPicker === 'new' && (
                  <div className={`absolute top-12 right-0 z-10 p-3 ${c.card} ${c.border} border rounded-xl shadow-xl`}>
                    <div className="grid grid-cols-4 gap-2">
                      {PRESET_COLORS.map(color => (
                        <button
                          key={color}
                          onClick={() => { setNewColor(color); setShowColorPicker(null); }}
                          className={`w-8 h-8 rounded-lg transition-transform hover:scale-110 ${newColor === color ? 'ring-2 ring-white ring-offset-2 ring-offset-gray-900' : ''}`}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                    <div className="mt-3 pt-3 border-t border-gray-700">
                      <input
                        type="color"
                        value={newColor}
                        onChange={(e) => setNewColor(e.target.value)}
                        className="w-full h-8 rounded cursor-pointer"
                      />
                    </div>
                  </div>
                )}
              </div>
              <button
                onClick={handleSaveAdd}
                className="p-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
                title="Speichern"
              >
                <Checkmark size={20} />
              </button>
              <button
                onClick={handleCancelAdd}
                className={`p-2 ${c.bgTertiary} ${c.hover} ${c.text} rounded-lg transition-colors`}
                title="Abbrechen"
              >
                <Close size={20} />
              </button>
            </div>
          </div>
        )}

        {/* Category List */}
        <div className="space-y-2">
          {categories.map(category => {
            const accounts = getAccountsByCategory(category.id);
            const isEditing = editingId === category.id;
            const IconComponent = getCategoryIcon(category.icon || 'tag');
            
            return (
              <div
                key={category.id}
                className={`p-4 ${c.bgSecondary} rounded-xl ${c.border} border flex items-center gap-3`}
              >
                {isEditing ? (
                  // Edit Mode
                  <>
                    {/* Icon Picker */}
                    <IconPicker value={editIcon} onChange={setEditIcon} pickerId={`edit-${category.id}`} />
                    
                    <div className="relative">
                      <button
                        onClick={() => setShowColorPicker(showColorPicker === category.id ? null : category.id)}
                        className={`w-10 h-10 rounded-lg border-2 ${c.border} flex items-center justify-center`}
                        style={{ backgroundColor: editColor }}
                        title="Farbe wählen"
                      >
                        <ColorPalette size={20} className="text-white drop-shadow" />
                      </button>
                      {showColorPicker === category.id && (
                        <div className={`absolute top-12 left-0 z-10 p-3 ${c.card} ${c.border} border rounded-xl shadow-xl`}>
                          <div className="grid grid-cols-4 gap-2">
                            {PRESET_COLORS.map(color => (
                              <button
                                key={color}
                                onClick={() => { setEditColor(color); setShowColorPicker(null); }}
                                className={`w-8 h-8 rounded-lg transition-transform hover:scale-110 ${editColor === color ? 'ring-2 ring-white ring-offset-2 ring-offset-gray-900' : ''}`}
                                style={{ backgroundColor: color }}
                              />
                            ))}
                          </div>
                          <div className="mt-3 pt-3 border-t border-gray-700">
                            <input
                              type="color"
                              value={editColor}
                              onChange={(e) => setEditColor(e.target.value)}
                              className="w-full h-8 rounded cursor-pointer"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className={`flex-1 px-4 py-2 ${c.bgTertiary} ${c.text} ${c.border} border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent`}
                      autoFocus
                    />
                    <button
                      onClick={handleSaveEdit}
                      className="p-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
                      title="Speichern"
                    >
                      <Checkmark size={20} />
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className={`p-2 ${c.bgTertiary} ${c.hover} ${c.text} rounded-lg transition-colors`}
                      title="Abbrechen"
                    >
                      <Close size={20} />
                    </button>
                  </>
                ) : (
                  // View Mode - v1.12.3: Edit/Delete Buttons IMMER sichtbar (nicht nur Hover)
                  <>
                    <div
                      className="w-10 h-10 rounded-lg flex-shrink-0 flex items-center justify-center"
                      style={{ backgroundColor: category.color }}
                    >
                      <IconComponent size={20} className="text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className={`font-medium ${c.text}`}>{category.name}</h4>
                      <p className={`text-sm ${c.textSecondary}`}>
                        {accounts.length} Konto{accounts.length !== 1 ? 'en' : ''}
                      </p>
                    </div>
                    {/* v1.12.3: FIXED - Buttons sind IMMER sichtbar, nicht nur bei Hover */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => handleStartEdit(category)}
                        className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 text-sm font-medium bg-gray-700 hover:bg-gray-600 text-gray-200 hover:text-white`}
                        title="Kategorie bearbeiten"
                      >
                        <Edit size={16} />
                        <span>Bearbeiten</span>
                      </button>
                      {isDeletable(category.id) && (
                        <button
                          onClick={() => handleDelete(category.id)}
                          className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 text-sm font-medium bg-red-900/30 hover:bg-red-900/50 text-red-400 hover:text-red-300`}
                          title="Kategorie löschen"
                        >
                          <TrashCan size={16} />
                          <span>Löschen</span>
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Bestätigungs-Dialog: Kategorie löschen */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className={`${c.bgSecondary} ${c.border} border rounded-xl p-6 shadow-2xl max-w-sm w-full mx-4`}>
            <h3 className={`text-lg font-semibold ${c.text} mb-2`}>Kategorie löschen?</h3>
            <p className={`text-sm ${c.textSecondary} mb-5`}>{confirmDelete.message}</p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmDelete(null)}
                className={`px-4 py-2 rounded-lg ${c.bgTertiary} ${c.hover} ${c.text} text-sm transition-colors`}
              >
                Abbrechen
              </button>
              <button
                onClick={handleDeleteConfirmed}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm transition-colors"
              >
                Löschen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tips */}
      <div className={`${c.bgSecondary} ${c.border} border rounded-xl p-6`}>
        <h4 className={`font-medium ${c.text} mb-3`}>💡 Tipps</h4>
        <ul className={`text-sm ${c.textSecondary} space-y-2`}>
          <li>• Kategorien helfen dir, deine E-Mail-Konten zu organisieren</li>
          <li>• Wähle ein passendes Icon für jede Kategorie</li>
          <li>• Die Standard-Kategorien (Arbeit, Privat, Sonstiges) können nicht gelöscht werden</li>
          <li>• Beim Löschen einer Kategorie werden die Konten zu "Sonstiges" verschoben</li>
          <li>• Wähle aussagekräftige Farben für eine bessere Übersicht</li>
        </ul>
      </div>
    </div>
  );
}

export default CategorySettings;
