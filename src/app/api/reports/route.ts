import { NextRequest, NextResponse } from 'next/server';
import { supabase, toCamelCase, toSnakeCase } from '@/lib/supabase';

// Deep camelCase conversion for nested objects from Supabase joins
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

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const type = searchParams.get('type') || 'daily'; // daily, monthly, stock-value, category
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    if (type === 'stock-value') {
      // Category-wise stock value report
      const { data: categories, error: catError } = await supabase
        .from('categories')
        .select('*, products(*)')
        .eq('user_id', userId);

      if (catError) {
        console.error('Reports stock-value error:', catError);
        return NextResponse.json(
          { error: 'Internal server error' },
          { status: 500 }
        );
      }

      const camelCategories = (categories || []).map((cat) => deepCamelCase(cat)) as Record<string, unknown>[];

      const stockValueData = camelCategories.map((cat) => {
        const products = (cat.products as Record<string, unknown>[]) || [];
        const totalQty = products.reduce((sum, p) => sum + ((p.quantity as number) || 0), 0);
        const totalPurchaseValue = products.reduce((sum, p) => sum + ((p.quantity as number) || 0) * ((p.purchasePrice as number) || 0), 0);
        const totalSellingValue = products.reduce((sum, p) => sum + ((p.quantity as number) || 0) * ((p.sellingPrice as number) || 0), 0);
        const totalProfit = totalSellingValue - totalPurchaseValue;
        const lowStockCount = products.filter(p => ((p.quantity as number) || 0) <= ((p.lowStockThreshold as number) || 5)).length;
        const productCount = products.length;

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
          products: products.map(p => ({
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

      // Grand totals
      const grandTotal = {
        totalProducts: stockValueData.reduce((s, d) => s + d.productCount, 0),
        totalQty: stockValueData.reduce((s, d) => s + d.totalQty, 0),
        totalPurchaseValue: stockValueData.reduce((s, d) => s + d.totalPurchaseValue, 0),
        totalSellingValue: stockValueData.reduce((s, d) => s + d.totalSellingValue, 0),
        totalProfit: stockValueData.reduce((s, d) => s + d.totalProfit, 0),
        totalLowStock: stockValueData.reduce((s, d) => s + d.lowStockCount, 0),
      };

      return NextResponse.json({ type: 'stock-value', data: stockValueData, grandTotal }, {
        headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
      });
    }

    // For daily, monthly, and category reports — fetch transactions with product (and category) join
    const selectFields = type === 'category'
      ? '*, product:products(*, category:categories(*))'
      : '*, product:products(*)';

    let query = supabase
      .from('transactions')
      .select(selectFields)
      .eq('user_id', userId)
      .order('date', { ascending: true });

    if (from) query = query.gte('date', from);
    if (to) query = query.lte('date', to);

    const { data: transactions, error: txError } = await query;

    if (txError) {
      console.error('Reports transaction fetch error:', txError);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    const txList = (transactions || []).map((t) => deepCamelCase(t)) as Record<string, unknown>[];

    if (type === 'daily') {
      // Group by date
      const dailyMap = new Map<string, {
        date: string;
        revenue: number;
        cost: number;
        profit: number;
        stockIn: number;
        stockOut: number;
        sell: number;
      }>();

      for (const t of txList) {
        const date = t.date as string;
        if (!dailyMap.has(date)) {
          dailyMap.set(date, {
            date,
            revenue: 0,
            cost: 0,
            profit: 0,
            stockIn: 0,
            stockOut: 0,
            sell: 0,
          });
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

      const daily = Array.from(dailyMap.values());
      return NextResponse.json({ type: 'daily', data: daily }, {
        headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
      });
    }

    if (type === 'monthly') {
      // Group by month (YYYY-MM)
      const monthlyMap = new Map<string, {
        month: string;
        revenue: number;
        cost: number;
        profit: number;
        stockIn: number;
        stockOut: number;
        sell: number;
      }>();

      for (const t of txList) {
        const month = (t.date as string).substring(0, 7); // YYYY-MM
        if (!monthlyMap.has(month)) {
          monthlyMap.set(month, {
            month,
            revenue: 0,
            cost: 0,
            profit: 0,
            stockIn: 0,
            stockOut: 0,
            sell: 0,
          });
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

      const monthly = Array.from(monthlyMap.values());
      return NextResponse.json({ type: 'monthly', data: monthly }, {
        headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
      });
    }

    if (type === 'category') {
      // Group by product category
      const categoryMap = new Map<string, {
        categoryId: string;
        categoryName: string;
        revenue: number;
        cost: number;
        profit: number;
        totalTransactions: number;
        stockIn: number;
        stockOut: number;
        sell: number;
      }>();

      for (const t of txList) {
        const product = t.product as Record<string, unknown> | null;
        const category = product?.category as Record<string, unknown> | null;
        const catId = (product?.categoryId as string) ?? 'unknown';
        const catName = (category?.name as string) ?? (product?.name as string) ?? 'Unknown';

        if (!categoryMap.has(catId)) {
          categoryMap.set(catId, {
            categoryId: catId,
            categoryName: catName,
            revenue: 0,
            cost: 0,
            profit: 0,
            totalTransactions: 0,
            stockIn: 0,
            stockOut: 0,
            sell: 0,
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

      return NextResponse.json({ type: 'category', data: categoryData }, {
        headers: { 'Cache-Control': 'private, max-age=30, stale-while-revalidate=60' },
      });
    }

    return NextResponse.json(
      { error: 'Invalid report type. Use daily, monthly, stock-value, or category.' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Reports error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
