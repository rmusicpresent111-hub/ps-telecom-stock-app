/**
 * Client-side Supabase Service Module
 * Optimized with in-memory caching and parallel queries
 */

import { supabase, generateId, toCamelCase, toSnakeCase } from './supabase';
import { getCached, setCache, invalidateCache, cacheKeys, cacheTTL } from './cache';

// ============ AUTH ============

async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function login(email: string, password: string) {
  if (!email || !password) {
    throw new Error('Email and password are required');
  }

  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .single();

  if (error || !data) {
    throw new Error('Invalid email or password');
  }

  const user = toCamelCase(data);
  const hashedInput = await hashPassword(password);

  if (hashedInput !== (user.password as string)) {
    throw new Error('Invalid email or password');
  }

  const { password: _, ...userWithoutPassword } = user;
  return { user: userWithoutPassword };
}

export async function signup(name: string, email: string, password: string, shopName: string) {
  if (!name || !email || !password) {
    throw new Error('Name, email, and password are required');
  }

  const { data: existingData } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .single();

  if (existingData) {
    throw new Error('Email already exists');
  }

  const hashedPassword = await hashPassword(password);
  const now = new Date().toISOString();

  const snakeCaseData = toSnakeCase({
    id: generateId(),
    name,
    email,
    password: hashedPassword,
    shopName: shopName || 'PS TELECOM',
    createdAt: now,
    updatedAt: now,
  });

  const { data, error } = await supabase
    .from('users')
    .insert(snakeCaseData)
    .select('*')
    .single();

  if (error) {
    throw new Error('Internal server error');
  }

  const user = toCamelCase(data);
  const { password: _, ...userWithoutPassword } = user;
  return { user: userWithoutPassword };
}

// ============ PROFILE ============

export async function getProfile(userId: string) {
  const key = cacheKeys.profile(userId);
  const cached = getCached<{ user: unknown }>(key);
  if (cached) return cached;

  const { data, error } = await supabase
    .from('users')
    .select('id, email, name, shop_name, role, language, theme, created_at, updated_at')
    .eq('id', userId)
    .single();

  if (error || !data) {
    throw new Error('User not found');
  }

  const result = { user: toCamelCase(data) };
  setCache(key, result, cacheTTL.categories);
  return result;
}

export async function updateProfile(id: string, updates: { name?: string; shopName?: string; language?: string; theme?: string }) {
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('id', id)
    .single();

  if (!existing) {
    throw new Error('User not found');
  }

  const updateFields: Record<string, unknown> = {};
  if (updates.name !== undefined) updateFields.name = updates.name;
  if (updates.shopName !== undefined) updateFields.shopName = updates.shopName;
  if (updates.language !== undefined) updateFields.language = updates.language;
  if (updates.theme !== undefined) updateFields.theme = updates.theme;

  const { data, error } = await supabase
    .from('users')
    .update(toSnakeCase(updateFields))
    .eq('id', id)
    .select('id, email, name, shop_name, role, language, theme, created_at, updated_at')
    .single();

  if (error) {
    throw new Error('Internal server error');
  }

  invalidateCache(cacheKeys.profile(id));
  return { user: toCamelCase(data) };
}

export async function deleteAccount(id: string) {
  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('id', id)
    .single();

  if (!existing) {
    throw new Error('User not found');
  }

  // Delete in parallel
  await Promise.all([
    supabase.from('transactions').delete().eq('user_id', id),
    supabase.from('products').delete().eq('user_id', id),
    supabase.from('categories').delete().eq('user_id', id),
    supabase.from('cash_entries').delete().eq('user_id', id),
    supabase.from('expenses').delete().eq('user_id', id),
  ]);

  await supabase.from('users').delete().eq('id', id);
  invalidateCache();
  return { message: 'User account deleted successfully' };
}

// ============ PRODUCTS ============

export async function getProducts(userId: string, options?: { categoryId?: string; search?: string }) {
  const optsKey = options ? `${options.categoryId || ''}:${options.search || ''}` : 'all';
  const key = cacheKeys.products(userId, optsKey);
  const cached = getCached<{ products: unknown[] }>(key);
  if (cached) return cached;

  let query = supabase
    .from('products')
    .select('*, category:categories(*)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (options?.categoryId) {
    query = query.eq('category_id', options.categoryId);
  }

  if (options?.search) {
    query = query.ilike('name', `%${options.search}%`);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error('Internal server error');
  }

  const products = (data || []).map((product: Record<string, unknown>) => {
    const { category, ...productFields } = product as Record<string, unknown>;
    const camelProduct = toCamelCase(productFields as Record<string, unknown>);
    if (category && typeof category === 'object') {
      camelProduct.category = toCamelCase(category as Record<string, unknown>);
    }
    return camelProduct;
  });

  const result = { products };
  setCache(key, result, cacheTTL.products);
  return result;
}

export async function createProduct(productData: {
  name: string;
  categoryId: string;
  quantity?: number;
  boxNumber?: string;
  purchasePrice?: number;
  sellingPrice?: number;
  lowStockThreshold?: number;
  userId: string;
}) {
  const id = generateId();
  const now = new Date().toISOString();

  const snakeData = toSnakeCase({
    id,
    name: productData.name,
    categoryId: productData.categoryId,
    quantity: productData.quantity ?? 0,
    boxNumber: productData.boxNumber ?? '',
    purchasePrice: productData.purchasePrice ?? 0,
    sellingPrice: productData.sellingPrice ?? 0,
    lowStockThreshold: productData.lowStockThreshold ?? 5,
    userId: productData.userId,
    createdAt: now,
    updatedAt: now,
  });

  const { data, error } = await supabase
    .from('products')
    .insert(snakeData)
    .select('*, category:categories(*)')
    .single();

  if (error) {
    throw new Error('Internal server error');
  }

  const { category, ...productFields } = data as Record<string, unknown>;
  const product = toCamelCase(productFields as Record<string, unknown>);
  if (category && typeof category === 'object') {
    product.category = toCamelCase(category as Record<string, unknown>);
  }

  // Invalidate product and dashboard caches
  invalidateCache(cacheKeys.products(productData.userId));
  invalidateCache(cacheKeys.dashboard(productData.userId));
  invalidateCache(cacheKeys.categories(productData.userId));

  return { product };
}

