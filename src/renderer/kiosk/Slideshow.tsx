import React, { useState, useEffect } from 'react';

interface Props {
  slidesDir?: string;
  intervalMs: number;
  onTap: () => void;
}

// In Electron renderer, we can use the local file path to show images
// The slides directory is passed via config from main process

export default function Slideshow({ slidesDir, intervalMs, onTap }: Props) {
  const [slides, setSlides] = useState<string[]>([]);
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (!slidesDir) return;
    // Load available images from the slides directory via a native approach
    // We'll show a placeholder if no slides exist
    try {
      const { readdirSync } = window.require ? window.require('fs') : { readdirSync: () => [] };
      const files: string[] = readdirSync(slidesDir)
        .filter((f: string) => /\.(jpe?g|png|webp)$/i.test(f))
        .map((f: string) => `file://${slidesDir}/${f}`);
      setSlides(files);
    } catch {
      setSlides([]);
    }
  }, [slidesDir]);

  useEffect(() => {
    if (slides.length <= 1) return;
    const t = setInterval(() => setCurrent(c => (c + 1) % slides.length), intervalMs);
    return () => clearInterval(t);
  }, [slides, intervalMs]);

  return (
    <div
      onClick={onTap}
      style={{
        width: '100%', height: '100%', position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-primary)', cursor: 'pointer', overflow: 'hidden',
      }}
    >
      {slides.length > 0 ? (
        <img
          src={slides[current]}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover', animation: 'fadeIn 0.5s ease' }}
        />
      ) : (
        <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: '3rem', color: 'var(--brand-color)', marginBottom: '1rem' }}>
            Numerini
          </div>
          <p style={{ fontSize: '1.3rem' }}>Tocca per prendere il numero</p>
        </div>
      )}

      {/* "Tap to continue" hint */}
      <div style={{ position: 'absolute', bottom: '2rem', left: 0, right: 0, textAlign: 'center' }}>
        <span style={{
          background: 'rgba(0,0,0,0.5)', color: '#fff',
          padding: '0.5rem 1.5rem', borderRadius: '2rem', fontSize: '1rem',
        }}>
          Tocca per iniziare
        </span>
      </div>

      <style>{`@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }`}</style>
    </div>
  );
}
