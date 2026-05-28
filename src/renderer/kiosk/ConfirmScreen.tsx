import React, { useEffect, useRef, useState } from 'react';

interface Props {
  number: number;
  queueName: string;
  advisory?: string;
  durationMs: number;
  onDone: () => void;
}

export default function ConfirmScreen({ number, queueName, advisory, durationMs, onDone }: Props) {
  const [remaining, setRemaining] = useState(durationMs);
  const intervalRef = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setRemaining(r => {
        if (r <= 100) {
          clearInterval(intervalRef.current);
          onDone();
          return 0;
        }
        return r - 100;
      });
    }, 100);
    return () => clearInterval(intervalRef.current);
  }, []);

  const progress = Math.max(0, remaining / durationMs);

  return (
    <div
      onClick={onDone}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        height: '100%', background: 'var(--bg-primary)', gap: '1.5rem', cursor: 'pointer',
        animation: 'fadeIn 0.3s ease',
      }}
    >
      <p style={{ fontSize: '1.2rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-ui)' }}>
        Coda: {queueName}
      </p>

      <div style={{
        fontFamily: 'var(--font-display)', fontWeight: 800,
        fontSize: 'clamp(6rem, 25vw, 14rem)',
        color: 'var(--brand-color)',
        lineHeight: 1,
        animation: 'numberReveal 0.4s cubic-bezier(0.22,1,0.36,1)',
      }}>
        {String(number).padStart(3, '0')}
      </div>

      <p style={{ fontSize: '1.1rem', color: 'var(--text-secondary)', fontFamily: 'var(--font-ui)' }}>
        Prendi il tuo scontrino
      </p>

      {advisory && (
        <div style={{
          background: 'var(--bg-secondary)', border: '1px solid var(--color-warning)',
          borderRadius: '0.75rem', padding: '1rem 1.5rem', maxWidth: '480px', textAlign: 'center',
          color: 'var(--color-warning)', fontSize: '0.95rem',
        }}>
          {advisory}
        </div>
      )}

      {/* Progress bar */}
      <div style={{ width: '200px', height: '4px', background: '#333', borderRadius: '2px', marginTop: '1rem' }}>
        <div style={{ width: `${progress * 100}%`, height: '100%', background: 'var(--brand-color)', borderRadius: '2px', transition: 'width 0.1s linear' }} />
      </div>

      <p style={{ fontSize: '0.8rem', color: '#555' }}>Tocca per continuare</p>

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes numberReveal {
          from { opacity: 0; transform: scale(0.7) translateY(20px) }
          to   { opacity: 1; transform: scale(1) translateY(0) }
        }
      `}</style>
    </div>
  );
}
