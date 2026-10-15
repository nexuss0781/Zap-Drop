export type OSPlatform = 'android' | 'macos' | 'windows' | 'linux' | 'ios';

export interface DeviceProfile {
  id: string;
  name: string;
  avatar: string;
  os: OSPlatform;
  signalStrength: number;
  status: 'online' | 'busy' | 'pairing';
  ip?: string;
  port?: number;
  token?: string;
  wifiSsid?: string;
  isAccessPoint?: boolean;
}

export type FileCategory = 'all' | 'images' | 'videos' | 'audio' | 'documents' | 'apps' | 'archives';

export interface DeviceFile {
  id: string;
  name: string;
  path: string;
  size: number;
  modifiedDate: string;
  category: FileCategory;
  mimeType: string;
  isDirectory: boolean;
  previewUrl?: string;
  blob?: Blob;
  extension: string;
  nativeUri?: string;
}

export interface TransferRecord {
  id: string;
  fileName: string;
  fileSize: number;
  fileType: string;
  category: FileCategory;
  senderId: string;
  senderName: string;
  senderAvatar: string;
  senderOs: OSPlatform;
  receiverId: string;
  receiverName: string;
  receiverAvatar: string;
  receiverOs: OSPlatform;
  direction: 'sent' | 'received';
  timestamp: number;
  dateLabel: string;
  status: 'transferring' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  speedMbps: number;
  filePath?: string;
}

export interface FolderNode {
  name: string;
  path: string;
  icon: string;
  itemsCount: number;
  totalSize: string;
}

export interface HotspotState {
  enabled: boolean;
  ssid: string;
  password: string;
}

export type ActiveTab = 'files' | 'history' | 'profile';
