import React, { useState } from 'react';

interface Props {
  queues: any[];
  onSelect: (queue: any) => void;
  onBack: () => void;
}

const MAX_NAME_LEN = 32;

function truncate(s: string) {
  return s.length > MAX_NAME_LEN ? s.slice(0, MAX_NAME_LEN - 1) + '…' : s;
}

function gridStyle(count: number): React.CSSProperties {
  const cols = count <= 2 ? 1 : 2;
  const minH = count <= 2 ? 140 : count <= 4 ? 120 : 100;
  return {
    display: 'grid',
    gridTemplateColumns: `repeat(${cols}, 1fr)`,
    gap: '1.5rem',
    padding: '2rem',
    flex: 1,
  };
}

export default function QueueGrid({ queues, onSelect, onBack }: Props) {
  const [tapped, setTapped] = useState<number | null>(null);

  const handleTap = (queue: any) => {
    if (tapped !== null) return; // prevent double-tap
    setTapped(queue.id);
    setTimeout(() => {
      onSelect(queue);
      setTapped(null);
    }, 200);
  };

  const minH = queues.length <= 2 ? 140 : queues.length <= 4 ? 120 : 100;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-primary)' }}>
      <header style={{ padding: '1.5rem 2rem', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <button
          onClick={onBack}
          style={{ background: 'none', color: 'var(--text-secondary)', fontSize: '1.2rem', padding: '0.5rem 1rem', borderRadius: '0.5rem' }}
        >← Indietro</button>
        <h1 style={{ fontFamily: 'var(--font-ui)', fontSize: '1.4rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          Seleziona il servizio
        </h1>
      </header>

      <div style={gridStyle(queues.length)}>
        {queues.map(queue => (
          <button
            key={queue.id}
            disabled={tapped !== null && tapped !== queue.id}
            onClick={() => handleTap(queue)}
            style={{
              background: tapped === queue.id ? 'var(--brand-color)' : 'var(--bg-secondary)',
              border: '2px solid',
              borderColor: tapped === queue.id ? 'var(--brand-color)' : '#333',
              borderRadius: '1rem',
              color: 'var(--text-primary)',
              padding: '1.5rem',
              minHeight: `${minH}px`,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              transition: 'background 0.15s, border-color 0.15s',
              opacity: (tapped !== null && tapped !== queue.id) ? 0.5 : 1,
            }}
          >
            <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
              {truncate(queue.name)}
            </span>
            {queue.description && (
              <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                {queue.description}
              </span>
            )}
            {queue.waiting > 0 && (
              <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                {queue.waiting} in attesa
                {queue.eta != null ? ` · ~${Math.round(queue.eta / 60)} min` : ''}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
