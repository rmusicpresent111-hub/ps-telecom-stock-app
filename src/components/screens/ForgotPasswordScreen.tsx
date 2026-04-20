'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Mail, ArrowLeft } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { Language } from '@/lib/types';
import { toast } from 'sonner';

export default function ForgotPasswordScreen() {
  const { language, navigateTo } = useAppStore();
  const lang = language as Language;

  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSent, setIsSent] = useState(false);

  const handleReset = async () => {
    if (!email.trim()) {
      toast.error(t('error', lang), { description: 'Email is required' });
      return;
    }

    setIsLoading(true);
    try {
      // Placeholder: simulate API call
      await new Promise((resolve) => setTimeout(resolve, 1500));
      setIsSent(true);
      toast.success(t('success', lang), {
        description: 'Password reset link sent to your email',
      });
    } catch {
      toast.error(t('error', lang), { description: 'Something went wrong' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="animated-bg min-h-screen flex flex-col max-w-md mx-auto px-6 py-8">
      {/* Back button */}
      <motion.button
        className="flex items-center gap-2 text-white/60 hover:text-white transition-colors mb-8 mt-4"
        onClick={() => navigateTo('login')}
        initial={{ opacity: 0, x: -10 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3 }}
      >
        <ArrowLeft size={20} />
        <span className="text-sm">{t('backToLogin', lang)}</span>
      </motion.button>

      {/* Header */}
      <motion.div
        className="text-center mb-10"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        <div className="w-16 h-16 rounded-2xl mx-auto mb-6 flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, rgba(0, 240, 255, 0.15), rgba(180, 74, 255, 0.15))',
            border: '1px solid rgba(0, 240, 255, 0.25)',
          }}
        >
          <Mail size={28} className="text-[#00f0ff]" />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold neon-glow text-white mb-3">
          {t('forgotPassword', lang)}
        </h1>
        <p className="text-white/50 text-sm leading-relaxed">
          {isSent
            ? 'A password reset link has been sent to your email address.'
            : 'Enter your email address and we\'ll send you a link to reset your password.'}
        </p>
      </motion.div>

      {/* Form card */}
      <motion.div
        className="glass-card p-6 sm:p-8"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3 }}
      >
        {!isSent ? (
          <div className="space-y-5">
            {/* Email input */}
            <div className="relative">
              <Mail
                size={18}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40"
              />
              <input
                type="email"
                className="glass-input w-full pl-11 pr-4 py-3 text-white text-sm"
                placeholder={t('email', lang)}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleReset()}
              />
            </div>

            {/* Reset button */}
            <motion.button
              className="neon-btn-solid w-full py-3 font-semibold text-base rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleReset}
              disabled={isLoading}
              whileTap={{ scale: 0.97 }}
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <motion.span
                    className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                  />
                  {t('loading', lang)}
                </span>
              ) : (
                t('resetPassword', lang)
              )}
            </motion.button>
          </div>
        ) : (
          <motion.div
            className="text-center space-y-4"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
          >
            <div className="w-12 h-12 rounded-full mx-auto flex items-center justify-center bg-[#39ff14]/20 border border-[#39ff14]/30">
              <span className="text-[#39ff14] text-xl">✓</span>
            </div>
            <p className="text-white/70 text-sm">
              Check your inbox at <span className="text-[#00f0ff] font-medium">{email}</span>
            </p>
          </motion.div>
        )}
      </motion.div>

      {/* Back to login link */}
      <motion.div
        className="text-center mt-8"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.5 }}
      >
        <button
          className="text-[#00f0ff] text-sm font-medium hover:underline"
          onClick={() => navigateTo('login')}
        >
          {t('backToLogin', lang)}
        </button>
      </motion.div>
    </div>
  );
}
