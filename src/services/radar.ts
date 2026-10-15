import { Capacitor } from '@capacitor/core';
import { ZapdropWifi } from '../native/zapdrop-native';
import { DeviceProfile } from '../types';
import { getDeviceProfile } from './device';
import { MOCK_RADAR_DEVICES } from './mock';

export interface RadarDiscoverySession {
  stop: () => Promise<void>;
}

const AVATAR = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop&q=80';

export async function startRadarDiscovery(
  onDeviceFound: (device: DeviceProfile) => void,
  onDeviceLost?: (id: string) => void
): Promise<RadarDiscoverySession> {
  if (!Capacitor.isNativePlatform()) {
    const timer = setTimeout(() => MOCK_RADAR_DEVICES.forEach(onDeviceFound), 400);
    return { stop: async () => clearTimeout(timer) };
  }

  const self = await getDeviceProfile();
  const found = await ZapdropWifi.addListener('deviceFound', (peer) => {
    onDeviceFound({
      id: peer.id,
      name: peer.name,
      avatar: AVATAR,
      os: 'android',
      signalStrength: 90,
      status: 'online',
      ip: peer.ip,
      port: peer.port,
      token: peer.token,
    });
  });

  await ZapdropWifi.startDiscovery();
  try {
    const { accessPoints } = await ZapdropWifi.scanHotspots();
    accessPoints.forEach((network) => {
      if (network.ssid === self.name) return;
      onDeviceFound({
        id: `wifi-${network.ssid}`,
        name: network.ssid,
        avatar: AVATAR,
        os: 'android',
        signalStrength: Math.max(0, Math.min(100, 2 * (network.level + 100))),
        status: 'online',
        wifiSsid: network.ssid,
        isAccessPoint: true,
      });
    });
  } catch (error) {
    console.warn('Wi-Fi access-point scan was unavailable; continuing with Zapdrop peer discovery.', error);
  }

  return {
    stop: async () => {
      try {
        await found.remove();
        await ZapdropWifi.stopDiscovery();
      } catch {
        // ignore teardown races
      }
      if (onDeviceLost) onDeviceLost('');
    },
  };
}
