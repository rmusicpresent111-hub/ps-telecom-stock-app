import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { readFileSync } from 'fs';
import { join } from 'path';

// POST /api/setup/database - Create all Supabase tables using SQL schema
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { databaseUrl, setupKey } = body;

    // Security check
    if (setupKey !== 'ps-telecom-setup-2025') {
      return NextResponse.json({ error: 'Invalid setup key' }, { status: 403 });
    }

    // Method 1: Try using pg module with direct database URL
    if (databaseUrl) {
      try {
        const { Client } = await import('pg');
        const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
        await client.connect();

        // Read the SQL schema file
        const schemaPath = join(process.cwd(), 'supabase-schema.sql');
        const sql = readFileSync(schemaPath, 'utf8');

        await client.query(sql);
        await client.end();

        return NextResponse.json({
          success: true,
          method: 'direct_connection',
          message: 'Database schema created successfully using direct PostgreSQL connection!',
        });
      } catch (pgError) {
        console.error('Direct DB connection error:', pgError);
        return NextResponse.json({
          success: false,
          method: 'direct_connection',
          error: pgError instanceof Error ? pgError.message : 'Failed to connect to database',
          hint: 'Make sure the DATABASE_URL is correct and accessible. You can also run the SQL manually in the Supabase Dashboard.',
        }, { status: 500 });
      }
    }

    // Method 2: Check if tables already exist via REST API
    const tables: Record<string, boolean> = {};
    const tableNames = ['users', 'categories', 'products', 'transactions', 'cash_entries', 'expenses', 'app_settings'];

    for (const table of tableNames) {
      const { error } = await supabase.from(table).select('id').limit(1);
      tables[table] = !error;
    }

    const allExist = Object.values(tables).every(v => v);

    if (allExist) {
      return NextResponse.json({
        success: true,
        method: 'already_exists',
        message: 'All database tables already exist!',
        tables,
      });
    }

    // Tables don't exist and no database URL provided
    // Return the SQL schema for manual setup
    const schemaPath = join(process.cwd(), 'supabase-schema.sql');
    const sql = readFileSync(schemaPath, 'utf8');

    return NextResponse.json({
      success: false,
      method: 'manual_setup_required',
      message: 'Database tables not found. Please run the SQL schema manually.',
      tables,
      sql,
      instructions: [
        '1. Go to https://supabase.com/dashboard/project/iwigztspqhrujaskpobn/sql',
        '2. Click "New Query" in the SQL Editor',
        '3. Copy and paste the SQL schema from the response',
        '4. Click "Run" to execute the SQL',
        '5. Come back and click "Check Connection" to verify',
      ],
      dashboardUrl: 'https://supabase.com/dashboard/project/iwigztspqhrujaskpobn/sql',
    });
  } catch (error) {
    console.error('Database setup error:', error);
    return NextResponse.json(
      { error: 'Setup failed', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
