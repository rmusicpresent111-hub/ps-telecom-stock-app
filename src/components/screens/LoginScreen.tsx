'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { Language, User } from '@/lib/types';
import { toast } from 'sonner';
import { login } from '@/lib/supabase-service';

export default function LoginScreen() {
  const { language, setUser, navigateTo } = useAppStore();
  const lang = language as Language;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async () => {
    if (!email.trim()) {
      toast.error(t('error', lang), { description: 'Email is required' });
      return;
    }
    if (!password.trim()) {
      toast.error(t('error', lang), { description: 'Password is required' });
      return;
    }

    setIsLoading(true);
    try {
      const data = await login(email, password);
      setUser(data.user as User);
      navigateTo('dashboard');
      toast.success(t('success', lang));
    } catch (error) {
      toast.error(t('error', lang), { description: error instanceof Error ? error.message : 'Login failed' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="animated-bg min-h-screen flex flex-col max-w-md mx-auto px-6 py-8">
      {/* Logo section */}
      <motion.div
        className="text-center mt-12 sm:mt-16 mb-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h1 className="text-3xl sm:text-4xl font-bold neon-glow text-white mb-2">
          PS TELECOM
        </h1>
        <p className="text-white/50 text-sm">
          {t('login', lang)}
        </p>
      </motion.div>

      {/* Form card */}
      <motion.div
        className="glass-card p-6 sm:p-8 glass-shine"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
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
              autoComplete="current-password"
              onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
            />
            <button
              type="button"
              className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          {/* Forgot password link */}
          <div className="text-right">
            <button
              className="text-[#00f0ff] text-xs hover:underline"
              onClick={() => navigateTo('forgot-password')}
            >
              {t('forgotLink', lang)}
            </button>
          </div>

          {/* Login button */}
          <motion.button
            className="neon-btn-solid w-full py-3 font-semibold text-base rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleLogin}
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
              t('loginBtn', lang)
            )}
          </motion.button>
        </div>
      </motion.div>

      {/* Sign up link */}
      <motion.div
        className="text-center mt-8"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.5 }}
      >
        <p className="text-white/50 text-sm">
          {t('noAccount', lang)}{' '}
          <button
            className="text-[#00f0ff] font-medium hover:underline"
            onClick={() => navigateTo('signup')}
          >
            {t('signup', lang)}
          </button>
        </p>
      </motion.div>
    </div>
  );
}
