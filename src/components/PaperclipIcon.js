import React from 'react';

// v7.3.0: Eigenes Büroklammer-Icon statt Carbons «Attachment» — dessen
// diagonale Schlaufe wurde leicht mit einem Link-/Ketten-Icon verwechselt.
// Gleiche Props wie die Carbon-Icons (size, className, aria-label, …).
const PaperclipIcon = ({ size = 16, className, ...rest }) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden={rest['aria-label'] ? undefined : true}
    role={rest['aria-label'] ? 'img' : undefined}
    focusable="false"
    {...rest}
  >
    <path d="M13.5 8V15a1.75 1.75 0 0 1-3.5 0V5.5a3.5 3.5 0 0 1 7 0V15.5a5.5 5.5 0 0 1-11 0V8" />
  </svg>
);

export default PaperclipIcon;
