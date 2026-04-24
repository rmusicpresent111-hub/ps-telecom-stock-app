'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, ChevronLeft, SkipForward, Sparkles } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { Language } from '@/lib/types';

interface TutorialPage {
  image: string;
  titleEn: string;
  titleBn: string;
  titleHi: string;
  description: string;
  accent: string;
}

const tutorialPages: TutorialPage[] = [
  {
    image: '/tutorial-1.png',
    titleEn: 'Dashboard Overview',
    titleBn: 'ড্যাশবোর্ড ওভারভিউ',
    titleHi: 'डैशबोर्ड अवलोकन',
    description: 'Track your total items, low stock alerts, today\'s transactions and stock value at a glance',
    accent: '#D4A853',
  },
  {
    image: '/tutorial-2-new.png',
    titleEn: 'Product Management',
    titleBn: 'প্রোডাক্ট ম্যানেজমেন্ট',
    titleHi: 'प्रोडक्ट मैनेजमेंट',
    description: 'Add, edit and manage all your products with categories, prices and quantities',
    accent: '#A07C3E',
  },
  {
    image: '/tutorial-3-new.png',
    titleEn: 'Stock In & Out',
    titleBn: 'স্টক ইন ও আউট',
    titleHi: 'स्टॉक इन और आउट',
    description: 'Easily manage stock entries, exits and instant sales with one tap',
    accent: '#F5DEB3',
  },
  {
    image: '/tutorial-4-new.png',
    titleEn: 'Profit Tracking',
    titleBn: 'লাভ ট্র্যাকিং',
    titleHi: 'लाभ ट्रैकिंग',
    description: 'Monitor daily and monthly profits, revenue and costs with visual charts',
    accent: '#ff6b00',
  },
  {
    image: '/tutorial-5-new.png',
    titleEn: 'Daily Book',
    titleBn: 'ডেইলি বুক',
    titleHi: 'डेली बुक',
    description: 'Manage hand cash, liquid cash and track all your daily expenses',
    accent: '#ffd700',
  },
  {
    image: '/tutorial-6-new.png',
    titleEn: 'Reports & Backup',
    titleBn: 'রিপোর্ট ও ব্যাকআপ',
    titleHi: 'रिपोर्ट और बैकअप',
    description: 'Generate detailed reports, backup your data and use in multiple languages',
    accent: '#ff006e',
  },
];

function getTitle(page: TutorialPage, lang: Language): string {
  switch (lang) {
    case 'bn':
      return page.titleBn;
    case 'hi':
      return page.titleHi;
    default:
      return page.titleEn;
  }
}

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? '100%' : '-100%',
    opacity: 0,
    scale: 0.95,
  }),
  center: {
    x: 0,
    opacity: 1,
    scale: 1,
  },
  exit: (direction: number) => ({
    x: direction < 0 ? '100%' : '-100%',
    opacity: 0,
    scale: 0.95,
  }),
};

const contentVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: 0.15 + i * 0.1,
      duration: 0.5,
      ease: [0.25, 0.46, 0.45, 0.94] as [number, number, number, number],
    },
  }),
};

