'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useAppStore } from '@/store/appStore';

const floatingIcons = ['📱', '🎧', '🔌', '⌚', '📺'];

// Pre-computed deterministic positions to avoid hydration mismatch
const iconPositions = [
  { ix: -45, iy: -77, ay: [-77, 150], left: '10%', top: '15%' },
  { ix: 108, iy: -115, ay: [-115, 80], left: '30%', top: '40%' },
  { ix: 77, iy: -47, ay: [-47, 180], left: '50%', top: '65%' },
  { ix: 38, iy: -240, ay: [-240, -60], left: '70%', top: '15%' },
  { ix: 131, iy: -14, ay: [-14, 120], left: '90%', top: '40%' },
];

export default function SplashScreen() {
  const { navigateTo, hasSeenTutorial, isAuthenticated, _hasHydrated } = useAppStore();
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const duration = 3000;
    const interval = 30;
    const step = 100 / (duration / interval);
    const timer = setInterval(() => {
      setProgress((prev) => {
        const next = prev + step;
        if (next >= 100) {
          clearInterval(timer);
          return 100;
        }
        return next;
      });
    }, interval);

    // Wait for hydration + splash duration before navigating
    const navTimer = setTimeout(() => {
      // If store hasn't hydrated yet, wait a bit more
      if (!_hasHydrated) {
        const waitTimer = setInterval(() => {
          const state = useAppStore.getState();
          if (state._hasHydrated) {
            clearInterval(waitTimer);
            navigateToApp(state.hasSeenTutorial, state.isAuthenticated);
          }
        }, 100);
        return;
      }
      navigateToApp(hasSeenTutorial, isAuthenticated);
    }, duration);

    function navigateToApp(seenTutorial: boolean, authenticated: boolean) {
      if (!seenTutorial) {
        // First time user → Welcome + Tutorial + Login flow
        navigateTo('welcome');
      } else if (authenticated) {
        // Returning user, logged in → Dashboard directly
        navigateTo('dashboard');
      } else {
        // Returning user, not logged in → Login directly
        navigateTo('login');
      }
    }

    return () => {
      clearInterval(timer);
      clearTimeout(navTimer);
    };
  }, [navigateTo, hasSeenTutorial, isAuthenticated, _hasHydrated]);

  return (
    <div className="animated-bg min-h-screen flex flex-col items-center justify-center relative overflow-hidden">
      {/* Floating background icons */}
      {floatingIcons.map((icon, i) => (
        <motion.div
          key={i}
          className="absolute text-4xl sm:text-5xl opacity-10 select-none"
          initial={{
            x: iconPositions[i].ix,
            y: iconPositions[i].iy,
            scale: 1,
          }}
          animate={{
            y: iconPositions[i].ay,
            scale: [1, 1.1],
          }}
          transition={{
            duration: 3 + i,
            repeat: Infinity,
            repeatType: 'reverse',
            ease: 'easeInOut',
          }}
          style={{
            left: iconPositions[i].left,
            top: iconPositions[i].top,
          }}
        >
          <span className="slow-zoom inline-block float-animation">{icon}</span>
        </motion.div>
      ))}

      {/* Center content */}
      <motion.div
        className="flex flex-col items-center gap-6 z-10"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
      >
        {/* App name with neon effect */}
        <motion.h1
          className="text-4xl sm:text-5xl font-bold neon-glow neon-pulse text-white tracking-wider"
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.3 }}
        >
          PS TELECOM
        </motion.h1>

        {/* Subtitle */}
        <motion.p
          className="text-white/50 text-sm tracking-widest uppercase"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.6 }}
        >
          Stock Management
        </motion.p>

        {/* Progress bar */}
        <motion.div
          className="w-48 sm:w-56 mt-8"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.8 }}
        >
          <div className="h-1 rounded-full bg-white/10 overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{
                background: 'linear-gradient(90deg, #00f0ff, #b44aff)',
                boxShadow: '0 0 10px rgba(0, 240, 255, 0.5)',
              }}
              initial={{ width: '0%' }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.1 }}
            />
          </div>
        </motion.div>
      </motion.div>

      {/* Bottom decorative line */}
      <motion.div
        className="absolute bottom-12 left-1/2 -translate-x-1/2 w-24 h-[2px] rounded-full"
        style={{
          background: 'linear-gradient(90deg, transparent, #00f0ff, transparent)',
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.5, 0] }}
        transition={{ duration: 2, repeat: Infinity }}
      />
    </div>
  );
}