export async function updateProduct(id: string, updates: {
  name?: string;
  categoryId?: string;
  quantity?: number;
  boxNumber?: string;
  purchasePrice?: number;
  sellingPrice?: number;
  lowStockThreshold?: number;
}) {
  const { data: existing } = await supabase
    .from('products')
    .select('user_id')
    .eq('id', id)
    .single();

  if (!existing) {
    throw new Error('Product not found');
  }

  const updateFields: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  if (updates.name !== undefined) updateFields.name = updates.name;
  if (updates.categoryId !== undefined) updateFields.categoryId = updates.categoryId;
  if (updates.quantity !== undefined) updateFields.quantity = updates.quantity;
  if (updates.boxNumber !== undefined) updateFields.boxNumber = updates.boxNumber;
  if (updates.purchasePrice !== undefined) updateFields.purchasePrice = updates.purchasePrice;
  if (updates.sellingPrice !== undefined) updateFields.sellingPrice = updates.sellingPrice;
  if (updates.lowStockThreshold !== undefined) updateFields.lowStockThreshold = updates.lowStockThreshold;

  const snakeUpdate = toSnakeCase(updateFields);

  const { data, error } = await supabase
    .from('products')
    .update(snakeUpdate)
    .eq('id', id)
    .select('*, category:categories(*)')
    .single();

  if (error) {
    throw new Error('Internal server error');
  }

  const { category, ...productFields } = data as Record<string, unknown>;
  const product = toCamelCase(productFields as Record<string, unknown>);
  if (category && typeof category === 'object') {
    product.category = toCamelCase(category as Record<string, unknown>);
  }

  // Invalidate caches
  const userId = existing.user_id as string;
  invalidateCache(cacheKeys.products(userId));
  invalidateCache(cacheKeys.dashboard(userId));

  return { product };
}

export async function deleteProduct(id: string) {
  const { data: existing } = await supabase
    .from('products')
    .select('user_id')
    .eq('id', id)
    .single();

  if (!existing) {
    throw new Error('Product not found');
  }

  const { error } = await supabase
    .from('products')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error('Internal server error');
  }

  const userId = existing.user_id as string;
  invalidateCache(cacheKeys.products(userId));
  invalidateCache(cacheKeys.dashboard(userId));
  invalidateCache(cacheKeys.categories(userId));

  return { message: 'Product deleted successfully' };
}

export async function deleteTransaction(id: string) {
  // First get the transaction to reverse stock change
  const { data: txn } = await supabase
    .from('transactions')
    .select('product_id, type, quantity')
    .eq('id', id)
    .single();

  if (txn) {
    // Reverse the stock change on the product
    const { data: product } = await supabase
      .from('products')
      .select('quantity, user_id')
      .eq('id', txn.product_id)
      .single();

    if (product) {
      const quantityChange = txn.type === 'STOCK_IN' ? -txn.quantity : txn.quantity;
      await supabase
        .from('products')
        .update({ quantity: Math.max(0, product.quantity + quantityChange) })
        .eq('id', txn.product_id);

      const userId = product.user_id as string;
      invalidateCache(cacheKeys.products(userId));
      invalidateCache(cacheKeys.dashboard(userId));
    }
  }

  const { error } = await supabase.from('transactions').delete().eq('id', id);
  if (error) {
    throw new Error('Failed to delete transaction');
  }

  return { success: true };
}

// ============ CATEGORIES ============

export async function getCategories(userId: string) {
  const key = cacheKeys.categories(userId);
  const cached = getCached<{ categories: unknown[] }>(key);
  if (cached) return cached;

  // Run both queries in parallel
  const [categoriesResult, productCountsResult] = await Promise.all([
    supabase
      .from('categories')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    supabase
      .from('products')
      .select('category_id')
      .eq('user_id', userId),
  ]);

  if (categoriesResult.error) {
    throw new Error('Internal server error');
  }

  if (productCountsResult.error) {
    throw new Error('Internal server error');
  }

  const countMap: Record<string, number> = {};
  for (const row of productCountsResult.data ?? []) {
    const catId = row.category_id;
    countMap[catId] = (countMap[catId] ?? 0) + 1;
  }

  const result = {
    categories: (categoriesResult.data ?? []).map((cat) => ({
      ...toCamelCase(cat),
      _count: { products: countMap[cat.id] ?? 0 },
    })),
  };

  setCache(key, result, cacheTTL.categories);
  return result;
}

export async function createCategory(name: string, image: string, userId: string) {
  if (!name || !userId) {
    throw new Error('Name and userId are required');
  }

  const id = generateId();
  const { data, error } = await supabase
    .from('categories')
    .insert(
      toSnakeCase({
        id,
        name,
        image: image || '',
        userId,
      })
    )
    .select()
    .single();

  if (error) {
    throw new Error('Internal server error');
  }

  const category = {
    ...toCamelCase(data),
    _count: { products: 0 },
  };

  invalidateCache(cacheKeys.categories(userId));
  invalidateCache(cacheKeys.dashboard(userId));

  return { category };
}

