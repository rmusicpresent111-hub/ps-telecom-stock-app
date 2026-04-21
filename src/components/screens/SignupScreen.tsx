'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { User, Mail, Lock, Eye, EyeOff, Store } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { Language, User as UserType } from '@/lib/types';
import { toast } from 'sonner';
import { signup } from '@/lib/supabase-service';

export default function SignupScreen() {
  const { language, setUser, navigateTo } = useAppStore();
  const lang = language as Language;

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [shopName, setShopName] = useState('PS TELECOM');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSignup = async () => {
    if (!name.trim()) {
      toast.error(t('error', lang), { description: 'Name is required' });
      return;
    }
    if (!email.trim()) {
      toast.error(t('error', lang), { description: 'Email is required' });
      return;
    }
    if (!password.trim()) {
      toast.error(t('error', lang), { description: 'Password is required' });
      return;
    }
    if (password !== confirmPassword) {
      toast.error(t('error', lang), { description: 'Passwords do not match' });
      return;
    }
    if (password.length < 6) {
      toast.error(t('error', lang), { description: 'Password must be at least 6 characters' });
      return;
    }

    setIsLoading(true);
    try {
      const data = await signup(name, email, password, shopName);
      setUser(data.user as UserType);
      navigateTo('dashboard');
      toast.success(t('success', lang));
    } catch (error) {
      toast.error(t('error', lang), { description: error instanceof Error ? error.message : 'Signup failed' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="animated-bg min-h-screen flex flex-col max-w-md mx-auto px-6 py-8">
      {/* Header */}
      <motion.div
        className="text-center mt-8 sm:mt-12 mb-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h1 className="text-2xl sm:text-3xl font-bold neon-glow text-white mb-2">
          {t('signup', lang)}
        </h1>
        <p className="text-white/50 text-sm">
          PS TELECOM
        </p>
      </motion.div>

      {/* Form card */}
      <motion.div
        className="glass-card p-6 sm:p-8 glass-shine"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <div className="space-y-4">
          {/* Name input */}
          <div className="relative">
            <User
              size={18}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40"
            />
            <input
              type="text"
              className="glass-input w-full pl-11 pr-4 py-3 text-white text-sm"
              placeholder={t('name', lang)}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

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
              autoComplete="email"
            />
          </div>

          {/* Password input */}
          <div className="relative">
            <Lock
              size={18}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40"
            />
            <input
              type={showPassword ? 'text' : 'password'}
              className="glass-input w-full pl-11 pr-11 py-3 text-white text-sm"
              placeholder={t('password', lang)}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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

          {/* Confirm Password input */}
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
              autoComplete="new-password"
            />
          </div>

          {/* Shop Name input */}
          <div className="relative">
            <Store
              size={18}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40"
            />
            <input
              type="text"
              className="glass-input w-full pl-11 pr-4 py-3 text-white text-sm"
              placeholder={t('shopName', lang)}
              value={shopName}
              onChange={(e) => setShopName(e.target.value)}
            />
          </div>

          {/* Signup button */}
          <motion.button
            className="neon-btn-solid w-full py-3 font-semibold text-base rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleSignup}
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
              t('signupBtn', lang)
            )}
          </motion.button>
        </div>
      </motion.div>

      {/* Login link */}
      <motion.div
        className="text-center mt-8"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.5 }}
      >
        <p className="text-white/50 text-sm">
          {t('hasAccount', lang)}{' '}
          <button
            className="text-[#00f0ff] font-medium hover:underline"
            onClick={() => navigateTo('login')}
          >
            {t('login', lang)}
          </button>
        </p>
      </motion.div>
    </div>
  );
}
