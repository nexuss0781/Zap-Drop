import React, { useState, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { motion, AnimatePresence } from 'motion/react';
import { X, ChevronDown, ChevronUp, AlertCircle, ShieldCheck, Wifi, Settings } from 'lucide-react';
import { DeviceFile, DeviceProfile, HotspotState } from '../types';
import { formatFileSize } from '../services/mockNetwork';
import { startSend, SendSession } from '../services/send';
import { ZapdropWifi } from '../native/zapdrop-native';

interface SendModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedFiles: DeviceFile[];
  hotspotState: HotspotState;
  myProfile: DeviceProfile;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
}

export const SendModal: React.FC<SendModalProps> = ({
  isOpen,
  onClose,
  selectedFiles,
  hotspotState,
  myProfile,
  isCollapsed,
  setIsCollapsed,
}) => {
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [serverIp, setServerIp] = useState<string | null>(null);
  const [serverPort, setServerPort] = useState<number | null>(null);
  const [sessionSsid, setSessionSsid] = useState<string | null>(null);
  const [transferProgress, setTransferProgress] = useState<{ bytes: number; total: number } | null>(null);
  const [transferDone, setTransferDone] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [startupStatus, setStartupStatus] = useState('Preparing transfer…');

  const sessionRef = useRef<SendSession | null>(null);

  useEffect(() => {
    if (!isOpen || selectedFiles.length === 0) {
      if (sessionRef.current) {
        sessionRef.current.stop();
        sessionRef.current = null;
      }
      setQrCodeDataUrl(null);
      setSessionSsid(null);
      setTransferProgress(null);
      setTransferDone(false);
      setErrorMsg(null);
      setStartupStatus('Preparing transfer…');
      return;
    }

    let isMounted = true;

    startSend(
      selectedFiles,
      (id, bytes, total) => {
        if (isMounted) {
          setTransferProgress({ bytes, total });
        }
      },
      () => {
        if (isMounted) {
          setTransferDone(true);
        }
      },
      (status) => {
        if (isMounted) setStartupStatus(status);
      },
    )
      .then((session) => {
        if (!isMounted) {
          session.stop();
          return;
        }
        sessionRef.current = session;
        setQrCodeDataUrl(session.qrCodeUrl);
        setServerIp(session.ip);
        setServerPort(session.port);
        setSessionSsid(session.ssid);
        setStartupStatus('Ready to connect. Scan this QR code on the other device.');
      })
      .catch((err) => {
        if (isMounted) {
          setErrorMsg(err.message || 'Failed to start file sharing server');
        }
      });

    return () => {
      isMounted = false;
      if (sessionRef.current) {
        sessionRef.current.stop();
        sessionRef.current = null;
      }
    };
  }, [isOpen, selectedFiles]);

  if (!isOpen) return null;

  const totalSize = selectedFiles.reduce((sum, f) => sum + f.size, 0);

  const handleAttemptClose = () => {
    setShowExitConfirm(true);
  };

  const handleConfirmExit = () => {
    if (sessionRef.current) {
      sessionRef.current.stop();
      sessionRef.current = null;
    }
    setShowExitConfirm(false);
    setIsCollapsed(false);
    onClose();
  };

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
              <h3 className="text-xs font-bold text-white mb-1">Stop Sharing?</h3>
              <p className="text-[11px] text-slate-400 mb-3">
                Closing will terminate the direct local transfer session.
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

      {/* Main Send Floating Sheet */}
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
              <div className="w-2 h-2 rounded-full bg-[#2ee86f] animate-pulse" />
              <span className="text-xs font-bold text-white">
                {transferDone ? (Capacitor.isNativePlatform() ? 'Zap Complete' : 'Transfer Complete') : Capacitor.isNativePlatform() ? `Zapping ${selectedFiles.length} file${selectedFiles.length !== 1 ? 's' : ''}` : `Sending ${selectedFiles.length} file${selectedFiles.length !== 1 ? 's' : ''}`}
              </span>
              <span className="text-[10px] text-slate-400">
                ({formatFileSize(totalSize)})
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
              {/* QR Code Container */}
              <div className="p-3 bg-white rounded-2xl shadow-xl flex items-center justify-center min-w-[170px] min-h-[170px]">
                {qrCodeDataUrl ? (
                  <img
                    src={qrCodeDataUrl}
                    alt={Capacitor.isNativePlatform() ? 'Scan to Drop' : 'Scan to Receive'}
                    className="w-36 h-36 object-contain"
                  />
                ) : errorMsg ? (
                  <div className="flex flex-col items-center gap-2 p-2 text-xs text-red-500"><AlertCircle size={22} /><span>{errorMsg}</span></div>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-slate-600">
                    <Wifi size={24} className="animate-pulse" />
                    <span className="text-[10px]">{startupStatus}</span>
                  </div>
                )}
              </div>

              {/* Transfer Progress Bar */}
              {transferProgress && transferProgress.total > 0 && (
                <div className="w-full space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span>Transferring...</span>
                    <span>{Math.round((transferProgress.bytes / transferProgress.total) * 100)}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-[#22c55e] to-[#39f07c] transition-all"
                      style={{
                        width: `${Math.min(100, Math.round((transferProgress.bytes / transferProgress.total) * 100))}%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Direct Wi-Fi Connection Details */}
              <div className="w-full p-2.5 rounded-2xl bg-black/30 border border-white/5 space-y-1 text-left">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-400">Host IP:</span>
                  <span className="text-[11px] font-mono font-bold text-emerald-400">
                    {serverIp ? `${serverIp}:${serverPort}` : 'Waiting for server…'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-400">P2P Network:</span>
                  <span className="text-[11px] font-medium text-white">{sessionSsid || (!Capacitor.isNativePlatform() ? hotspotState.ssid : 'Waiting for hotspot…')}</span>
                </div>
              </div>

              {errorMsg && Capacitor.getPlatform() === 'android' && (
                <button
                  onClick={() => ZapdropWifi.openHotspotSettings().catch(() => {})}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-white/5 px-3 py-2 text-[10px] font-semibold text-slate-200 hover:bg-white/10"
                >
                  <Settings size={13} /> Open Android Wi-Fi settings
                </button>
              )}

              <div className="flex items-center gap-1 text-[10px] text-slate-400">
                <ShieldCheck size={12} className="text-[#2ee86f]" />
                <span>{Capacitor.isNativePlatform() ? 'Offline direct peer-to-peer transfer' : 'Encrypted offline direct peer-to-peer transfer'}</span>
              </div>
            </div>
          )}
        </motion.div>
      </div>
    </>
  );
};
