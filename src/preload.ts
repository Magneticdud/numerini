import { contextBridge, ipcRenderer } from 'electron';

const validChannels = ['numerini-event', 'wizard-mode'];

contextBridge.exposeInMainWorld('numerini', {
  getConfig:    () => ipcRenderer.invoke('get-config'),
  getQueues:    () => ipcRenderer.invoke('get-queues'),
  issueTicket:  (queueId: number) => ipcRenderer.invoke('issue-ticket', queueId),
  callNext:     (queueId: number) => ipcRenderer.invoke('call-next', queueId),
  resetQueue:   (queueId: number) => ipcRenderer.invoke('reset-queue', queueId),
  checkOrder:   (orderCheckUrl: string, orderNumber: string) =>
    ipcRenderer.invoke('check-order', { orderCheckUrl, orderNumber }),
  wizardComplete: (result: { kioskDisplayId: number; displayDisplayId: number | null }) =>
    ipcRenderer.send('wizard-complete', result),
  onEvent: (callback: (event: any) => void) => {
    ipcRenderer.on('numerini-event', (_e, data) => callback(data));
    return () => ipcRenderer.removeAllListeners('numerini-event');
  },
  onWizardMode: (callback: (data: any) => void) => {
    ipcRenderer.once('wizard-mode', (_e, data) => callback(data));
  },
});
