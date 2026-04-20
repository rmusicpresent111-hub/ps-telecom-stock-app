'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { useAppStore } from '@/store/appStore';
import { t } from '@/lib/i18n';
import { Language } from '@/lib/types';

interface LanguageOption {
  code: Language;
  flag: string;
  label: string;
  labelKey: 'bengali' | 'english' | 'hindi';
}

const languageOptions: LanguageOption[] = [
  { code: 'bn', flag: '🇧🇩', label: 'বাংলা', labelKey: 'bengali' },
  { code: 'en', flag: '🇺🇸', label: 'English', labelKey: 'english' },
  { code: 'hi', flag: '🇮🇳', label: 'हिन्दी', labelKey: 'hindi' },
];

export default function LanguageScreen() {
  const { language, setLanguage, navigateTo } = useAppStore();
  const [selected, setSelected] = useState<Language>(language);

  const handleContinue = () => {
    setLanguage(selected);
    navigateTo('login');
  };

  return (
    <div className="animated-bg min-h-screen flex flex-col max-w-md mx-auto px-6 py-8">
      {/* Title */}
      <motion.div
        className="text-center mt-12 sm:mt-16 mb-10"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h1 className="text-2xl sm:text-3xl font-bold neon-glow text-white mb-3">
          {t('selectLanguage', selected)}
        </h1>
        <p className="text-white/50 text-sm">
          {t('selectLanguageDesc', selected)}
        </p>
      </motion.div>

      {/* Language options */}
      <div className="flex-1 flex flex-col gap-4">
        {languageOptions.map((option, index) => {
          const isSelected = selected === option.code;
          return (
            <motion.button
              key={option.code}
              className={`glass-card-strong w-full p-5 flex items-center gap-4 transition-all duration-300 ${
                isSelected ? 'neon-border-glow' : ''
              }`}
              style={{
                borderColor: isSelected ? 'rgba(0, 240, 255, 0.5)' : undefined,
                borderWidth: isSelected ? '1px' : undefined,
              }}
              onClick={() => setSelected(option.code)}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: index * 0.1 }}
              whileTap={{ scale: 0.98 }}
            >
              {/* Flag */}
              <span className="text-3xl">{option.flag}</span>

              {/* Language name */}
              <span className="flex-1 text-left text-white font-medium text-base">
                {option.label}
              </span>

              {/* Radio indicator */}
              <div
                className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-300 ${
                  isSelected
                    ? 'border-[#00f0ff] bg-[#00f0ff]/20'
                    : 'border-white/30'
                }`}
              >
                {isSelected && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                  >
                    <Check size={14} className="text-[#00f0ff]" />
                  </motion.div>
                )}
              </div>
            </motion.button>
          );
        })}
      </div>

      {/* Continue button */}
      <motion.div
        className="mt-8 pb-4"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.4 }}
      >
        <motion.button
          className="neon-btn-solid w-full py-3 font-semibold text-base rounded-xl"
          onClick={handleContinue}
          whileTap={{ scale: 0.97 }}
        >
          {t('continue', selected)}
        </motion.button>
      </motion.div>
    </div>
  );
}
