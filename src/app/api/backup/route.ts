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

    const categories = await db.category.findMany({
      where: { userId },
    });

    const products = await db.product.findMany({
      where: { userId },
    });

    const transactions = await db.transaction.findMany({
      where: { userId },
    });

    const backup = {
      exportDate: new Date().toISOString(),
      userId,
      categories,
      products,
      transactions,
    };

    return NextResponse.json(backup);
  } catch (error) {
    console.error('Export backup error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, categories, products, transactions } = body;

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Import data using a transaction for atomicity
    await db.$transaction(async (tx) => {
      // Import categories
      if (categories && Array.isArray(categories)) {
        for (const cat of categories) {
          await tx.category.upsert({
            where: { id: cat.id },
            update: { name: cat.name, image: cat.image ?? '' },
            create: {
              id: cat.id,
              name: cat.name,
              image: cat.image ?? '',
              userId,
            },
          });
        }
      }

      // Import products
      if (products && Array.isArray(products)) {
        for (const prod of products) {
          await tx.product.upsert({
            where: { id: prod.id },
            update: {
              name: prod.name,
              categoryId: prod.categoryId,
              quantity: prod.quantity ?? 0,
              boxNumber: prod.boxNumber ?? '',
              purchasePrice: prod.purchasePrice ?? 0,
              sellingPrice: prod.sellingPrice ?? 0,
              lowStockThreshold: prod.lowStockThreshold ?? 5,
            },
            create: {
              id: prod.id,
              name: prod.name,
              categoryId: prod.categoryId,
              quantity: prod.quantity ?? 0,
              boxNumber: prod.boxNumber ?? '',
              purchasePrice: prod.purchasePrice ?? 0,
              sellingPrice: prod.sellingPrice ?? 0,
              lowStockThreshold: prod.lowStockThreshold ?? 5,
              userId,
            },
          });
        }
      }

      // Import transactions
      if (transactions && Array.isArray(transactions)) {
        for (const tran of transactions) {
          await tx.transaction.upsert({
            where: { id: tran.id },
            update: {
              type: tran.type,
              quantity: tran.quantity,
              unitPrice: tran.unitPrice,
              totalAmount: tran.totalAmount,
              date: tran.date,
            },
            create: {
              id: tran.id,
              type: tran.type,
              productId: tran.productId,
              quantity: tran.quantity,
              unitPrice: tran.unitPrice ?? 0,
              totalAmount: tran.totalAmount ?? 0,
              date: tran.date,
              userId,
            },
          });
        }
      }
    });

    return NextResponse.json({
      message: 'Data imported successfully',
      imported: {
        categories: categories?.length ?? 0,
        products: products?.length ?? 0,
        transactions: transactions?.length ?? 0,
      },
    });
  } catch (error) {
    console.error('Import backup error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Delete all user data in correct order (transactions first, then products, then categories)
    await db.$transaction(async (tx) => {
      await tx.transaction.deleteMany({ where: { userId } });
      await tx.product.deleteMany({ where: { userId } });
      await tx.category.deleteMany({ where: { userId } });
    });

    return NextResponse.json({ message: 'All data reset successfully' });
  } catch (error) {
    console.error('Reset data error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
