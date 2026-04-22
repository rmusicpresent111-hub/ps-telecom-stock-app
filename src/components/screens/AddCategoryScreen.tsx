'use client';

import { useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { createCategory } from '@/lib/supabase-service';

const presetCategories = [
  { name: 'Mobile', image: '/categories/mobile.png', emoji: '📱' },
  { name: 'Display/Combo', image: '/categories/display.png', emoji: '🖥️' },
  { name: 'Tempered Glass', image: '/categories/tempered-glass.png', emoji: '🛡️' },
  { name: 'Flip Cover', image: '/categories/flip-cover.png', emoji: '📱' },
  { name: 'Back Cover', image: '/categories/back-cover.png', emoji: '📱' },
  { name: 'UV Glass', image: '/categories/uv-glass.png', emoji: '✨' },
  { name: 'Smart Watch', image: '/categories/smart-watch.png', emoji: '⌚' },
  { name: 'Battery', image: '/categories/battery.png', emoji: '🔋' },
  { name: 'Charger', image: '/categories/charger.png', emoji: '🔌' },
  { name: 'Neck Band', image: '/categories/neckband.png', emoji: '🎵' },
  { name: 'Ear Pods', image: '/categories/earpods.png', emoji: '🎧' },
  { name: 'Selfie Stick', image: '/categories/selfie-stick.png', emoji: '📸' },
  { name: 'Ring Light', image: '/categories/ring-light.png', emoji: '💡' },
  { name: 'Mobile Stand', image: '/categories/mobile-stand.png', emoji: '📐' },
  { name: 'Watch Strap', image: '/categories/watch-strap.png', emoji: '⌚' },
  { name: 'Earphone', image: '/categories/earphone.png', emoji: '🎧' },
  { name: 'Memory Card', image: '/categories/memory-card.png', emoji: '💾' },
  { name: 'Data Cable', image: '/categories/data-cable.png', emoji: '🔌' },
  { name: 'Home Theater', image: '/categories/home-theater.png', emoji: '🔊' },
  { name: 'Refrigerator', image: '/categories/refrigerator.png', emoji: '❄️' },
];

const emojiOptions = ['📱', '🖥️', '🛡️', '⌚', '🔋', '🔌', '🎧', '🔧', '💾', '🎮', '📷', '🔊', '📡', '💡', '📦', '🏷️', '🖲️', '❄️'];

export default function AddCategoryScreen() {
  const { user, language, goBack } = useAppStore();

  const [name, setName] = useState('');
  const [selectedImage, setSelectedImage] = useState('');
  const [selectedEmoji, setSelectedEmoji] = useState('📦');
  const [iconMode, setIconMode] = useState<'image' | 'emoji'>('image');
  const [loading, setLoading] = useState(false);

  const handlePresetSelect = (preset: typeof presetCategories[0]) => {
    setName(preset.name);
    setSelectedImage(preset.image);
    setIconMode('image');
  };

  const handleSave = async () => {
    if (!name.trim() || !user?.id) {
      toast.error(t('error', language));
      return;
    }

    setLoading(true);
    try {
      const imageData = iconMode === 'image' ? selectedImage : selectedEmoji;
      await createCategory(name.trim(), imageData, user.id);
      toast.success(t('added', language));
      goBack();
    } catch (error) {
      toast.error((error as Error).message || t('error', language));
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    goBack();
  };

  return (
    <div className="animated-bg min-h-screen pb-24">
      <div className="max-w-md mx-auto px-4 pt-4">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between mb-6"
        >
          <button onClick={handleCancel} className="p-2 rounded-full glass-card" aria-label="Back">
            <ArrowLeft size={20} className="text-cyan-400" />
          </button>
          <h1 className="text-lg font-bold">{t('addCategory', language)}</h1>
          <div className="w-10" />
        </motion.div>

        {/* Form */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass-card-strong p-6 space-y-4"
        >
          {/* Category Name */}
          <div>
            <label className="text-xs text-white/60 mb-1 block">{t('name', language)}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('name', language)}
              className="glass-input w-full px-4 py-3 text-sm"
              autoFocus
            />
          </div>

          {/* Icon Mode Toggle */}
          <div>
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => setIconMode('image')}
                className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-all ${
                  iconMode === 'image'
                    ? 'bg-cyan-500/20 border border-cyan-500/40 text-cyan-400'
                    : 'glass-card text-white/60'
                }`}
              >
                🖼️ Photo Icon
              </button>
              <button
                onClick={() => setIconMode('emoji')}
                className={`flex-1 py-2 text-xs font-semibold rounded-xl transition-all ${
                  iconMode === 'emoji'
                    ? 'bg-cyan-500/20 border border-cyan-500/40 text-cyan-400'
                    : 'glass-card text-white/60'
                }`}
              >
                😀 Emoji Icon
              </button>
            </div>

            {/* Selected preview */}
            <div className="flex items-center gap-3 mb-3">
              <div className="w-14 h-14 glass-card flex items-center justify-center overflow-hidden rounded-xl">
                {iconMode === 'image' && selectedImage ? (
                  <img src={selectedImage} alt="Selected" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-3xl">{selectedEmoji}</span>
                )}
              </div>
              <span className="text-sm text-white/60">Selected Icon</span>
            </div>

            {/* Image picker */}
            {iconMode === 'image' && (
              <div className="grid grid-cols-4 gap-2 max-h-64 overflow-y-auto pr-1">
                {presetCategories.map((preset) => (
                  <button
                    key={preset.name}
                    onClick={() => handlePresetSelect(preset)}
                    className={`flex flex-col items-center gap-1 p-2 rounded-xl transition-all ${
                      selectedImage === preset.image
                        ? 'bg-cyan-500/20 border border-cyan-500/40 scale-105'
                        : 'glass-card hover:scale-105'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-lg overflow-hidden">
                      <img src={preset.image} alt={preset.name} className="w-full h-full object-cover" />
                    </div>
                    <span className="text-[9px] text-white/70 truncate w-full text-center leading-tight">{preset.name}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Emoji picker */}
            {iconMode === 'emoji' && (
              <div className="grid grid-cols-9 gap-2">
                {emojiOptions.map((em) => (
                  <button
                    key={em}
                    onClick={() => setSelectedEmoji(em)}
                    className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg transition-all ${
                      selectedEmoji === em
                        ? 'bg-cyan-500/20 border border-cyan-500/40 scale-110'
                        : 'glass-card hover:scale-105'
                    }`}
                  >
                    {em}
                  </button>
                ))}
              </div>
            )}
          </div>
        </motion.div>

        {/* Buttons */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mt-6 space-y-3"
        >
          <button
            onClick={handleSave}
            disabled={loading || !name.trim()}
            className="neon-btn-solid w-full py-3 font-semibold text-sm disabled:opacity-50"
          >
            {loading ? t('loading', language) : t('save', language)}
          </button>
          <button
            onClick={handleCancel}
            className="neon-btn w-full py-3 font-semibold text-sm"
          >
            {t('cancel', language)}
          </button>
        </motion.div>
      </div>
    </div>
  );
}
