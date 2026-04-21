import { NextRequest, NextResponse } from 'next/server';
import { supabase, generateId, toCamelCase, toSnakeCase } from '@/lib/supabase';

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

    const { data: entries, error } = await supabase
      .from('cash_entries')
      .select('*')
      .eq('user_id', userId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: false });

    if (error) {
      console.error('Cash entries GET error:', error);
      return NextResponse.json({ error: 'Failed to fetch cash entries' }, { status: 500 });
    }

    const camelEntries = (entries || []).map(toCamelCase);

    // Get latest entry for totals
    const { data: latestEntry } = await supabase
      .from('cash_entries')
      .select('*')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(1);

    const latest = latestEntry && latestEntry.length > 0 ? toCamelCase(latestEntry[0]) : null;
    const totalHandCash = (latest?.handCash as number) || 0;
    const totalLiquidCash = (latest?.liquidCash as number) || 0;

    return NextResponse.json({
      entries: camelEntries,
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
    const { data: existingRows } = await supabase
      .from('cash_entries')
      .select('*')
      .eq('user_id', userId)
      .eq('date', date);

    let entry;
    if (existingRows && existingRows.length > 0) {
      // Update existing entry
      const existing = toCamelCase(existingRows[0]);
      const updates: Record<string, unknown> = {};
      if (handCash !== undefined) updates.handCash = handCash;
      else updates.handCash = existing.handCash;
      if (liquidCash !== undefined) updates.liquidCash = liquidCash;
      else updates.liquidCash = existing.liquidCash;
      if (note !== undefined) updates.note = note;
      else updates.note = existing.note;

      const { data, error } = await supabase
        .from('cash_entries')
        .update(toSnakeCase(updates))
        .eq('id', existing.id)
        .select('*')
        .single();

      if (error) {
        console.error('Cash entry update error:', error);
        return NextResponse.json({ error: 'Failed to update cash entry' }, { status: 500 });
      }
      entry = toCamelCase(data);
    } else {
      // Create new entry
      const newEntry = {
        id: generateId(),
        userId,
        date,
        handCash: handCash || 0,
        liquidCash: liquidCash || 0,
        note: note || '',
      };

      const { data, error } = await supabase
        .from('cash_entries')
        .insert(toSnakeCase(newEntry))
        .select('*')
        .single();

      if (error) {
        console.error('Cash entry create error:', error);
        return NextResponse.json({ error: 'Failed to create cash entry' }, { status: 500 });
      }
      entry = toCamelCase(data);
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

    const updates: Record<string, unknown> = {};
    if (handCash !== undefined) updates.handCash = handCash;
    if (liquidCash !== undefined) updates.liquidCash = liquidCash;
    if (note !== undefined) updates.note = note;

    const { data, error } = await supabase
      .from('cash_entries')
      .update(toSnakeCase(updates))
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      console.error('Cash entry PUT error:', error);
      return NextResponse.json({ error: 'Failed to update cash entry' }, { status: 500 });
    }

    return NextResponse.json({ entry: toCamelCase(data) });
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

    const { error } = await supabase
      .from('cash_entries')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Cash entry DELETE error:', error);
      return NextResponse.json({ error: 'Failed to delete cash entry' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Cash entry DELETE error:', error);
    return NextResponse.json({ error: 'Failed to delete cash entry' }, { status: 500 });
  }
}
