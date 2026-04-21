'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '@/store/appStore';
import {
  Database,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  ExternalLink,
  RefreshCw,
  ArrowRight,
  Server,
  Shield,
  Zap,
  Loader2,
} from 'lucide-react';

interface TableStatus {
  users: boolean;
  categories: boolean;
  products: boolean;
  transactions: boolean;
  cash_entries: boolean;
  expenses: boolean;
  app_settings: boolean;
}

const tableLabels: Record<string, string> = {
  users: 'Users',
  categories: 'Categories',
  products: 'Products',
  transactions: 'Transactions',
  cash_entries: 'Cash Entries',
  expenses: 'Expenses',
  app_settings: 'App Settings',
};

const SQL_SCHEMA = `-- PS TELECOM - Supabase Database Schema
-- Run this SQL in Supabase SQL Editor (Dashboard > SQL Editor)

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  password TEXT NOT NULL,
  shop_name TEXT DEFAULT 'PS TELECOM',
  role TEXT DEFAULT 'admin',
  language TEXT DEFAULT 'en',
  theme TEXT DEFAULT 'dark',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. CATEGORIES TABLE
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  image TEXT DEFAULT '',
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. PRODUCTS TABLE
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  quantity INTEGER DEFAULT 0,
  box_number TEXT DEFAULT '',
  purchase_price FLOAT DEFAULT 0,
  selling_price FLOAT DEFAULT 0,
  low_stock_threshold INTEGER DEFAULT 5,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 4. TRANSACTIONS TABLE
CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('STOCK_IN', 'STOCK_OUT', 'SELL')),
  quantity INTEGER NOT NULL,
  unit_price FLOAT DEFAULT 0,
  total_amount FLOAT DEFAULT 0,
  date TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. CASH ENTRIES TABLE
CREATE TABLE IF NOT EXISTS cash_entries (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  hand_cash FLOAT DEFAULT 0,
  liquid_cash FLOAT DEFAULT 0,
  note TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 6. EXPENSES TABLE
CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  amount FLOAT DEFAULT 0,
  category TEXT DEFAULT 'other',
  description TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 7. APP SETTINGS TABLE
CREATE TABLE IF NOT EXISTS app_settings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  key TEXT UNIQUE NOT NULL,
  value TEXT NOT NULL,
  user_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_categories_user_id ON categories(user_id);
CREATE INDEX IF NOT EXISTS idx_products_user_id ON products(user_id);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_product_id ON transactions(product_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_cash_entries_user_id ON cash_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_cash_entries_date ON cash_entries(date);
CREATE INDEX IF NOT EXISTS idx_expenses_user_id ON expenses(user_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);

-- ENABLE RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- RLS POLICIES
CREATE POLICY "Allow all on users" ON users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on categories" ON categories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on products" ON products FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on transactions" ON transactions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on cash_entries" ON cash_entries FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on expenses" ON expenses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on app_settings" ON app_settings FOR ALL USING (true) WITH CHECK (true);

-- AUTO-UPDATE TRIGGER
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_categories_updated_at BEFORE UPDATE ON categories FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_cash_entries_updated_at BEFORE UPDATE ON cash_entries FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_expenses_updated_at BEFORE UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER update_app_settings_updated_at BEFORE UPDATE ON app_settings FOR EACH ROW EXECUTE FUNCTION update_updated_at();`;

