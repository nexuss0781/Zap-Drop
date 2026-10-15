import { Capacitor } from '@capacitor/core';
import { ZapdropNative, ZapdropWifi } from '../native/zapdrop-native';
import { getDeviceProfile } from './device';
import { makeQrDataUrl } from './qr';
import { holdScreen, releaseScreen } from './keepawake';
import { addHistory } from './storage';
import { DeviceFile } from '../types';

export interface SendSession {
  qrCodeUrl: string;
  ip: string;
  port: number;
  token: string;
  ssid: string;
  password: string;
  stop: () => Promise<void>;
}

export async function startSend(
  selectedFiles: DeviceFile[],
  onProgress?: (id: string, bytes: number, total: number) => void,
  onDone?: () => void,
  onStatus?: (status: string) => void,
): Promise<SendSession> {
  const profile = await getDeviceProfile();
  const token = Math.random().toString(36).substring(2, 10);

  if (!Capacitor.isNativePlatform()) {
    const payload = {
      v: 1 as const,
      ip: '192.168.1.100',
      port: 8080,
      token,
      name: profile.name,
      deviceId: profile.id,
      files: selectedFiles.map((f) => ({
        id: f.id,
        name: f.name,
        size: f.size,
        mime: f.mimeType || 'application/octet-stream',
      })),
    };
    const qrCodeUrl = await makeQrDataUrl(payload);
    return {
      qrCodeUrl,
      ip: '192.168.1.100',
      port: 8080,
      token,
      ssid: 'Zapdrop-Hotspot',
      password: '',
      stop: async () => {},
    };
  }

  onStatus?.('Requesting Android Wi-Fi permission…');
  const hotspot = await ZapdropWifi.startHotspot();
  onStatus?.('Hotspot is ready. Starting the transfer server…');
  const nativeFiles = selectedFiles.map((f) => ({
    id: f.id,
    uri: f.nativeUri || f.path,
    name: f.name,
    size: f.size,
    mime: f.mimeType || 'application/octet-stream',
  }));

  let serverStarted = false;
  let progressSub: { remove: () => Promise<void> } | null = null;
  let doneSub: { remove: () => Promise<void> } | null = null;
  try {
    const { ip, port } = await ZapdropNative.startServer({
      token,
      files: nativeFiles,
    });
    serverStarted = true;
    if (!ip) throw new Error('Android started the hotspot but could not find its local address.');
    onStatus?.('Preparing your secure transfer QR code…');

    const payload = {
      v: 1 as const,
      ip,
      port,
      token,
      name: profile.name,
      deviceId: profile.id,
      ssid: hotspot.ssid,
      password: hotspot.password,
      files: nativeFiles.map(({ id, name, size, mime }) => ({ id, name, size, mime })),
    };
    const qrCodeUrl = await makeQrDataUrl(payload);
    await holdScreen();
    await ZapdropWifi.startSessionBroadcast({
      deviceId: profile.id,
      name: profile.name,
      token,
      port,
      ssid: hotspot.ssid,
    });
    onStatus?.('Ready to connect. Scan this QR code on the other device.');

    progressSub = await ZapdropNative.addListener('fileServed', (event) => {
      if (onProgress) onProgress(event.id, event.bytes, event.total);
    });
    doneSub = await ZapdropNative.addListener('transferDone', async () => {
      for (const file of selectedFiles) {
        await addHistory({
          id: `sent-${Date.now()}-${file.id}`,
          fileName: file.name,
          size: file.size,
          direction: 'sent',
          peerName: 'Connected Peer',
          at: Date.now(),
          status: 'done',
        });
      }
      if (onDone) onDone();
    });

    let stopped = false;
    const stop = async () => {
      if (stopped) return;
      stopped = true;
      try {
        await progressSub?.remove();
        await doneSub?.remove();
        await ZapdropWifi.stopSessionBroadcast();
        await ZapdropNative.stopServer();
        await ZapdropWifi.stopHotspot();
        await releaseScreen();
      } catch {
        // Cleanup is intentionally best-effort when a sheet is dismissed.
      }
    };

    return { qrCodeUrl, ip, port, token, ssid: hotspot.ssid, password: hotspot.password, stop };
  } catch (error) {
    try {
      await progressSub?.remove();
      await doneSub?.remove();
      await ZapdropWifi.stopSessionBroadcast();
      if (serverStarted) await ZapdropNative.stopServer();
      await ZapdropWifi.stopHotspot();
      await releaseScreen();
    } catch {
      // Do not replace the startup error with a cleanup error.
    }
    throw error;
  }
}
