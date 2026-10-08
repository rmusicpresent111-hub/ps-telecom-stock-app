#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Apply remaining DailyBookScreen fixes with regex anchors (Bengali-safe)."""
import re, sys

P = '/home/z/my-project/src/components/screens/DailyBookScreen.tsx'
src = open(P, encoding='utf-8').read()

def replace_once(s, old, new):
    n = s.count(old)
    if n != 1:
        print(f"FAIL count={n} for: {old[:80]!r}")
        sys.exit(1)
    return s.replace(old, new, 1)

def re_sub_once(s, pattern, repl):
    new, n = re.subn(pattern, repl, s, count=1)
    if n != 1:
        print(f"FAIL regex count={n} for: {pattern[:80]!r}")
        sys.exit(1)
    return new

# 0. drop unused deleteBusy state
src = re_sub_once(
    src,
    r"  const \[confirmDelete, setConfirmDelete\] = useState<\{ type: 'cash' \| 'expense'; id: string \} \| null>\(null\);\n  const \[deleteBusy, setDeleteBusy\] = useState\(false\);",
    "  const [confirmDelete, setConfirmDelete] = useState<{ type: 'cash' | 'expense'; id: string } | null>(null);"
)

# 1. handleSaveCash: validation + Number() instead of parseFloat
src = replace_once(
    src,
    """  // Cash form handlers
  const handleSaveCash = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      if (editingCashId) {
        await updateCashEntryOffline(editingCashId, {
          handCash: parseFloat(handCashInput) || 0,
          liquidCash: parseFloat(liquidCashInput) || 0,
          note: cashNote,
        }, user.id);
      } else {
        await upsertCashEntryOffline({
          userId: user.id,
          date: cashDate,
          handCash: parseFloat(handCashInput) || 0,
          liquidCash: parseFloat(liquidCashInput) || 0,
          note: cashNote,
        });
      }""",
    """  // Cash form handlers
  const handleSaveCash = async () => {
    if (!user?.id) return;

    // Validate amounts - NaN/negative values poison the cash summary ("Rs NaN")
    const hand = Number(handCashInput || 0);
    const liquid = Number(liquidCashInput || 0);
    if (!Number.isFinite(hand) || hand < 0 || !Number.isFinite(liquid) || liquid < 0) {
      toast.error(isBn ? '\u09a4\u09cd\u09b0\u09c1\u099f\u09bf' : isHi ? '\u0924\u094d\u0930\u0941\u091f\u093f' : 'Error', { description: 'Cash amounts cannot be negative' });
      return;
    }
    if (hand === 0 && liquid === 0) {
      toast.error(isBn ? '\u09a4\u09cd\u09b0\u09c1\u099f\u09bf' : isHi ? '\u0924\u094d\u0930\u0941\u091f\u093f' : 'Error', { description: 'Enter at least one cash amount' });
      return;
    }

    setLoading(true);
    try {
      if (editingCashId) {
        await updateCashEntryOffline(editingCashId, {
          handCash: hand,
          liquidCash: liquid,
          note: cashNote,
        }, user.id);
      } else {
        await upsertCashEntryOffline({
          userId: user.id,
          date: cashDate,
          handCash: hand,
          liquidCash: liquid,
          note: cashNote,
        });
      }"""
)

# 2. cash save catch -> show error detail (regex: Bengali-agnostic)
src = re_sub_once(
    src,
    r"      resetCashForm\(\);\n      fetchCashEntries\(\);\n    \} catch \{\n      toast\.error\(isBn \? '[^']*' : isHi \? '[^']*' : 'Error'\);",
    "      resetCashForm();\n      fetchCashEntries();\n    } catch (error) {\n      toast.error(isBn ? '\\u09a4\\u09cd\\u09b0\\u09c1\\u099f\\u09bf' : isHi ? '\\u0924\\u094d\\u0930\\u0941\\u091f\\u093f' : 'Error', { description: (error as Error).message });"
)

