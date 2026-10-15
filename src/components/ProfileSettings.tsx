import React, { useState } from 'react';
import { motion } from 'motion/react';
import { User, Camera, Check, Radio } from 'lucide-react';
import { DeviceProfile, HotspotState } from '../types';
import { AVATAR_PRESETS } from '../services/mockNetwork';
import { setDeviceName, setAvatar } from '../services/device';
import { AppUpdateCard } from './AppUpdateCard';

interface ProfileSettingsProps {
  myProfile: DeviceProfile;
  onUpdateProfile: (updated: Partial<DeviceProfile>) => void;
  hotspotState: HotspotState;
  onUpdateHotspot: (updated: Partial<HotspotState>) => void;
}

export const ProfileSettings: React.FC<ProfileSettingsProps> = ({
  myProfile,
  onUpdateProfile,
  hotspotState,
  onUpdateHotspot,
}) => {
  const [nameInput, setNameInput] = useState(myProfile.name);
  const [isSaved, setIsSaved] = useState(false);
  const [hotspotSsid, setHotspotSsid] = useState(hotspotState.ssid);
  const [hotspotPass, setHotspotPass] = useState(hotspotState.password);

  const handleSaveProfile = async () => {
    const trimmed = nameInput.trim() || myProfile.name;
    await setDeviceName(trimmed);
    onUpdateProfile({ name: trimmed });
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  const handleCustomAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const url = URL.createObjectURL(e.target.files[0]);
      await setAvatar(url);
      onUpdateProfile({ avatar: url });
    }
  };

  const handleSelectPresetAvatar = async (avatarUrl: string) => {
    await setAvatar(avatarUrl);
    onUpdateProfile({ avatar: avatarUrl });
  };

  return (
    <div className="min-h-[calc(100vh-140px)] pb-28 pt-2 px-3 sm:px-6 max-w-2xl mx-auto space-y-5">
      
      {/* Profile Card & Avatar Customization */}
      <div className="p-5 sm:p-6 rounded-3xl neu-raised border border-white/5 space-y-5">
        <div className="flex items-center gap-2 pb-3 border-b border-white/5">
          <User size={18} className="text-[#22c55e]" />
          <h2 className="text-sm font-bold text-white">Device Profile</h2>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-5">
          {/* Avatar with live photo edit */}
          <div className="relative group shrink-0">
            <img
              src={myProfile.avatar}
              alt={myProfile.name}
              className="w-20 h-20 rounded-3xl object-cover ring-2 ring-[#22c55e]/50 neu-raised"
            />
            <label
              htmlFor="avatar-upload"
              className="absolute -bottom-1 -right-1 p-1.5 rounded-xl bg-[#22c55e] text-black cursor-pointer shadow-lg hover:scale-105 transition-transform"
              title="Change Avatar"
            >
              <Camera size={14} />
              <input
                id="avatar-upload"
                type="file"
                accept="image/*"
                onChange={handleCustomAvatarUpload}
                className="hidden"
              />
            </label>
          </div>

          <div className="flex-1 w-full space-y-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-400 mb-1">
                Display Name (Visible to nearby peers)
              </label>
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="e.g. Studio MacBook Pro"
                className="w-full px-3.5 py-2.5 rounded-2xl neu-pressed text-xs text-white placeholder-slate-500 border border-white/5 focus:border-[#22c55e]/40 outline-none"
              />
            </div>

            <button
              onClick={handleSaveProfile}
              className="w-full py-2.5 rounded-2xl bg-[#22c55e] text-black text-xs font-bold hover:bg-[#16a34a] shadow-[0_0_15px_rgba(34,197,94,0.3)] transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              {isSaved ? (
                <>
                  <Check size={14} className="stroke-[3]" />
                  <span>Saved!</span>
                </>
              ) : (
                <span>Save Profile</span>
              )}
            </button>
          </div>
        </div>

        {/* Preset Avatars */}
        <div>
          <label className="block text-[11px] font-medium text-slate-400 mb-2">
            Or Choose an Avatar Preset
          </label>
          <div className="flex items-center gap-3 overflow-x-auto pb-1">
            {AVATAR_PRESETS.map((preset, idx) => (
              <button
                key={idx}
                onClick={() => handleSelectPresetAvatar(preset)}
                className={`w-11 h-11 rounded-2xl overflow-hidden shrink-0 transition-transform ${
                  myProfile.avatar === preset
                    ? 'ring-2 ring-[#22c55e] scale-105'
                    : 'opacity-60 hover:opacity-100 hover:scale-105'
                }`}
              >
                <img src={preset} alt={`Preset ${idx + 1}`} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Direct Wi-Fi Hotspot Settings */}
      <div className="p-5 sm:p-6 rounded-3xl neu-raised border border-white/5 space-y-4">
        <div className="flex items-center justify-between pb-3 border-b border-white/5">
          <div className="flex items-center gap-2">
            <Radio size={18} className="text-[#22c55e]" />
            <h2 className="text-sm font-bold text-white">Direct P2P Hotspot</h2>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">
            No Internet Needed
          </span>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed">
          Zapdrop automatically establishes an offline high-speed local connection for lightning fast transfers.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              Hotspot SSID
            </label>
            <input
              type="text"
              value={hotspotSsid}
              onChange={(e) => setHotspotSsid(e.target.value)}
              className="w-full px-3.5 py-2 rounded-2xl neu-pressed text-xs text-white placeholder-slate-500 border border-white/5 outline-none"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-400 mb-1">
              WPA2 Password
            </label>
            <input
              type="text"
              value={hotspotPass}
              onChange={(e) => setHotspotPass(e.target.value)}
              className="w-full px-3.5 py-2 rounded-2xl neu-pressed text-xs text-white placeholder-slate-500 border border-white/5 outline-none"
            />
          </div>
        </div>

        <button
          onClick={() => onUpdateHotspot({ ssid: hotspotSsid, password: hotspotPass })}
          className="px-4 py-2 rounded-xl neu-raised text-xs font-semibold text-white hover:text-[#22c55e] transition-all cursor-pointer"
        >
          Update Hotspot Config
        </button>
      </div>

      <AppUpdateCard />

    </div>
  );
};
