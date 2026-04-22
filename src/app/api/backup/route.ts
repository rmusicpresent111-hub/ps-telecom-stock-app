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

    const { data: categories, error: catError } = await supabase
      .from('categories')
      .select('*')
      .eq('user_id', userId);

    if (catError) {
      console.error('Export backup categories error:', catError);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    const { data: products, error: prodError } = await supabase
      .from('products')
      .select('*')
      .eq('user_id', userId);

    if (prodError) {
      console.error('Export backup products error:', prodError);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    const { data: transactions, error: txError } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId);

    if (txError) {
      console.error('Export backup transactions error:', txError);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }

    const backup = {
      exportDate: new Date().toISOString(),
      userId,
      categories: (categories || []).map(toCamelCase),
      products: (products || []).map(toCamelCase),
      transactions: (transactions || []).map(toCamelCase),
    };

    return NextResponse.json(backup);
  } catch (error) {
    console.error('Export backup error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId, categories, products, transactions } = body;

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    // Verify user exists
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Import categories
    if (categories && Array.isArray(categories)) {
      for (const cat of categories) {
        const catData = toSnakeCase({
          id: cat.id,
          name: cat.name,
          image: cat.image ?? '',
          userId,
        });

        // Try insert first
        const { error: insertError } = await supabase
          .from('categories')
          .insert(catData)
          .select('*')
          .single();

        if (insertError) {
          // If conflict (duplicate key), try update instead
          const { error: updateError } = await supabase
            .from('categories')
            .update({ name: catData.name, image: catData.image })
            .eq('id', catData.id)
            .select('*')
            .single();

          if (updateError) {
            console.error('Category import update error:', updateError);
          }
        }
      }
    }

    // Import products
    if (products && Array.isArray(products)) {
      for (const prod of products) {
        const prodData = toSnakeCase({
          id: prod.id,
          name: prod.name,
          categoryId: prod.categoryId,
          quantity: prod.quantity ?? 0,
          boxNumber: prod.boxNumber ?? '',
          purchasePrice: prod.purchasePrice ?? 0,
          sellingPrice: prod.sellingPrice ?? 0,
          lowStockThreshold: prod.lowStockThreshold ?? 5,
          userId,
        });

        // Try insert first
        const { error: insertError } = await supabase
          .from('products')
          .insert(prodData)
          .select('*')
          .single();

        if (insertError) {
          // If conflict, try update instead
          const updateFields = toSnakeCase({
            name: prod.name,
            categoryId: prod.categoryId,
            quantity: prod.quantity ?? 0,
            boxNumber: prod.boxNumber ?? '',
            purchasePrice: prod.purchasePrice ?? 0,
            sellingPrice: prod.sellingPrice ?? 0,
            lowStockThreshold: prod.lowStockThreshold ?? 5,
          });

          const { error: updateError } = await supabase
            .from('products')
            .update(updateFields)
            .eq('id', prodData.id)
            .select('*')
            .single();

          if (updateError) {
            console.error('Product import update error:', updateError);
          }
        }
      }
    }

    // Import transactions
    if (transactions && Array.isArray(transactions)) {
      for (const tran of transactions) {
        const tranData = toSnakeCase({
          id: tran.id,
          type: tran.type,
          productId: tran.productId,
          quantity: tran.quantity,
          unitPrice: tran.unitPrice ?? 0,
          totalAmount: tran.totalAmount ?? 0,
          date: tran.date,
          userId,
        });

        // Try insert first
        const { error: insertError } = await supabase
          .from('transactions')
          .insert(tranData)
          .select('*')
          .single();

        if (insertError) {
          // If conflict, try update instead
          const updateFields = toSnakeCase({
            type: tran.type,
            quantity: tran.quantity,
            unitPrice: tran.unitPrice ?? 0,
            totalAmount: tran.totalAmount ?? 0,
            date: tran.date,
          });

          const { error: updateError } = await supabase
            .from('transactions')
            .update(updateFields)
            .eq('id', tranData.id)
            .select('*')
            .single();

          if (updateError) {
            console.error('Transaction import update error:', updateError);
          }
        }
      }
    }

    return NextResponse.json({
      message: 'Data imported successfully',
      imported: {
        categories: categories?.length ?? 0,
        products: products?.length ?? 0,
        transactions: transactions?.length ?? 0,
      },
    });
  } catch (error) {
    console.error('Import backup error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    // Verify user exists
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // Delete all user data in correct order (transactions first, then products, then categories)
    await supabase.from('transactions').delete().eq('user_id', userId);
    await supabase.from('products').delete().eq('user_id', userId);
    await supabase.from('categories').delete().eq('user_id', userId);

    return NextResponse.json({ message: 'All data reset successfully' });
  } catch (error) {
    console.error('Reset data error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
