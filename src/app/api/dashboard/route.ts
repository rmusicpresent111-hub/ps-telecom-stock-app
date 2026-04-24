import { NextRequest, NextResponse } from 'next/server';
import { supabase, generateId, toCamelCase, formatDate } from '@/lib/supabase';

// Server-side response cache with TTL
const responseCache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 60_000; // 60 seconds server-side cache

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    // Check server-side cache
    const cacheKey = `dashboard:${userId}`;
    const cached = responseCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return NextResponse.json(cached.data, {
        headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' },
      });
    }

    // Calculate date range for 7-day sale overview
    const todayDate = new Date();
    const today = formatDate(todayDate);
    const sevenDaysAgo = new Date(todayDate);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const sevenDaysAgoStr = formatDate(sevenDaysAgo);

    // ✅ BATCH 1: Run ALL independent queries in PARALLEL (was 20+ sequential, now 7 parallel)
    const [
      productsCountResult,
      productsDataResult,
      todayTxnCountResult,
      categoriesDataResult,
      recentTxnResult,
      sevenDayTxnResult,
      productCountResult,
    ] = await Promise.all([
      // Total items count
      supabase
        .from('products')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId),

      // All products (for stock value + low stock calculation - ONE query instead of many)
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

      // Recent transactions (with product join)
      supabase
        .from('transactions')
        .select('*, product:products(*)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(5),

      // ✅ SINGLE query for 7-day sales (was 7 separate queries!)
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

    // Low stock items - computed from already-fetched products (no extra query)
    const lowItems = products.filter((p: Record<string, unknown>) => (p.quantity as number) <= (p.lowStockThreshold as number)).length;

    // Total stock value - computed from already-fetched products
    const stockValue = products.reduce(
      (sum: number, p: Record<string, unknown>) => sum + ((p.quantity as number) * (p.purchasePrice as number)),
      0
    );

    // Low stock products detail - use already-fetched products (no extra query!)
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

    // Product counts by category
    const productCountMap: Record<string, number> = {};
    if (productCountResult.data) {
      for (const p of productCountResult.data) {
        const catId = p.category_id;
        if (catId) {
          productCountMap[catId] = (productCountMap[catId] || 0) + 1;
        }
      }
    }

    // Categories with product counts
    let categories = (categoriesDataResult.data || []).map((cat: Record<string, unknown>) => ({
      ...toCamelCase(cat),
      _count: { products: productCountMap[(cat as Record<string, unknown>).id as string] || 0 },
    }));

    // Auto-seed default categories if user has none
    if (categories.length === 0) {
      const defaultCategories = [
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

      const insertRows = defaultCategories.map(cat => ({
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

    // Migration: Split "Flip Cover/Back Cover" into two separate categories
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

    // ✅ Sale Overview: Process 7-day data from SINGLE query (was 7 sequential queries!)
    const saleMap = new Map<string, { sales: number; quantity: number }>();
    for (const t of (sevenDayTxnResult.data || [])) {
      const dateStr = t.date as string;
      const existing = saleMap.get(dateStr) || { sales: 0, quantity: 0 };
      existing.sales += (t.total_amount as number) || 0;
      existing.quantity += (t.quantity as number) || 0;
      saleMap.set(dateStr, existing);
    }

    const saleOverview = [];
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

    // ✅ Stock Overview: Compute from already-fetched products (was N queries per category!)
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

    // Cache the response server-side
    responseCache.set(cacheKey, { data: result, timestamp: Date.now() });

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'public, max-age=30, stale-while-revalidate=60' },
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