export async function updateCategory(id: string, updates: { name?: string; image?: string }) {
  const updateFields: Record<string, unknown> = {};
  if (updates.name !== undefined) updateFields.name = updates.name;
  if (updates.image !== undefined) updateFields.image = updates.image;
  updateFields.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('categories')
    .update(updateFields)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    throw new Error('Failed to update category');
  }

  const category = {
    ...toCamelCase(data),
    _count: { products: 0 },
  };

  return { category };
}

export async function deleteCategory(id: string) {
  // Delete related products and transactions first (cascading)
  const { data: products } = await supabase.from('products').select('id').eq('category_id', id);
  if (products) {
    for (const p of products) {
      await deleteProduct(p.id);
    }
  }

  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) {
    throw new Error('Failed to delete category');
  }
  return { message: 'Category deleted successfully' };
}

// ============ TRANSACTIONS ============

export async function getTransactions(userId: string, options?: { type?: string; productId?: string; date?: string; from?: string; to?: string }) {
  const optsKey = `${options?.type || ''}:${options?.productId || ''}:${options?.date || ''}:${options?.from || ''}:${options?.to || ''}`;
  const key = cacheKeys.transactions(userId, optsKey);
  const cached = getCached<{ transactions: unknown[] }>(key);
  if (cached) return cached;

  let query = supabase
    .from('transactions')
    .select('*, product:products(*)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (options?.type) {
    query = query.eq('type', options.type);
  }

  if (options?.productId) {
    query = query.eq('product_id', options.productId);
  }

  if (options?.date) {
    query = query.eq('date', options.date);
  }

  if (options?.from) {
    query = query.gte('date', options.from);
  }

  if (options?.to) {
    query = query.lte('date', options.to);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error('Failed to fetch transactions');
  }

  const transactions = data.map((row: Record<string, unknown>) => {
    const { product, ...transactionFields } = row as Record<string, unknown>;
    const camelTransaction = toCamelCase(transactionFields);
    if (product && typeof product === 'object') {
      camelTransaction.product = toCamelCase(product as Record<string, unknown>);
    }
    return camelTransaction;
  });

  const result = { transactions };
  setCache(key, result, cacheTTL.transactions);
  return result;
}

export async function createTransaction(transactionData: {
  type: string;
  productId: string;
  quantity: number;
  unitPrice?: number;
  totalAmount?: number;
  date?: string;
  userId: string;
}) {
  const { type, productId, quantity, unitPrice, totalAmount, date, userId } = transactionData;

  if (!type || !productId || !quantity || !userId) {
    throw new Error('Type, productId, quantity, and userId are required');
  }

  if (!['STOCK_IN', 'STOCK_OUT', 'SELL'].includes(type)) {
    throw new Error('Type must be STOCK_IN, STOCK_OUT, or SELL');
  }

  // Step 1: Fetch the product
  const { data: product, error: productError } = await supabase
    .from('products')
    .select('*')
    .eq('id', productId)
    .single();

  if (productError || !product) {
    throw new Error('Product not found');
  }

  // Step 2: Check stock if STOCK_OUT or SELL
  if ((type === 'STOCK_OUT' || type === 'SELL') && product.quantity < quantity) {
    throw new Error('Insufficient stock');
  }

  // Step 3: Insert the transaction
  const transactionId = generateId();
  const quantityChange = type === 'STOCK_IN' ? quantity : -quantity;

  const { data: newTransaction, error: insertError } = await supabase
    .from('transactions')
    .insert(
      toSnakeCase({
        id: transactionId,
        type,
        productId,
        quantity,
        unitPrice: unitPrice ?? 0,
        totalAmount: totalAmount ?? 0,
        date: date || new Date().toISOString().split('T')[0],
        userId,
      })
    )
    .select('*, product:products(*)')
    .single();

  if (insertError) {
    throw new Error('Failed to create transaction');
  }

  // Step 4: Update the product quantity
  const { error: updateError } = await supabase
    .from('products')
    .update({ quantity: product.quantity + quantityChange })
    .eq('id', productId);

  if (updateError) {
    await supabase.from('transactions').delete().eq('id', transactionId);
    throw new Error('Failed to update product stock');
  }

  const camelTransaction = toCamelCase(newTransaction as Record<string, unknown>);
  const { product: productData, ...transactionFields } = camelTransaction as Record<string, unknown>;
  if (productData && typeof productData === 'object') {
    transactionFields.product = toCamelCase(productData as Record<string, unknown>);
  }

  // Invalidate all relevant caches
  invalidateCache(cacheKeys.transactions(userId));
  invalidateCache(cacheKeys.products(userId));
  invalidateCache(cacheKeys.dashboard(userId));

  return { transaction: transactionFields };
}

// ============ EXPENSES ============

function getDateRange(period: string, date?: string, from?: string, to?: string): { startDate: string; endDate: string } {
  const now = new Date();
  let startDate: string;
  let endDate: string;

  if (from && to) {
    startDate = from;
    endDate = to;
  } else if (date) {
    startDate = date;
    endDate = date;
  } else {
    const todayStr = now.toISOString().split('T')[0];
    if (period === 'today') {
      startDate = todayStr;
      endDate = todayStr;
    } else if (period === 'week') {
      const weekStart = new Date(now);
      const day = weekStart.getDay();
      const diff = weekStart.getDate() - day + (day === 0 ? -6 : 1);
      weekStart.setDate(diff);
      startDate = weekStart.toISOString().split('T')[0];
      endDate = todayStr;
    } else if (period === 'month') {
      startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      endDate = todayStr;
    } else {
      startDate = todayStr;
      endDate = todayStr;
    }
  }

  return { startDate, endDate };
}

