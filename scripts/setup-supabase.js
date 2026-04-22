#!/usr/bin/env node
/**
 * PS TELECOM - Supabase Database Setup Script
 * 
 * Usage:
 *   bun run scripts/setup-supabase.js <database-url>
 * 
 * Get your database URL from:
 *   https://supabase.com/dashboard/project/iwigztspqhrujaskpobn/settings/database
 * 
 * The URL format is:
 *   postgresql://postgres.iwigztspqhrujaskpobn:[YOUR-PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres
 */

const { Client } = require('pg');
const { readFileSync } = require('fs');
const { join } = require('path');

async function main() {
  const databaseUrl = process.argv[2];

  if (!databaseUrl) {
    console.log('❌ Database URL is required!');
    console.log('');
    console.log('Usage: bun run scripts/setup-supabase.js <database-url>');
    console.log('');
    console.log('Get your database URL from:');
    console.log('  https://supabase.com/dashboard/project/iwigztspqhrujaskpobn/settings/database');
    console.log('');
    console.log('The URL format is:');
    console.log('  postgresql://postgres.iwigztspqhrujaskpobn:[PASSWORD]@aws-0-[region].pooler.supabase.com:6543/postgres');
    process.exit(1);
  }

  console.log('🔌 Connecting to Supabase database...');
  
  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('✅ Connected successfully!');

    // Read the SQL schema file
    const schemaPath = join(process.cwd(), 'supabase-schema.sql');
    console.log('📄 Reading SQL schema from:', schemaPath);
    const sql = readFileSync(schemaPath, 'utf8');

    // Execute the SQL
    console.log('⚡ Creating database tables...');
    await client.query(sql);
    console.log('✅ Database schema created successfully!');

    // Verify tables
    console.log('');
    console.log('🔍 Verifying tables...');
    const tables = ['users', 'categories', 'products', 'transactions', 'cash_entries', 'expenses', 'app_settings'];
    
    for (const table of tables) {
      const result = await client.query(`SELECT to_regclass('public.${table}') as exists`);
      const exists = result.rows[0]?.exists;
      console.log(`  ${exists ? '✅' : '❌'} ${table}`);
    }

    console.log('');
    console.log('🎉 Setup complete! Your PS TELECOM app is now connected to Supabase.');
    console.log('');
    console.log('You can now start using the app at: http://localhost:3000');
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    
    if (error.message.includes('ECONNREFUSED')) {
      console.log('');
      console.log('💡 Tip: Make sure the database URL is correct and the region is right.');
      console.log('   Common regions: ap-south-1, ap-southeast-1, us-east-1, eu-west-1');
    }
    
    if (error.message.includes('authentication')) {
      console.log('');
      console.log('💡 Tip: The database password might be incorrect.');
      console.log('   You can find it in: Supabase Dashboard > Settings > Database');
    }
    
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
