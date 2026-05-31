import React, { useEffect, useState, useRef } from 'react';

interface QueueState {
  id: number;
  name: string;
  lastCalled: number;
  lastCalledSuffix: string | null;
  waiting: number;
}

const CHIME_DURATION_MS = 3000;

export default function DisplayApp() {
  const [queues, setQueues] = useState<QueueState[]>([]);
  const [config, setConfig] = useState<any>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [recentCall, setRecentCall] = useState<{ queueId: number; number: number; suffix: string | null } | null>(null);
  const [showingCall, setShowingCall] = useState(false);
  const chimeTimer = useRef<ReturnType<typeof setTimeout>>();
  const rotateTimer = useRef<ReturnType<typeof setInterval>>();

  useEffect(() => {
    window.numerini.getConfig().then(setConfig);
    window.numerini.getQueues().then((qs) => {
      setQueues(qs.map((q: any) => ({ id: q.id, name: q.name, lastCalled: q.lastCalled, lastCalledSuffix: null, waiting: q.waiting })));
    });

    const unsub = window.numerini.onEvent((event) => {
      if (event.type === 'call') {
        setQueues(prev => prev.map(q =>
          q.id === event.queueId
            ? { ...q, lastCalled: event.number, lastCalledSuffix: event.suffix ?? null }
            : q
        ));
        setRecentCall({ queueId: event.queueId, number: event.number, suffix: event.suffix ?? null });
        setShowingCall(true);
        clearTimeout(chimeTimer.current);
        chimeTimer.current = setTimeout(() => setShowingCall(false), CHIME_DURATION_MS);
        playChime();
      } else if (event.type === 'queue_state') {
        setQueues(prev => prev.map(q =>
          q.id === event.queueId
            ? { ...q, lastCalled: event.current, waiting: event.waiting }
            : q
        ));
      } else if (event.type === 'reset') {
        setQueues(prev => prev.map(q =>
          q.id === event.queueId ? { ...q, lastCalled: 0, lastCalledSuffix: null, waiting: 0 } : q
        ));
      }
    });

    return () => { unsub(); clearTimeout(chimeTimer.current); clearInterval(rotateTimer.current); };
  }, []);

  // Rotate between queues every 5 seconds if multiple active queues
  useEffect(() => {
    clearInterval(rotateTimer.current);
    const active = queues.filter(q => q.lastCalled > 0);
    if (active.length > 1) {
      rotateTimer.current = setInterval(() => {
        setActiveIdx(i => (i + 1) % active.length);
      }, 5000);
    }
    return () => clearInterval(rotateTimer.current);
  }, [queues]);

  function playChime() {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
      osc.start();
      osc.stop(ctx.currentTime + 0.8);
    } catch { /* audio not available */ }
  }

  const activeQueues = queues.filter(q => q.lastCalled > 0);
  const displayQueue = activeQueues[activeIdx % Math.max(1, activeQueues.length)];
  const hasAnyCall = activeQueues.length > 0;

  const slidesDir = config?.slidesDir;

  if (!hasAnyCall) {
    return <IdleSlideshow slidesDir={slidesDir} intervalMs={config?.slideshowIntervalMs ?? 10000} />;
  }

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
      {/* Queue name */}
      <p style={{ fontFamily: 'var(--font-ui)', fontSize: 'clamp(1.5rem, 3vw, 2.5rem)', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
        {displayQueue?.name}
      </p>

      {/* Large number */}
      <div
        key={`${displayQueue?.id}-${displayQueue?.lastCalled}-${displayQueue?.lastCalledSuffix}`}
        style={{
          fontFamily: 'var(--font-display)', fontWeight: 800,
          fontSize: 'clamp(10rem, 40vw, 30rem)',
          color: 'var(--brand-color)',
          lineHeight: 0.9,
          animation: showingCall ? 'callReveal 0.5s cubic-bezier(0.22,1,0.36,1)' : 'none',
        }}
      >
        {displayQueue
          ? String(displayQueue.lastCalled).padStart(3, '0') + (displayQueue.lastCalledSuffix ?? '')
          : '000'}
      </div>

      {/* Multi-queue indicator dots */}
      {activeQueues.length > 1 && (
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '2rem' }}>
          {activeQueues.map((q, i) => (
            <div
              key={q.id}
              style={{
                width: '12px', height: '12px', borderRadius: '50%',
                background: i === activeIdx % activeQueues.length ? 'var(--brand-color)' : '#444',
                transition: 'background 0.3s',
              }}
            />
          ))}
        </div>
      )}

      <style>{`
        @keyframes callReveal {
          from { opacity: 0; transform: scale(0.8) }
          to   { opacity: 1; transform: scale(1) }
        }
      `}</style>
    </div>
  );
}

function IdleSlideshow({ slidesDir, intervalMs }: { slidesDir?: string; intervalMs: number }) {
  const [slides, setSlides] = useState<string[]>([]);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (!slidesDir) return;
    try {
      const { readdirSync } = (window as any).require ? (window as any).require('fs') : { readdirSync: () => [] };
      const files: string[] = readdirSync(slidesDir)
        .filter((f: string) => /\.(jpe?g|png|webp)$/i.test(f))
        .map((f: string) => `file://${slidesDir}/${f}`);
      setSlides(files);
    } catch { setSlides([]); }
  }, [slidesDir]);

  useEffect(() => {
    if (slides.length <= 1) return;
    const t = setInterval(() => setCurrent(c => (c + 1) % slides.length), intervalMs);
    return () => clearInterval(t);
  }, [slides, intervalMs]);

  if (slides.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '4rem', color: 'var(--brand-color)' }}>Numerini</div>
          <p style={{ fontSize: '1.5rem', color: 'var(--text-secondary)', marginTop: '1rem' }}>In attesa di apertura</p>
        </div>
      </div>
    );
  }

  return (
    <img
      key={current}
      src={slides[current]}
      alt=""
      style={{ width: '100%', height: '100%', objectFit: 'cover', animation: 'fadeIn 0.5s ease' }}
    />
  );
}
