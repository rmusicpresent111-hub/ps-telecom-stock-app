import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

// GET /api/cash-entries?userId=xxx&date=xxx&period=today|week|month&from=xxx&to=xxx
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 });

    const date = searchParams.get('date');
    const period = searchParams.get('period') || 'today';
    const from = searchParams.get('from');
    const to = searchParams.get('to');

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

    const entries = await db.cashEntry.findMany({
      where: {
        userId,
        date: { gte: startDate, lte: endDate },
      },
      orderBy: { date: 'desc' },
    });

    // Calculate totals
    const latestEntry = await db.cashEntry.findFirst({
      where: { userId },
      orderBy: { date: 'desc' },
    });

    const totalHandCash = latestEntry?.handCash || 0;
    const totalLiquidCash = latestEntry?.liquidCash || 0;

    return NextResponse.json({
      entries,
      summary: {
        totalHandCash,
        totalLiquidCash,
        totalCash: totalHandCash + totalLiquidCash,
      },
    });
  } catch (error) {
    console.error('Cash entries GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch cash entries' }, { status: 500 });
  }
}

// POST /api/cash-entries
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, date, handCash, liquidCash, note } = body;

    if (!userId || !date) {
      return NextResponse.json({ error: 'userId and date required' }, { status: 400 });
    }

    // Check if entry for this date already exists
    const existing = await db.cashEntry.findFirst({
      where: { userId, date },
    });

    let entry;
    if (existing) {
      // Update existing entry
      entry = await db.cashEntry.update({
        where: { id: existing.id },
        data: {
          handCash: handCash !== undefined ? handCash : existing.handCash,
          liquidCash: liquidCash !== undefined ? liquidCash : existing.liquidCash,
          note: note !== undefined ? note : existing.note,
        },
      });
    } else {
      // Create new entry
      entry = await db.cashEntry.create({
        data: {
          userId,
          date,
          handCash: handCash || 0,
          liquidCash: liquidCash || 0,
          note: note || '',
        },
      });
    }

    return NextResponse.json({ entry });
  } catch (error) {
    console.error('Cash entry POST error:', error);
    return NextResponse.json({ error: 'Failed to create/update cash entry' }, { status: 500 });
  }
}

// PUT /api/cash-entries
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, handCash, liquidCash, note } = body;

    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const entry = await db.cashEntry.update({
      where: { id },
      data: {
        ...(handCash !== undefined && { handCash }),
        ...(liquidCash !== undefined && { liquidCash }),
        ...(note !== undefined && { note }),
      },
    });

    return NextResponse.json({ entry });
  } catch (error) {
    console.error('Cash entry PUT error:', error);
    return NextResponse.json({ error: 'Failed to update cash entry' }, { status: 500 });
  }
}

// DELETE /api/cash-entries?id=xxx
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    await db.cashEntry.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Cash entry DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete cash entry' }, { status: 500 });
  }
}