export default function SetupScreen() {
  const { navigateTo, hasSeenTutorial, isAuthenticated } = useAppStore();
  const [tableStatus, setTableStatus] = useState<TableStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [step, setStep] = useState(1); // 1: check, 2: instructions, 3: success
  const [dbUrl, setDbUrl] = useState('');
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupError, setSetupError] = useState('');

  const checkConnection = async () => {
    setChecking(true);
    try {
      const res = await fetch('/api/setup');
      const data = await res.json();
      setTableStatus(data.tables as TableStatus);

      if (data.status === 'ready') {
        setStep(3);
      } else {
        setStep(2);
      }
    } catch {
      setStep(2);
    } finally {
      setLoading(false);
      setChecking(false);
    }
  };

  useEffect(() => {
    checkConnection();
  }, []);

  const handleCopySQL = async () => {
    try {
      await navigator.clipboard.writeText(SQL_SCHEMA);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = SQL_SCHEMA;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDirectSetup = async () => {
    if (!dbUrl.trim()) return;
    setSetupLoading(true);
    setSetupError('');

    try {
      const res = await fetch('/api/setup/database', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          databaseUrl: dbUrl.trim(),
          setupKey: 'ps-telecom-setup-2025',
        }),
      });

      const data = await res.json();

      if (data.success) {
        await checkConnection();
      } else {
        setSetupError(data.error || 'Failed to setup database');
      }
    } catch {
      setSetupError('Network error. Please try again.');
    } finally {
      setSetupLoading(false);
    }
  };

  const handleContinue = () => {
    if (!hasSeenTutorial) {
      navigateTo('welcome');
    } else if (isAuthenticated) {
      navigateTo('dashboard');
    } else {
      navigateTo('login');
    }
  };

  const allTablesReady = tableStatus && Object.values(tableStatus).every(v => v);
  const readyCount = tableStatus ? Object.values(tableStatus).filter(v => v).length : 0;
  const totalTables = 7;

  return (
    <div className="min-h-screen animated-bg flex flex-col">
      {/* Header */}
      <div className="pt-12 pb-6 px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex flex-col items-center gap-4"
        >
          <div className="w-20 h-20 rounded-2xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #00f0ff, #b44aff)' }}>
            <Database size={36} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white neon-glow">Supabase Setup</h1>
            <p className="text-white/50 text-sm mt-1">Connect your PS TELECOM database</p>
          </div>
        </motion.div>
      </div>

      {/* Content */}
      <div className="flex-1 px-4 sm:px-6 pb-8">
        <AnimatePresence mode="wait">
          {/* Step 1: Checking connection */}
          {loading && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center py-16 gap-4"
            >
              <Loader2 className="w-10 h-10 text-cyan-400 animate-spin" />
              <p className="text-white/60 text-sm">Checking database connection...</p>
            </motion.div>
          )}

          {/* Step 2: Setup instructions */}
          {!loading && step === 2 && (
            <motion.div
              key="setup"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-5"
            >
              {/* Connection Status */}
              <div className="glass-card p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Server size={16} className="text-cyan-400" />
                  <span className="text-sm font-semibold text-white">Connection Status</span>
                </div>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-xs text-white/60">Connected to Supabase</span>
                </div>
                <div className="text-xs text-white/40 mt-1">
                  Project: iwigztspqhrujaskpobn.supabase.co
                </div>
              </div>

              {/* Table Status */}
              <div className="glass-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Shield size={16} className="text-amber-400" />
                    <span className="text-sm font-semibold text-white">Database Tables</span>
                  </div>
                  <span className="text-xs text-white/40">{readyCount}/{totalTables} ready</span>
                </div>
                <div className="space-y-2">
                  {Object.entries(tableStatus || {}).map(([table, exists]) => (
                    <div key={table} className="flex items-center justify-between py-1.5 px-2 rounded-lg bg-white/5">
                      <span className="text-xs text-white/70">{tableLabels[table] || table}</span>
                      {exists ? (
                        <CheckCircle2 size={14} className="text-emerald-400" />
                      ) : (
                        <XCircle size={14} className="text-red-400/60" />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Instructions */}
              <div className="glass-card p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Zap size={16} className="text-yellow-400" />
                  <span className="text-sm font-semibold text-white">Setup Instructions</span>
                </div>
                <div className="space-y-3">
                  <div className="flex gap-3">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: 'linear-gradient(135deg, #00f0ff, #b44aff)', color: 'white' }}>
                      1
                    </div>
                    <div>
                      <p className="text-sm text-white/80">Open Supabase SQL Editor</p>
                      <a
                        href="https://supabase.com/dashboard/project/iwigztspqhrujaskpobn/sql"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-cyan-400 flex items-center gap-1 mt-0.5 hover:text-cyan-300"
                      >
                        Open Dashboard <ExternalLink size={10} />
                      </a>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: 'linear-gradient(135deg, #00f0ff, #b44aff)', color: 'white' }}>
                      2
                    </div>
                    <div>
                      <p className="text-sm text-white/80">Copy the SQL schema below</p>
                      <button
                        onClick={handleCopySQL}
                        className="mt-1 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                        style={{
                          background: copied ? 'rgba(16, 185, 129, 0.15)' : 'rgba(0, 240, 255, 0.1)',
                          color: copied ? '#10b981' : '#00f0ff',
                          border: copied ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(0, 240, 255, 0.3)',
                        }}
                      >
                        {copied ? <Check size={12} /> : <Copy size={12} />}
                        {copied ? 'Copied!' : 'Copy SQL Schema'}
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: 'linear-gradient(135deg, #00f0ff, #b44aff)', color: 'white' }}>
                      3
                    </div>
                    <div>
                      <p className="text-sm text-white/80">Paste & Run in SQL Editor</p>
                      <p className="text-xs text-white/40 mt-0.5">Click &quot;Run&quot; to create all tables</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ background: 'linear-gradient(135deg, #00f0ff, #b44aff)', color: 'white' }}>
                      4
                    </div>
                    <div>
                      <p className="text-sm text-white/80">Verify connection below</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Quick Setup with Database URL */}
              <div className="glass-card p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Database size={16} className="text-purple-400" />
                  <span className="text-sm font-semibold text-white">Quick Setup (Advanced)</span>
                </div>
                <p className="text-xs text-white/40 mb-3">
                  Enter your Supabase PostgreSQL connection string for automatic setup
                </p>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={dbUrl}
                    onChange={(e) => setDbUrl(e.target.value)}
                    placeholder="postgresql://postgres.xxx:password@..."
                    className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-white placeholder:text-white/25 focus:outline-none focus:border-cyan-400/50"
                  />
                  <button
                    onClick={handleDirectSetup}
                    disabled={!dbUrl.trim() || setupLoading}
                    className="px-4 py-2 rounded-lg text-xs font-medium transition-all disabled:opacity-40"
                    style={{
                      background: 'linear-gradient(135deg, #00f0ff, #b44aff)',
                      color: 'white',
                    }}
                  >
                    {setupLoading ? <Loader2 size={14} className="animate-spin" /> : 'Run'}
                  </button>
                </div>
                {setupError && (
                  <p className="text-xs text-red-400 mt-2">{setupError}</p>
                )}
              </div>

              {/* Verify Button */}
              <button
                onClick={checkConnection}
                disabled={checking}
                className="w-full py-3 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2"
                style={{
                  background: 'linear-gradient(135deg, #00f0ff, #b44aff)',
                  color: 'white',
                  boxShadow: '0 0 20px rgba(0, 240, 255, 0.3)',
                }}
              >
                {checking ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <RefreshCw size={16} />
                )}
                {checking ? 'Checking...' : 'Verify Connection'}
              </button>
            </motion.div>
          )}

          {/* Step 3: Success */}
          {!loading && (step === 3 || allTablesReady) && (
            <motion.div
              key="success"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-5"
            >
              <div className="glass-card p-6 text-center">
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', damping: 15, stiffness: 200, delay: 0.2 }}
                  className="w-20 h-20 rounded-full mx-auto mb-4 flex items-center justify-center"
                  style={{ background: 'rgba(16, 185, 129, 0.15)', border: '2px solid rgba(16, 185, 129, 0.3)' }}
                >
                  <CheckCircle2 size={40} className="text-emerald-400" />
                </motion.div>
                <h2 className="text-xl font-bold text-white mb-2">Database Connected!</h2>
                <p className="text-sm text-white/50 mb-4">All tables are ready. Your PS TELECOM app is connected to Supabase.</p>

                {tableStatus && (
                  <div className="grid grid-cols-2 gap-2 mt-4">
                    {Object.entries(tableStatus).map(([table, exists]) => (
                      <div key={table} className="flex items-center gap-1.5 py-1 px-2 rounded-lg bg-white/5">
                        <CheckCircle2 size={12} className={exists ? 'text-emerald-400' : 'text-red-400/60'} />
                        <span className="text-xs text-white/60">{tableLabels[table] || table}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button
                onClick={handleContinue}
                className="w-full py-3.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2"
                style={{
                  background: 'linear-gradient(135deg, #00f0ff, #b44aff)',
                  color: 'white',
                  boxShadow: '0 0 20px rgba(0, 240, 255, 0.3)',
                }}
              >
                Continue to App <ArrowRight size={16} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
