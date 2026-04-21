import { NextRequest, NextResponse } from 'next/server';
import { supabase, generateId, toCamelCase, toSnakeCase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const type = searchParams.get('type');
    const productId = searchParams.get('productId');
    const date = searchParams.get('date');
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    let query = supabase
      .from('transactions')
      .select('*, product:products(*)')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (type) {
      query = query.eq('type', type);
    }

    if (productId) {
      query = query.eq('product_id', productId);
    }

    if (date) {
      query = query.eq('date', date);
    }

    if (from) {
      query = query.gte('date', from);
    }

    if (to) {
      query = query.lte('date', to);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Supabase query error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch transactions' },
        { status: 500 }
      );
    }

    const transactions = data.map((row: Record<string, unknown>) => {
      const { product, ...transactionFields } = row as Record<string, unknown>;
      const camelTransaction = toCamelCase(transactionFields);
      if (product && typeof product === 'object') {
        camelTransaction.product = toCamelCase(product as Record<string, unknown>);
      }
      return camelTransaction;
    });

    return NextResponse.json({ transactions });
  } catch (error) {
    console.error('Get transactions error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, productId, quantity, unitPrice, totalAmount, date, userId } = body;

    if (!type || !productId || !quantity || !userId) {
      return NextResponse.json(
        { error: 'Type, productId, quantity, and userId are required' },
        { status: 400 }
      );
    }

    if (!['STOCK_IN', 'STOCK_OUT', 'SELL'].includes(type)) {
      return NextResponse.json(
        { error: 'Type must be STOCK_IN, STOCK_OUT, or SELL' },
        { status: 400 }
      );
    }

    // Step 1: Fetch the product
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('*')
      .eq('id', productId)
      .single();

    if (productError || !product) {
      return NextResponse.json(
        { error: 'Product not found' },
        { status: 400 }
      );
    }

    // Step 2: Check stock if STOCK_OUT or SELL
    if ((type === 'STOCK_OUT' || type === 'SELL') && product.quantity < quantity) {
      return NextResponse.json(
        { error: 'Insufficient stock' },
        { status: 400 }
      );
    }

    // Step 3: Insert the transaction
    const transactionId = generateId();
    const quantityChange = type === 'STOCK_IN' ? quantity : -quantity;

    const { data: newTransaction, error: insertError } = await supabase
      .from('transactions')
      .insert(
        toSnakeCase({
          id: transactionId,
          type,
          productId,
          quantity,
          unitPrice: unitPrice ?? 0,
          totalAmount: totalAmount ?? 0,
          date: date || new Date().toISOString().split('T')[0],
          userId,
        })
      )
      .select('*, product:products(*)')
      .single();

    if (insertError) {
      console.error('Insert transaction error:', insertError);
      return NextResponse.json(
        { error: 'Failed to create transaction' },
        { status: 500 }
      );
    }

    // Step 4: Update the product quantity
    const { error: updateError } = await supabase
      .from('products')
      .update({ quantity: product.quantity + quantityChange })
      .eq('id', productId);

    if (updateError) {
      // Attempt to roll back the inserted transaction
      console.error('Update product quantity error:', updateError);
      await supabase.from('transactions').delete().eq('id', transactionId);
      return NextResponse.json(
        { error: 'Failed to update product stock' },
        { status: 500 }
      );
    }

    const camelTransaction = toCamelCase(newTransaction as Record<string, unknown>);
    const { product: productData, ...transactionFields } = camelTransaction as Record<string, unknown>;
    if (productData && typeof productData === 'object') {
      transactionFields.product = toCamelCase(productData as Record<string, unknown>);
    }

    return NextResponse.json({ transaction: transactionFields }, { status: 201 });
  } catch (error: unknown) {
    console.error('Create transaction error:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status = message === 'Product not found' || message === 'Insufficient stock' ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'Transaction id is required' },
        { status: 400 }
      );
    }

    // Find the existing transaction
    const { data: existing, error: findError } = await supabase
      .from('transactions')
      .select('*')
      .eq('id', id)
      .single();

    if (findError || !existing) {
      return NextResponse.json(
        { error: 'Transaction not found' },
        { status: 404 }
      );
    }

    const camelExisting = toCamelCase(existing as Record<string, unknown>);

    // Reverse the stock change
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('*')
      .eq('id', camelExisting.productId as string)
      .single();

    if (!productError && product) {
      const quantityChange =
        (camelExisting.type as string) === 'STOCK_IN'
          ? -(camelExisting.quantity as number)
          : (camelExisting.quantity as number);

      await supabase
        .from('products')
        .update({ quantity: product.quantity + quantityChange })
        .eq('id', camelExisting.productId as string);
    }

    // Delete the transaction
    const { error: deleteError } = await supabase
      .from('transactions')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error('Delete transaction error:', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete transaction' },
        { status: 500 }
      );
    }

    return NextResponse.json({ message: 'Transaction deleted successfully' });
  } catch (error) {
    console.error('Delete transaction error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
