import React, { useState } from 'react';

interface Props {
  queueName: string;
  onConfirm: (orderNumber: string) => void;
  onBack: () => void;
}

const DIGITS = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

export default function OrderNumpad({ queueName, onConfirm, onBack }: Props) {
  const [value, setValue] = useState('');

  const handleKey = (key: string) => {
    if (key === '⌫') {
      setValue(v => v.slice(0, -1));
    } else if (/^\d$/.test(key) && value.length < 10) {
      setValue(v => v + key);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-primary)', padding: '2rem' }}>
      <button
        onClick={onBack}
        style={{ alignSelf: 'flex-start', background: 'none', color: 'var(--text-secondary)', fontSize: '1.1rem', padding: '0.5rem 1rem', borderRadius: '0.5rem' }}
      >← Indietro</button>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2rem' }}>
        <h2 style={{ fontFamily: 'var(--font-ui)', fontSize: '1.5rem', color: 'var(--text-secondary)' }}>
          Coda: {queueName}
        </h2>
        <h1 style={{ fontFamily: 'var(--font-ui)', fontSize: '1.8rem', fontWeight: 600 }}>
          Inserisci il tuo numero ordine:
        </h1>

        {/* Display */}
        <div style={{
          fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '4rem',
          background: 'var(--bg-secondary)', borderRadius: '1rem',
          padding: '1rem 2rem', minWidth: '280px', textAlign: 'center',
          color: value ? 'var(--text-primary)' : 'var(--text-secondary)',
          letterSpacing: '0.1em', minHeight: '5rem',
          border: '2px solid #333',
        }}>
          {value || '—'}
        </div>

        {/* Numpad grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', width: '100%', maxWidth: '360px' }}>
          {DIGITS.map((d, i) => (
            <button
              key={i}
              onClick={() => d && handleKey(d)}
              style={{
                height: '80px', borderRadius: '0.75rem',
                background: d === '⌫' ? '#2d3748' : d ? 'var(--bg-secondary)' : 'transparent',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-display)', fontSize: '2rem', fontWeight: 700,
                border: d ? '2px solid #333' : 'none',
                cursor: d ? 'pointer' : 'default',
                transition: 'background 0.1s',
              }}
              onTouchStart={e => { if (d) (e.currentTarget as HTMLElement).style.background = 'var(--brand-color)'; }}
              onTouchEnd={e => { if (d && d !== '⌫') (e.currentTarget as HTMLElement).style.background = 'var(--bg-secondary)'; else if (d === '⌫') (e.currentTarget as HTMLElement).style.background = '#2d3748'; }}
            >
              {d}
            </button>
          ))}
        </div>

        <button
          disabled={value.length === 0}
          onClick={() => value && onConfirm(value)}
          style={{
            background: value ? 'var(--brand-color)' : '#333',
            color: value ? 'var(--brand-contrast)' : 'var(--text-secondary)',
            fontFamily: 'var(--font-ui)', fontSize: '1.3rem', fontWeight: 600,
            padding: '1rem 3rem', borderRadius: '0.75rem',
            transition: 'background 0.2s',
            width: '100%', maxWidth: '360px', height: '64px',
          }}
        >
          Conferma
        </button>
      </div>
    </div>
  );
}