export async function getExpenses(userId: string, options?: { period?: string; date?: string; from?: string; to?: string; category?: string }) {
  const period = options?.period || 'today';
  const optsKey = `${period}:${options?.date || ''}:${options?.from || ''}:${options?.to || ''}:${options?.category || ''}`;
  const key = cacheKeys.expenses(userId, optsKey);
  const cached = getCached<unknown>(key);
  if (cached) return cached;

  const { startDate, endDate } = getDateRange(period, options?.date, options?.from, options?.to);

  let query = supabase
    .from('expenses')
    .select('*')
    .eq('user_id', userId)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: false });

  if (options?.category) {
    query = query.eq('category', options.category);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error('Failed to fetch expenses');
  }

  const expenses = (data || []).map(toCamelCase) as Record<string, unknown>[];

  const totalExpense = expenses.reduce((sum: number, e) => sum + ((e.amount as number) || 0), 0);

  const byCategory = expenses.reduce((acc: Record<string, number>, e: Record<string, unknown>) => {
    const cat = (e.category as string) || 'other';
    if (!acc[cat]) acc[cat] = 0;
    acc[cat] += (e.amount as number) || 0;
    return acc;
  }, {} as Record<string, number>);

  const result = {
    expenses,
    summary: {
      totalExpense,
      byCategory,
      count: expenses.length,
    },
  };

  setCache(key, result, cacheTTL.reports);
  return result;
}

export async function createExpense(expenseData: {
  userId: string;
  date: string;
  amount: number;
  category?: string;
  description?: string;
}) {
  if (!expenseData.userId || !expenseData.date || expenseData.amount === undefined) {
    throw new Error('userId, date and amount required');
  }

  const newExpense = {
    id: generateId(),
    userId: expenseData.userId,
    date: expenseData.date,
    amount: parseFloat(String(expenseData.amount)),
    category: expenseData.category || 'other',
    description: expenseData.description || '',
  };

  const { data, error } = await supabase
    .from('expenses')
    .insert(toSnakeCase(newExpense))
    .select('*')
    .single();

  if (error) {
    throw new Error('Failed to create expense');
  }

  invalidateCache(cacheKeys.expenses(expenseData.userId));
  return { expense: toCamelCase(data) };
}

export async function updateExpense(id: string, updates: { amount?: number; category?: string; description?: string }) {
  if (!id) throw new Error('id required');

  const updateFields: Record<string, unknown> = {};
  if (updates.amount !== undefined) updateFields.amount = parseFloat(String(updates.amount));
  if (updates.category !== undefined) updateFields.category = updates.category;
  if (updates.description !== undefined) updateFields.description = updates.description;

  const { data, error } = await supabase
    .from('expenses')
    .update(toSnakeCase(updateFields))
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    throw new Error('Failed to update expense');
  }

  invalidateCache('expenses:');
  return { expense: toCamelCase(data) };
}

export async function deleteExpense(id: string) {
  if (!id) throw new Error('id required');

  const { error } = await supabase
    .from('expenses')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error('Failed to delete expense');
  }

  invalidateCache('expenses:');
  return { success: true };
}

// ============ CASH ENTRIES ============

export async function getCashEntries(userId: string, options?: { period?: string; date?: string; from?: string; to?: string }) {
  const period = options?.period || 'today';
  const optsKey = `${period}:${options?.date || ''}:${options?.from || ''}:${options?.to || ''}`;
  const key = cacheKeys.cashEntries(userId, optsKey);
  const cached = getCached<unknown>(key);
  if (cached) return cached;

  const { startDate, endDate } = getDateRange(period, options?.date, options?.from, options?.to);

  // Run both queries in parallel
  const [entriesResult, latestResult] = await Promise.all([
    supabase
      .from('cash_entries')
      .select('*')
      .eq('user_id', userId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: false }),
    supabase
      .from('cash_entries')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(1),
  ]);

  if (entriesResult.error) {
    throw new Error('Failed to fetch cash entries');
  }

  const camelEntries = (entriesResult.data || []).map(toCamelCase);
  const latest = latestResult.data && latestResult.data.length > 0 ? toCamelCase(latestResult.data[0]) : null;
  const totalHandCash = (latest?.handCash as number) || 0;
  const totalLiquidCash = (latest?.liquidCash as number) || 0;

  const result = {
    entries: camelEntries,
    summary: {
      totalHandCash,
      totalLiquidCash,
      totalCash: totalHandCash + totalLiquidCash,
    },
  };

  setCache(key, result, cacheTTL.reports);
  return result;
}

export async function upsertCashEntry(entryData: {
  userId: string;
  date: string;
  handCash?: number;
  liquidCash?: number;
  note?: string;
}) {
  if (!entryData.userId || !entryData.date) {
    throw new Error('userId and date required');
  }

  const { data: existingRows } = await supabase
    .from('cash_entries')
    .select('*')
    .eq('user_id', entryData.userId)
    .eq('date', entryData.date);

  let entry;
  if (existingRows && existingRows.length > 0) {
    const existing = toCamelCase(existingRows[0]);
    const updates: Record<string, unknown> = {};
    if (entryData.handCash !== undefined) updates.handCash = entryData.handCash;
    else updates.handCash = existing.handCash;
    if (entryData.liquidCash !== undefined) updates.liquidCash = entryData.liquidCash;
    else updates.liquidCash = existing.liquidCash;
    if (entryData.note !== undefined) updates.note = entryData.note;
    else updates.note = existing.note;

    const { data, error } = await supabase
      .from('cash_entries')
      .update(toSnakeCase(updates))
      .eq('id', existing.id)
      .select('*')
      .single();

    if (error) {
      throw new Error('Failed to update cash entry');
    }
    entry = toCamelCase(data);
  } else {
    const newEntry = {
      id: generateId(),
      userId: entryData.userId,
      date: entryData.date,
      handCash: entryData.handCash || 0,
      liquidCash: entryData.liquidCash || 0,
      note: entryData.note || '',
    };

    const { data, error } = await supabase
      .from('cash_entries')
      .insert(toSnakeCase(newEntry))
      .select('*')
      .single();

    if (error) {
      throw new Error('Failed to create cash entry');
    }
    entry = toCamelCase(data);
  }

  invalidateCache(cacheKeys.cashEntries(entryData.userId));
  return { entry };
}

