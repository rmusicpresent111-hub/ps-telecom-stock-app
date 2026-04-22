import { NextRequest, NextResponse } from 'next/server';
import { supabase, generateId, toCamelCase, toSnakeCase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const categoryId = searchParams.get('categoryId');
    const search = searchParams.get('search');

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    let query = supabase
      .from('products')
      .select('*, category:categories(*)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (categoryId) {
      query = query.eq('category_id', categoryId);
    }

    if (search) {
      query = query.ilike('name', `%${search}%`);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Get products Supabase error:', error);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    const products = (data || []).map((product: Record<string, unknown>) => {
      const { category, ...productFields } = product as Record<string, unknown>;
      const camelProduct = toCamelCase(productFields as Record<string, unknown>);
      if (category && typeof category === 'object') {
        camelProduct.category = toCamelCase(category as Record<string, unknown>);
      }
      return camelProduct;
    });

    return NextResponse.json({ products });
  } catch (error) {
    console.error('Get products error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      name,
      categoryId,
      quantity,
      boxNumber,
      purchasePrice,
      sellingPrice,
      lowStockThreshold,
      userId,
    } = body;

    if (!name || !categoryId || !userId) {
      return NextResponse.json(
        { error: 'Name, categoryId, and userId are required' },
        { status: 400 }
      );
    }

    const id = generateId();
    const now = new Date().toISOString();

    const snakeData = toSnakeCase({
      id,
      name,
      categoryId,
      quantity: quantity ?? 0,
      boxNumber: boxNumber ?? '',
      purchasePrice: purchasePrice ?? 0,
      sellingPrice: sellingPrice ?? 0,
      lowStockThreshold: lowStockThreshold ?? 5,
      userId,
      createdAt: now,
      updatedAt: now,
    });

    const { data, error } = await supabase
      .from('products')
      .insert(snakeData)
      .select('*, category:categories(*)')
      .single();

    if (error) {
      console.error('Create product Supabase error:', error);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    const { category, ...productFields } = data as Record<string, unknown>;
    const product = toCamelCase(productFields as Record<string, unknown>);
    if (category && typeof category === 'object') {
      product.category = toCamelCase(category as Record<string, unknown>);
    }

    return NextResponse.json({ product }, { status: 201 });
  } catch (error) {
    console.error('Create product error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      id,
      name,
      categoryId,
      quantity,
      boxNumber,
      purchasePrice,
      sellingPrice,
      lowStockThreshold,
    } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'Product id is required' },
        { status: 400 }
      );
    }

    const { data: existing, error: findError } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .single();

    if (findError || !existing) {
      return NextResponse.json(
        { error: 'Product not found' },
        { status: 404 }
      );
    }

    const updateFields: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };
    if (name !== undefined) updateFields.name = name;
    if (categoryId !== undefined) updateFields.categoryId = categoryId;
    if (quantity !== undefined) updateFields.quantity = quantity;
    if (boxNumber !== undefined) updateFields.boxNumber = boxNumber;
    if (purchasePrice !== undefined) updateFields.purchasePrice = purchasePrice;
    if (sellingPrice !== undefined) updateFields.sellingPrice = sellingPrice;
    if (lowStockThreshold !== undefined) updateFields.lowStockThreshold = lowStockThreshold;

    const snakeUpdate = toSnakeCase(updateFields);

    const { data, error } = await supabase
      .from('products')
      .update(snakeUpdate)
      .eq('id', id)
      .select('*, category:categories(*)')
      .single();

    if (error) {
      console.error('Update product Supabase error:', error);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    const { category, ...productFields } = data as Record<string, unknown>;
    const product = toCamelCase(productFields as Record<string, unknown>);
    if (category && typeof category === 'object') {
      product.category = toCamelCase(category as Record<string, unknown>);
    }

    return NextResponse.json({ product });
  } catch (error) {
    console.error('Update product error:', error);
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
        { error: 'Product id is required' },
        { status: 400 }
      );
    }

    const { data: existing, error: findError } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .single();

    if (findError || !existing) {
      return NextResponse.json(
        { error: 'Product not found' },
        { status: 404 }
      );
    }

    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Delete product Supabase error:', error);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    return NextResponse.json({ message: 'Product deleted successfully' });
  } catch (error) {
    console.error('Delete product error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
