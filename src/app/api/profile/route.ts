import { NextRequest, NextResponse } from 'next/server';
import { supabase, toCamelCase, toSnakeCase } from '@/lib/supabase';

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

    const { data, error } = await supabase
      .from('users')
      .select('id, email, name, shop_name, role, language, theme, created_at, updated_at')
      .eq('id', userId)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    const user = toCamelCase(data);
    return NextResponse.json({ user });
  } catch (error) {
    console.error('Get profile error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, shopName, language, theme } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'User id is required' },
        { status: 400 }
      );
    }

    // Check if user exists
    const { data: existing, error: findError } = await supabase
      .from('users')
      .select('id')
      .eq('id', id)
      .single();

    if (findError || !existing) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (shopName !== undefined) updates.shopName = shopName;
    if (language !== undefined) updates.language = language;
    if (theme !== undefined) updates.theme = theme;

    const { data, error } = await supabase
      .from('users')
      .update(toSnakeCase(updates))
      .eq('id', id)
      .select('id, email, name, shop_name, role, language, theme, created_at, updated_at')
      .single();

    if (error) {
      console.error('Update profile error:', error);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    const user = toCamelCase(data);
    return NextResponse.json({ user });
  } catch (error) {
    console.error('Update profile error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'User id is required' },
        { status: 400 }
      );
    }

    // Check if user exists
    const { data: existing, error: findError } = await supabase
      .from('users')
      .select('id')
      .eq('id', id)
      .single();

    if (findError || !existing) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Delete related data first (in correct order), then delete user
    await supabase.from('transactions').delete().eq('user_id', id);
    await supabase.from('products').delete().eq('user_id', id);
    await supabase.from('categories').delete().eq('user_id', id);
    await supabase.from('cash_entries').delete().eq('user_id', id);
    await supabase.from('expenses').delete().eq('user_id', id);
    await supabase.from('users').delete().eq('id', id);

    return NextResponse.json({ message: 'User account deleted successfully' });
  } catch (error) {
    console.error('Delete profile error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
