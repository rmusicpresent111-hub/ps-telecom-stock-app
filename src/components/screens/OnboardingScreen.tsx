'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Package, Plus, TrendingUp, FileText, Cloud, Globe, Search } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { Language } from '@/lib/types';
import type { LucideIcon } from 'lucide-react';

interface OnboardingPage {
  icon: LucideIcon;
  titleKey: `onboarding${1 | 2 | 3 | 4 | 5 | 6 | 7}Title`;
  descKey: `onboarding${1 | 2 | 3 | 4 | 5 | 6 | 7}Desc`;
  accent: string;
}

const pages: OnboardingPage[] = [
  { icon: Package, titleKey: 'onboarding1Title', descKey: 'onboarding1Desc', accent: '#D4A853' },
  { icon: Plus, titleKey: 'onboarding2Title', descKey: 'onboarding2Desc', accent: '#A07C3E' },
  { icon: TrendingUp, titleKey: 'onboarding3Title', descKey: 'onboarding3Desc', accent: '#F5DEB3' },
  { icon: FileText, titleKey: 'onboarding4Title', descKey: 'onboarding4Desc', accent: '#D4A853' },
  { icon: Cloud, titleKey: 'onboarding5Title', descKey: 'onboarding5Desc', accent: '#ff6b00' },
  { icon: Globe, titleKey: 'onboarding6Title', descKey: 'onboarding6Desc', accent: '#A07C3E' },
  { icon: Search, titleKey: 'onboarding7Title', descKey: 'onboarding7Desc', accent: '#D4A853' },
];

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 300 : -300,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction < 0 ? 300 : -300,
    opacity: 0,
  }),
};

export default function OnboardingScreen() {
  const [currentPage, setCurrentPage] = useState(0);
  const [direction, setDirection] = useState(0);
  const { language, setHasSeenTutorial, navigateTo } = useAppStore();
  const lang = language as Language;

  const isLastPage = currentPage === pages.length - 1;

  const goNext = () => {
    if (isLastPage) {
      handleFinish();
      return;
    }
    setDirection(1);
    setCurrentPage((prev) => prev + 1);
  };

  const goPrev = () => {
    if (currentPage === 0) return;
    setDirection(-1);
    setCurrentPage((prev) => prev - 1);
  };

  const handleSkip = () => {
    handleFinish();
  };

  const handleFinish = () => {
    setHasSeenTutorial(true);
    navigateTo('language');
  };

  // Touch handling for swipe
  const [touchStart, setTouchStart] = useState<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStart(e.touches[0].clientX);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStart === null) return;
    const diff = touchStart - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 50) {
      if (diff > 0) goNext();
      else goPrev();
    }
    setTouchStart(null);
  };

  const page = pages[currentPage];
  const IconComponent = page.icon;

  return (
    <div
      className="animated-bg min-h-screen flex flex-col max-w-md mx-auto relative overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Skip button */}
      {!isLastPage && (
        <motion.button
          className="absolute top-6 right-6 text-white/60 hover:text-white text-sm font-medium z-20 px-3 py-1.5 rounded-lg transition-colors"
          onClick={handleSkip}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
        >
          {t('skip', lang)}
        </motion.button>
      )}

      {/* Slide content */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={currentPage}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.35, ease: 'easeInOut' }}
            className="glass-card p-8 sm:p-10 w-full text-center glass-shine"
          >
            {/* Icon */}
            <motion.div
              className="mx-auto w-20 h-20 sm:w-24 sm:h-24 rounded-2xl flex items-center justify-center mb-8 float-animation"
              style={{
                background: `linear-gradient(135deg, ${page.accent}20, ${page.accent}08)`,
                border: `1px solid ${page.accent}40`,
                boxShadow: `0 0 20px ${page.accent}15`,
              }}
              initial={{ scale: 0, rotate: -10 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ duration: 0.5, delay: 0.1, type: 'spring' }}
            >
              <IconComponent size={40} style={{ color: page.accent }} />
            </motion.div>

            {/* Title */}
            <motion.h2
              className="text-xl sm:text-2xl font-bold text-white mb-4 neon-glow"
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.2 }}
            >
              {t(page.titleKey, lang)}
            </motion.h2>

            {/* Description */}
            <motion.p
              className="text-white/60 text-sm sm:text-base leading-relaxed"
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.3 }}
            >
              {t(page.descKey, lang)}
            </motion.p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom section: Dots + Button */}
      <div className="px-6 pb-8 sm:pb-12">
        {/* Page indicator dots */}
        <div className="flex justify-center gap-2 mb-8">
          {pages.map((_, i) => (
            <motion.button
              key={i}
              className="h-2 rounded-full transition-all duration-300"
              animate={{
                width: i === currentPage ? 24 : 8,
                background:
                  i === currentPage
                    ? 'linear-gradient(90deg, #D4A853, #A07C3E)'
                    : 'rgba(255, 255, 255, 0.2)',
                boxShadow: i === currentPage ? '0 0 8px rgba(212, 168, 83, 0.4)' : 'none',
              }}
              onClick={() => {
                setDirection(i > currentPage ? 1 : -1);
                setCurrentPage(i);
              }}
            />
          ))}
        </div>

        {/* Navigation button */}
        <motion.button
          className="neon-btn-solid w-full py-3 font-semibold text-base rounded-xl"
          onClick={goNext}
          whileTap={{ scale: 0.97 }}
        >
          {isLastPage ? t('getStarted', lang) : t('next', lang)}
        </motion.button>
      </div>
    </div>
  );
}
