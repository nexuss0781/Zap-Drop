import { Capacitor } from '@capacitor/core';
import { ZapdropWifi } from '../native/zapdrop-native';
import { DeviceProfile } from '../types';
import { scanQr, parsePayload, QrPayload } from './scanner';
import { downloadToDevice } from './files';
import { addHistory } from './storage';
import { notifyDone, showToast } from './notify';
import { holdScreen, releaseScreen } from './keepawake';

export interface ReceiveProgressInfo {
  fileName: string;
  loaded: number;
  total: number;
  fileIndex: number;
  fileCount: number;
  speedMbps: number;
}

export interface ReceivedFile {
  name: string;
  size: number;
  mime: string;
  uri: string;
}

async function nativeDownload(
  connection: { ip: string; port: number; token: string; ssid?: string; password?: string },
  onProgress: (info: ReceiveProgressInfo) => void
): Promise<ReceivedFile[]> {
  if (connection.ssid && connection.password) {
    await ZapdropWifi.connectToWifi({ ssid: connection.ssid, password: connection.password });
  }
  const progressSub = await ZapdropWifi.addListener('receiveProgress', onProgress);
  try {
    const result = await ZapdropWifi.downloadPeer({
      ip: connection.ip,
      port: connection.port,
      token: connection.token,
    });
    return result.files;
  } finally {
    await progressSub.remove();
  }
}

async function recordReceivedFiles(files: ReceivedFile[], peerName: string, peerId: string) {
  for (const file of files) {
    await addHistory({
      id: `recv-${Date.now()}-${file.name}-${Math.random().toString(36).slice(2, 7)}`,
      fileName: file.name,
      size: file.size,
      direction: 'received',
      peerName,
      at: Date.now(),
      status: 'done',
      filePath: file.uri,
      mimeType: file.mime,
    });
  }
}

export async function startReceive(
  onProgress: (info: ReceiveProgressInfo) => void,
  manualPayload?: QrPayload
): Promise<ReceivedFile[]> {
  let payload = manualPayload;
  if (!payload) {
    const raw = await scanQr();
    if (!raw) throw new Error('No Zapdrop QR code scanned');
    payload = parsePayload(raw) || undefined;
    if (!payload) throw new Error('Invalid Zapdrop QR code');
  }

  await holdScreen();
  try {
    let files: ReceivedFile[];
    if (Capacitor.isNativePlatform()) {
      files = await nativeDownload(payload, onProgress);
    } else {
      files = [];
      for (let index = 0; index < payload.files.length; index++) {
        const file = payload.files[index];
        const url = `http://${payload.ip}:${payload.port}/file/${file.id}?t=${payload.token}`;
        let lastTime = Date.now();
        let lastBytes = 0;
        const savedPath = await downloadToDevice(url, file.name, (loaded, total) => {
          const now = Date.now();
          const seconds = (now - lastTime) / 1000;
          let speed = 0;
          if (seconds > 0.5) {
            speed = ((loaded - lastBytes) * 8) / (seconds * 1024 * 1024);
            lastTime = now;
            lastBytes = loaded;
          }
          onProgress({
            fileName: file.name,
            loaded,
            total: total || file.size,
            fileIndex: index + 1,
            fileCount: payload!.files.length,
            speedMbps: Math.max(speed, 12.5),
          });
        });
        files.push({ name: file.name, size: file.size, mime: file.mime, uri: savedPath });
      }
    }

    await recordReceivedFiles(files, payload.name, payload.deviceId);
    await notifyDone(files[0]?.name || 'files', files.length);
    await showToast('Drop complete. Saved to Downloads/Zapdrop.');
    return files;
  } finally {
    await releaseScreen();
  }
}

export async function startPeerReceive(
  peer: DeviceProfile,
  onProgress: (info: ReceiveProgressInfo) => void
): Promise<ReceivedFile[]> {
  if (!Capacitor.isNativePlatform()) throw new Error('Direct peer transfer is available in the Android app.');
  if (!peer.ip || !peer.port || !peer.token) throw new Error('Scan the Zapdrop QR code or connect to the same local hotspot first.');
  await holdScreen();
  try {
    const files = await nativeDownload({ ip: peer.ip, port: peer.port, token: peer.token }, onProgress);
    await recordReceivedFiles(files, peer.name, peer.id);
    await showToast('Drop complete. Saved to Downloads/Zapdrop.');
    return files;
  } finally {
    await releaseScreen();
  }
}
