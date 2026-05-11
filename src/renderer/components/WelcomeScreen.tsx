import React, { useState } from 'react';

export type AppLanguage = 'en' | 'de' | 'el';

const LANG_OPTIONS: { code: AppLanguage; flag: string; label: string }[] = [
  { code: 'en', flag: '🇬🇧', label: 'EN' },
  { code: 'de', flag: '🇩🇪', label: 'DE' },
  { code: 'el', flag: '🇬🇷', label: 'EL' },
];

const GO_LABELS: Record<AppLanguage, string> = {
  en: "Let's go!",
  de: "Los geht's!",
  el: 'Πάμε!',
};

interface Props {
  onSelect: (lang: AppLanguage) => void;
}

export function WelcomeScreen({ onSelect }: Props) {
  const [selected, setSelected] = useState<AppLanguage>('en');

  return (
    <div className="welcome-overlay">
      <img
        className="welcome-logo"
        src="assets/icon.png"
        alt="Gemma4kids"
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
      />
      <h1 className="welcome-title">Welcome to Gemma4kids!</h1>
      <p className="welcome-subtitle">Pick your language to get started</p>
      <div className="welcome-lang-tabs">
        {LANG_OPTIONS.map(({ code, flag, label }) => (
          <button
            key={code}
            className={`welcome-lang-btn${selected === code ? ' welcome-lang-btn-active' : ''}`}
            onClick={() => setSelected(code)}
          >
            {flag} {label}
          </button>
        ))}
      </div>
      <button className="welcome-go-btn" onClick={() => onSelect(selected)}>
        {GO_LABELS[selected]}
      </button>
    </div>
  );
}
