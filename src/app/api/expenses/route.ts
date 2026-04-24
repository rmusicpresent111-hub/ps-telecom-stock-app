import { NextRequest, NextResponse } from 'next/server';
import { supabase, generateId, toCamelCase, toSnakeCase } from '@/lib/supabase';

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

    let query = supabase
      .from('expenses')
      .select('*')
      .eq('user_id', userId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: false });

    if (category) {
      query = query.eq('category', category);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Expenses GET error:', error);
      return NextResponse.json({ error: 'Failed to fetch expenses' }, { status: 500 });
    }

    const expenses = (data || []).map(toCamelCase) as Record<string, unknown>[];

    // Calculate total
    const totalExpense = expenses.reduce((sum, e) => sum + ((e.amount as number) || 0), 0);

    // Group by category
    const byCategory = expenses.reduce<Record<string, number>>((acc, e) => {
      const cat = (e.category as string) || 'other';
      if (!acc[cat]) acc[cat] = 0;
      acc[cat] += (e.amount as number) || 0;
      return acc;
    }, {});

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

    const newExpense = {
      id: generateId(),
      userId,
      date,
      amount: parseFloat(amount),
      category: category || 'other',
      description: description || '',
    };

    const { data, error } = await supabase
      .from('expenses')
      .insert(toSnakeCase(newExpense))
      .select('*')
      .single();

    if (error) {
      console.error('Expense POST error:', error);
      return NextResponse.json({ error: 'Failed to create expense' }, { status: 500 });
    }

    return NextResponse.json({ expense: toCamelCase(data) });
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

    const updates: Record<string, unknown> = {};
    if (amount !== undefined) updates.amount = parseFloat(amount);
    if (category !== undefined) updates.category = category;
    if (description !== undefined) updates.description = description;

    const { data, error } = await supabase
      .from('expenses')
      .update(toSnakeCase(updates))
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      console.error('Expense PUT error:', error);
      return NextResponse.json({ error: 'Failed to update expense' }, { status: 500 });
    }

    return NextResponse.json({ expense: toCamelCase(data) });
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

    const { error } = await supabase
      .from('expenses')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Expense DELETE error:', error);
      return NextResponse.json({ error: 'Failed to delete expense' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Expense DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete expense' }, { status: 500 });
  }
}
