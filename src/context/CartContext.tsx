import React, { createContext, useContext, useState, useEffect } from 'react';
import { CartItem, User, Product, PromoCodeValidity, AvailablePromoCode } from '../types';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

interface ShippingAddress {
  shippingDifferent: boolean;
  shippingAddress?: string;
  shippingCity?: string;
  shippingState?: string;
  shippingZip?: string;
  shippingPhone?: string;
  shippingContactName?: string;
}

interface CartContextType {
  items: CartItem[];
  addToCart: (product: Product, quantity?: number) => void;
  removeFromCart: (partnumber: string) => void;
  updateQuantity: (partnumber: string, quantity: number) => void;
  clearCart: () => void;
  totalItems: number;
  totalPrice: number;
  placeOrder: (paymentMethod: 'credit' | 'net10', customerEmail: string, customerPhone: string, poReference?: string, specialInstructions?: string, shippingAddress?: ShippingAddress) => Promise<string>;
  // Promo code features
  applyPromoCode: (code: string, isAutoApplied?: boolean) => Promise<PromoCodeValidity>;
  removePromoCode: () => void;
  appliedPromoCode: PromoCodeValidity | null;
  availablePromoCodes: AvailablePromoCode[];
  fetchAvailablePromoCodes: () => Promise<void>;
  isLoadingPromoCodes: boolean;
  isPromoCodeAutoApplied: boolean;
}

const CartContext = createContext<CartContextType>({
  items: [],
  addToCart: () => {},
  removeFromCart: () => {},
  updateQuantity: () => {},
  clearCart: () => {},
  totalItems: 0,
  totalPrice: 0,
  placeOrder: async () => '',
  // Promo code features
  applyPromoCode: async () => ({ is_valid: false, message: '', discount_amount: 0 }),
  removePromoCode: () => {},
  appliedPromoCode: null,
  availablePromoCodes: [],
  fetchAvailablePromoCodes: async () => {},
  isLoadingPromoCodes: false,
  isPromoCodeAutoApplied: false
});

export const useCart = () => useContext(CartContext);

