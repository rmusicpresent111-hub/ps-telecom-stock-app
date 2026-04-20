import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const type = searchParams.get('type');
    const productId = searchParams.get('productId');
    const date = searchParams.get('date');
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    const where: Prisma.TransactionWhereInput = { userId };

    if (type) {
      where.type = type;
    }

    if (productId) {
      where.productId = productId;
    }

    if (date) {
      where.date = date;
    }

    if (from || to) {
      where.date = {};
      if (from) {
        (where.date as Prisma.StringFilter)['gte'] = from;
      }
      if (to) {
        (where.date as Prisma.StringFilter)['lte'] = to;
      }
    }

    const transactions = await db.transaction.findMany({
      where,
      include: { product: true },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ transactions });
  } catch (error) {
    console.error('Get transactions error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, productId, quantity, unitPrice, totalAmount, date, userId } = body;

    if (!type || !productId || !quantity || !userId) {
      return NextResponse.json(
        { error: 'Type, productId, quantity, and userId are required' },
        { status: 400 }
      );
    }

    if (!['STOCK_IN', 'STOCK_OUT', 'SELL'].includes(type)) {
      return NextResponse.json(
        { error: 'Type must be STOCK_IN, STOCK_OUT, or SELL' },
        { status: 400 }
      );
    }

    // Use Prisma interactive transaction for atomicity
    const result = await db.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: productId } });

      if (!product) {
        throw new Error('Product not found');
      }

      // Check if enough stock for STOCK_OUT or SELL
      if ((type === 'STOCK_OUT' || type === 'SELL') && product.quantity < quantity) {
        throw new Error('Insufficient stock');
      }

      // Update product quantity
      const quantityChange = type === 'STOCK_IN' ? quantity : -quantity;
      const updatedProduct = await tx.product.update({
        where: { id: productId },
        data: { quantity: product.quantity + quantityChange },
      });

      // Create transaction record
      const transaction = await tx.transaction.create({
        data: {
          type,
          productId,
          quantity,
          unitPrice: unitPrice ?? 0,
          totalAmount: totalAmount ?? 0,
          date: date || new Date().toISOString().split('T')[0],
          userId,
        },
        include: { product: true },
      });

      return { transaction, product: updatedProduct };
    });

    return NextResponse.json({ transaction: result.transaction }, { status: 201 });
  } catch (error: unknown) {
    console.error('Create transaction error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message === 'Product not found' || message === 'Insufficient stock' ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'Transaction id is required' },
        { status: 400 }
      );
    }

    const existing = await db.transaction.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: 'Transaction not found' },
        { status: 404 }
      );
    }

    // Reverse the stock change
    await db.$transaction(async (tx) => {
      const product = await tx.product.findUnique({ where: { id: existing.productId } });

      if (product) {
        const quantityChange = existing.type === 'STOCK_IN' ? -existing.quantity : existing.quantity;
        await tx.product.update({
          where: { id: existing.productId },
          data: { quantity: product.quantity + quantityChange },
        });
      }

      await tx.transaction.delete({ where: { id } });
    });

    return NextResponse.json({ message: 'Transaction deleted successfully' });
  } catch (error) {
    console.error('Delete transaction error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
