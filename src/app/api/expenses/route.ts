import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/expenses?userId=xxx&date=xxx&period=today|week|month&from=xxx&to=xxx&category=xxx
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

    const date = searchParams.get('date');
    const period = searchParams.get('period') || 'today';
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const category = searchParams.get('category');

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

    const where: Record<string, unknown> = {
      userId,
      date: { gte: startDate, lte: endDate },
    };
    if (category) where.category = category;

    const expenses = await db.expense.findMany({
      where,
      orderBy: { date: 'desc' },
    });

    // Calculate total
    const totalExpense = expenses.reduce((sum, e) => sum + e.amount, 0);

    // Group by category
    const byCategory = expenses.reduce((acc, e) => {
      if (!acc[e.category]) acc[e.category] = 0;
      acc[e.category] += e.amount;
      return acc;
    }, {} as Record<string, number>);

    return NextResponse.json({
      expenses,
      summary: {
        totalExpense,
        byCategory,
        count: expenses.length,
      },
    });
  } catch (error) {
    console.error('Expenses GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch expenses' }, { status: 500 });
  }
}

// POST /api/expenses
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, date, amount, category, description } = body;

    if (!userId || !date || amount === undefined) {
      return NextResponse.json({ error: 'userId, date and amount required' }, { status: 400 });
    }

    const expense = await db.expense.create({
      data: {
        userId,
        date,
        amount: parseFloat(amount),
        category: category || 'other',
        description: description || '',
      },
    });

    return NextResponse.json({ expense });
  } catch (error) {
    console.error('Expense POST error:', error);
    return NextResponse.json({ error: 'Failed to create expense' }, { status: 500 });
  }
}

// PUT /api/expenses
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, amount, category, description } = body;

    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const expense = await db.expense.update({
      where: { id },
      data: {
        ...(amount !== undefined && { amount: parseFloat(amount) }),
        ...(category !== undefined && { category }),
        ...(description !== undefined && { description }),
      },
    });

    return NextResponse.json({ expense });
  } catch (error) {
    console.error('Expense PUT error:', error);
    return NextResponse.json({ error: 'Failed to update expense' }, { status: 500 });
  }
}

// DELETE /api/expenses?id=xxx
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    await db.expense.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Expense DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete expense' }, { status: 500 });
  }
}
