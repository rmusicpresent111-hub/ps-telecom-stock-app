'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Mail, ArrowLeft, Lock, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { Language } from '@/lib/types';
import { toast } from 'sonner';
import { resetLocalPassword, normalizeEmail } from '@/lib/local-auth';

export default function ForgotPasswordScreen() {
  const { language, navigateTo } = useAppStore();
  const lang = language as Language;

  const [step, setStep] = useState<'email' | 'reset'>('email');
  const [email, setEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleVerifyEmail = async () => {
    const cleanEmail = normalizeEmail(email);
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      toast.error(t('error', lang), { description: 'Please enter a valid email address' });
      return;
    }

    setIsLoading(true);
    try {
      // Small delay so the loading state is visible; validation happens on reset
      await new Promise((resolve) => setTimeout(resolve, 400));
      setStep('reset');
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = async () => {
    if (!newPassword || newPassword.length < 6) {
      toast.error(t('error', lang), { description: 'Password must be at least 6 characters' });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error(t('error', lang), { description: 'Passwords do not match' });
      return;
    }

    setIsLoading(true);
    try {
      await resetLocalPassword(email, newPassword);
      toast.success(t('success', lang), { description: 'Password updated. Please log in.' });
      navigateTo('login');
    } catch (error) {
      toast.error(t('error', lang), {
        description: error instanceof Error ? error.message : 'Something went wrong',
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="animated-bg min-h-screen flex flex-col max-w-md mx-auto px-6 py-8">
      {/* Back button */}
      <motion.button
        className="flex items-center gap-2 text-white/60 hover:text-white transition-colors mb-8 mt-4"
        onClick={() => (step === 'reset' ? setStep('email') : navigateTo('login'))}
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
            background: 'linear-gradient(135deg, rgba(212, 168, 83, 0.15), rgba(160, 124, 62, 0.15))',
            border: '1px solid rgba(212, 168, 83, 0.25)',
          }}
        >
          {step === 'email' ? (
            <Mail size={28} className="text-[#D4A853]" />
          ) : (
            <ShieldCheck size={28} className="text-[#D4A853]" />
          )}
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold neon-glow text-white mb-3">
          {t('forgotPassword', lang)}
        </h1>
        <p className="text-white/50 text-sm leading-relaxed">
          {step === 'email'
            ? 'Enter your account email to reset your password on this device.'
            : `Set a new password for ${email}`}
        </p>
      </motion.div>

      {/* Form card */}
      <motion.div
        className="glass-card p-6 sm:p-8"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3 }}
      >
        {step === 'email' ? (
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
                onKeyDown={(e) => e.key === 'Enter' && handleVerifyEmail()}
                autoComplete="email"
              />
            </div>

            {/* Continue button */}
            <motion.button
              className="neon-btn-solid w-full py-3 font-semibold text-base rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleVerifyEmail}
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
                t('continue', lang)
              )}
            </motion.button>
          </div>
        ) : (
          <div className="space-y-5">
            {/* New password */}
            <div className="relative">
              <Lock
                size={18}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40"
              />
              <input
                type={showPassword ? 'text' : 'password'}
                className="glass-input w-full pl-11 pr-11 py-3 text-white text-sm"
                placeholder={t('newPassword', lang)}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
              <button
                type="button"
                className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            {/* Confirm password */}
            <div className="relative">
              <Lock
                size={18}
                className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40"
              />
              <input
                type={showPassword ? 'text' : 'password'}
                className="glass-input w-full pl-11 pr-4 py-3 text-white text-sm"
                placeholder={t('confirmPassword', lang)}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleReset()}
                autoComplete="new-password"
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
          className="text-[#D4A853] text-sm font-medium hover:underline"
          onClick={() => navigateTo('login')}
        >
          {t('backToLogin', lang)}
        </button>
      </motion.div>
    </div>
  );
}