export async function updateCashEntry(id: string, updates: { handCash?: number; liquidCash?: number; note?: string }) {
  if (!id) throw new Error('id required');

  const updateFields: Record<string, unknown> = {};
  if (updates.handCash !== undefined) updateFields.handCash = updates.handCash;
  if (updates.liquidCash !== undefined) updateFields.liquidCash = updates.liquidCash;
  if (updates.note !== undefined) updateFields.note = updates.note;

  const { data, error } = await supabase
    .from('cash_entries')
    .update(toSnakeCase(updateFields))
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    throw new Error('Failed to update cash entry');
  }

  invalidateCache('cashEntries:');
  return { entry: toCamelCase(data) };
}

export async function deleteCashEntry(id: string) {
  if (!id) throw new Error('id required');

  const { error } = await supabase
    .from('cash_entries')
    .delete()
    .eq('id', id);

  if (error) {
    throw new Error('Failed to delete cash entry');
  }

  invalidateCache('cashEntries:');
  return { success: true };
}

// ============ DASHBOARD (OPTIMIZED) ============

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

const defaultCategoriesList = [
  { name: 'Mobile', image: '/categories/mobile.png' },
  { name: 'Display/Combo', image: '/categories/display.png' },
  { name: 'Tempered Glass', image: '/categories/tempered-glass.png' },
  { name: 'Flip Cover', image: '/categories/flip-cover.png' },
  { name: 'Back Cover', image: '/categories/back-cover.png' },
  { name: 'UV Glass', image: '/categories/uv-glass.png' },
  { name: 'Smart Watch', image: '/categories/smart-watch.png' },
  { name: 'Battery', image: '/categories/battery.png' },
  { name: 'Charger', image: '/categories/charger.png' },
  { name: 'Neck Band', image: '/categories/neckband.png' },
  { name: 'Ear Pods', image: '/categories/earpods.png' },
  { name: 'Selfie Stick', image: '/categories/selfie-stick.png' },
  { name: 'Ring Light', image: '/categories/ring-light.png' },
  { name: 'Mobile Stand', image: '/categories/mobile-stand.png' },
  { name: 'Watch Strap', image: '/categories/watch-strap.png' },
  { name: 'Earphone', image: '/categories/earphone.png' },
  { name: 'Memory Card', image: '/categories/memory-card.png' },
  { name: 'Data Cable', image: '/categories/data-cable.png' },
  { name: 'Home Theater', image: '/categories/home-theater.png' },
  { name: 'Refrigerator', image: '/categories/refrigerator.png' },
];

