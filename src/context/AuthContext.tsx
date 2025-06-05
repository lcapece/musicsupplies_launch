                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          import React, { createContext, useContext, useState, useEffect } from 'react';
import { User } from '../types';
import { supabase } from '../lib/supabase';

interface ActiveDiscountInfo { // This might be deprecated or repurposed if only max discount is used
  message: string;
  startDate: string;
  endDate: string;
  percentage: number | null;
}

interface DiscountInfo {
  rate: number;
  type: 'date_based' | 'order_based';
  message?: string;
  source: string; // Description of discount source
}

interface AuthContextType {
  user: User | null;
  login: (accountNumber: string, password: string) => Promise<boolean>;
  logout: () => void;
  isAuthenticated: boolean;
  isLoading: boolean; 
  error: string | null;
  fetchUserAccount: (accountNumber: string) => Promise<User | null>; 
  maxDiscountRate: number | null; // New: for the highest eligible discount rate
  currentDiscountInfo: DiscountInfo | null; // Information about the applied discount
  // activeDiscount: ActiveDiscountInfo | null; // Potentially remove if maxDiscountRate replaces its calculation role
  // showActiveDiscountModal: boolean; // Potentially remove
  // clearActiveDiscount: () => void; // Potentially remove
  showPasswordChangeModal: boolean; 
  openPasswordChangeModal: () => void; 
  handlePasswordModalClose: (wasSuccess: boolean) => void; 
  showDiscountFormModal: boolean; 
  openDiscountFormModal: () => void; 
  closeDiscountFormModal: () => void; 
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  login: async () => false,
  logout: () => {},
  isAuthenticated: false,
  isLoading: true, 
  error: null,
  fetchUserAccount: async () => null, 
  maxDiscountRate: null, // New
  currentDiscountInfo: null,
  // activeDiscount: null,
  // showActiveDiscountModal: false,
  // clearActiveDiscount: () => {},
  showPasswordChangeModal: false,
  openPasswordChangeModal: () => {},
  handlePasswordModalClose: () => {}, // Default empty fn
  showDiscountFormModal: false,
  openDiscountFormModal: () => {},
  closeDiscountFormModal: () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true); 
  // const [activeDiscount, setActiveDiscount] = useState<ActiveDiscountInfo | null>(null); // Old discount state
  // const [showActiveDiscountModal, setShowActiveDiscountModal] = useState<boolean>(false); // Old discount modal state
  const [maxDiscountRate, setMaxDiscountRate] = useState<number | null>(null); // New state for max discount rate
  const [currentDiscountInfo, setCurrentDiscountInfo] = useState<DiscountInfo | null>(null);
  const [showPasswordChangeModal, setShowPasswordChangeModal] = useState<boolean>(false);
  const [showDiscountFormModal, setShowDiscountFormModal] = useState<boolean>(false);

  // Function to calculate the highest eligible discount for a user
  const calculateBestDiscount = async (accountNumber: string): Promise<void> => {
    try {
      const accountNumberInt = parseInt(accountNumber, 10);
      if (isNaN(accountNumberInt)) {
        console.log('[AuthContext] Invalid account number for discount calculation');
        setMaxDiscountRate(null);
        setCurrentDiscountInfo(null);
        return;
      }

      // 1. Fetch active date-based discounts
      const { data: dateDiscounts, error: dateError } = await supabase
        .from('lcmd_discount')
        .select('discount, promo_message')
        .eq('is_active', true)
        .lte('start_date', new Date().toISOString().split('T')[0])
        .gte('end_date', new Date().toISOString().split('T')[0]);

      if (dateError) {
        console.error('[AuthContext] Error fetching date-based discounts:', dateError);
      }

      // 2. Fetch order-based discounts and customer usage
      const { data: orderDiscounts, error: orderError } = await supabase
        .from('discount_tiers')
        .select('id, discount, max_orders, discount_type')
        .eq('discount_type', 'order_based');

      if (orderError) {
        console.error('[AuthContext] Error fetching order-based discounts:', orderError);
      }

      // 3. For each order-based discount, check customer usage
      const eligibleOrderDiscounts = [];
      if (orderDiscounts && orderDiscounts.length > 0) {
        for (const orderDiscount of orderDiscounts) {
          const { data: usage, error: usageError } = await supabase
            .from('account_order_discounts')
            .select('orders_used')
            .eq('account_number', accountNumber)
            .eq('discount_tier_id', orderDiscount.id)
            .single();

          if (usageError && usageError.code !== 'PGRST116') { // PGRST116 = no rows found
            console.error('[AuthContext] Error fetching order discount usage:', usageError);
            continue;
          }

          const ordersUsed = usage?.orders_used || 0;
          const maxOrders = orderDiscount.max_orders || 0;

          // If customer still has orders remaining, this discount is eligible
          if (ordersUsed < maxOrders) {
            eligibleOrderDiscounts.push({
              rate: orderDiscount.discount,
              type: 'order_based' as const,
              message: `New customer discount - ${maxOrders - ordersUsed} orders remaining`,
              source: `Order-based discount (${ordersUsed + 1}/${maxOrders})`
            });
          }
        }
      }

      // 4. Combine and find the highest discount
      const allEligibleDiscounts = [];

      // Add date-based discounts
      if (dateDiscounts && dateDiscounts.length > 0) {
        dateDiscounts.forEach(discount => {
          if (discount.discount && discount.discount > 0) {
            allEligibleDiscounts.push({
              rate: discount.discount,
              type: 'date_based' as const,
              message: discount.promo_message || 'Promotional discount',
              source: 'Date-based promotion'
            });
          }
        });
      }

      // Add eligible order-based discounts
      allEligibleDiscounts.push(...eligibleOrderDiscounts);

      // 5. Find the highest discount
      if (allEligibleDiscounts.length > 0) {
        const bestDiscount = allEligibleDiscounts.reduce((best, current) => 
          current.rate > best.rate ? current : best
        );
        
        setMaxDiscountRate(bestDiscount.rate);
        setCurrentDiscountInfo(bestDiscount);
        console.log('[AuthContext] Best discount found:', bestDiscount);
      } else {
        setMaxDiscountRate(null);
        setCurrentDiscountInfo(null);
        console.log('[AuthContext] No eligible discounts found');
      }

    } catch (err) {
      console.error('[AuthContext] Exception calculating discounts:', err);
      setMaxDiscountRate(null);
      setCurrentDiscountInfo(null);
    }
  };

  useEffect(() => {
    const checkUserAndFetchMaxDiscount = async () => {
      try {
        const savedUser = localStorage.getItem('user');
        if (savedUser) {
          const parsedUser = JSON.parse(savedUser);
          setUser(parsedUser);
          setIsAuthenticated(true);
        }
      } catch (e) {
        localStorage.removeItem('user');
        setUser(null);
        setIsAuthenticated(false);
      }

      setIsLoading(false);
    };
    checkUserAndFetchMaxDiscount();
  }, []);

  const login = async (accountNumber: string, password: string): Promise<boolean> => {
    setError(null);
    
    try {
      const accountNumberInt = parseInt(accountNumber, 10);
      
      if (isNaN(accountNumberInt)) {
        setError('Invalid account number format');
        return false;
      }

      // All authentication logic is now handled by the authenticate_user_lcmd function

      // Call the RPC function for login
      const rpcParams = {
        p_account_number: accountNumberInt,
        p_password: password // Pass the original password, the function handles lowercasing
      };
      const rpcFunctionName = 'authenticate_user'; // Updated function name
      console.log(`[AuthContext] Calling RPC: ${rpcFunctionName} with params:`, { p_account_number: accountNumberInt, p_password: '***' }); // Log params, obscuring password

      const { data: rpcResult, error: rpcError } = await supabase.rpc(rpcFunctionName, rpcParams);

      if (rpcError) {
        console.error('RPC Database error:', rpcError);
        setError('An error occurred while trying to log in. Please try again.');
        return false;
      }

      // rpcResult will be an array. If login is successful, it should contain one user object.
      if (!rpcResult || rpcResult.length === 0) {
        setError('Invalid account number or password');
        return false;
      }
      
      const accountData = rpcResult[0]; // Get the first user object from the array

      if (!accountData) { // Should not happen if rpcResult.length > 0, but as a safeguard
        setError('Invalid account number or password');
        return false;
      }

      const userData: User = {
        accountNumber: String(accountData.account_number), // Ensure it's a string
        acctName: accountData.acct_name || '',
        address: accountData.address || '',
        city: accountData.city || '',
        state: accountData.state || '',
        zip: accountData.zip || '',
        // Assuming 'requires_password_change' is a boolean field from the RPC result
        requires_password_change: accountData.requires_password_change || false, 
        id: accountData.id // Make sure id is also populated for updates
      };
      
      setUser(userData);
      setIsAuthenticated(true);
      localStorage.setItem('user', JSON.stringify(userData));

      // Modal logic based on requires_password_change
      if (userData.requires_password_change) {
        setShowPasswordChangeModal(true);
      }

      // Calculate the best eligible discount for this user
      await calculateBestDiscount(userData.accountNumber);

      return true;

    } catch (err) {
      console.error('Login error:', err);
      setError('An unexpected error occurred. Please try again later.');
      return false;
    }
  };

  const logout = () => {
    setUser(null);
    setIsAuthenticated(false);
    localStorage.removeItem('user');
    // setMaxDiscountRate(null); // Or keep it if it's app-wide and not user-specific
    // setShowActiveDiscountModal(false); // Old logic
  };

  // const clearActiveDiscount = () => { // Old logic
  //   setActiveDiscount(null);
  //   setShowActiveDiscountModal(false);
  // };

  const openPasswordChangeModal = () => setShowPasswordChangeModal(true);

  const handlePasswordModalClose = (wasSuccess: boolean) => {
    setShowPasswordChangeModal(false);
    if (wasSuccess) {
      // Update user context if requires_password_change was set to false
      // This happens because PasswordChangeModal itself updates the DB.
      // The local user state also needs to reflect this.
      if (user && user.requires_password_change) { // Check if it was true before
        const updatedUser = { ...user, requires_password_change: false };
        setUser(updatedUser);
        localStorage.setItem('user', JSON.stringify(updatedUser));
      }
      // Removed automatic opening of DiscountFormModal after password change success
      // setShowDiscountFormModal(true); 
    }
    // If wasSuccess is false, only the password modal is closed.
  };

  const openDiscountFormModal = () => setShowDiscountFormModal(true);
  const closeDiscountFormModal = () => setShowDiscountFormModal(false);


  const fetchUserAccount = async (accountNumber: string): Promise<User | null> => {
    setIsLoading(true);
    setError(null);
    try {
      const accountNumberInt = parseInt(accountNumber, 10);
      if (isNaN(accountNumberInt)) {
        setError('Invalid account number format for fetching.');
        return null;
      }

      const { data, error: rpcError } = await supabase
        .from('accounts_lcmd')
        .select('*')
        .eq('account_number', accountNumberInt)
        .single();

      if (rpcError) {
        console.error('Error fetching user account:', rpcError);
        setError('Could not fetch account details.');
        return null;
      }

      if (data) {
        const fetchedUser: User = {
          accountNumber: String(data.account_number),
          acctName: data.acct_name || '',
          address: data.address || '',
          city: data.city || '',
          state: data.state || '',
          zip: data.zip || '',
          id: data.id, // Ensure the UUID 'id' is mapped
          email: data.email_address || '', // Map email_address to email (corrected to lowercase)
          mobile_phone: data.mobile_phone || '',
          requires_password_change: data.requires_password_change || false, // Also fetch this flag
          // Add other relevant fields from your 'accounts' table
        };
        // Optionally update the context's user state if this is the logged-in user
        // For now, just returning the fetched data
        return fetchedUser;
      }
      return null;
    } catch (err) {
      console.error('Fetch user account error:', err);
      setError('An unexpected error occurred while fetching account details.');
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AuthContext.Provider value={{ 
      user, 
      login, 
      logout, 
      isAuthenticated, 
      isLoading, 
      error, 
      fetchUserAccount,
      maxDiscountRate, // New
      currentDiscountInfo, // New
      // activeDiscount, // Old
      // showActiveDiscountModal, // Old
      // clearActiveDiscount, // Old
      showPasswordChangeModal,
      openPasswordChangeModal,
      handlePasswordModalClose, 
      showDiscountFormModal,
      openDiscountFormModal,
      closeDiscountFormModal
    }}>
      {children}
    </AuthContext.Provider>
  );
};
