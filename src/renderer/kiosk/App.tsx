import React, { useEffect, useState, useCallback } from 'react';
import QueueGrid from './QueueGrid';
import ConfirmScreen from './ConfirmScreen';
import OrderNumpad from './OrderNumpad';
import Slideshow from './Slideshow';

declare global {
  interface Window {
    numerini: {
      getConfig: () => Promise<any>;
      getQueues: () => Promise<any[]>;
      issueTicket: (queueId: number) => Promise<{ ok: boolean; ticket?: any; error?: string }>;
      callNext: (queueId: number) => Promise<{ ok: boolean; number?: number; error?: string }>;
      resetQueue: (queueId: number) => Promise<{ ok: boolean }>;
      checkOrder: (queueId: number, num: string) => Promise<'ready' | 'not_ready' | 'error'>;
      wizardComplete: (result: any) => void;
      onEvent: (cb: (event: any) => void) => () => void;
      onWizardMode: (cb: (data: any) => void) => void;
    };
  }
}

type Screen =
  | { name: 'idle' }
  | { name: 'queue-select' }
  | { name: 'numpad'; queueId: number }
  | { name: 'checking' }
  | { name: 'confirm'; ticketNumber: number; queueName: string; advisory?: string }
  | { name: 'error'; message: string };

export default function App() {
  const [queues, setQueues] = useState<any[]>([]);
  const [screen, setScreen] = useState<Screen>({ name: 'idle' });
  const [config, setConfig] = useState<any>(null);
  const [printerOk, setPrinterOk] = useState(true);

  const IDLE_TIMEOUT_MS = 30_000;
  const CONFIRM_DURATION_MS = 8_000;

  useEffect(() => {
    window.numerini.getConfig().then(setConfig);
    window.numerini.getQueues().then(setQueues);
    const unsub = window.numerini.onEvent((event) => {
      if (event.type === 'queue_state') {
        setQueues(prev => prev.map(q =>
          q.id === event.queueId ? { ...q, lastCalled: event.current, waiting: event.waiting } : q
        ));
      }
    });
    return unsub;
  }, []);

  const goIdle = useCallback(() => setScreen({ name: 'idle' }), []);

  const handleQueueTap = useCallback(async (queue: any) => {
    if (queue.type === 'order_pickup' && queue.orderCheckUrl) {
      setScreen({ name: 'numpad', queueId: queue.id });
      return;
    }
    await doIssueTicket(queue.id, queue.name);
  }, []);

  const doIssueTicket = async (queueId: number, queueName: string, advisory?: string) => {
    const result = await window.numerini.issueTicket(queueId);
    if (result.ok && result.ticket) {
      setPrinterOk(true);
      setScreen({ name: 'confirm', ticketNumber: result.ticket.number, queueName, advisory });
      // Refresh queue list
      window.numerini.getQueues().then(setQueues);
    } else {
      setPrinterOk(false);
      setScreen({ name: 'error', message: 'Stampante non disponibile. Riprova.' });
      setTimeout(goIdle, 4000);
    }
  };

  const handleNumpadConfirm = async (queueId: number, queueName: string, orderNumber: string) => {
    setScreen({ name: 'checking' });
    const result = await window.numerini.checkOrder(queueId, orderNumber);
    // Always issue the ticket — result only affects the message
    const advisory = result === 'not_ready'
      ? 'Il sistema non ha ancora aggiornato il tuo ordine. Verifica al bancone.'
      : undefined;
    await doIssueTicket(queueId, queueName, advisory);
  };

  const queueName = (id: number) => queues.find(q => q.id === id)?.name ?? '';

  if (screen.name === 'idle') {
    return <Slideshow slidesDir={config?.slidesDir} intervalMs={config?.slideshowIntervalMs ?? 10000} onTap={() => setScreen({ name: 'queue-select' })} />;
  }

  if (screen.name === 'queue-select') {
    return (
      <QueueGrid
        queues={queues}
        onSelect={handleQueueTap}
        onBack={goIdle}
      />
    );
  }

  if (screen.name === 'numpad') {
    return (
      <OrderNumpad
        queueName={queueName(screen.queueId)}
        onConfirm={(num) => handleNumpadConfirm(screen.queueId, queueName(screen.queueId), num)}
        onBack={() => setScreen({ name: 'queue-select' })}
      />
    );
  }

  if (screen.name === 'checking') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '2rem' }}>
        <div className="spinner" />
        <p style={{ fontSize: '1.5rem', color: 'var(--text-secondary)' }}>Verifica in corso...</p>
      </div>
    );
  }

  if (screen.name === 'confirm') {
    return (
      <ConfirmScreen
        number={screen.ticketNumber}
        queueName={screen.queueName}
        advisory={screen.advisory}
        durationMs={CONFIRM_DURATION_MS}
        onDone={goIdle}
      />
    );
  }

  if (screen.name === 'error') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <p style={{ fontSize: '1.5rem', color: 'var(--color-error)' }}>{screen.message}</p>
      </div>
    );
  }

  return null;
}