export async function getDashboard(userId: string) {
  // Check cache first
  const key = cacheKeys.dashboard(userId);
  const cached = getCached<unknown>(key);
  if (cached) return cached;

  const today = formatDate(new Date());

  // Calculate date range for 7-day sale overview
  const todayDate = new Date();
  const sevenDaysAgo = new Date(todayDate);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  const sevenDaysAgoStr = formatDate(sevenDaysAgo);

  // BATCH 1: Run independent queries in parallel
  const [
    productsCountResult,
    productsDataResult,
    todayTxnCountResult,
    categoriesDataResult,
    recentTxnResult,
    // Single query for 7-day sales instead of 7 separate queries!
    sevenDayTxnResult,
    productCountResult,
  ] = await Promise.all([
    // Total items count
    supabase
      .from('products')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId),

    // All products (for stock value + low stock calculation)
    supabase
      .from('products')
      .select('id, name, quantity, selling_price, purchase_price, low_stock_threshold, category_id, box_number, user_id, created_at, updated_at')
      .eq('user_id', userId),

    // Today's transaction count
    supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('date', today),

    // Categories
    supabase
      .from('categories')
      .select('*')
      .eq('user_id', userId),

    // Recent transactions
    supabase
      .from('transactions')
      .select('*, product:products(*)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(5),

    // 7-day sales (SINGLE QUERY instead of 7)
    supabase
      .from('transactions')
      .select('total_amount, quantity, date')
      .eq('user_id', userId)
      .eq('type', 'SELL')
      .gte('date', sevenDaysAgoStr)
      .lte('date', today),

    // Product counts by category
    supabase
      .from('products')
      .select('category_id')
      .eq('user_id', userId),
  ]);

  const products = (productsDataResult.data || []).map(toCamelCase);

  // Low stock items (computed from already fetched products)
  const lowItems = products.filter((p: Record<string, unknown>) => (p.quantity as number) <= (p.lowStockThreshold as number)).length;

  // Total stock value
  const stockValue = products.reduce(
    (sum: number, p: Record<string, unknown>) => sum + ((p.quantity as number) * (p.purchasePrice as number)),
    0
  );

  // Low stock products detail - use already fetched products instead of another query
  const lowStockProducts = products
    .filter((p: Record<string, unknown>) => (p.quantity as number) <= (p.lowStockThreshold as number))
    .slice(0, 10);

  // Recent transactions
  const recentTransactions = (recentTxnResult.data || []).map((t: Record<string, unknown>) => {
    const camel = toCamelCase(t);
    if (camel.product && typeof camel.product === 'object') {
      camel.product = toCamelCase(camel.product as Record<string, unknown>);
    }
    return camel;
  });

  // Categories with product counts
  const productCountMap: Record<string, number> = {};
  if (productCountResult.data) {
    for (const p of productCountResult.data) {
      const catId = p.category_id;
      if (catId) {
        productCountMap[catId] = (productCountMap[catId] || 0) + 1;
      }
    }
  }

  let categories = (categoriesDataResult.data || []).map((cat: Record<string, unknown>) => ({
    ...toCamelCase(cat),
    _count: { products: productCountMap[(cat as Record<string, unknown>).id as string] || 0 },
  }));

  // Auto-seed default categories if user has none
  if (categories.length === 0) {
    const insertRows = defaultCategoriesList.map(cat => ({
      id: generateId(),
      name: cat.name,
      image: cat.image,
      user_id: userId,
    }));

    const { data: insertedData } = await supabase
      .from('categories')
      .insert(insertRows)
      .select('*');

    categories = (insertedData || []).map((cat: Record<string, unknown>) => ({
      ...toCamelCase(cat),
      _count: { products: 0 },
    }));
  }

  // Migration: Split "Flip Cover/Back Cover" into two
  const oldCombined = categories.find((c: Record<string, unknown>) => c.name === 'Flip Cover/Back Cover');
  if (oldCombined) {
    await Promise.all([
      supabase
        .from('categories')
        .update({ name: 'Flip Cover' })
        .eq('id', (oldCombined as Record<string, unknown>).id as string),
      supabase
        .from('categories')
        .insert({
          id: generateId(),
          name: 'Back Cover',
          image: '/categories/back-cover.png',
          user_id: userId,
        }),
    ]);

    const { data: refreshedData } = await supabase
      .from('categories')
      .select('*')
      .eq('user_id', userId);

    categories = (refreshedData || []).map((cat: Record<string, unknown>) => {
      const camel = toCamelCase(cat);
      return {
        ...camel,
        _count: { products: productCountMap[(camel.id as string)] || 0 },
      };
    });
  }

  // Sale Overview: Process 7-day data from SINGLE query (was 7 queries)
  const saleMap = new Map<string, { sales: number; quantity: number }>();
  for (const t of (sevenDayTxnResult.data || [])) {
    const dateStr = t.date as string;
    const existing = saleMap.get(dateStr) || { sales: 0, quantity: 0 };
    existing.sales += (t.total_amount as number) || 0;
    existing.quantity += (t.quantity as number) || 0;
    saleMap.set(dateStr, existing);
  }

  const saleOverview: { date: string; label: string; sales: number; quantity: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(todayDate);
    d.setDate(d.getDate() - i);
    const dateStr = formatDate(d);
    const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short' });
    const dayData = saleMap.get(dateStr) || { sales: 0, quantity: 0 };
    saleOverview.push({
      date: dateStr,
      label: dayLabel,
      sales: dayData.sales,
      quantity: dayData.quantity,
    });
  }

  // Stock Overview: Compute from already-fetched products (no extra queries!)
  const stockByCategory = new Map<string, { quantity: number; value: number }>();
  for (const p of products) {
    const catId = (p as Record<string, unknown>).categoryId as string;
    if (!catId) continue;
    const cat = categories.find((c: Record<string, unknown>) => c.id === catId);
    const catName = cat ? (cat as Record<string, unknown>).name as string : 'Unknown';
    const existing = stockByCategory.get(catName) || { quantity: 0, value: 0 };
    existing.quantity += (p as Record<string, unknown>).quantity as number;
    existing.value += ((p as Record<string, unknown>).quantity as number) * ((p as Record<string, unknown>).purchasePrice as number);
    stockByCategory.set(catName, existing);
  }

  const stockOverview = Array.from(stockByCategory.entries())
    .filter(([_, data]) => data.quantity > 0)
    .map(([category, data]) => ({
      category,
      quantity: data.quantity,
      value: data.value,
    }));

  const result = {
    stats: {
      totalItems: productsCountResult.count || 0,
      lowItems,
      todayTransactions: todayTxnCountResult.count || 0,
      stockValue,
    },
    lowStockProducts,
    recentTransactions,
    categories,
    saleOverview,
    stockOverview,
  };

  setCache(key, result, cacheTTL.dashboard);
  return result;
}

// ============ REPORTS ============

function deepCamelCase(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(deepCamelCase);
  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      result[camelKey] = deepCamelCase(value);
    }
    return result;
  }
  return obj;
}