# 3. resetCashForm local date
src = replace_once(
    src,
    "    setEditingCashId(null);\n    setCashDate(new Date().toISOString().split('T')[0]);\n  };",
    "    setEditingCashId(null);\n    setCashDate(localDateStr());\n  };"
)

# 4. handleDeleteCash -> confirmDeleteCash (close dialog first, no double fire)
src = replace_once(
    src,
    """  const handleDeleteCash = async (id: string) => {
    try {
      await deleteCashEntryOffline(id, user?.id || '');""",
    """  const confirmDeleteCash = async () => {
    // Close the dialog FIRST so a double-tap can never fire the delete twice
    const target = confirmDelete;
    setConfirmDelete(null);
    if (!target || target.type !== 'cash') return;
    try {
      await deleteCashEntryOffline(target.id, user?.id || '');"""
)

# 5. handleSaveExpense: validation + Number()
src = replace_once(
    src,
    """  const handleSaveExpense = async () => {
    if (!user?.id || !expenseAmount) return;
    setLoading(true);
    try {
      if (editingExpenseId) {
        await updateExpenseOffline(editingExpenseId, {
          amount: parseFloat(expenseAmount),
          category: expenseCategory,
          description: expenseDesc,
        }, user.id);
      } else {
        await createExpenseOffline({
          userId: user.id,
          date: expenseDate,
          amount: parseFloat(expenseAmount),
          category: expenseCategory,
          description: expenseDesc,
        });
      }""",
    """  const handleSaveExpense = async () => {
    if (!user?.id || !expenseAmount) return;

    const amount = Number(expenseAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error(isBn ? '\u09a4\u09cd\u09b0\u09c1\u099f\u09bf' : isHi ? '\u0924\u094d\u0930\u0941\u091f\u093f' : 'Error', { description: 'Expense amount must be greater than 0' });
      return;
    }

    setLoading(true);
    try {
      if (editingExpenseId) {
        await updateExpenseOffline(editingExpenseId, {
          amount,
          category: expenseCategory,
          description: expenseDesc,
        }, user.id);
      } else {
        await createExpenseOffline({
          userId: user.id,
          date: expenseDate,
          amount,
          category: expenseCategory,
          description: expenseDesc,
        });
      }"""
)

# 6. expense save catch -> show error detail
src = re_sub_once(
    src,
    r"      resetExpenseForm\(\);\n      fetchExpenses\(\);\n    \} catch \{\n      toast\.error\(isBn \? '[^']*' : isHi \? '[^']*' : 'Error'\);",
    "      resetExpenseForm();\n      fetchExpenses();\n    } catch (error) {\n      toast.error(isBn ? '\\u09a4\\u09cd\\u09b0\\u09c1\\u099f\\u09bf' : isHi ? '\\u0924\\u094d\\u0930\\u0941\\u091f\\u093f' : 'Error', { description: (error as Error).message });"
)

# 7. resetExpenseForm local date
src = replace_once(
    src,
    "    setEditingExpenseId(null);\n    setExpenseDate(new Date().toISOString().split('T')[0]);\n  };",
    "    setEditingExpenseId(null);\n    setExpenseDate(localDateStr());\n  };"
)

# 8. handleDeleteExpense -> confirmDeleteExpense
src = replace_once(
    src,
    """  const handleDeleteExpense = async (id: string) => {
    try {
      await deleteExpenseOffline(id, user?.id || '');""",
    """  const confirmDeleteExpense = async () => {
    const target = confirmDelete;
    setConfirmDelete(null);
    if (!target || target.type !== 'expense') return;
    try {
      await deleteExpenseOffline(target.id, user?.id || '');"""
)

# 9. delete buttons -> open confirm dialog
src = replace_once(
    src,
    "<button onClick={() => handleDeleteCash(entry.id)} className=\"p-1.5 rounded-lg hover:bg-red-500/10 transition-colors\">",
    "<button onClick={() => setConfirmDelete({ type: 'cash', id: entry.id })} className=\"p-1.5 rounded-lg hover:bg-red-500/10 transition-colors\" aria-label=\"Delete entry\">"
)
src = replace_once(
    src,
    "<button onClick={() => handleDeleteExpense(exp.id)} className=\"p-1 rounded hover:bg-red-500/10\">",
    "<button onClick={() => setConfirmDelete({ type: 'expense', id: exp.id })} className=\"p-1 rounded hover:bg-red-500/10\" aria-label=\"Delete expense\">"
)

