/**
 * Client-side Supabase Service Module
 * Replaces all API route calls with direct Supabase client queries
 * This enables the app to work as a static export (no server needed)
 */

import { supabase, generateId, toCamelCase, toSnakeCase } from './supabase';

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
  const { data, error } = await supabase
    .from('users')
    .select('id, email, name, shop_name, role, language, theme, created_at, updated_at')
    .eq('id', userId)
    .single();

  if (error || !data) {
    throw new Error('User not found');
  }

  return { user: toCamelCase(data) };
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

  await supabase.from('transactions').delete().eq('user_id', id);
  await supabase.from('products').delete().eq('user_id', id);
  await supabase.from('categories').delete().eq('user_id', id);
  await supabase.from('cash_entries').delete().eq('user_id', id);
  await supabase.from('expenses').delete().eq('user_id', id);
  await supabase.from('users').delete().eq('id', id);

  return { message: 'User account deleted successfully' };
}

// ============ PRODUCTS ============

export async function getProducts(userId: string, options?: { categoryId?: string; search?: string }) {
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

  return { products };
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
    .select('*')
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

  return { product };
}

export async function deleteProduct(id: string) {
  const { data: existing } = await supabase
    .from('products')
    .select('*')
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

  return { message: 'Product deleted successfully' };
}

// ============ CATEGORIES ============

export async function getCategories(userId: string) {
  const { data: categories, error: categoriesError } = await supabase
    .from('categories')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (categoriesError) {
    throw new Error('Internal server error');
  }

  const { data: productCounts, error: productCountsError } = await supabase
    .from('products')
    .select('category_id')
    .eq('user_id', userId);

  if (productCountsError) {
    throw new Error('Internal server error');
  }

  const countMap: Record<string, number> = {};
  for (const row of productCounts ?? []) {
    const catId = row.category_id;
    countMap[catId] = (countMap[catId] ?? 0) + 1;
  }

  const result = (categories ?? []).map((cat) => ({
    ...toCamelCase(cat),
    _count: { products: countMap[cat.id] ?? 0 },
  }));

  return { categories: result };
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

  return { category };
}

// ============ TRANSACTIONS ============

export async function getTransactions(userId: string, options?: { type?: string; productId?: string; date?: string; from?: string; to?: string }) {
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

  return { transactions };
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
    // Attempt to roll back the inserted transaction
    await supabase.from('transactions').delete().eq('id', transactionId);
    throw new Error('Failed to update product stock');
  }

  const camelTransaction = toCamelCase(newTransaction as Record<string, unknown>);
  const { product: productData, ...transactionFields } = camelTransaction as Record<string, unknown>;
  if (productData && typeof productData === 'object') {
    transactionFields.product = toCamelCase(productData as Record<string, unknown>);
  }

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

  const expenses = (data || []).map(toCamelCase);

  const totalExpense = expenses.reduce((sum, e) => sum + ((e.amount as number) || 0), 0);

  const byCategory = expenses.reduce((acc, e) => {
    const cat = (e.category as string) || 'other';
    if (!acc[cat]) acc[cat] = 0;
    acc[cat] += (e.amount as number) || 0;
    return acc;
  }, {} as Record<string, number>);

  return {
    expenses,
    summary: {
      totalExpense,
      byCategory,
      count: expenses.length,
    },
  };
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

  return { success: true };
}

// ============ CASH ENTRIES ============

export async function getCashEntries(userId: string, options?: { period?: string; date?: string; from?: string; to?: string }) {
  const period = options?.period || 'today';
  const { startDate, endDate } = getDateRange(period, options?.date, options?.from, options?.to);

  const { data: entries, error } = await supabase
    .from('cash_entries')
    .select('*')
    .eq('user_id', userId)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: false });

  if (error) {
    throw new Error('Failed to fetch cash entries');
  }

  const camelEntries = (entries || []).map(toCamelCase);

  // Get latest entry for totals
  const { data: latestEntry } = await supabase
    .from('cash_entries')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .limit(1);

  const latest = latestEntry && latestEntry.length > 0 ? toCamelCase(latestEntry[0]) : null;
  const totalHandCash = (latest?.handCash as number) || 0;
  const totalLiquidCash = (latest?.liquidCash as number) || 0;

  return {
    entries: camelEntries,
    summary: {
      totalHandCash,
      totalLiquidCash,
      totalCash: totalHandCash + totalLiquidCash,
    },
  };
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

  // Check if entry for this date already exists
  const { data: existingRows } = await supabase
    .from('cash_entries')
    .select('*')
    .eq('user_id', entryData.userId)
    .eq('date', entryData.date);

  let entry;
  if (existingRows && existingRows.length > 0) {
    // Update existing entry
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
    // Create new entry
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

  return { success: true };
}

