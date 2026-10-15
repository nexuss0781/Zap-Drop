import React, { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { AlertCircle, CheckCircle2, Download, LoaderCircle, RefreshCw, Smartphone, Upload } from 'lucide-react';
import { ZapdropUpdater } from '../native/zapdrop-native';

interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseNotes: string;
  downloadSize: number;
}

const formatBytes = (bytes: number) => {
  if (bytes <= 0) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const AppUpdateCard: React.FC = () => {
  const isAndroid = Capacitor.getPlatform() === 'android';
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [permissionNeeded, setPermissionNeeded] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  const checkForUpdates = useCallback(async () => {
    if (!isAndroid || checking || installing) return;
    setChecking(true);
    setError('');
    setStatus('Checking GitHub Releases…');
    try {
      const info = await ZapdropUpdater.checkForUpdate();
      setUpdateInfo(info);
      setPermissionNeeded(false);
      setStatus(info.updateAvailable
        ? `Version ${info.latestVersion} is available.`
        : info.latestVersion
          ? `You're up to date · v${info.currentVersion}`
          : `No published update found · v${info.currentVersion}`);
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : 'Could not check for updates. Check your connection and try again.');
      setStatus('');
    } finally {
      setChecking(false);
    }
  }, [checking, installing, isAndroid]);

  useEffect(() => {
    if (!isAndroid) return;
    let mounted = true;
    const progressListener = ZapdropUpdater.addListener('downloadProgress', (event) => {
      if (!mounted) return;
      setProgress(event.percent >= 0 ? event.percent : null);
      setStatus(event.percent >= 0 ? `Downloading update… ${event.percent}%` : 'Downloading update…');
    });
    setChecking(true);
    setStatus('Checking GitHub Releases…');
    ZapdropUpdater.checkForUpdate()
      .then((info) => {
        if (!mounted) return;
        setUpdateInfo(info);
        setStatus(info.updateAvailable
          ? `Version ${info.latestVersion} is available.`
          : info.latestVersion
            ? `You're up to date · v${info.currentVersion}`
            : `No published update found · v${info.currentVersion}`);
      })
      .catch((checkError) => {
        if (!mounted) return;
        setError(checkError instanceof Error ? checkError.message : 'Could not check for updates. Check your connection and try again.');
        setStatus('');
      })
      .finally(() => {
        if (mounted) setChecking(false);
      });
    return () => {
      mounted = false;
      void progressListener.then((listener) => listener.remove()).catch(() => {});
    };
  }, [isAndroid]);

  const installUpdate = async () => {
    if (!isAndroid || installing) return;
    setInstalling(true);
    setPermissionNeeded(false);
    setProgress(0);
    setError('');
    setStatus('Preparing update…');
    try {
      const result = await ZapdropUpdater.downloadAndInstall();
      if (result.permissionRequired) {
        setPermissionNeeded(true);
        setProgress(null);
        setStatus(result.message || 'Allow installs from Zapdrop in Android settings, then return and try again.');
      } else if (result.installerLaunched) {
        setProgress(100);
        setStatus(result.message || 'Android installer opened. Confirm the update there, then choose Open when it finishes.');
      }
    } catch (installError) {
      setProgress(null);
      setError(installError instanceof Error ? installError.message : 'Could not prepare the update. Please try again.');
      setStatus('');
    } finally {
      setInstalling(false);
    }
  };

  return (
    <section className="p-5 sm:p-6 rounded-3xl neu-raised border border-white/5 space-y-4" aria-label="App updates">
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-white/5">
        <div className="flex items-center gap-2">
          <Smartphone size={18} className="text-[#22c55e]" />
          <h2 className="text-sm font-bold text-white">App updates</h2>
        </div>
        {updateInfo?.updateAvailable && (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-bold text-emerald-300">
            <Upload size={11} /> Update available
          </span>
        )}
      </div>

      {!isAndroid ? (
        <p className="text-xs leading-relaxed text-slate-400">In-app APK updates are available in the Android app.</p>
      ) : (
        <>
          <p className="text-xs leading-relaxed text-slate-400">
            Check the official Zapdrop GitHub Releases for a signed Android update. Your current version is {updateInfo?.currentVersion ? `v${updateInfo.currentVersion}` : 'being checked'}.
          </p>

          {status && (
            <div className="flex items-start gap-2 text-xs text-slate-300" role="status" aria-live="polite">
              {checking || installing ? <LoaderCircle size={14} className="mt-0.5 shrink-0 animate-spin text-[#22c55e]" /> : updateInfo?.updateAvailable ? <Upload size={14} className="mt-0.5 shrink-0 text-[#22c55e]" /> : <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-slate-400" />}
              <span>{status}{updateInfo?.updateAvailable && updateInfo.downloadSize > 0 && !installing ? ` · ${formatBytes(updateInfo.downloadSize)}` : ''}</span>
            </div>
          )}

          {progress !== null && installing && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-[10px] text-slate-400"><span>Download progress</span><span>{progress}%</span></div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div className="h-full rounded-full bg-gradient-to-r from-[#22c55e] to-[#39f07c] transition-all duration-200" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {updateInfo?.updateAvailable && updateInfo.releaseNotes.trim() && (
            <div className="max-h-32 overflow-y-auto rounded-2xl border border-white/5 bg-black/20 p-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Release notes</p>
              <p className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-slate-300">{updateInfo.releaseNotes}</p>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-2xl border border-rose-400/15 bg-rose-400/5 p-3 text-[11px] leading-relaxed text-rose-300" role="alert">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              onClick={() => void checkForUpdates()}
              disabled={checking || installing}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl neu-raised px-4 py-2.5 text-xs font-semibold text-white transition-all hover:text-[#22c55e] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {checking ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Check for updates
            </button>
            {updateInfo?.updateAvailable && (
              <button
                onClick={() => void installUpdate()}
                disabled={checking || installing}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#22c55e] px-4 py-2.5 text-xs font-bold text-black transition-colors hover:bg-[#39f07c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {installing ? <LoaderCircle size={14} className="animate-spin" /> : <Download size={14} />}
                {installing ? 'Preparing…' : permissionNeeded ? 'Try install again' : `Download v${updateInfo.latestVersion}`}
              </button>
            )}
          </div>

          <p className="text-[10px] leading-relaxed text-slate-500">
            Android verifies and installs the APK. For your protection, Android requires you to approve the install; after it finishes, tap Open in the system installer to relaunch Zapdrop.
          </p>
        </>
      )}
    </section>
  );
};
