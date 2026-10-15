import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Capacitor } from '@capacitor/core';
import { X, ChevronDown, ChevronUp, AlertCircle, Smartphone, Monitor, QrCode, Wifi } from 'lucide-react';
import { DeviceProfile, OSPlatform } from '../types';
import { startPeerReceive, startReceive, ReceiveProgressInfo, ReceivedFile } from '../services/receive';
import { startRadarDiscovery } from '../services/radar';
import { ZapdropWifi } from '../native/zapdrop-native';

interface ReceiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  myProfile: DeviceProfile;
  peers: DeviceProfile[];
  onConnectDevice: (device: DeviceProfile, files?: ReceivedFile[]) => void;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
}

export const ReceiveModal: React.FC<ReceiveModalProps> = ({
  isOpen,
  onClose,
  myProfile,
  onConnectDevice,
  isCollapsed,
  setIsCollapsed,
}) => {
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [connectingPeerId, setConnectingPeerId] = useState<string | null>(null);
  const [radarDevices, setRadarDevices] = useState<DeviceProfile[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [progressInfo, setProgressInfo] = useState<ReceiveProgressInfo | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const isAndroidApp = Capacitor.isNativePlatform();

  useEffect(() => {
    if (!isOpen) {
      setRadarDevices([]);
      setProgressInfo(null);
      setStatusMessage(null);
      setIsScanning(false);
      return;
    }

    let isMounted = true;
    let stopDiscovery: (() => Promise<void>) | null = null;

    startRadarDiscovery(
      (device) => {
        if (isMounted) {
          setRadarDevices((prev) => {
            if (prev.some((d) => d.id === device.id)) return prev;
            return [...prev, device];
          });
        }
      },
      (lostId) => {
        if (isMounted) {
          setRadarDevices((prev) => prev.filter((d) => d.id !== lostId));
        }
      }
    ).then((session) => {
      stopDiscovery = session.stop;
    });

    return () => {
      isMounted = false;
      if (stopDiscovery) stopDiscovery();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const getOsIcon = (os: OSPlatform) => {
    switch (os) {
      case 'android':
      case 'ios':
        return <Smartphone size={9} className="text-[#2ee86f]" />;
      default:
        return <Monitor size={9} className="text-[#3b82f6]" />;
    }
  };

  const handleAttemptClose = () => {
    setShowExitConfirm(true);
  };

  const handleConfirmExit = () => {
    setShowExitConfirm(false);
    setIsCollapsed(false);
    onClose();
  };

  const handleStartQrScan = async () => {
    setIsScanning(true);
    setStatusMessage(isAndroidApp ? 'Scanning Zapdrop QR code...' : 'Scanning QR code...');
    try {
      await startReceive((info) => {
        setProgressInfo(info);
      });
      setStatusMessage(isAndroidApp ? 'Drop complete.' : 'All files received successfully!');
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (e: unknown) {
      setStatusMessage((e as Error)?.message || 'Scan cancelled or failed');
    } finally {
      setIsScanning(false);
    }
  };

  const handleSelectDevice = async (peer: DeviceProfile) => {
    setConnectingPeerId(peer.id);
    if (peer.isAccessPoint && peer.wifiSsid) {
      try {
        setStatusMessage(`Connecting to ${peer.name}…`);
        await ZapdropWifi.connectToWifi({ ssid: peer.wifiSsid });
        await ZapdropWifi.stopDiscovery();
        await ZapdropWifi.startDiscovery();
        setStatusMessage('Connected. Looking for active Zapdrop devices…');
        setConnectingPeerId(null);
      } catch (error) {
        setStatusMessage((error as Error)?.message || 'Could not join this hotspot. Scan the other device’s Zapdrop QR code to connect securely.');
        setConnectingPeerId(null);
      }
      return;
    }
    if (!isAndroidApp) {
      setTimeout(() => {
        onConnectDevice(peer);
        onClose();
      }, 500);
      return;
    }
    try {
      setStatusMessage(`Connecting to ${peer.name}…`);
      const files = await startPeerReceive(peer, (info) => setProgressInfo(info));
      onConnectDevice(peer, files);
      setStatusMessage('Drop complete. Saved to Downloads/Zapdrop.');
      setTimeout(onClose, 1500);
    } catch (error) {
      setStatusMessage((error as Error)?.message || 'The connection failed. Scan the Zapdrop QR code or join the same Wi-Fi network.');
      setConnectingPeerId(null);
    }
  };

  const quadrantOffsets = [
    { x: -55, y: -46 },
    { x: 55, y: -46 },
    { x: -55, y: 46 },
    { x: 55, y: 46 },
  ];

  return (
    <>
      {/* Small Confirmation Modal */}
      <AnimatePresence>
        {showExitConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs pointer-events-auto">
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="w-full max-w-[250px] neu-raised rounded-3xl border border-white/10 p-4 bg-[#171821] text-center shadow-2xl"
            >
              <div className="w-8 h-8 rounded-xl bg-amber-500/15 text-amber-400 flex items-center justify-center mx-auto mb-2">
                <AlertCircle size={18} />
              </div>
              <h3 className="text-xs font-bold text-white mb-1">{isAndroidApp ? 'Stop Drop?' : 'Stop Receiving?'}</h3>
              <p className="text-[11px] text-slate-400 mb-3">
                {isAndroidApp ? 'This will hide your device and stop incoming Drops.' : 'This will end your radar visibility and stop incoming transfers.'}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowExitConfirm(false)}
                  className="flex-1 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-semibold text-white transition-all cursor-pointer"
                >
                  Stay
                </button>
                <button
                  onClick={handleConfirmExit}
                  className="flex-1 py-1.5 rounded-xl bg-red-500 hover:bg-red-600 text-xs font-bold text-white shadow-lg transition-all cursor-pointer"
                >
                  Exit
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Main Receive Floating Sheet */}
      <div className="fixed bottom-16 left-0 right-0 z-40 flex flex-col items-center pointer-events-none px-4">
        <motion.div
          initial={{ y: 80, opacity: 0, scale: 0.95 }}
          animate={{
            y: 0,
            opacity: 1,
            scale: 1,
            height: isCollapsed ? '52px' : 'auto',
          }}
          exit={{ y: 80, opacity: 0, scale: 0.95 }}
          transition={{ type: 'spring', damping: 25, stiffness: 350 }}
          className="w-full max-w-[340px] pointer-events-auto neu-raised rounded-3xl border border-white/10 bg-[#161720]/95 backdrop-blur-md shadow-[0_15px_40px_rgba(0,0,0,0.85)] overflow-hidden"
        >
          {/* Header Row */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#2ee86f] animate-ping" />
              <span className="text-xs font-bold text-white">{isAndroidApp ? 'Drop Files' : 'Receive Files'}</span>
              <span className="text-[10px] text-slate-400">
                ({radarDevices.length} nearby)
              </span>
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="p-1 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition-all cursor-pointer"
                title={isCollapsed ? 'Expand' : 'Minimize'}
              >
                {isCollapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </button>

              <button
                onClick={handleAttemptClose}
                className="p-1 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition-all cursor-pointer"
                title="Close"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Expanded Content */}
          {!isCollapsed && (
            <div className="p-4 flex flex-col items-center text-center space-y-3">
              
              {/* Scan QR Code Action Button */}
              <button
                onClick={handleStartQrScan}
                disabled={isScanning}
                className="w-full py-2.5 rounded-2xl bg-gradient-to-r from-[#22c55e] to-[#39f07c] text-black font-bold text-xs flex items-center justify-center gap-2 shadow-[0_0_20px_rgba(46,232,111,0.4)] hover:brightness-110 active:scale-98 transition-all cursor-pointer"
              >
                <QrCode size={16} className="stroke-[2.5]" />
                <span>{isScanning ? 'Scanning...' : isAndroidApp ? 'Scan Zapdrop QR Code' : 'Scan Sender QR Code'}</span>
              </button>

              {/* Progress info if downloading */}
              {progressInfo && (
                <div className="w-full p-2.5 rounded-2xl bg-black/40 border border-white/5 text-left space-y-1">
                  <div className="flex items-center justify-between text-[11px] font-bold text-white">
                    <span className="truncate max-w-[180px]">{progressInfo.fileName}</span>
                    <span className="text-[#2ee86f]">
                      {Math.round((progressInfo.loaded / progressInfo.total) * 100)}%
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full bg-[#2ee86f] transition-all"
                      style={{
                        width: `${Math.min(100, Math.round((progressInfo.loaded / progressInfo.total) * 100))}%`,
                      }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>File {progressInfo.fileIndex} of {progressInfo.fileCount}</span>
                    <span>{progressInfo.speedMbps.toFixed(1)} MB/s</span>
                  </div>
                </div>
              )}

              {/* Status Message */}
              {statusMessage && (
                <p className="text-[11px] text-emerald-400">{statusMessage}</p>
              )}

              {/* Minimal Radar Container */}
              <div className="relative w-44 h-44 rounded-full bg-[#0d0f16]/90 border border-[#2ee86f]/20 flex items-center justify-center overflow-hidden shadow-inner">
                {/* Concentric Radar Rings */}
                <div className="absolute inset-4 rounded-full border border-[#2ee86f]/15 pointer-events-none" />
                <div className="absolute inset-10 rounded-full border border-[#2ee86f]/20 pointer-events-none" />
                <div className="absolute inset-16 rounded-full border border-[#2ee86f]/25 pointer-events-none" />

                {/* Rotating Scanner Line */}
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 4, ease: 'linear' }}
                  className="absolute inset-0 origin-center pointer-events-none"
                  style={{
                    background:
                      'conic-gradient(from 0deg, transparent 0deg, transparent 270deg, rgba(46,232,111,0.18) 360deg)',
                  }}
                />

                {/* Center Self Avatar */}
                <div className="relative z-10 w-11 h-11 rounded-full p-0.5 bg-gradient-to-tr from-[#22c55e] to-white shadow-[0_0_15px_rgba(46,232,111,0.6)] flex items-center justify-center">
                  <img
                    src={myProfile.avatar}
                    alt={myProfile.name}
                    className="w-full h-full rounded-full object-cover"
                  />
                </div>

                {/* Discovered Peer Avatars */}
                {radarDevices.slice(0, 4).map((peer, idx) => {
                  const offset = quadrantOffsets[idx] || { x: 0, y: 0 };
                  const isConnecting = connectingPeerId === peer.id;

                  return (
                    <motion.button
                      key={peer.id}
                      initial={{ scale: 0, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      whileHover={{ scale: 1.15 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => handleSelectDevice(peer)}
                      className={`absolute z-20 flex flex-col items-center cursor-pointer group ${
                        isConnecting ? 'animate-pulse' : ''
                      }`}
                      style={{
                        transform: `translate(${offset.x}px, ${offset.y}px)`,
                      }}
                      title={`Connect to ${peer.name}`}
                    >
                      <div className="relative w-8 h-8 rounded-full p-0.5 bg-[#171922] border-2 border-[#2ee86f]/80 shadow-[0_0_10px_rgba(46,232,111,0.4)] group-hover:border-[#2ee86f] transition-all">
                        <img
                          src={peer.avatar}
                          alt={peer.name}
                          className="w-full h-full rounded-full object-cover"
                        />
                        <div className="absolute -bottom-1 -right-1 p-0.5 rounded-full bg-[#11131a] border border-white/20">
                          {getOsIcon(peer.os)}
                        </div>
                      </div>
                      <span className="text-[9px] font-medium text-slate-300 group-hover:text-white truncate max-w-[50px] drop-shadow-md">
                        {peer.name.split(' ')[0]}
                      </span>
                    </motion.button>
                  );
                })}
              </div>

              <span className="text-[10px] text-slate-400">
                {isAndroidApp ? 'Tap a hotspot to join, or a Zapdrop device to connect' : 'Tap a peer to initiate direct connection'}
              </span>
            </div>
          )}
        </motion.div>
      </div>
    </>
  );
};
