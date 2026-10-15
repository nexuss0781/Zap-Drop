import { BarcodeScanner, BarcodeFormat } from '@capacitor-mlkit/barcode-scanning';
import { Capacitor } from '@capacitor/core';

export interface QrPayload {
  v: 1;
  ip: string;
  port: number;
  token: string;
  name: string;
  deviceId: string;
  ssid?: string;
  password?: string;
  files: { id: string; name: string; size: number; mime: string }[];
}

export async function scanQr(): Promise<string | null> {
  if (!Capacitor.isNativePlatform()) {
    // In web preview, simulate scan or prompt code
    return null;
  }

  try {
    const isSupported = await BarcodeScanner.isSupported();
    if (!isSupported.supported) {
      return null;
    }

    const perm = await BarcodeScanner.requestPermissions();
    if (perm.camera !== 'granted' && perm.camera !== 'limited') {
      return null;
    }

    const { barcodes } = await BarcodeScanner.scan({
      formats: [BarcodeFormat.QrCode],
    });

    return barcodes[0]?.rawValue ?? null;
  } catch (e) {
    console.error('QR Scan error:', e);
    return null;
  }
}

export function parsePayload(raw: string): QrPayload | null {
  try {
    const p = JSON.parse(raw);
    return p?.v === 1 && p.ip && p.port && p.token ? p : null;
  } catch {
    return null;
  }
}
