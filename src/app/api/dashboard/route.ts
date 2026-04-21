import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

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

    // Total items (products)
    const totalItems = await db.product.count({
      where: { userId },
    });

    // Get all products to compute low stock and stock value
    const products = await db.product.findMany({
      where: { userId },
      select: { 
        id: true,
        name: true,
        quantity: true, 
        sellingPrice: true, 
        purchasePrice: true,
        lowStockThreshold: true,
        categoryId: true,
        boxNumber: true,
        userId: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Low stock items (quantity <= lowStockThreshold)
    const lowItems = products.filter(p => p.quantity <= p.lowStockThreshold).length;

    // Total stock value
    const stockValue = products.reduce(
      (sum, p) => sum + p.quantity * p.sellingPrice,
      0
    );

    // Today's transactions
    const today = new Date().toISOString().split('T')[0];
    const todayTransactions = await db.transaction.count({
      where: {
        userId,
        date: today,
      },
    });

    // Low stock products detail
    const lowStockProducts = await db.product.findMany({
      where: { userId },
      include: { category: true },
      take: 100,
      orderBy: { quantity: 'asc' },
    });

    // Filter to only low stock
    const lowStockFiltered = lowStockProducts.filter(
      p => p.quantity <= p.lowStockThreshold
    ).slice(0, 10);

    // Recent transactions
    const recentTransactions = await db.transaction.findMany({
      where: { userId },
      include: { product: true },
      take: 5,
      orderBy: { createdAt: 'desc' },
    });

    // Category distribution
    let categories = await db.category.findMany({
      where: { userId },
      include: { _count: { select: { products: true } } },
    });

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

      await db.category.createMany({
        data: defaultCategories.map(cat => ({
          name: cat.name,
          image: cat.image,
          userId,
        })),
      });

      categories = await db.category.findMany({
        where: { userId },
        include: { _count: { select: { products: true } } },
      });
    }

    // Migration: Split "Flip Cover/Back Cover" into two separate categories
    const oldCombined = categories.find(c => c.name === 'Flip Cover/Back Cover');
    if (oldCombined) {
      // Rename existing to "Flip Cover"
      await db.category.update({
        where: { id: oldCombined.id },
        data: { name: 'Flip Cover' },
      });
      // Create new "Back Cover" category
      await db.category.create({
        data: {
          name: 'Back Cover',
          image: '/categories/back-cover.png',
          userId,
        },
      });
      categories = await db.category.findMany({
        where: { userId },
        include: { _count: { select: { products: true } } },
      });
    }

    // Sale Overview: Last 7 days daily sales
    const todayDate = new Date();
    const saleOverview = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(todayDate);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayLabel = d.toLocaleDateString('en-US', { weekday: 'short' });

      const dayTxns = await db.transaction.findMany({
        where: { userId, type: 'SELL', date: dateStr },
        select: { totalAmount: true, quantity: true },
      });

      const totalSales = dayTxns.reduce((sum, t) => sum + t.totalAmount, 0);
      const totalQty = dayTxns.reduce((sum, t) => sum + t.quantity, 0);

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
      const catProducts = await db.product.findMany({
        where: { userId, categoryId: cat.id },
        select: { quantity: true, purchasePrice: true, sellingPrice: true },
      });
      const totalQty = catProducts.reduce((sum, p) => sum + p.quantity, 0);
      const totalValue = catProducts.reduce((sum, p) => sum + p.quantity * p.sellingPrice, 0);
      if (totalQty > 0) {
        stockOverview.push({
          category: cat.name,
          quantity: totalQty,
          value: totalValue,
        });
      }
    }

    return NextResponse.json({
      stats: {
        totalItems,
        lowItems,
        todayTransactions,
        stockValue,
      },
      lowStockProducts: lowStockFiltered,
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
