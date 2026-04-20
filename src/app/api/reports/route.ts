import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const type = searchParams.get('type') || 'daily'; // daily, monthly, category
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    // Build date filter
    const dateFilter: Record<string, string> = {};
    if (from) dateFilter.gte = from;
    if (to) dateFilter.lte = to;

    const where: Record<string, unknown> = { userId };
    if (from || to) {
      where.date = dateFilter;
    }

    const transactions = await db.transaction.findMany({
      where,
      include: { product: true },
      orderBy: { date: 'asc' },
    });

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

      for (const t of transactions) {
        const date = t.date;
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

        if (t.type === 'SELL') {
          entry.revenue += t.totalAmount;
          entry.cost += t.quantity * (t.product?.purchasePrice ?? 0);
          entry.profit += t.totalAmount - t.quantity * (t.product?.purchasePrice ?? 0);
          entry.sell += t.quantity;
        } else if (t.type === 'STOCK_IN') {
          entry.cost += t.totalAmount;
          entry.stockIn += t.quantity;
        } else if (t.type === 'STOCK_OUT') {
          entry.stockOut += t.quantity;
        }
      }

      const daily = Array.from(dailyMap.values());
      return NextResponse.json({ type: 'daily', data: daily });
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

      for (const t of transactions) {
        const month = t.date.substring(0, 7); // YYYY-MM
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

        if (t.type === 'SELL') {
          entry.revenue += t.totalAmount;
          entry.cost += t.quantity * (t.product?.purchasePrice ?? 0);
          entry.profit += t.totalAmount - t.quantity * (t.product?.purchasePrice ?? 0);
          entry.sell += t.quantity;
        } else if (t.type === 'STOCK_IN') {
          entry.cost += t.totalAmount;
          entry.stockIn += t.quantity;
        } else if (t.type === 'STOCK_OUT') {
          entry.stockOut += t.quantity;
        }
      }

      const monthly = Array.from(monthlyMap.values());
      return NextResponse.json({ type: 'monthly', data: monthly });
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

      for (const t of transactions) {
        const catId = t.product?.categoryId ?? 'unknown';
        const catName = t.product?.category?.name ?? t.product?.name ?? 'Unknown';

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
          entry.revenue += t.totalAmount;
          entry.cost += t.quantity * (t.product?.purchasePrice ?? 0);
          entry.profit += t.totalAmount - t.quantity * (t.product?.purchasePrice ?? 0);
          entry.sell += t.quantity;
        } else if (t.type === 'STOCK_IN') {
          entry.cost += t.totalAmount;
          entry.stockIn += t.quantity;
        } else if (t.type === 'STOCK_OUT') {
          entry.stockOut += t.quantity;
        }
        entry.totalTransactions++;
      }

      // Fetch category names properly
      const categories = await db.category.findMany({
        where: { userId },
      });

      const categoryData = Array.from(categoryMap.values()).map((item) => {
        const cat = categories.find((c) => c.id === item.categoryId);
        return {
          ...item,
          categoryName: cat?.name ?? item.categoryName,
        };
      });

      return NextResponse.json({ type: 'category', data: categoryData });
    }

    return NextResponse.json(
      { error: 'Invalid report type. Use daily, monthly, or category.' },
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
