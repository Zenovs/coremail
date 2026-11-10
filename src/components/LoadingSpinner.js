import React from 'react';
import { useTheme } from '../context/ThemeContext';

function LoadingSpinner({ message = 'Laden...', size = 'md', variant = 'default' }) {
  const { currentTheme } = useTheme();
  const c = currentTheme.colors;

  const sizes = {
    sm: 'w-6 h-6',
    md: 'w-12 h-12',
    lg: 'w-16 h-16'
  };

  const borderSizes = {
    sm: 'border-2',
    md: 'border-4',
    lg: 'border-4'
  };

  if (variant === 'dots') {
    return (
      <div className="flex flex-col items-center justify-center p-8 animate-fadeIn">
        <div className="flex gap-2 mb-4">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-3 h-3 bg-accentbg rounded-full"
              style={{
                animation: 'bounce 1.4s ease-in-out infinite',
                animationDelay: `${i * 0.16}s`
              }}
            />
          ))}
        </div>
        {message && <p className={`${c.textSecondary} text-sm`}>{message}</p>}
      </div>
    );
  }

  if (variant === 'pulse') {
    return (
      <div className="flex flex-col items-center justify-center p-8 animate-fadeIn">
        <div className={`${sizes[size]} rounded-full bg-accent/15 animate-ping mb-4`} />
        {message && <p className={`${c.textSecondary} text-sm`}>{message}</p>}
      </div>
    );
  }

  // Default spinner
  return (
    <div className="flex flex-col items-center justify-center p-8 animate-fadeIn">
      <div className={`relative ${sizes[size]} mb-4`}>
        <div className={`absolute inset-0 ${borderSizes[size]} border-accent/30 rounded-full`}></div>
        <div className={`absolute inset-0 ${borderSizes[size]} border-accent border-t-transparent rounded-full animate-spin`}></div>
        {/* Inner glow effect */}
        <div className="absolute inset-2 bg-accent/10 rounded-full blur-sm animate-pulse"></div>
      </div>
      {message && <p className={`${c.textSecondary} text-sm`}>{message}</p>}
    </div>
  );
}

// Skeleton loader for email items
export function EmailSkeleton({ count = 3 }) {
  return (
    <div className="space-y-3 p-4 animate-fadeIn">
      {[...Array(count)].map((_, i) => (
        <div key={i} className="flex gap-4 p-3 rounded-lg bg-dark-700/50" style={{ animationDelay: `${i * 0.1}s` }}>
          <div className="skeleton skeleton-avatar flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="skeleton skeleton-text w-1/3" />
            <div className="skeleton skeleton-text w-2/3" />
            <div className="skeleton skeleton-text w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default LoadingSpinner;
