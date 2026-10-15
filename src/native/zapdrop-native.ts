import { registerPlugin, PluginListenerHandle } from '@capacitor/core';

export type NativeMediaType = 'all' | 'image' | 'video' | 'audio' | 'doc' | 'app';

export interface NativeMediaItem {
  id: string;
  uri: string;
  webPath: string;
  name: string;
  size: number;
  mime: string;
  type: NativeMediaType;
  bucket: string;
  modified: number;
}

export interface NativeBucket {
  name: string;
  path: string;
  count: number;
}

export interface ZapdropNativePlugin {
  listBuckets(): Promise<{ buckets: NativeBucket[] }>;
  listMedia(opts: {
    type?: NativeMediaType;
    bucket?: string;
    limit?: number;
    offset?: number;
    query?: string;
  }): Promise<{ items: NativeMediaItem[]; total: number }>;
  getLocalIp(): Promise<{ ip: string | null }>;
  startServer(opts: {
    token: string;
    files: { id: string; uri: string; name: string; size: number; mime: string }[];
  }): Promise<{ ip: string; port: number }>;
  stopServer(): Promise<void>;
  startDiscovery(opts: { deviceId: string; name: string }): Promise<void>;
  stopDiscovery(): Promise<void>;
  addListener(e: 'deviceFound', cb: (d: { id: string; name: string; ip: string; port: number }) => void): Promise<PluginListenerHandle>;
  addListener(e: 'deviceLost', cb: (d: { id: string }) => void): Promise<PluginListenerHandle>;
  addListener(e: 'fileServed', cb: (d: { id: string; bytes: number; total: number }) => void): Promise<PluginListenerHandle>;
  addListener(e: 'transferDone', cb: (d: { peerIp: string }) => void): Promise<PluginListenerHandle>;
}

export interface AccessPoint {
  ssid: string;
  bssid: string;
  level: number;
  capabilities: string;
}

export interface SessionPeer {
  id: string;
  name: string;
  ip: string;
  port: number;
  token: string;
  ssid?: string;
  active: boolean;
}

export interface NativeReceivedFile {
  name: string;
  size: number;
  mime: string;
  uri: string;
}

export interface ZapdropWifiPlugin {
  startHotspot(): Promise<{ ssid: string; password: string }>;
  stopHotspot(): Promise<void>;
  openHotspotSettings(): Promise<void>;
  connectToWifi(opts: { ssid: string; password?: string }): Promise<{ connected: boolean; ssid: string }>;
  disconnectFromWifi(): Promise<void>;
  scanHotspots(): Promise<{ accessPoints: AccessPoint[] }>;
  startDiscovery(): Promise<void>;
  stopDiscovery(): Promise<void>;
  startSessionBroadcast(opts: { deviceId: string; name: string; token: string; port: number; ssid: string }): Promise<void>;
  stopSessionBroadcast(): Promise<void>;
  downloadPeer(opts: { ip: string; port: number; token: string }): Promise<{ files: NativeReceivedFile[] }>;
  addListener(e: 'deviceFound', cb: (d: SessionPeer) => void): Promise<PluginListenerHandle>;
  addListener(e: 'deviceLost', cb: (d: { id: string }) => void): Promise<PluginListenerHandle>;
  addListener(e: 'receiveProgress', cb: (d: {
    fileName: string;
    loaded: number;
    total: number;
    fileIndex: number;
    fileCount: number;
    speedMbps: number;
  }) => void): Promise<PluginListenerHandle>;
}

export const ZapdropNative = registerPlugin<ZapdropNativePlugin>('ZapdropNative');
export const ZapdropWifi = registerPlugin<ZapdropWifiPlugin>('ZapdropWifi');

export interface ZapdropUpdaterPlugin {
  checkForUpdate(): Promise<{
    currentVersion: string;
    latestVersion: string;
    updateAvailable: boolean;
    releaseNotes: string;
    downloadSize: number;
  }>;
  downloadAndInstall(): Promise<{
    permissionRequired: boolean;
    installerLaunched?: boolean;
    version?: string;
    message: string;
  }>;
  addListener(e: 'downloadProgress', cb: (progress: {
    downloadedBytes: number;
    totalBytes: number;
    percent: number;
  }) => void): Promise<PluginListenerHandle>;
}

export const ZapdropUpdater = registerPlugin<ZapdropUpdaterPlugin>('ZapdropUpdater');
