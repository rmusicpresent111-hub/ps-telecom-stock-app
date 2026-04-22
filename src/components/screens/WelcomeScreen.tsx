'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { useAppStore } from '@/store/appStore';
import { ChevronRight, Sparkles, Zap, Shield, Smartphone } from 'lucide-react';

const floatingIcons = ['📱', '🎧', '⌚', '🔌', '💰', '📊'];

// Pre-computed deterministic positions to avoid hydration mismatch
const iconPositions = [
  { ix: -30, iy: -80, ax: [-30, 20], ay: [-80, 100], left: '5%', top: '10%' },
  { ix: 45, iy: -120, ax: [45, -25], ay: [-120, 60], left: '22%', top: '38%' },
  { ix: -60, iy: 40, ax: [-60, 30], ay: [40, -90], left: '39%', top: '66%' },
  { ix: 80, iy: -60, ax: [80, -40], ay: [-60, 130], left: '56%', top: '10%' },
  { ix: -20, iy: 100, ax: [-20, 50], ay: [100, -70], left: '73%', top: '38%' },
  { ix: 55, iy: -30, ax: [55, -35], ay: [-30, 80], left: '90%', top: '66%' },
];

const features = [
  { icon: '📦', label: 'Stock Track' },
  { icon: '💰', label: 'Profit' },
  { icon: '📊', label: 'Reports' },
  { icon: '📒', label: 'Daily Book' },
];

