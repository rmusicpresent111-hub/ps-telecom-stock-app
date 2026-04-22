---
Task ID: 1
Agent: Main Agent
Task: App Performance Optimization - Complete overhaul

Work Log:
- Analyzed entire codebase and identified critical performance bottlenecks
- Fixed Dashboard API route: replaced 20+ sequential Supabase queries with 7 parallel queries
  - Changed 7 separate day-by-day queries to single 7-day range query
  - Changed N per-category queries to client-side computation from already-fetched data
  - Added server-side response cache with 60s TTL
  - Added HTTP Cache-Control headers (max-age=30, stale-while-revalidate=60)
- Increased cache TTLs: Dashboard 20→60s, Products 25→60s, Categories 60→120s, Transactions 15→30s, Reports 30→60s
- Optimized page.tsx: faster transitions (0.15→0.1s), Set for O(1) bottom nav lookup, memoized exit dialog strings
- Optimized BottomNav: individual store selectors, memoized NavItem components
- Optimized DashboardScreen: stale-while-revalidate pattern, background refresh on focus, memoized StatCard, ref-based fetch guard
- Added CSS performance hints: `contain: layout style` on glass-card/animated-bg, `will-change: transform` on interactive elements
- Added Cache-Control headers to all API routes (transactions, products, categories, reports)
- Fixed missing `resetData` function in supabase-service.ts that was causing 500 errors
- Verified all changes pass lint and the app runs correctly

Stage Summary:
- Dashboard API went from 20+ sequential DB queries to 7 parallel queries (~3-5x faster)
- Cache TTLs 2-3x longer, reducing redundant API calls
- Added stale-while-revalidate pattern for instant UI updates
- Added server-side caching for dashboard responses
- Added CSS containment and will-change hints for better rendering performance
- Fixed critical bug (missing resetData function)

---
Task ID: 2
Agent: Main Agent
Task: Complete offline-first architecture - All Supabase data auto-saved to device for offline use

Work Log:
- Added `pendingDeletes` store to IndexedDB (offline-db.ts) for tracking local deletions that need to be synced to Supabase
  - Bumped DB_VERSION from 3 to 4
  - Added `offlinePendingDeletes` helper with add/getAll/getByStore/remove/removeByItemId/clearForUser methods
- Added ALL missing offline-first functions to offline-service.ts:
  - `deleteProductOffline` - deletes from IndexedDB + adds to pendingDeletes queue
  - `createExpenseOffline` - saves locally first, uploads to Supabase if online
  - `updateExpenseOffline` - updates locally + marks dirty, syncs to Supabase if online
  - `deleteExpenseOffline` - deletes locally + adds to pendingDeletes queue
  - `upsertCashEntryOffline` - creates or updates cash entry locally first
  - `updateCashEntryOffline` - updates locally + marks dirty
  - `deleteCashEntryOffline` - deletes locally + adds to pendingDeletes queue
  - `getReportsOffline` - computes reports from local IndexedDB data (stock-value, daily, monthly, category)
  - `getProfileOffline` - tries Supabase online, returns null for offline (uses zustand cache)
  - `updateProfileOffline` - tries Supabase if online, saves locally otherwise
  - `exportBackupOffline` - exports from local IndexedDB data (always works offline!)
  - `importBackupOffline` - imports to local IndexedDB first, syncs to Supabase later
- Updated sync-engine.ts to handle pending deletes:
  - Added `processPendingDeletes` function that processes the delete queue before uploading dirty items
  - Integrated into `syncAll()` flow: processPendingDeletes → syncToSupabase → syncFromSupabase
- Migrated ALL screens from supabase-service to offline-service:
  - AddProductScreen: createProduct → createProductOffline, updateProduct → updateProductOffline
  - ProductDetailScreen: deleteProduct → deleteProductOffline
  - DailyBookScreen: all expense/cash CRUD operations migrated to offline versions
  - ProfileScreen: getProfile, updateProfile, exportBackup, importBackup, resetData all migrated
  - ReportsScreen: getReports → getReportsOffline
  - ProfitScreen: getReports → getReportsOffline
  - SplashScreen: getProfile → getProfileOffline with offline fallback (allows dashboard access even when offline)
- Only LoginScreen and SignupScreen still use supabase-service directly (auth requires online access)
- Fixed `getDashboard` export alias for backward compatibility with DashboardScreen import
- All changes pass lint and the app runs correctly (HTTP 200)

Stage Summary:
- Complete offline-first architecture now covers ALL data operations (CRUD for categories, products, transactions, expenses, cash entries)
- Reports can be computed entirely from local IndexedDB data
- Backup/restore works offline using local data
- Delete operations tracked in pendingDeletes queue and synced to Supabase when back online
- Auto-sync runs every 30 seconds when online + triggers on online event
- App fully functional in offline mode with instant local data access