// ============ DASHBOARD ============

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
  // Total items (products) — count
  const { count: totalItems } = await supabase
    .from('products')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  // Get all products
  const { data: productsData } = await supabase
    .from('products')
    .select('id, name, quantity, selling_price, purchase_price, low_stock_threshold, category_id, box_number, user_id, created_at, updated_at')
    .eq('user_id', userId);

  const products = (productsData || []).map(toCamelCase);

  // Low stock items
  const lowItems = products.filter((p: Record<string, unknown>) => (p.quantity as number) <= (p.lowStockThreshold as number)).length;

  // Total stock value
  const stockValue = products.reduce(
    (sum: number, p: Record<string, unknown>) => sum + ((p.quantity as number) * (p.sellingPrice as number)),
    0
  );

  // Today's transactions
  const today = formatDate(new Date());
  const { count: todayTransactions } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('date', today);

  // Low stock products detail
  const { data: lowStockData } = await supabase
    .from('products')
    .select('*, category:categories(*)')
    .eq('user_id', userId)
    .order('quantity', { ascending: true })
    .limit(100);

  const lowStockProducts = (lowStockData || [])
    .map((p: Record<string, unknown>) => {
      const camel = toCamelCase(p);
      if (camel.category && typeof camel.category === 'object') {
        camel.category = toCamelCase(camel.category as Record<string, unknown>);
      }
      return camel;
    })
    .filter((p: Record<string, unknown>) => (p.quantity as number) <= (p.lowStockThreshold as number))
    .slice(0, 10);

  // Recent transactions
  const { data: recentTxnData } = await supabase
    .from('transactions')
    .select('*, product:products(*)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(5);

  const recentTransactions = (recentTxnData || []).map((t: Record<string, unknown>) => {
    const camel = toCamelCase(t);
    if (camel.product && typeof camel.product === 'object') {
      camel.product = toCamelCase(camel.product as Record<string, unknown>);
    }
    return camel;
  });

  // Categories with product counts
  const { data: categoriesData } = await supabase
    .from('categories')
    .select('*')
    .eq('user_id', userId);

  let categories = (categoriesData || []).map(toCamelCase);

  const { data: productCountData } = await supabase
    .from('products')
    .select('category_id')
    .eq('user_id', userId);

  const productCountMap: Record<string, number> = {};
  if (productCountData) {
    for (const p of productCountData) {
      const catId = p.category_id;
      if (catId) {
        productCountMap[catId] = (productCountMap[catId] || 0) + 1;
      }
    }
  }

  categories = categories.map((cat: Record<string, unknown>) => ({
    ...cat,
    _count: { products: productCountMap[(cat.id as string)] || 0 },
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
    await supabase
      .from('categories')
      .update({ name: 'Flip Cover' })
      .eq('id', (oldCombined as Record<string, unknown>).id as string);

    await supabase
      .from('categories')
      .insert({
        id: generateId(),
        name: 'Back Cover',
        image: '/categories/back-cover.png',
        user_id: userId,
      });

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

  // Sale Overview: Last 7 days
  const todayDate = new Date();
  const saleOverview = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(todayDate);
    d.setDate(d.getDate() - i);
    const dateStr = formatDate(d);
    const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short' });

    const { data: dayTxnData } = await supabase
      .from('transactions')
      .select('total_amount, quantity')
      .eq('user_id', userId)
      .eq('type', 'SELL')
      .eq('date', dateStr);

    const dayTxns = dayTxnData || [];
    const totalSales = dayTxns.reduce((sum: number, t: Record<string, unknown>) => sum + (t.total_amount as number), 0);
    const totalQty = dayTxns.reduce((sum: number, t: Record<string, unknown>) => sum + (t.quantity as number), 0);

    saleOverview.push({
      date: dateStr,
      label: dayLabel,
      sales: totalSales,
      quantity: totalQty,
    });
  }

  // Stock Overview: Stock quantity by category
  const stockOverview = [];
  for (const cat of categories) {
    const { data: catProductsData } = await supabase
      .from('products')
      .select('quantity, selling_price')
      .eq('user_id', userId)
      .eq('category_id', (cat as Record<string, unknown>).id as string);

    const catProducts = catProductsData || [];
    const totalQty = catProducts.reduce((sum: number, p: Record<string, unknown>) => sum + (p.quantity as number), 0);
    const totalValue = catProducts.reduce((sum: number, p: Record<string, unknown>) => sum + (p.quantity as number) * (p.selling_price as number), 0);
    if (totalQty > 0) {
      stockOverview.push({
        category: (cat as Record<string, unknown>).name,
        quantity: totalQty,
        value: totalValue,
      });
    }
  }

  return {
    stats: {
      totalItems: totalItems || 0,
      lowItems,
      todayTransactions: todayTransactions || 0,
      stockValue,
    },
    lowStockProducts,
    recentTransactions,
    categories,
    saleOverview,
    stockOverview,
  };
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
          stockValue: ((p.quantity as number) || 0) * ((p.sellingPrice as number) || 0),
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

    return { type: 'stock-value', data: stockValueData, grandTotal };
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

    return { type: 'daily', data: Array.from(dailyMap.values()) };
  }

  if (type === 'monthly') {
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

    return { type: 'monthly', data: Array.from(monthlyMap.values()) };
  }

  if (type === 'category') {
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

    return { type: 'category', data: categoryData };
  }

  throw new Error('Invalid report type. Use daily, monthly, stock-value, or category.');
}

// ============ BACKUP ============

export async function exportBackup(userId: string) {
  const { data: categories } = await supabase
    .from('categories')
    .select('*')
    .eq('user_id', userId);

  const { data: products } = await supabase
    .from('products')
    .select('*')
    .eq('user_id', userId);

  const { data: transactions } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', userId);

  return {
    exportDate: new Date().toISOString(),
    userId,
    categories: (categories || []).map(toCamelCase),
    products: (products || []).map(toCamelCase),
    transactions: (transactions || []).map(toCamelCase),
  };
}

export async function importBackup(userId: string, backup: {
  categories?: Record<string, unknown>[];
  products?: Record<string, unknown>[];
  transactions?: Record<string, unknown>[];
}) {
  // Verify user exists
  const { data: user } = await supabase
    .from('users')
    .select('id')
    .eq('id', userId)
    .single();

  if (!user) {
    throw new Error('User not found');
  }

  // Import categories
  if (backup.categories && Array.isArray(backup.categories)) {
    for (const cat of backup.categories) {
      const catData = toSnakeCase({
        id: cat.id,
        name: cat.name,
        image: cat.image ?? '',
        userId,
      });

      const { error: insertError } = await supabase
        .from('categories')
        .insert(catData)
        .select('*')
        .single();

      if (insertError) {
        await supabase
          .from('categories')
          .update({ name: catData.name, image: catData.image })
          .eq('id', catData.id)
          .select('*')
          .single();
      }
    }
  }

  // Import products
  if (backup.products && Array.isArray(backup.products)) {
    for (const prod of backup.products) {
      const prodData = toSnakeCase({
        id: prod.id,
        name: prod.name,
        categoryId: prod.categoryId,
        quantity: prod.quantity ?? 0,
        boxNumber: prod.boxNumber ?? '',
        purchasePrice: prod.purchasePrice ?? 0,
        sellingPrice: prod.sellingPrice ?? 0,
        lowStockThreshold: prod.lowStockThreshold ?? 5,
        userId,
      });

      const { error: insertError } = await supabase
        .from('products')
        .insert(prodData)
        .select('*')
        .single();

      if (insertError) {
        const updateFields = toSnakeCase({
          name: prod.name,
          categoryId: prod.categoryId,
          quantity: prod.quantity ?? 0,
          boxNumber: prod.boxNumber ?? '',
          purchasePrice: prod.purchasePrice ?? 0,
          sellingPrice: prod.sellingPrice ?? 0,
          lowStockThreshold: prod.lowStockThreshold ?? 5,
        });

        await supabase
          .from('products')
          .update(updateFields)
          .eq('id', prodData.id)
          .select('*')
          .single();
      }
    }
  }

  // Import transactions
  if (backup.transactions && Array.isArray(backup.transactions)) {
    for (const tran of backup.transactions) {
      const tranData = toSnakeCase({
        id: tran.id,
        type: tran.type,
        productId: tran.productId,
        quantity: tran.quantity,
        unitPrice: tran.unitPrice ?? 0,
        totalAmount: tran.totalAmount ?? 0,
        date: tran.date,
        userId,
      });

      const { error: insertError } = await supabase
        .from('transactions')
        .insert(tranData)
        .select('*')
        .single();

      if (insertError) {
        const updateFields = toSnakeCase({
          type: tran.type,
          quantity: tran.quantity,
          unitPrice: tran.unitPrice ?? 0,
          totalAmount: tran.totalAmount ?? 0,
          date: tran.date,
        });

        await supabase
          .from('transactions')
          .update(updateFields)
          .eq('id', tranData.id)
          .select('*')
          .single();
      }
    }
  }

  return {
    message: 'Data imported successfully',
    imported: {
      categories: backup.categories?.length ?? 0,
      products: backup.products?.length ?? 0,
      transactions: backup.transactions?.length ?? 0,
    },
  };
}

export async function resetData(userId: string) {
  const { data: user } = await supabase
    .from('users')
    .select('id')
    .eq('id', userId)
    .single();

  if (!user) {
    throw new Error('User not found');
  }

  await supabase.from('transactions').delete().eq('user_id', userId);
  await supabase.from('products').delete().eq('user_id', userId);
  await supabase.from('categories').delete().eq('user_id', userId);

  return { message: 'All data reset successfully' };
}
