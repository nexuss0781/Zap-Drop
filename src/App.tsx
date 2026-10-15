import React, { useState, useEffect, useRef } from 'react';
import {
  ActiveTab,
  DeviceFile,
  DeviceProfile,
  FileCategory,
  HotspotState,
  TransferRecord,
} from './types';
import {
  DEFAULT_SAMPLE_PEERS,
  INITIAL_TRANSFERS,
  AVATAR_PRESETS,
} from './services/mockNetwork';
import { INITIAL_FILES, PlatformBridge } from './services/platformBridge';
import { getDeviceProfile } from './services/device';
import { watchNetwork } from './services/network';
import { Header } from './components/Header';
import { BottomNav } from './components/BottomNav';
import { DeviceExplorer } from './components/DeviceExplorer';
import { TransferHistory } from './components/TransferHistory';
import { ProfileSettings } from './components/ProfileSettings';
import { SendModal } from './components/SendModal';
import { ReceiveModal } from './components/ReceiveModal';
import { ReceivedFile } from './services/receive';
import { TransferProgressModal } from './components/TransferProgressModal';
import { StatusBar, Style } from '@capacitor/status-bar';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { loadFiles } from './services/library';

export default function App() {
  const detectedOs = PlatformBridge.getDetectedOS();

  // Screen size detection: Desktop (>= 1024px) vs Phone / Tablet (< 1024px)
  const [isDesktopView, setIsDesktopView] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : false
  );

  useEffect(() => {
    const handleResize = () => {
      setIsDesktopView(window.innerWidth >= 1024);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Device profile state
  const [myProfile, setMyProfile] = useState<DeviceProfile>(() => {
    const saved = localStorage.getItem('zapdrop_profile');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {}
    }
    return {
      id: 'self-dev-' + Math.random().toString(36).substring(2, 7),
      name: detectedOs === 'android' ? 'Galaxy S24' : 'MacBook Pro',
      avatar: AVATAR_PRESETS[0],
      os: detectedOs,
      signalStrength: 99,
      status: 'online',
    };
  });

  // Load real device info on launch
  useEffect(() => {
    getDeviceProfile().then((p) => {
      if (p) {
        setMyProfile((prev) => ({
          ...prev,
          id: p.id,
          name: p.name || prev.name,
          avatar: p.avatar || prev.avatar,
        }));
      }
    });

    if (Capacitor.isNativePlatform()) {
      StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
      StatusBar.setBackgroundColor({ color: '#0d0e12' }).catch(() => {});

      // Capacitor Back Button handling
      const backSub = CapApp.addListener('backButton', ({ canGoBack }) => {
        if (isSendModalOpen) {
          setIsSendModalOpen(false);
        } else if (isReceiveModalOpen) {
          setIsReceiveModalOpen(false);
        } else if (isActionMenuOpen) {
          setIsActionMenuOpen(false);
        } else if (activeTab !== 'files') {
          setActiveTab('files');
        } else if (canGoBack) {
          window.history.back();
        } else {
          CapApp.exitApp();
        }
      });

      const netSub = watchNetwork((online) => {
        setMyProfile((prev) => ({ ...prev, status: online ? 'online' : 'busy' }));
      });

      return () => {
        backSub.then((s) => s.remove());
        netSub.then((s) => s.remove());
      };
    }
  }, []);

  // Hotspot state
  const [hotspotState, setHotspotState] = useState<HotspotState>(() => ({
    enabled: false,
    ssid: 'Zapdrop-Hotspot',
    password: 'zap-speed-889',
  }));

  // Discovered peers
  const [peers, setPeers] = useState<DeviceProfile[]>(DEFAULT_SAMPLE_PEERS);

  // Files in device storage
  const [files, setFiles] = useState<DeviceFile[]>(() => {
    const saved = localStorage.getItem('zapdrop_files');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {}
    }
    return INITIAL_FILES;
  });

  // Selection & Transfers
  const [selectedFiles, setSelectedFiles] = useState<DeviceFile[]>([]);
  const [transfers, setTransfers] = useState<TransferRecord[]>(() => {
    const saved = localStorage.getItem('zapdrop_transfers');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {}
    }
    return INITIAL_TRANSFERS;
  });

  // Active tab (Default: files / home folder screen above navigation)
  const [activeTab, setActiveTab] = useState<ActiveTab>('files');
  const [isSendModalOpen, setIsSendModalOpen] = useState(false);
  const [isSendCollapsed, setIsSendCollapsed] = useState(false);
  const [isReceiveModalOpen, setIsReceiveModalOpen] = useState(false);
  const [isReceiveCollapsed, setIsReceiveCollapsed] = useState(false);
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const [currentTransfer, setCurrentTransfer] = useState<TransferRecord | null>(null);

  const isCardActive = isSendModalOpen || isReceiveModalOpen;
  const isAnyCardCollapsed = (isSendModalOpen && isSendCollapsed) || (isReceiveModalOpen && isReceiveCollapsed);

  const handleToggleCardCollapse = () => {
    if (isReceiveModalOpen) {
      setIsReceiveCollapsed((prev) => !prev);
    } else if (isSendModalOpen) {
      setIsSendCollapsed((prev) => !prev);
    }
  };

  const transferIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    localStorage.setItem('zapdrop_profile', JSON.stringify(myProfile));
  }, [myProfile]);

  useEffect(() => {
    localStorage.setItem('zapdrop_transfers', JSON.stringify(transfers));
  }, [transfers]);

  // File selection toggles
  const handleToggleSelectFile = (file: DeviceFile) => {
    setSelectedFiles((prev) => {
      const exists = prev.some((f) => f.id === file.id);
      if (exists) {
        return prev.filter((f) => f.id !== file.id);
      } else {
        return [...prev, file];
      }
    });
  };

  const handleSelectAll = () => {
    setSelectedFiles(files);
  };

  const handleClearSelection = () => {
    setSelectedFiles([]);
  };

  const handleAddNewFiles = (newFiles: DeviceFile[]) => {
    setFiles((prev) => [...newFiles, ...prev]);
  };

  const handleDeleteFile = (fileId: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
    setSelectedFiles((prev) => prev.filter((f) => f.id !== fileId));
  };

  // Open send with files selected
  const handleOpenSendWithFiles = (selected: DeviceFile[]) => {
    setSelectedFiles(selected);
    setIsReceiveModalOpen(false);
    setIsSendModalOpen(true);
    setIsSendCollapsed(false);
    setIsActionMenuOpen(false);
  };

  // Open send from action button
  const handleOpenSend = () => {
    if (selectedFiles.length === 0 && files.length > 0) {
      setSelectedFiles([files[0]]);
    }
    setIsReceiveModalOpen(false);
    setIsSendModalOpen(true);
    setIsSendCollapsed(false);
    setIsActionMenuOpen(false);
  };

  // Open receive from action button
  const handleOpenReceive = () => {
    setIsSendModalOpen(false);
    setIsReceiveModalOpen(true);
    setIsReceiveCollapsed(false);
    setIsActionMenuOpen(false);
  };

  // Connect to peer in receive radar
  const handleConnectDevice = (peer: DeviceProfile, receivedFiles?: ReceivedFile[]) => {
    if (receivedFiles?.length) {
      const now = Date.now();
      const records: TransferRecord[] = receivedFiles.map((file, index) => {
        let category: FileCategory = 'documents';
        if (file.mime.startsWith('image/')) category = 'images';
        else if (file.mime.startsWith('video/')) category = 'videos';
        else if (file.mime.startsWith('audio/')) category = 'audio';
        else if (file.mime === 'application/vnd.android.package-archive') category = 'apps';
        else if (/\.(zip|rar|7z|tar|gz)$/i.test(file.name)) category = 'archives';
        return {
          id: `drop-${now}-${index}`,
          fileName: file.name,
          fileSize: file.size,
          fileType: file.mime,
          category,
          senderId: peer.id,
          senderName: peer.name,
          senderAvatar: peer.avatar,
          senderOs: peer.os,
          receiverId: myProfile.id,
          receiverName: myProfile.name,
          receiverAvatar: myProfile.avatar,
          receiverOs: myProfile.os,
          direction: 'received' as const,
          timestamp: now,
          dateLabel: 'Just now',
          status: 'completed' as const,
          progress: 100,
          speedMbps: 0,
          filePath: file.uri,
        };
      });
      setTransfers((previous) => [...records, ...previous]);
      loadFiles('all').then(setFiles).catch(() => {});
      return;
    }
    if (selectedFiles.length === 0 && files.length > 0) {
      setSelectedFiles([files[0]]);
    }
    const targetFile = selectedFiles[0] || files[0];
    if (!targetFile) return;

    const newRecord: TransferRecord = {
      id: 'tr-' + Date.now(),
      fileName: targetFile.name,
      fileSize: targetFile.size,
      fileType: targetFile.mimeType,
      category: targetFile.category,
      senderId: myProfile.id,
      senderName: myProfile.name,
      senderAvatar: myProfile.avatar,
      senderOs: myProfile.os,
      receiverId: peer.id,
      receiverName: peer.name,
      receiverAvatar: peer.avatar,
      receiverOs: peer.os,
      direction: 'sent',
      timestamp: Date.now(),
      dateLabel: 'Just now',
      status: 'transferring',
      progress: 0,
      speedMbps: 45.5,
    };

    setCurrentTransfer(newRecord);
    setTransfers((prev) => [newRecord, ...prev]);

    // Simulated transfer progress for peer direct click
    let p = 0;
    if (transferIntervalRef.current) clearInterval(transferIntervalRef.current);
    transferIntervalRef.current = setInterval(() => {
      p += 15;
      if (p >= 100) {
        if (transferIntervalRef.current) clearInterval(transferIntervalRef.current);
        setCurrentTransfer((prev) => (prev ? { ...prev, progress: 100, status: 'completed' } : null));
        setTransfers((prev) =>
          prev.map((t) => (t.id === newRecord.id ? { ...t, progress: 100, status: 'completed' } : t))
        );
      } else {
        setCurrentTransfer((prev) => (prev ? { ...prev, progress: p } : null));
        setTransfers((prev) =>
          prev.map((t) => (t.id === newRecord.id ? { ...t, progress: p } : t))
        );
      }
    }, 400);
  };

  const handleCloseTransferModal = () => {
    if (transferIntervalRef.current) clearInterval(transferIntervalRef.current);
    setCurrentTransfer(null);
  };

  const handleUpdateProfile = (updated: Partial<DeviceProfile>) => {
    setMyProfile((prev) => ({ ...prev, ...updated }));
  };

  const handleUpdateHotspot = (updated: Partial<HotspotState>) => {
    setHotspotState((prev) => ({ ...prev, ...updated }));
  };

  const handleClearHistory = () => {
    setTransfers([]);
  };

  const handleDeleteTransfer = (id: string) => {
    setTransfers((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <div className="min-h-screen bg-[#0d0e12] text-slate-100 flex flex-col font-sans selection:bg-[#22c55e]/30 selection:text-white">
      
      {/* Top Header */}
      <Header
        myProfile={myProfile}
        hotspotState={hotspotState}
        onOpenProfile={() => setActiveTab('profile')}
        isDesktopView={isDesktopView}
      />

      {/* Main View Area */}
      <main className="flex-1 overflow-y-auto">
        {activeTab === 'files' && (
          <DeviceExplorer
            files={files}
            selectedFiles={selectedFiles}
            onToggleSelectFile={handleToggleSelectFile}
            onSelectAll={handleSelectAll}
            onClearSelection={handleClearSelection}
            onOpenSendWithFiles={handleOpenSendWithFiles}
            onAddNewFiles={handleAddNewFiles}
            onDeleteFile={handleDeleteFile}
          />
        )}

        {activeTab === 'history' && (
          <TransferHistory
            transfers={transfers}
            onClearHistory={handleClearHistory}
            onDeleteTransfer={handleDeleteTransfer}
            onResend={(record) => {
              const matched = files.find((f) => f.name === record.fileName);
              if (matched) handleOpenSendWithFiles([matched]);
            }}
          />
        )}

        {activeTab === 'profile' && (
          <ProfileSettings
            myProfile={myProfile}
            onUpdateProfile={handleUpdateProfile}
            hotspotState={hotspotState}
            onUpdateHotspot={handleUpdateHotspot}
          />
        )}
      </main>

      {/* Send Modal Sheet */}
      <SendModal
        isOpen={isSendModalOpen}
        onClose={() => setIsSendModalOpen(false)}
        selectedFiles={selectedFiles}
        hotspotState={hotspotState}
        myProfile={myProfile}
        isCollapsed={isSendCollapsed}
        setIsCollapsed={setIsSendCollapsed}
      />

      {/* Receive Modal Sheet */}
      <ReceiveModal
        isOpen={isReceiveModalOpen}
        onClose={() => setIsReceiveModalOpen(false)}
        myProfile={myProfile}
        peers={peers}
        onConnectDevice={handleConnectDevice}
        isCollapsed={isReceiveCollapsed}
        setIsCollapsed={setIsReceiveCollapsed}
      />

      {/* Active Transfer Progress Modal */}
      {currentTransfer && (
        <TransferProgressModal
          currentTransfer={currentTransfer}
          onCancel={handleCloseTransferModal}
          onDismiss={handleCloseTransferModal}
          onDownloadCompleted={() => {}}
        />
      )}

      {/* Bottom Floating Navigation (History, Share with revealed Send/Receive circles, Profile) */}
      <BottomNav
        activeTab={activeTab}
        onSelectTab={(tab) => {
          setActiveTab(tab);
          setIsActionMenuOpen(false);
        }}
        onOpenSend={handleOpenSend}
        onOpenReceive={handleOpenReceive}
        isActionMenuOpen={isActionMenuOpen}
        setIsActionMenuOpen={setIsActionMenuOpen}
        isDesktopView={isDesktopView}
        isCardOpen={isCardActive}
        isCardCollapsed={isAnyCardCollapsed}
        onToggleCardCollapse={handleToggleCardCollapse}
      />

    </div>
  );
}
