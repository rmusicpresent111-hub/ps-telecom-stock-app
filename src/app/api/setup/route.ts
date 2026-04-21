import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// POST /api/setup - Initialize Supabase database tables
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { setupKey } = body;

    // Simple security check
    if (setupKey !== 'ps-telecom-setup-2025') {
      return NextResponse.json({ error: 'Invalid setup key' }, { status: 403 });
    }

    // Test connection by trying to select from users table
    const { error: testError } = await supabase.from('users').select('id').limit(1);

    if (testError) {
      return NextResponse.json({
        status: 'needs_sql_setup',
        message: 'Database tables not found. Please run the SQL schema in your Supabase Dashboard.',
        instructions: [
          '1. Go to https://supabase.com/dashboard',
          '2. Select your project (PS TELECOM)',
          '3. Click "SQL Editor" in the left sidebar',
          '4. Copy and paste the contents of supabase-schema.sql',
          '5. Click "Run" to execute',
          '6. Then call this API again to verify',
        ],
        sqlFilePath: 'supabase-schema.sql',
      }, { status: 200 });
    }

    return NextResponse.json({
      status: 'ready',
      message: 'Supabase database is connected and tables exist!',
    });
  } catch (error) {
    console.error('Setup error:', error);
    return NextResponse.json(
      { error: 'Setup failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

// GET /api/setup - Check database connection status
export async function GET() {
  try {
    const tables: Record<string, boolean> = {};

    const { error: usersError } = await supabase.from('users').select('id').limit(1);
    tables.users = !usersError;

    const { error: catError } = await supabase.from('categories').select('id').limit(1);
    tables.categories = !catError;

    const { error: prodError } = await supabase.from('products').select('id').limit(1);
    tables.products = !prodError;

    const { error: txnError } = await supabase.from('transactions').select('id').limit(1);
    tables.transactions = !txnError;

    const { error: cashError } = await supabase.from('cash_entries').select('id').limit(1);
    tables.cash_entries = !cashError;

    const { error: expError } = await supabase.from('expenses').select('id').limit(1);
    tables.expenses = !expError;

    const allReady = Object.values(tables).every(v => v);

    return NextResponse.json({
      status: allReady ? 'ready' : 'needs_setup',
      tables,
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ? 'configured' : 'default',
    });
  } catch (error) {
    console.error('Setup check error:', error);
    return NextResponse.json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
    }
}
