import { NextRequest, NextResponse } from 'next/server';
import { supabase, generateId, toCamelCase, toSnakeCase, formatDate } from '@/lib/supabase';

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

    // Total items (products) — count
    const { count: totalItems, error: countError } = await supabase
      .from('products')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (countError) {
      console.error('Product count error:', countError);
    }

    // Get all products to compute low stock and stock value
    const { data: productsData, error: productsError } = await supabase
      .from('products')
      .select('id, name, quantity, selling_price, purchase_price, low_stock_threshold, category_id, box_number, user_id, created_at, updated_at')
      .eq('user_id', userId);

    if (productsError) {
      console.error('Products fetch error:', productsError);
    }

    const products = (productsData || []).map(toCamelCase);

    // Low stock items (quantity <= lowStockThreshold)
    const lowItems = products.filter((p: Record<string, unknown>) => (p.quantity as number) <= (p.lowStockThreshold as number)).length;

    // Total stock value
    const stockValue = products.reduce(
      (sum: number, p: Record<string, unknown>) => sum + ((p.quantity as number) * (p.sellingPrice as number)),
      0
    );

    // Today's transactions
    const today = formatDate(new Date());
    const { count: todayTransactions, error: txnCountError } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('date', today);

    if (txnCountError) {
      console.error('Transaction count error:', txnCountError);
    }

    // Low stock products detail (with category join)
    const { data: lowStockData, error: lowStockError } = await supabase
      .from('products')
      .select('*, category:categories(*)')
      .eq('user_id', userId)
      .order('quantity', { ascending: true })
      .limit(100);

    if (lowStockError) {
      console.error('Low stock products error:', lowStockError);
    }

    const lowStockProducts = (lowStockData || [])
      .map((p: Record<string, unknown>) => {
        const camel = toCamelCase(p);
        // Flatten the joined category object
        if (camel.category && typeof camel.category === 'object') {
          camel.category = toCamelCase(camel.category as Record<string, unknown>);
        }
        return camel;
      })
      .filter((p: Record<string, unknown>) => (p.quantity as number) <= (p.lowStockThreshold as number))
      .slice(0, 10);

    // Recent transactions (with product join)
    const { data: recentTxnData, error: recentTxnError } = await supabase
      .from('transactions')
      .select('*, product:products(*)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(5);

    if (recentTxnError) {
      console.error('Recent transactions error:', recentTxnError);
    }

    const recentTransactions = (recentTxnData || []).map((t: Record<string, unknown>) => {
      const camel = toCamelCase(t);
      // Flatten the joined product object
      if (camel.product && typeof camel.product === 'object') {
        camel.product = toCamelCase(camel.product as Record<string, unknown>);
      }
      return camel;
    });

    // Category distribution — fetch categories with product counts
    const { data: categoriesData, error: categoriesError } = await supabase
      .from('categories')
      .select('*')
      .eq('user_id', userId);

    if (categoriesError) {
      console.error('Categories fetch error:', categoriesError);
    }

    let categories = (categoriesData || []).map(toCamelCase);

    // Compute product counts per category from products
    const { data: productCountData, error: productCountError } = await supabase
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

    // Attach _count to categories for compatibility
    categories = categories.map((cat: Record<string, unknown>) => ({
      ...cat,
      _count: { products: productCountMap[(cat.id as string)] || 0 },
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

      const { data: insertedData, error: insertError } = await supabase
        .from('categories')
        .insert(insertRows)
        .select('*');

      if (insertError) {
        console.error('Default categories insert error:', insertError);
      }

      categories = (insertedData || []).map((cat: Record<string, unknown>) => ({
        ...toCamelCase(cat),
        _count: { products: 0 },
      }));
    }

    // Migration: Split "Flip Cover/Back Cover" into two separate categories
    const oldCombined = categories.find((c: Record<string, unknown>) => c.name === 'Flip Cover/Back Cover');
    if (oldCombined) {
      // Rename existing to "Flip Cover"
      const { error: updateError } = await supabase
        .from('categories')
        .update({ name: 'Flip Cover' })
        .eq('id', oldCombined.id as string);

      if (updateError) {
        console.error('Category rename error:', updateError);
      }

      // Create new "Back Cover" category
      const { error: createError } = await supabase
        .from('categories')
        .insert({
          id: generateId(),
          name: 'Back Cover',
          image: '/categories/back-cover.png',
          user_id: userId,
        });

      if (createError) {
        console.error('Category create error:', createError);
      }

      // Re-fetch categories after migration
      const { data: refreshedData, error: refreshError } = await supabase
        .from('categories')
        .select('*')
        .eq('user_id', userId);

      if (refreshError) {
        console.error('Categories refresh error:', refreshError);
      }

      categories = (refreshedData || []).map((cat: Record<string, unknown>) => {
        const camel = toCamelCase(cat);
        return {
          ...camel,
          _count: { products: productCountMap[(camel.id as string)] || 0 },
        };
      });
    }

    // Sale Overview: Last 7 days daily sales
    const todayDate = new Date();
    const saleOverview = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(todayDate);
      d.setDate(d.getDate() - i);
      const dateStr = formatDate(d);
      const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short' });

      const { data: dayTxnData, error: dayTxnError } = await supabase
        .from('transactions')
        .select('total_amount, quantity')
        .eq('user_id', userId)
        .eq('type', 'SELL')
        .eq('date', dateStr);

      if (dayTxnError) {
        console.error('Day transactions error:', dayTxnError);
      }

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
      const { data: catProductsData, error: catProductsError } = await supabase
        .from('products')
        .select('quantity, selling_price')
        .eq('user_id', userId)
        .eq('category_id', (cat as Record<string, unknown>).id as string);

      if (catProductsError) {
        console.error('Category products error:', catProductsError);
      }

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

    return NextResponse.json({
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
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
