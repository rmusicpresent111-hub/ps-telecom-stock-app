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
    const categories = await db.category.findMany({
      where: { userId },
      include: { _count: { select: { products: true } } },
    });

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
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
