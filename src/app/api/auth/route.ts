import { NextRequest, NextResponse } from 'next/server';
import { supabase, generateId, toCamelCase, toSnakeCase } from '@/lib/supabase';
import { hashPassword, verifyPassword } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .single();

    if (error || !data) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    const user = toCamelCase(data);

    if (!verifyPassword(password, user.password as string)) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    const { password: _, ...userWithoutPassword } = user;
    return NextResponse.json({ user: userWithoutPassword });
  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, email, password, shopName } = body;

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: 'Name, email, and password are required' },
        { status: 400 }
      );
    }

    const { data: existingData, error: lookupError } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .single();

    if (existingData) {
      return NextResponse.json(
        { error: 'Email already exists' },
        { status: 409 }
      );
    }

    const hashedPassword = hashPassword(password);

    const now = new Date().toISOString();
    const snakeCaseData = toSnakeCase({
      id: generateId(),
      name,
      email,
      password: hashedPassword,
      shopName: shopName || 'PS TELECOM',
      createdAt: now,
      updatedAt: now,
    });

    const { data, error } = await supabase
      .from('users')
      .insert(snakeCaseData)
      .select('*')
      .single();

    if (error) {
      console.error('Supabase insert error:', error);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    const user = toCamelCase(data);
    const { password: _, ...userWithoutPassword } = user;
    return NextResponse.json({ user: userWithoutPassword }, { status: 201 });
  } catch (error) {
    console.error('Signup error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