export async function getReports(userId: string, type: string, options?: { from?: string; to?: string }) {
  const optsKey = `${type}:${options?.from || ''}:${options?.to || ''}`;
  const key = cacheKeys.reports(userId, type, optsKey);
  const cached = getCached<unknown>(key);
  if (cached) return cached;

  if (type === 'stock-value') {
    const { data: categories } = await supabase
      .from('categories')
      .select('*, products(*)')
      .eq('user_id', userId);

    const camelCategories = (categories || []).map((cat) => deepCamelCase(cat)) as Record<string, unknown>[];

    const stockValueData = camelCategories.map((cat) => {
      const prods = (cat.products as Record<string, unknown>[]) || [];
      const totalQty = prods.reduce((sum, p) => sum + ((p.quantity as number) || 0), 0);
      const totalPurchaseValue = prods.reduce((sum, p) => sum + ((p.quantity as number) || 0) * ((p.purchasePrice as number) || 0), 0);
      const totalSellingValue = prods.reduce((sum, p) => sum + ((p.quantity as number) || 0) * ((p.sellingPrice as number) || 0), 0);
      const totalProfit = totalSellingValue - totalPurchaseValue;
      const lowStockCount = prods.filter(p => ((p.quantity as number) || 0) <= ((p.lowStockThreshold as number) || 5)).length;
      const productCount = prods.length;

      return {
        categoryId: cat.id,
        categoryName: cat.name,
        categoryImage: cat.image,
        productCount,
        totalQty,
        totalPurchaseValue,
        totalSellingValue,
        totalProfit,
        lowStockCount,
        products: prods.map(p => ({
          id: p.id,
          name: p.name,
          quantity: p.quantity,
          purchasePrice: p.purchasePrice,
          sellingPrice: p.sellingPrice,
          stockValue: ((p.quantity as number) || 0) * ((p.purchasePrice as number) || 0),
          purchaseValue: ((p.quantity as number) || 0) * ((p.purchasePrice as number) || 0),
          lowStock: ((p.quantity as number) || 0) <= ((p.lowStockThreshold as number) || 5),
        })),
      };
    }).filter(item => item.productCount > 0);

    const grandTotal = {
      totalProducts: stockValueData.reduce((s, d) => s + d.productCount, 0),
      totalQty: stockValueData.reduce((s, d) => s + d.totalQty, 0),
      totalPurchaseValue: stockValueData.reduce((s, d) => s + d.totalPurchaseValue, 0),
      totalSellingValue: stockValueData.reduce((s, d) => s + d.totalSellingValue, 0),
      totalProfit: stockValueData.reduce((s, d) => s + d.totalProfit, 0),
      totalLowStock: stockValueData.reduce((s, d) => s + d.lowStockCount, 0),
    };

    const result = { type: 'stock-value', data: stockValueData, grandTotal };
    setCache(key, result, cacheTTL.reports);
    return result;
  }

  // For daily, monthly, and category reports
  const selectFields = type === 'category'
    ? '*, product:products(*, category:categories(*))'
    : '*, product:products(*)';

  let query = supabase
    .from('transactions')
    .select(selectFields)
    .eq('user_id', userId)
    .order('date', { ascending: true });

  if (options?.from) query = query.gte('date', options.from);
  if (options?.to) query = query.lte('date', options.to);

  const { data: transactions, error: txError } = await query;

  if (txError) {
    throw new Error('Internal server error');
  }

  const txList = (transactions || []).map((t) => deepCamelCase(t)) as Record<string, unknown>[];

  let result;

  if (type === 'daily') {
    const dailyMap = new Map<string, {
      date: string; revenue: number; cost: number; profit: number;
      stockIn: number; stockOut: number; sell: number;
    }>();

    for (const t of txList) {
      const date = t.date as string;
      if (!dailyMap.has(date)) {
        dailyMap.set(date, { date, revenue: 0, cost: 0, profit: 0, stockIn: 0, stockOut: 0, sell: 0 });
      }
      const entry = dailyMap.get(date)!;
      const product = t.product as Record<string, unknown> | null;

      if (t.type === 'SELL') {
        entry.revenue += (t.totalAmount as number) || 0;
        entry.cost += ((t.quantity as number) || 0) * ((product?.purchasePrice as number) ?? 0);
        entry.profit += ((t.totalAmount as number) || 0) - ((t.quantity as number) || 0) * ((product?.purchasePrice as number) ?? 0);
        entry.sell += (t.quantity as number) || 0;
      } else if (t.type === 'STOCK_IN') {
        entry.cost += (t.totalAmount as number) || 0;
        entry.stockIn += (t.quantity as number) || 0;
      } else if (t.type === 'STOCK_OUT') {
        entry.stockOut += (t.quantity as number) || 0;
      }
    }

    result = { type: 'daily', data: Array.from(dailyMap.values()) };
  } else if (type === 'monthly') {
    const monthlyMap = new Map<string, {
      month: string; revenue: number; cost: number; profit: number;
      stockIn: number; stockOut: number; sell: number;
    }>();

    for (const t of txList) {
      const month = (t.date as string).substring(0, 7);
      if (!monthlyMap.has(month)) {
        monthlyMap.set(month, { month, revenue: 0, cost: 0, profit: 0, stockIn: 0, stockOut: 0, sell: 0 });
      }
      const entry = monthlyMap.get(month)!;
      const product = t.product as Record<string, unknown> | null;

      if (t.type === 'SELL') {
        entry.revenue += (t.totalAmount as number) || 0;
        entry.cost += ((t.quantity as number) || 0) * ((product?.purchasePrice as number) ?? 0);
        entry.profit += ((t.totalAmount as number) || 0) - ((t.quantity as number) || 0) * ((product?.purchasePrice as number) ?? 0);
        entry.sell += (t.quantity as number) || 0;
      } else if (t.type === 'STOCK_IN') {
        entry.cost += (t.totalAmount as number) || 0;
        entry.stockIn += (t.quantity as number) || 0;
      } else if (t.type === 'STOCK_OUT') {
        entry.stockOut += (t.quantity as number) || 0;
      }
    }

    result = { type: 'monthly', data: Array.from(monthlyMap.values()) };
  } else if (type === 'category') {
    const categoryMap = new Map<string, {
      categoryId: string; categoryName: string; revenue: number; cost: number;
      profit: number; totalTransactions: number; stockIn: number; stockOut: number; sell: number;
    }>();

    for (const t of txList) {
      const product = t.product as Record<string, unknown> | null;
      const category = product?.category as Record<string, unknown> | null;
      const catId = (product?.categoryId as string) ?? 'unknown';
      const catName = (category?.name as string) ?? (product?.name as string) ?? 'Unknown';

      if (!categoryMap.has(catId)) {
        categoryMap.set(catId, {
          categoryId: catId, categoryName: catName, revenue: 0, cost: 0,
          profit: 0, totalTransactions: 0, stockIn: 0, stockOut: 0, sell: 0,
        });
      }
      const entry = categoryMap.get(catId)!;

      if (t.type === 'SELL') {
        entry.revenue += (t.totalAmount as number) || 0;
        entry.cost += ((t.quantity as number) || 0) * ((product?.purchasePrice as number) ?? 0);
        entry.profit += ((t.totalAmount as number) || 0) - ((t.quantity as number) || 0) * ((product?.purchasePrice as number) ?? 0);
        entry.sell += (t.quantity as number) || 0;
      } else if (t.type === 'STOCK_IN') {
        entry.cost += (t.totalAmount as number) || 0;
        entry.stockIn += (t.quantity as number) || 0;
      } else if (t.type === 'STOCK_OUT') {
        entry.stockOut += (t.quantity as number) || 0;
      }
      entry.totalTransactions++;
    }

    // Fetch category names for any missing ones
    const { data: categories } = await supabase
      .from('categories')
      .select('*')
      .eq('user_id', userId);

    const camelCategories = (categories || []).map(toCamelCase);

    const categoryData = Array.from(categoryMap.values()).map((item) => {
      const cat = camelCategories.find((c) => c.id === item.categoryId);
      return {
        ...item,
        categoryName: cat?.name ? (cat.name as string) : item.categoryName,
      };
    });

    result = { type: 'category', data: categoryData };
  } else {
    throw new Error('Invalid report type. Use daily, monthly, stock-value, or category.');
  }

  setCache(key, result, cacheTTL.reports);
  return result;
}