export default function TutorialScreen() {
  const [currentPage, setCurrentPage] = useState(0);
  const [direction, setDirection] = useState(0);
  const { language, setHasSeenTutorial, navigateTo, isAuthenticated } = useAppStore();
  const lang = language as Language;

  const isLastPage = currentPage === tutorialPages.length - 1;
  const page = tutorialPages[currentPage];
  const progress = ((currentPage + 1) / tutorialPages.length) * 100;

  const handleFinish = useCallback(() => {
    setHasSeenTutorial(true);
    if (isAuthenticated) {
      navigateTo('dashboard');
    } else {
      navigateTo('login');
    }
  }, [setHasSeenTutorial, navigateTo, isAuthenticated]);

  const goNext = useCallback(() => {
    if (isLastPage) {
      handleFinish();
      return;
    }
    setDirection(1);
    setCurrentPage((prev) => prev + 1);
  }, [isLastPage, handleFinish]);

  const goPrev = useCallback(() => {
    if (currentPage === 0) return;
    setDirection(-1);
    setCurrentPage((prev) => prev - 1);
  }, [currentPage]);

  const handleSkip = useCallback(() => {
    handleFinish();
  }, [handleFinish]);

  // Touch handling for swipe
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchDelta, setTouchDelta] = useState(0);

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStart(e.touches[0].clientX);
    setTouchDelta(0);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStart === null) return;
    setTouchDelta(e.touches[0].clientX - touchStart);
  };

  const handleTouchEnd = () => {
    if (touchStart === null) return;
    if (Math.abs(touchDelta) > 50) {
      if (touchDelta < 0) goNext();
      else goPrev();
    }
    setTouchStart(null);
    setTouchDelta(0);
  };

  return (
    <div
      className="animated-bg min-h-screen flex flex-col max-w-md mx-auto relative overflow-hidden"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Accent color overlay */}
      <div
        className="absolute inset-0 pointer-events-none transition-opacity duration-700"
        style={{
          background: `radial-gradient(ellipse at 50% 30%, ${page.accent}08 0%, transparent 70%)`,
        }}
      />

      {/* Progress bar at top */}
      <div className="w-full h-1 bg-white/5 relative z-20">
        <motion.div
          className="h-full rounded-full"
          style={{
            background: `linear-gradient(90deg, ${page.accent}, ${page.accent}80)`,
            boxShadow: `0 0 8px ${page.accent}60`,
          }}
          initial={{ width: '0%' }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </div>

      {/* Skip button */}
      <div className="relative z-20 flex items-center justify-between px-5 pt-4 pb-2">
        {/* Page counter */}
        <motion.span
          key={`counter-${currentPage}`}
          className="text-xs font-medium px-3 py-1 rounded-full"
          style={{
            color: page.accent,
            background: `${page.accent}15`,
            border: `1px solid ${page.accent}30`,
          }}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
        >
          {currentPage + 1} / {tutorialPages.length}
        </motion.span>

        {!isLastPage && (
          <motion.button
            className="flex items-center gap-1 text-white/50 hover:text-white/80 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
            onClick={handleSkip}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            whileTap={{ scale: 0.95 }}
          >
            {t('skip', lang)}
            <SkipForward size={14} />
          </motion.button>
        )}
      </div>

      {/* Main content area */}
      <div className="flex-1 flex flex-col items-center justify-center px-5 py-2 relative z-10">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={currentPage}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{
              duration: 0.4,
              ease: [0.25, 0.46, 0.45, 0.94],
            }}
            className="w-full flex flex-col items-center"
          >
            {/* Image container with glow */}
            <motion.div
              custom={0}
              variants={contentVariants}
              initial="hidden"
              animate="visible"
              className="relative mb-6 w-full max-w-[280px] sm:max-w-[300px]"
            >
              {/* Glow behind image */}
              <div
                className="absolute -inset-3 rounded-3xl blur-xl transition-all duration-700"
                style={{
                  background: `radial-gradient(ellipse at center, ${page.accent}25 0%, transparent 70%)`,
                }}
              />

              {/* Image frame */}
              <div
                className="relative rounded-2xl overflow-hidden float-animation"
                style={{
                  border: `1.5px solid ${page.accent}40`,
                  boxShadow: `0 0 30px ${page.accent}20, 0 8px 32px rgba(0,0,0,0.3)`,
                }}
              >
                {/* Shine effect */}
                <div className="absolute inset-0 z-10 pointer-events-none">
                  <div
                    className="absolute inset-0"
                    style={{
                      background: `linear-gradient(135deg, ${page.accent}10 0%, transparent 50%)`,
                    }}
                  />
                </div>

                <img
                  src={page.image}
                  alt={getTitle(page, lang)}
                  className="w-full h-auto rounded-2xl"
                  style={{
                    filter: 'brightness(1.05) saturate(1.1)',
                  }}
                />

                {/* Bottom gradient overlay */}
                <div
                  className="absolute bottom-0 left-0 right-0 h-20 z-10 pointer-events-none"
                  style={{
                    background: `linear-gradient(to top, ${page.accent}15, transparent)`,
                  }}
                />
              </div>
            </motion.div>

            {/* Text content */}
            <motion.div
              custom={1}
              variants={contentVariants}
              initial="hidden"
              animate="visible"
              className="text-center px-2"
            >
              {/* Accent dot before title */}
              <div className="flex items-center justify-center gap-2 mb-3">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{
                    background: page.accent,
                    boxShadow: `0 0 8px ${page.accent}80`,
                  }}
                />
                <span
                  className="text-xs font-medium uppercase tracking-widest"
                  style={{ color: `${page.accent}cc` }}
                >
                  {t('appName', lang)}
                </span>
                <div
                  className="w-2 h-2 rounded-full"
                  style={{
                    background: page.accent,
                    boxShadow: `0 0 8px ${page.accent}80`,
                  }}
                />
              </div>

              {/* Title */}
              <h2
                className="text-2xl sm:text-3xl font-bold text-white mb-3 leading-tight"
                style={{
                  textShadow: `0 0 20px ${page.accent}30`,
                }}
              >
                {getTitle(page, lang)}
              </h2>

              {/* Description */}
              <p className="text-white/55 text-sm sm:text-base leading-relaxed max-w-xs mx-auto">
                {page.description}
              </p>
            </motion.div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Bottom section: Dots + Navigation */}
      <div className="relative z-20 px-5 pb-6 sm:pb-10">
        {/* Page indicator dots */}
        <div className="flex justify-center items-center gap-2 mb-6">
          {tutorialPages.map((p, i) => (
            <motion.button
              key={i}
              className="h-2 rounded-full"
              animate={{
                width: i === currentPage ? 28 : 8,
                background:
                  i === currentPage
                    ? `linear-gradient(90deg, ${p.accent}, ${p.accent}99)`
                    : i < currentPage
                      ? `${p.accent}40`
                      : 'rgba(255, 255, 255, 0.15)',
                boxShadow: i === currentPage ? `0 0 10px ${p.accent}50` : 'none',
              }}
              transition={{ duration: 0.4, ease: 'easeInOut' }}
              onClick={() => {
                setDirection(i > currentPage ? 1 : -1);
                setCurrentPage(i);
              }}
              whileTap={{ scale: 0.9 }}
            />
          ))}
        </div>

        {/* Navigation buttons */}
        <div className="flex items-center gap-3">
          {/* Previous button */}
          {currentPage > 0 ? (
            <motion.button
              className="flex items-center justify-center w-12 h-12 rounded-xl transition-all"
              style={{
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
              }}
              onClick={goPrev}
              whileTap={{ scale: 0.92 }}
              whileHover={{ background: 'rgba(255, 255, 255, 0.1)' }}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.3 }}
            >
              <ChevronLeft size={20} className="text-white/60" />
            </motion.button>
          ) : (
            <div className="w-12 h-12" />
          )}

          {/* Next / Get Started button */}
          <motion.button
            className="flex-1 flex items-center justify-center gap-2 py-3.5 font-semibold text-base rounded-xl transition-all"
            style={{
              background: `linear-gradient(135deg, ${page.accent}dd, ${page.accent}99)`,
              boxShadow: `0 4px 20px ${page.accent}30`,
              color: page.accent === '#ffd700' || page.accent === '#F5DEB3' ? '#091413' : '#ffffff',
            }}
            onClick={goNext}
            whileTap={{ scale: 0.97 }}
            whileHover={{
              boxShadow: `0 6px 25px ${page.accent}50`,
            }}
          >
            {isLastPage ? (
              <>
                <Sparkles size={18} />
                {t('getStarted', lang)}
              </>
            ) : (
              <>
                {t('next', lang)}
                <ChevronRight size={18} />
              </>
            )}
          </motion.button>
        </div>
      </div>

      {/* Decorative floating particles */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
        {[...Array(6)].map((_, i) => (
          <motion.div
            key={`particle-${i}`}
            className="absolute rounded-full"
            style={{
              width: 3 + (i % 3) * 2,
              height: 3 + (i % 3) * 2,
              background: page.accent,
              opacity: 0.15,
              left: `${10 + i * 16}%`,
              top: `${20 + (i % 4) * 18}%`,
            }}
            animate={{
              y: [0, -20, 0],
              opacity: [0.1, 0.25, 0.1],
            }}
            transition={{
              duration: 3 + i * 0.5,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: i * 0.3,
            }}
          />
        ))}
      </div>
    </div>
  );
}