let nextOrderNumber = 750000; 

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [items, setItems] = useState<CartItem[]>(() => {
    // Use sessionStorage for better security (cleared when browser closes)
    const savedCart = sessionStorage.getItem('cart');
    if (savedCart) {
      try {
        const parsedItems = JSON.parse(savedCart);
        if (Array.isArray(parsedItems) && parsedItems.every(item => typeof item.partnumber === 'string' && typeof item.quantity === 'number')) {
          return parsedItems;
        }
        sessionStorage.removeItem('cart');
        return [];
      } catch (e) {
        sessionStorage.removeItem('cart');
        return [];
      }
    }
    // Also clean up any old localStorage cart data
    localStorage.removeItem('cart');
    return [];
  });

  const { user } = useAuth();
  const [appliedPromoCode, setAppliedPromoCode] = useState<PromoCodeValidity | null>(null);
  const [availablePromoCodes, setAvailablePromoCodes] = useState<AvailablePromoCode[]>([]);
  const [isLoadingPromoCodes, setIsLoadingPromoCodes] = useState<boolean>(false);
  const [isPromoCodeAutoApplied, setIsPromoCodeAutoApplied] = useState<boolean>(false);

  useEffect(() => {
    const initializeOrderNumber = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const { data, error } = await supabase.from('web_orders').select('order_number').order('order_number', { ascending: false }).limit(1).abortSignal(controller.signal);
        clearTimeout(timeoutId);
        if (error) { console.warn('Warning: Could not fetch max order number:', error.message); return; }
        if (data && data.length > 0 && data[0].order_number) { nextOrderNumber = data[0].order_number + 1; }
      } catch (e: any) { console.warn('Warning: Error fetching order number:', e.message); }
    };
    initializeOrderNumber();
  }, []);
  
  useEffect(() => {
    // Use sessionStorage for better security
    sessionStorage.setItem('cart', JSON.stringify(items));
    console.log('Cart state updated:', items);
  }, [items]);

  const totalItems = items.reduce((total, item) => total + item.quantity, 0);
  const totalPrice = items.reduce((total, item) => total + ((item.price || 0) * item.quantity), 0);

  // Fetch available promo codes - CRITICAL FIX: Use get_available_promo_codes_only to prevent showing used single-use codes
  const fetchAvailablePromoCodes = async () => {
    if (!user || !user.accountNumber) {
      setAvailablePromoCodes([]);
      return;
    }
    
    setIsLoadingPromoCodes(true);
    try {
      // CRITICAL FIX: Use the new get_available_promo_codes_only function that excludes already-used single-use codes
      const { data: availablePromos, error: queryError } = await supabase.rpc('get_available_promo_codes_only', {
        p_account_number: user.accountNumber,
        p_order_value: totalPrice
      });
      
      if (!queryError && availablePromos && availablePromos.length > 0) {
        // Convert to expected format - these are already filtered and available
        const promoCodes: AvailablePromoCode[] = availablePromos.map((promo: any) => ({
          code: promo.code,
          name: promo.name,
          description: promo.description,
          type: promo.type,
          value: promo.value,
          min_order_value: promo.min_order_value || 0,
          discount_amount: promo.discount_amount, // Already calculated by the function
          is_best: promo.is_best,
          uses_remaining_for_account: null, // Not needed for available codes
          status: 'available' // All returned codes are available
        }));
        
        setAvailablePromoCodes(promoCodes);
        console.log(`Fetched ${promoCodes.length} available promo codes for account ${user.accountNumber}`);
        return;
      }
      
      // If no available codes, set empty array
      console.log(`No available promo codes found for account ${user.accountNumber}`);
      setAvailablePromoCodes([]);
    } catch (err) {
      console.error('Error fetching available promo codes:', err);
      setAvailablePromoCodes([]);
    } finally {
      setIsLoadingPromoCodes(false);
    }
  };
  
  // Helper function to calculate discount amount
  const calculateDiscountAmount = (type: string, value: number, orderValue: number): number => {
    if (type === 'percent_off') {
      // Ensure proper decimal calculation and round to 2 decimal places
      const discount = Math.round((orderValue * value / 100) * 100) / 100;
      console.log(`Calculating ${value}% of $${orderValue} = $${discount}`);
      return discount;
    } else { // dollars_off
      return Math.min(value, orderValue);
    }
  };
  
  // Fetch promo codes when user changes or cart total changes
  useEffect(() => {
    // Add a small delay to ensure user state is fully settled after login
    const timeoutId = setTimeout(() => {
      fetchAvailablePromoCodes();
    }, 200); // Increased delay to ensure auth state is fully settled
    
    return () => clearTimeout(timeoutId);
  }, [user, totalPrice]);

  // Additional effect to ensure cart is properly initialized after login
  useEffect(() => {
    if (user && user.accountNumber) {
      console.log('CartContext: User logged in, ensuring cart is properly initialized');
      // Force a re-render to ensure all cart functions are properly bound
      const timeoutId = setTimeout(() => {
        console.log('CartContext: Cart initialization complete for user:', user.accountNumber);
      }, 300);
      
      return () => clearTimeout(timeoutId);
    }
  }, [user]);

  // Clear cart when user logs out
  useEffect(() => {
    // If user becomes null (logout), clear the cart
    if (user === null) {
      console.log('CartContext: User logged out, clearing cart');
      clearCart();
    }
  }, [user]);

  // TEMPORARILY DISABLED: Auto-apply best promo code when conditions are met (but not immediately when items change)
  // useEffect(() => {
  //   const autoApplyBestPromoCode = async () => {
  //     // Only auto-apply if:
  //     // 1. User is logged in
  //     // 2. Cart has items
  //     // 3. No promo code is currently applied
  //     // 4. Available promo codes exist
  //     // 5. Cart has been stable for a bit (not just added items)
  //     if (!user || !user.accountNumber || items.length === 0 || appliedPromoCode || availablePromoCodes.length === 0) {
  //       return;
  //     }

  //     // Find the best promo code that meets the minimum order requirement
  //     const bestPromo = availablePromoCodes.find(promo => 
  //       promo.is_best && totalPrice >= promo.min_order_value
  //     );

  //     if (bestPromo) {
  //       try {
  //         console.log('Auto-applying best promo code:', bestPromo.code);
  //         const result = await applyPromoCode(bestPromo.code, true); // Pass true for isAutoApplied
  //         if (result.is_valid) {
  //           console.log('Auto-applied promo code successfully:', bestPromo.code);
  //         }
  //       } catch (error) {
  //         console.error('Error auto-applying promo code:', error);
  //       }
  //     }
  //   };

  //   // Add a longer delay to avoid interfering with cart operations
  //   const timeoutId = setTimeout(autoApplyBestPromoCode, 2000);
  //   return () => clearTimeout(timeoutId);
  // }, [availablePromoCodes, appliedPromoCode, user]); // Removed items.length and totalPrice dependencies

  const addToCart = (product: Product, quantity: number = 1) => {
    console.log('CartContext: Adding to cart:', product.partnumber, 'quantity:', quantity);
    
    // Validate product data before adding
    if (!product.partnumber) {
      console.error('CartContext: Cannot add product without partnumber');
      return;
    }
    
    // Use functional update with immediate logging
    setItems(prevItems => {
      const existingItem = prevItems.find(item => item.partnumber === product.partnumber);
      
      let newItems;
      if (existingItem) {
        console.log('CartContext: Updating existing item quantity');
        newItems = prevItems.map(item => 
          item.partnumber === product.partnumber 
            ? { ...item, quantity: item.quantity + quantity } 
            : item
        );
      } else {
        console.log('CartContext: Adding new item to cart');
        newItems = [...prevItems, { 
          ...product, 
          inventory: product.inventory ?? null, 
          price: product.price ?? 0, 
          quantity 
        }];
      }
      
      console.log('CartContext: Cart updated, new item count:', newItems.length);
      return newItems;
    });
  };

  const removeFromCart = (partnumber: string) => setItems(prevItems => prevItems.filter(item => item.partnumber !== partnumber));
  const updateQuantity = (partnumber: string, quantity: number) => {
    if (quantity <= 0) { removeFromCart(partnumber); return; }
    setItems(prevItems => prevItems.map(item => item.partnumber === partnumber ? { ...item, quantity } : item));
  };
  const clearCart = () => { 
    setItems([]); 
    // Clear from both storages for safety
    sessionStorage.removeItem('cart');
    localStorage.removeItem('cart');
    setAppliedPromoCode(null); // Also clear any applied promo code when clearing the cart
  };
  
  // Apply a promo code to the cart
  const applyPromoCode = async (code: string, isAutoApplied: boolean = false): Promise<PromoCodeValidity> => {
    if (!user || !user.accountNumber) {
      return { 
        is_valid: false, 
        message: 'You must be logged in to apply a promo code' 
      };
    }
    
    try {
      console.log('Applying promo code:', code, 'for account:', user.accountNumber, 'order value:', totalPrice, 'auto-applied:', isAutoApplied);
      
      // Call the database function to check if the promo code is valid
      const { data, error } = await supabase.rpc('check_promo_code_validity', {
        p_code: code,
        p_account_number: user.accountNumber,
        p_order_value: totalPrice
      });
      
      if (error) {
        console.error('Supabase RPC error:', error);
        throw error;
      }
      
      console.log('Raw response from database:', data);
      
      // The database function returns an array with a single object
      const result = Array.isArray(data) ? data[0] : data;
      
      console.log('Processed result:', result);
      
      if (result && result.is_valid) {
        // Customize the message based on whether it was auto-applied
        const customizedResult = {
          ...result,
          message: isAutoApplied 
            ? `Promo code ${code} has been automatically applied`
            : result.message,
          // Ensure discount_amount is properly parsed as a number
          discount_amount: result.discount_amount ? parseFloat(result.discount_amount.toString()) : 0
        };
        
        setAppliedPromoCode(customizedResult);
        setIsPromoCodeAutoApplied(isAutoApplied);
        console.log('Promo code applied successfully:', customizedResult);
        
        return customizedResult;
      } else {
        setAppliedPromoCode(null);
        setIsPromoCodeAutoApplied(false);
        console.log('Promo code validation failed:', result?.message);
      }
      
      return result || { is_valid: false, message: 'No response from server' };
    } catch (err: any) {
      console.error('Error applying promo code:', err);
      return { 
        is_valid: false, 
        message: 'An error occurred while applying the promo code' 
      };
    }
  };
  
  // Remove the applied promo code
  const removePromoCode = () => {
    setAppliedPromoCode(null);
  };

  const placeOrder = async (paymentMethod: 'credit' | 'net10', customerEmail: string, customerPhone: string, poReference?: string, specialInstructions?: string, shippingAddress?: ShippingAddress): Promise<string> => {
    const orderNumberGenerated = `WB${nextOrderNumber++}`;
    const orderNumberForDb = parseInt(orderNumberGenerated.slice(2));
    
    if (!user || !user.accountNumber) {
      console.error('Place Order: User or account number is not available.');
      throw new Error('User not authenticated or account number missing.');
    }
    
    // Log user details for debugging
    console.log('Place Order: User validation - accountNumber:', user.accountNumber, 'id:', user.id, 'typeof id:', typeof user.id);
    
    const accountNumberInt = parseInt(user.accountNumber, 10);
    if (isNaN(accountNumberInt)) { throw new Error('Invalid user account number format.'); }

    let discountPartNumber: string | null = null;
    let discountDescription: string | null = null;
    let finalDiscountAmount = 0;
    let appliedDiscountRate = 0; // This will be a fraction, e.g., 0.05 for 5%
    let orderComments = `Payment Method: ${paymentMethod}. Customer Email: ${customerEmail}, Phone: ${customerPhone}`;
    let promoCodeUsedInThisOrder = false;

    // Apply Promo Code discount if available
    if (appliedPromoCode && appliedPromoCode.is_valid && appliedPromoCode.discount_amount && items.length > 0) {
      finalDiscountAmount = appliedPromoCode.discount_amount;
      discountPartNumber = `PROMO-${appliedPromoCode.promo_id?.slice(0, 8)}`;
      discountDescription = `Promo Code Discount: ${appliedPromoCode.message}`;
      orderComments += ` | ${discountDescription} ($${finalDiscountAmount.toFixed(2)})`;
      promoCodeUsedInThisOrder = true;
    }

    const orderItems = items.map(item => ({ 
      partnumber: item.partnumber, description: item.description, quantity: item.quantity, 
      price: item.price || 0, extended_price: (item.price || 0) * item.quantity
    }));

    // Only add discount item if it's from a promo code
    if (promoCodeUsedInThisOrder && discountPartNumber && finalDiscountAmount > 0) {
      orderItems.push({
        partnumber: discountPartNumber, description: discountDescription || 'Promo Code Discount',
        quantity: 1, price: -finalDiscountAmount, extended_price: -finalDiscountAmount
      });
    }

    // Add special line items at the end (per requirements)
    // Add PO Reference if provided
    if (poReference && poReference.trim()) {
      orderItems.push({
        partnumber: 'PO',
        description: `Customer PO: ${poReference.trim()}`,
        quantity: 1,
        price: 0,
        extended_price: 0
      });
    }

    // Add Special Instructions if provided
    if (specialInstructions && specialInstructions.trim()) {
      orderItems.push({
        partnumber: 'COMMENT',
        description: specialInstructions.trim(),
        quantity: 1,
        price: 0,
        extended_price: 0
      });
    }

    const grandTotal = totalPrice - finalDiscountAmount;
    const orderPayload = {
      order_number: orderNumberForDb, account_number: accountNumberInt, order_comments: orderComments,
      order_items: orderItems, subtotal: totalPrice, 
      discount_percentage: 0, // No percentage discounts, only fixed amount promo codes
      discount_amount: finalDiscountAmount, grand_total: grandTotal, status: 'Pending Confirmation',
      // Include shipping address fields if provided
      ...(shippingAddress?.shippingDifferent && {
        shipped_to_address: shippingAddress.shippingAddress,
        shipped_to_city: shippingAddress.shippingCity,
        shipped_to_state: shippingAddress.shippingState,
        shipped_to_zip: shippingAddress.shippingZip,
        shipped_to_phone: shippingAddress.shippingPhone,
        shipped_to_contact_name: shippingAddress.shippingContactName
      })
    };

    try {
      const { data: insertedOrder, error: insertError } = await supabase.from('web_orders').insert(orderPayload).select('id').single();
      if (insertError || !insertedOrder) throw insertError || new Error('Failed to save order.');
      
      console.log('Order saved successfully:', insertedOrder);

      // Record promo code usage if applicable
      if (promoCodeUsedInThisOrder && appliedPromoCode && appliedPromoCode.promo_id) {
        try {
          console.log(`Recording promo code usage for account: ${accountNumberInt}, order ID: ${insertedOrder.id}`);
          await supabase.rpc('record_promo_code_usage', {
            p_promo_id: appliedPromoCode.promo_id,
            p_account_number: user.accountNumber,
            p_order_id: insertedOrder.id,
            p_order_value: totalPrice,
            p_discount_amount: appliedPromoCode.discount_amount || 0
          });
          console.log('Promo code usage recorded.');
          // Clear the applied promo code after successful order
          setAppliedPromoCode(null);
        } catch (promoCodeUsageError) {
          console.error('Error recording promo code usage:', promoCodeUsageError);
        }
      }
      
      clearCart();
      return orderNumberGenerated;
    } catch (error: any) {
      console.error('Order placement error:', error);
      throw new Error(error.message || 'An unexpected error occurred while placing the order.');
    }
  };


  return (
    <CartContext.Provider value={{
      items, addToCart, removeFromCart, updateQuantity, clearCart,
      totalItems, totalPrice, placeOrder,
      applyPromoCode, removePromoCode, appliedPromoCode,
      availablePromoCodes, fetchAvailablePromoCodes, isLoadingPromoCodes,
      isPromoCodeAutoApplied
    }}>
      {children}
    </CartContext.Provider>
  );
};