export default function WelcomeScreen() {
  const { navigateTo } = useAppStore();
  const [imageUrl] = useState('/ps-telecom-shop.png');

  const handleGetStarted = () => {
    navigateTo('tutorial');
  };

  return (
    <div className="animated-bg min-h-screen flex flex-col items-center justify-between relative overflow-hidden">
      {/* Floating background icons */}
      {floatingIcons.map((icon, i) => (
        <motion.div
          key={i}
          className="absolute text-3xl sm:text-4xl opacity-[0.07] select-none pointer-events-none"
          initial={{
            x: iconPositions[i].ix,
            y: iconPositions[i].iy,
          }}
          animate={{
            y: iconPositions[i].ay,
            x: iconPositions[i].ax,
          }}
          transition={{
            duration: 5 + i,
            repeat: Infinity,
            repeatType: 'reverse',
            ease: 'easeInOut',
          }}
          style={{
            left: iconPositions[i].left,
            top: iconPositions[i].top,
          }}
        >
          <span className="inline-block float-animation">{icon}</span>
        </motion.div>
      ))}

      {/* Top decorative glow */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[500px] h-[400px] pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at center, rgba(212, 168, 83, 0.08) 0%, transparent 70%)',
        }}
      />

      {/* Main content area */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pt-8 relative z-10">
        {/* Hero Image */}
        <motion.div
          className="relative mb-6 w-full max-w-[260px] sm:max-w-[300px]"
          initial={{ opacity: 0, y: 30, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          {/* Glow behind image */}
          <div
            className="absolute -inset-4 rounded-3xl blur-2xl"
            style={{
              background: 'radial-gradient(ellipse at center, rgba(212, 168, 83, 0.2) 0%, rgba(160, 124, 62, 0.15) 50%, transparent 70%)',
            }}
          />

          {/* Image frame */}
          <motion.div
            className="relative rounded-2xl overflow-hidden"
            style={{
              border: '1.5px solid rgba(212, 168, 83, 0.25)',
              boxShadow: '0 0 40px rgba(212, 168, 83, 0.15), 0 8px 40px rgba(0, 0, 0, 0.4)',
            }}
            animate={{
              boxShadow: [
                '0 0 40px rgba(212, 168, 83, 0.15), 0 8px 40px rgba(0, 0, 0, 0.4)',
                '0 0 50px rgba(212, 168, 83, 0.25), 0 8px 40px rgba(0, 0, 0, 0.4)',
                '0 0 40px rgba(212, 168, 83, 0.15), 0 8px 40px rgba(0, 0, 0, 0.4)',
              ],
            }}
            transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
          >
            {/* Shine sweep */}
            <div className="absolute inset-0 z-10 pointer-events-none overflow-hidden">
              <div
                className="absolute inset-0"
                style={{
                  background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.06) 45%, rgba(255,255,255,0.1) 50%, rgba(255,255,255,0.06) 55%, transparent 60%)',
                  animation: 'shine 5s ease-in-out infinite',
                }}
              />
            </div>

            {/* Gradient overlay at bottom */}
            <div
              className="absolute bottom-0 left-0 right-0 h-24 z-10 pointer-events-none"
              style={{
                background: 'linear-gradient(to top, rgba(212, 168, 83, 0.08), transparent)',
              }}
            />

            <img
              src={imageUrl}
              alt="PS TELECOM Shop"
              className="w-full h-auto rounded-2xl"
              style={{
                filter: 'brightness(1.05) saturate(1.15)',
              }}
            />
          </motion.div>
        </motion.div>

        {/* Brand name */}
        <motion.h1
          className="text-4xl sm:text-5xl font-bold neon-glow neon-pulse text-white tracking-wider mb-2"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
        >
          PS TELECOM
        </motion.h1>

        {/* Tagline */}
        <motion.p
          className="text-white/45 text-sm sm:text-base tracking-widest uppercase mb-6"
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
        >
          Smart Stock Management
        </motion.p>

        {/* Feature pills */}
        <motion.div
          className="flex flex-wrap justify-center gap-2 mb-2"
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.7 }}
        >
          {features.map((feature, i) => (
            <motion.div
              key={feature.label}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium"
              style={{
                background: 'rgba(212, 168, 83, 0.08)',
                border: '1px solid rgba(212, 168, 83, 0.15)',
                color: 'rgba(212, 168, 83, 0.8)',
              }}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, delay: 0.8 + i * 0.1 }}
              whileHover={{
                background: 'rgba(212, 168, 83, 0.15)',
                scale: 1.05,
              }}
            >
              <span>{feature.icon}</span>
              <span>{feature.label}</span>
            </motion.div>
          ))}
        </motion.div>

        {/* Trust indicators */}
        <motion.div
          className="flex items-center gap-4 mt-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 1.1 }}
        >
          <div className="flex items-center gap-1 text-white/30 text-[10px]">
            <Shield size={12} />
            <span>Secure</span>
          </div>
          <div className="flex items-center gap-1 text-white/30 text-[10px]">
            <Zap size={12} />
            <span>Fast</span>
          </div>
          <div className="flex items-center gap-1 text-white/30 text-[10px]">
            <Smartphone size={12} />
            <span>Offline</span>
          </div>
        </motion.div>
      </div>

      {/* Bottom CTA area */}
      <motion.div
        className="w-full px-6 pb-8 sm:pb-12 pt-4 relative z-10"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 1.2 }}
      >
        {/* Get Started button */}
        <motion.button
          className="neon-btn-solid w-full py-4 font-semibold text-base rounded-xl flex items-center justify-center gap-2"
          onClick={handleGetStarted}
          whileTap={{ scale: 0.97 }}
          whileHover={{
            boxShadow: '0 0 30px rgba(180, 140, 60, 0.5)',
          }}
        >
          <Sparkles size={18} />
          Get Started
          <ChevronRight size={18} />
        </motion.button>

        {/* Bottom note */}
        <p className="text-center text-white/25 text-[10px] mt-4 tracking-wider">
          Your data stays on your device
        </p>
      </motion.div>

      {/* Bottom decorative line */}
      <motion.div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 w-24 h-[2px] rounded-full pointer-events-none"
        style={{
          background: 'linear-gradient(90deg, transparent, #D4A853, transparent)',
        }}
        animate={{
          opacity: [0, 0.5, 0],
        }}
        transition={{ duration: 2, repeat: Infinity }}
      />
    </div>
  );
}
