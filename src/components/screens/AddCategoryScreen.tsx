'use client';

import { useState } from 'react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';

const emojiOptions = ['📱', '🖥️', '🛡️', '⌚', '🔋', '🔌', '🎧', '🔧', '💾', '🎮', '📷', '🔊', '📡', '💡', '📦', '🏷️', '🖲️', '🖥️'];

export default function AddCategoryScreen() {
  const { user, language, goBack } = useAppStore();

  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('📦');
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!name.trim() || !user?.id) {
      toast.error(t('error', language));
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          image: emoji,
          userId: user.id,
        }),
      });

      if (res.ok) {
        toast.success(t('added', language));
        goBack();
      } else {
        const err = await res.json();
        toast.error(err.error || t('error', language));
      }
    } catch {
      toast.error(t('error', language));
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

          {/* Emoji Picker */}
          <div>
            <label className="text-xs text-white/60 mb-2 block">Icon</label>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-14 h-14 glass-card flex items-center justify-center text-3xl">
                {emoji}
              </div>
              <span className="text-sm text-white/60">Selected Icon</span>
            </div>
            <div className="grid grid-cols-9 gap-2">
              {emojiOptions.map((em) => (
                <button
                  key={em}
                  onClick={() => setEmoji(em)}
                  className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg transition-all ${
                    emoji === em
                      ? 'bg-cyan-500/20 border border-cyan-500/40 scale-110'
                      : 'glass-card hover:scale-105'
                  }`}
                >
                  {em}
                </button>
              ))}
            </div>
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