# 10. date inputs disabled while editing
src = replace_once(
    src,
    """                <input
                  type="date"
                  value={cashDate}
                  onChange={(e) => setCashDate(e.target.value)}
                  className="glass-input w-full px-4 py-3 text-sm"
                />""",
    """                <input
                  type="date"
                  value={cashDate}
                  onChange={(e) => setCashDate(e.target.value)}
                  disabled={!!editingCashId}
                  className="glass-input w-full px-4 py-3 text-sm disabled:opacity-50"
                />"""
)
src = replace_once(
    src,
    """                <input
                  type="date"
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                  className="glass-input w-full px-4 py-3 text-sm"
                />""",
    """                <input
                  type="date"
                  value={expenseDate}
                  onChange={(e) => setExpenseDate(e.target.value)}
                  disabled={!!editingExpenseId}
                  className="glass-input w-full px-4 py-3 text-sm disabled:opacity-50"
                />"""
)

# 11. append confirm dialog JSX before the final closing tags
DIALOG = """      </AnimatePresence>

      {/* Delete confirmation dialog (cash & expense) */}
      <AnimatePresence>
        {confirmDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-6"
            onClick={() => setConfirmDelete(null)}
          >
            <div className="absolute inset-0 bg-black/60" />
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-card-strong p-6 w-full max-w-sm relative z-10"
            >
              <div className="w-14 h-14 rounded-full bg-red-500/15 flex items-center justify-center mx-auto mb-4">
                <Trash2 size={24} className="text-red-400" />
              </div>
              <h3 className="text-lg font-bold text-center mb-2">
                {isBn ? '\u09ae\u09c1\u099b\u09c7 \u09ab\u09c7\u09b2\u09ac\u09c7\u09a8?' : isHi ? '\u0939\u091f\u093e\u090f\u0902?' : 'Delete this entry?'}
              </h3>
              <p className="text-sm text-white/50 text-center mb-6">
                {isBn ? '\u098f\u0987 \u0985\u09cd\u09af\u09be\u0995\u09b6\u09a8\u099f\u09bf \u09ab\u09c7\u09b0\u09be\u09a8\u09cb \u09af\u09be\u09ac\u09c7 \u09a8\u09be\u0964' : isHi ? '\u092f\u0939 \u0915\u093e\u0930\u094d\u092f \u0935\u093e\u092a\u0938 \u0928\u0939\u0940\u0902 \u0915\u093f\u092f\u093e \u091c\u093e \u0938\u0915\u0924\u093e\u0964' : 'This action cannot be undone.'}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmDelete(null)}
                  className="flex-1 glass-card py-3 text-sm font-semibold text-white/70 rounded-xl hover:bg-white/10 transition-colors"
                >
                  {isBn ? '\u09ac\u09be\u09a4\u09bf\u09b2' : isHi ? '\u0930\u0926\u094d\u0926 \u0915\u0930\u0947\u0902' : 'Cancel'}
                </button>
                <button
                  onClick={confirmDelete.type === 'cash' ? confirmDeleteCash : confirmDeleteExpense}
                  className="flex-1 py-3 text-sm font-semibold rounded-xl text-white transition-all"
                  style={{
                    background: 'linear-gradient(135deg, #dc2626, #b91c1c)',
                    border: '1px solid rgba(220,38,38,0.5)',
                  }}
                >
                  {isBn ? '\u09ae\u09c1\u099b\u09c1\u09a8' : isHi ? '\u0939\u091f\u093e\u090f\u0902' : 'Delete'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}"""

src = replace_once(
    src,
    "      </AnimatePresence>\n    </div>\n  );\n}",
    DIALOG
)

open(P, 'w', encoding='utf-8').write(src)
print("ALL OK")
