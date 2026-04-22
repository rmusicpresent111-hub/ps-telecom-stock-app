import { NextRequest, NextResponse } from 'next/server';
import { supabase, generateId, toCamelCase, toSnakeCase } from '@/lib/supabase';

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

    const { data: categories, error: categoriesError } = await supabase
      .from('categories')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (categoriesError) {
      console.error('Get categories error:', categoriesError);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    const { data: productCounts, error: productCountsError } = await supabase
      .from('products')
      .select('category_id')
      .eq('user_id', userId);

    if (productCountsError) {
      console.error('Get product counts error:', productCountsError);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    const countMap: Record<string, number> = {};
    for (const row of productCounts ?? []) {
      const catId = row.category_id;
      countMap[catId] = (countMap[catId] ?? 0) + 1;
    }

    const result = (categories ?? []).map((cat) => ({
      ...toCamelCase(cat),
      _count: { products: countMap[cat.id] ?? 0 },
    }));

    return NextResponse.json({ categories: result }, {
      headers: { 'Cache-Control': 'private, max-age=60, stale-while-revalidate=120' },
    });
  } catch (error) {
    console.error('Get categories error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, image, userId } = body;

    if (!name || !userId) {
      return NextResponse.json(
        { error: 'Name and userId are required' },
        { status: 400 }
      );
    }

    const id = generateId();
    const { data, error } = await supabase
      .from('categories')
      .insert(
        toSnakeCase({
          id,
          name,
          image: image || '',
          userId,
        })
      )
      .select()
      .single();

    if (error) {
      console.error('Create category error:', error);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    const category = {
      ...toCamelCase(data),
      _count: { products: 0 },
    };

    return NextResponse.json({ category }, { status: 201 });
  } catch (error) {
    console.error('Create category error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, name, image } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'Category id is required' },
        { status: 400 }
      );
    }

    const { data: existing, error: findError } = await supabase
      .from('categories')
      .select('*')
      .eq('id', id)
      .single();

    if (findError || !existing) {
      return NextResponse.json(
        { error: 'Category not found' },
        { status: 404 }
      );
    }

    const updateData: Record<string, string> = {};
    if (name !== undefined) updateData.name = name;
    if (image !== undefined) updateData.image = image;

    const { data, error } = await supabase
      .from('categories')
      .update(toSnakeCase(updateData))
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Update category error:', error);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    // Fetch product count for this category
    const { count, error: countError } = await supabase
      .from('products')
      .select('*', { count: 'exact', head: true })
      .eq('category_id', id);

    if (countError) {
      console.error('Get product count error:', countError);
    }

    const category = {
      ...toCamelCase(data),
      _count: { products: count ?? 0 },
    };

    return NextResponse.json({ category });
  } catch (error) {
    console.error('Update category error:', error);
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
        { error: 'Category id is required' },
        { status: 400 }
      );
    }

    const { data: existing, error: findError } = await supabase
      .from('categories')
      .select('*')
      .eq('id', id)
      .single();

    if (findError || !existing) {
      return NextResponse.json(
        { error: 'Category not found' },
        { status: 404 }
      );
    }

    const { error } = await supabase
      .from('categories')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Delete category error:', error);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    return NextResponse.json({ message: 'Category deleted successfully' });
  } catch (error) {
    console.error('Delete category error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
