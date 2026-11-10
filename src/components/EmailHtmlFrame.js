import React, { useRef, useCallback, useState, useMemo, useEffect } from 'react';
import DOMPurify from 'dompurify';

/**
 * Renders email HTML content in an isolated iframe so that any CSS
 * contained in the email (e.g. <style> tags, body rules) cannot leak
 * into the CoreMail UI.
 *
 * Security:
 * - HTML wird mit DOMPurify gegen XSS sanitized.
 * - Externe http(s)-Bilder werden per default geblockt (Tracking-Schutz),
 *   data:-Bilder (eingebettete Anhänge) bleiben erhalten.
 * - Sandbox-Iframe blockt Skripte und Forms zusätzlich.
 */
function EmailHtmlFrame({ html, fontFamily }) {
  const iframeRef = useRef(null);
  const [imagesAllowed, setImagesAllowed] = useState(false);

  // App-weites Setting "Externe Bilder immer laden" beachten
  const alwaysLoadImages = (() => {
    try { return localStorage.getItem('emailSettings.alwaysLoadImages') === 'true'; } catch { return false; }
  })();

  // Reset image-allow flag wenn andere Mail geladen wird
  useEffect(() => {
    setImagesAllowed(alwaysLoadImages);
  }, [html, alwaysLoadImages]);

  // Sanitize font (CSS injection guard)
  const font = (fontFamily || 'Arial, sans-serif').replace(/[;"'{}\\]/g, '');

  // 1) DOMPurify: Sanitize HTML, lasse alle visuellen Elemente, blocke Scripts/Events
  // 2) Externe Bilder: Wenn nicht erlaubt, src durch transparentes 1px-Pixel ersetzen, Original in data-blocked-src merken
  const { sanitized, blockedImageCount } = useMemo(() => {
    if (!html) return { sanitized: '', blockedImageCount: 0 };

    let blockedCount = 0;

    DOMPurify.removeAllHooks();
    DOMPurify.addHook('uponSanitizeAttribute', (node, data) => {
      // Tracking-Schutz auch für CSS: background:url(http://tracker) & Co. umgingen
      // bisher den Bildblocker und bestätigten dem Absender das Öffnen der Mail.
      if (data.attrName === 'style' && !imagesAllowed && data.attrValue) {
        if (/url\(\s*['"]?\s*https?:/i.test(data.attrValue)) {
          blockedCount++;
          data.attrValue = data.attrValue.replace(/url\(\s*['"]?\s*https?:[^)]*\)/gi, 'none');
        }
        return;
      }
      if (data.attrName !== 'src') return;
      if (node.tagName !== 'IMG') return;
      const v = (data.attrValue || '').trim().toLowerCase();
      // data:- und cid:-Bilder erlauben (eingebettete Anhänge)
      if (v.startsWith('data:image/') || v.startsWith('cid:')) return;
      if (v.startsWith('http://') || v.startsWith('https://')) {
        if (imagesAllowed) return; // User hat externe Bilder freigegeben
        blockedCount++;
        // 1×1 transparent gif als Platzhalter
        node.setAttribute('data-blocked-src', data.attrValue);
        data.attrValue = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      }
    });
    // <style>-Blöcke mit externem url()/@import ebenfalls entschärfen
    DOMPurify.addHook('uponSanitizeElement', (node) => {
      if (node.nodeName === 'STYLE' && !imagesAllowed && node.textContent && /url\(\s*['"]?\s*https?:|@import/i.test(node.textContent)) {
        node.textContent = node.textContent
          .replace(/url\(\s*['"]?\s*https?:[^)]*\)/gi, 'none')
          .replace(/@import[^;]+;/gi, '');
      }
    });

    const clean = DOMPurify.sanitize(html, {
      WHOLE_DOCUMENT: false,
      ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|cid|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
      FORBID_TAGS: ['script', 'object', 'embed', 'base', 'form', 'input', 'button', 'textarea'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'onmouseenter', 'srcset'],
      ADD_ATTR: ['target', 'data-blocked-src']
    });
    DOMPurify.removeAllHooks();
    return { sanitized: clean, blockedImageCount: blockedCount };
  }, [html, imagesAllowed]);

  const srcDoc = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  html, body {
    margin: 0;
    padding: 4px 0 16px 0;
    font-family: ${font};
    font-size: 14px;
    line-height: 1.5;
    word-break: break-word;
    overflow-x: hidden;
    background: white;
    color: #111;
  }
  img { max-width: 100%; height: auto; }
  img[data-blocked-src] {
    background: #f3f4f6;
    border: 1px dashed #d1d5db;
    min-width: 32px;
    min-height: 32px;
  }
  a { color: #0f6cbd; }
  pre, code { white-space: pre-wrap; word-break: break-all; }
</style>
</head>
<body>${sanitized}</body>
</html>`;

  const handleLoad = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    try {
      const doc = iframe.contentDocument;
      const body = doc?.body;
      if (body) {
        iframe.style.height = (body.scrollHeight + 8) + 'px';

        // Links im Browser öffnen statt im iframe navigieren.
        // Event-Delegation statt once:true — sonst navigierte ein zweiter Klick
        // auf denselben Link ungehindert im iframe (Tracking/IP-Leak).
        body.addEventListener('click', (e) => {
          const link = e.target?.closest?.('a[href]');
          if (!link) return;
          e.preventDefault();
          const href = link.getAttribute('href');
          if (href && window.electronAPI?.openExternal) {
            const proto = href.trim().toLowerCase().split(':')[0];
            if (['http', 'https', 'mailto', 'tel'].includes(proto)) {
              window.electronAPI.openExternal(href);
            }
          }
        });

        // Kontextmenü-Events an Electron weiterleiten
        body.addEventListener('contextmenu', (e) => {
          const selection = doc.getSelection()?.toString() || null;
          const linkEl = e.target.closest('a[href]');
          const customEvent = new CustomEvent('contextmenu', {
            bubbles: true, cancelable: true,
            detail: {
              selection,
              linkUrl: linkEl?.href || null,
              clientX: e.clientX,
              clientY: e.clientY
            }
          });
          window.dispatchEvent(customEvent);
        });
      }
    } catch {
      // Cross-origin guard
    }
  }, []);

  return (
    <div>
      {blockedImageCount > 0 && !imagesAllowed && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          gap: '12px', padding: '8px 14px', marginBottom: '12px',
          background: '#fff4ce',
          border: '1px solid #f2dd86',
          borderRadius: '8px', fontSize: '13px', color: '#7a5a00'
        }}>
          <span>
            <strong>{blockedImageCount}</strong> externe{blockedImageCount === 1 ? 's' : ''} Bild{blockedImageCount === 1 ? '' : 'er'} blockiert (Tracking-Schutz)
          </span>
          <button
            onClick={() => setImagesAllowed(true)}
            style={{
              background: '#ffffff',
              border: '1px solid #d1d1d1',
              color: '#242424', borderRadius: '6px',
              padding: '4px 12px', cursor: 'pointer', fontSize: '12px',
              fontFamily: 'inherit', fontWeight: 500, whiteSpace: 'nowrap'
            }}
          >
            Bilder anzeigen
          </button>
        </div>
      )}
      <iframe
        ref={iframeRef}
        srcDoc={srcDoc}
        sandbox="allow-same-origin"
        title="E-Mail Inhalt"
        style={{
          width: '100%',
          border: 'none',
          minHeight: '120px',
          display: 'block',
          background: 'white',
        }}
        onLoad={handleLoad}
      />
    </div>
  );
}

// memo: Re-Render nur bei neuer Mail/Font — Sanitizing + iframe-Rebuild sind
// zu teuer, um sie bei jedem Parent-Render (Reply-Panel, Progress) zu wiederholen.
export default React.memo(EmailHtmlFrame);