// ============ BACKUP ============

// ============ RESET DATA ============

export async function resetData(userId: string) {
  if (!userId) throw new Error('userId required');

  // Delete all user data in parallel (keep user account)
  await Promise.all([
    supabase.from('transactions').delete().eq('user_id', userId),
    supabase.from('products').delete().eq('user_id', userId),
    supabase.from('categories').delete().eq('user_id', userId),
    supabase.from('cash_entries').delete().eq('user_id', userId),
    supabase.from('expenses').delete().eq('user_id', userId),
  ]);

  invalidateCache();
  return { message: 'All data reset successfully' };
}

export async function exportBackup(userId: string) {
  // Run all queries in parallel
  const [categoriesResult, productsResult, transactionsResult, expensesResult, cashEntriesResult] = await Promise.all([
    supabase.from('categories').select('*').eq('user_id', userId),
    supabase.from('products').select('*').eq('user_id', userId),
    supabase.from('transactions').select('*').eq('user_id', userId),
    supabase.from('expenses').select('*').eq('user_id', userId),
    supabase.from('cash_entries').select('*').eq('user_id', userId),
  ]);

  return {
    categories: (categoriesResult.data || []).map(toCamelCase),
    products: (productsResult.data || []).map(toCamelCase),
    transactions: (transactionsResult.data || []).map(toCamelCase),
    expenses: (expensesResult.data || []).map(toCamelCase),
    cashEntries: (cashEntriesResult.data || []).map(toCamelCase),
    exportedAt: new Date().toISOString(),
  };
}

export async function importBackup(userId: string, data: {
  categories?: unknown[];
  products?: unknown[];
  transactions?: unknown[];
  expenses?: unknown[];
  cashEntries?: unknown[];
}) {
  // Delete existing data in parallel
  await Promise.all([
    supabase.from('transactions').delete().eq('user_id', userId),
    supabase.from('products').delete().eq('user_id', userId),
    supabase.from('categories').delete().eq('user_id', userId),
    supabase.from('cash_entries').delete().eq('user_id', userId),
    supabase.from('expenses').delete().eq('user_id', userId),
  ]);

  // Insert new data in parallel
  const insertPromises: Promise<unknown>[] = [];

  if (data.categories?.length) {
    const rows = data.categories.map((cat) => ({
      ...toSnakeCase(cat as Record<string, unknown>),
      user_id: userId,
    }));
    insertPromises.push((async () => { await supabase.from('categories').insert(rows); })());
  }

  if (data.products?.length) {
    const rows = data.products.map((prod) => ({
      ...toSnakeCase(prod as Record<string, unknown>),
      user_id: userId,
    }));
    insertPromises.push((async () => { await supabase.from('products').insert(rows); })());
  }

  if (data.transactions?.length) {
    const rows = data.transactions.map((txn) => ({
      ...toSnakeCase(txn as Record<string, unknown>),
      user_id: userId,
    }));
    insertPromises.push((async () => { await supabase.from('transactions').insert(rows); })());
  }

  if (data.expenses?.length) {
    const rows = data.expenses.map((exp) => ({
      ...toSnakeCase(exp as Record<string, unknown>),
      user_id: userId,
    }));
    insertPromises.push((async () => { await supabase.from('expenses').insert(rows); })());
  }

  if (data.cashEntries?.length) {
    const rows = data.cashEntries.map((entry) => ({
      ...toSnakeCase(entry as Record<string, unknown>),
      user_id: userId,
    }));
    insertPromises.push((async () => { await supabase.from('cash_entries').insert(rows); })());
  }

  await Promise.all(insertPromises);

  // Invalidate all caches
  invalidateCache();

  return { message: 'Backup imported successfully' };
}
