import React, { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface Account {
  account_number: number;
  acct_name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  requires_password_change: boolean;
  has_custom_password: boolean;
}

interface LogonEntry {
  account_number: number;
  password: string;
}

type SortableColumn = 'account_number' | 'acct_name' | 'city' | 'phone';

const AccountsTab: React.FC = () => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showTestPasswordModal, setShowTestPasswordModal] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [totalAccountCount, setTotalAccountCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [sortColumn, setSortColumn] = useState<SortableColumn>('account_number');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const itemsPerPage = 10;

  useEffect(() => {
    fetchAccounts();
  }, [currentPage, sortColumn, sortDirection, searchTerm]);

  useEffect(() => {
    if (searchTerm) {
      setCurrentPage(1);
    }
  }, [searchTerm]);

  const getDefaultPassword = (acctName: string, zip: string) => {
    if (!acctName || !zip) return '';
    const firstLetter = acctName.charAt(0).toLowerCase();
    const zipFirst5 = zip.substring(0, 5);
    return `${firstLetter}${zipFirst5}`;
  };

  const fetchAccounts = async () => {
    try {
      setLoading(true);
      
      let query = supabase
        .from('accounts_lcmd')
        .select(`
          account_number,
          acct_name,
          address,
          city,
          state,
          zip,
          phone,
          requires_password_change
        `, { count: 'exact' });

      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        const numericSearchTerm = parseInt(searchTerm, 10);
        const orConditions = [
          `acct_name.ilike.%${searchLower}%`,
          `city.ilike.%${searchLower}%`,
          `state.ilike.%${searchLower}%`,
        ];
        if (!isNaN(numericSearchTerm)) {
          orConditions.push(`account_number.eq.${numericSearchTerm}`);
        }
        query = query.or(orConditions.join(','));
      } else {
        // Calculate offset for pagination only when not searching
        const offset = (currentPage - 1) * itemsPerPage;
        query = query.range(offset, offset + itemsPerPage - 1);
      }

      // Always apply sorting
      query = query.order(sortColumn, { ascending: sortDirection === 'asc' });

      const { data, error, count } = await query;

      if (error) {
        console.error('Error fetching accounts:', error);
        setAccounts([]);
        return;
      }

      if (count) {
        setTotalAccountCount(count);
      }

      // Get password entries only for the current page accounts
      const accountNumbers = data?.map(a => a.account_number) || [];
      const { data: passwordData, error: passwordError } = await supabase
        .from('logon_lcmd')
        .select('account_number, password')
        .in('account_number', accountNumbers);

      if (passwordError) {
        console.error('Error fetching password data:', passwordError);
      }

      // Create a map of account passwords
      const passwordMap: { [key: number]: string } = {};
      passwordData?.forEach((entry: LogonEntry) => {
        passwordMap[entry.account_number] = entry.password;
      });

      // Check which accounts have custom passwords
      // DEBUGGING: Let's see what's actually happening with the data
      const accountsWithPasswordStatus = (data || []).map(account => {
        const hasEntry = passwordMap.hasOwnProperty(account.account_number);
        const storedPassword = passwordMap[account.account_number];
        const defaultPattern = getDefaultPassword(account.acct_name, account.zip);
        
        // DEBUG: Log account 105 specifically
        if (account.account_number === 105) {
          console.log('🔍 DEBUG Account 105:', {
            account_number: account.account_number,
            acct_name: account.acct_name,
            zip: account.zip,
            hasEntry: hasEntry,
            storedPassword: storedPassword,
            defaultPattern: defaultPattern,
            passwordsMatch: storedPassword?.toLowerCase() === defaultPattern?.toLowerCase()
          });
        }
        
        // BETTER LOGIC: Check if password exists AND is not the default pattern
        let hasCustomPassword = false;
        if (hasEntry && storedPassword) {
          // If stored password is different from default pattern, it's custom
          hasCustomPassword = storedPassword.toLowerCase() !== defaultPattern.toLowerCase();
        }
        
        // DEBUG: Log the final decision for account 105
        if (account.account_number === 105) {
          console.log('🎯 Account 105 final decision:', {
            hasCustomPassword: hasCustomPassword,
            reason: hasEntry ? 
              (hasCustomPassword ? 'Password differs from default pattern' : 'Password matches default pattern') :
              'No password entry found'
          });
        }
        
        return {
          ...account,
          has_custom_password: hasCustomPassword
        };
      });

      setAccounts(accountsWithPasswordStatus);
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (column: SortableColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };

  const handleSetPassword = async (accountNumber: number, newPassword: string) => {
    try {
      // Get the account details to check if password matches default pattern
      const account = accounts.find(a => a.account_number === accountNumber);
      const defaultPattern = account ? getDefaultPassword(account.acct_name, account.zip) : '';
      const isDefaultPattern = newPassword.toLowerCase() === defaultPattern.toLowerCase();

      // Check if account already has a password entry
      const { data: existingPassword, error: checkError } = await supabase
        .from('logon_lcmd')
        .select('account_number')
        .eq('account_number', accountNumber)
        .maybeSingle(); // Use maybeSingle instead of single to avoid error when no rows

      if (checkError) {
        console.error('Error checking existing password:', checkError);
        alert('Error checking existing password');
        return;
      }

      if (existingPassword) {
        // Update existing password
        const { error: updateError } = await supabase
          .from('logon_lcmd')
          .update({
            password: newPassword
          })
          .eq('account_number', accountNumber);

        if (updateError) {
          console.error('Error updating password:', updateError);
          alert('Error updating password: ' + updateError.message);
          return;
        }
      } else {
        // Insert new password entry
        const { error: insertError } = await supabase
          .from('logon_lcmd')
          .insert({
            account_number: accountNumber,
            password: newPassword
          });

        if (insertError) {
          console.error('Error inserting password:', insertError);
          alert('Error setting password: ' + insertError.message);
          return;
        }
      }

      setShowPasswordModal(false);
      fetchAccounts();
      
      // Show appropriate message based on whether password matches default pattern
      if (isDefaultPattern) {
        alert('Default password has been set');
      } else {
        alert('A new password has been set');
      }
    } catch (error) {
      console.error('Error:', error);
      alert('Error setting password');
    }
  };

  const handleResetPassword = async (accountNumber: number) => {
    if (window.confirm('This will reset the account to use the default password pattern (first letter + ZIP). Continue?')) {
      try {
        // Remove custom password entry
        const { error: deleteError } = await supabase
          .from('logon_lcmd')
          .delete()
          .eq('account_number', accountNumber);

        if (deleteError) {
          console.error('Error deleting password:', deleteError);
          alert('Error resetting password');
          return;
        }

        // Update account to require password change (this is on accounts_lcmd table)
        const { error: updateError } = await supabase
          .from('accounts_lcmd')
          .update({ requires_password_change: true })
          .eq('account_number', accountNumber);

        if (updateError) {
          console.error('Error updating account:', updateError);
        }

        fetchAccounts();
        alert('Password reset successfully. Account will use default password pattern.');
      } catch (error) {
        console.error('Error:', error);
        alert('Error resetting password');
      }
    }
  };

  const getDefaultPasswordDisplay = (account: Account) => {
    return getDefaultPassword(account.acct_name, account.zip) || 'N/A';
  };

  const isInactiveAccount = (account: Account) => {
    const defaultPattern = getDefaultPassword(account.acct_name, account.zip);
    return defaultPattern && defaultPattern.slice(-5) === 'xxxxx';
  };

  const testPassword = async (accountNumber: number, testPassword: string) => {
    try {
      // Get the account's actual password
      const { data: passwordData, error } = await supabase
        .from('logon_lcmd')
        .select('password')
        .eq('account_number', accountNumber)
        .maybeSingle();

      if (error) {
        console.error('Error fetching password:', error);
        return { success: false, message: 'Error checking password' };
      }

      // If no password entry exists, check against default pattern
      if (!passwordData) {
        const account = accounts.find(a => a.account_number === accountNumber);
        if (account) {
          const defaultPattern = getDefaultPassword(account.acct_name, account.zip);
          const isCorrect = testPassword.toLowerCase() === defaultPattern.toLowerCase();
          return { 
            success: true, 
            isCorrect, 
            message: isCorrect ? 'CORRECT' : 'INCORRECT'
          };
        }
        return { success: false, message: 'Account not found' };
      }

      // Check against stored password
      const isCorrect = testPassword === passwordData.password;
      return { 
        success: true, 
        isCorrect, 
        message: isCorrect ? 'CORRECT' : 'INCORRECT'
      };

    } catch (error) {
      console.error('Error testing password:', error);
      return { success: false, message: 'Error testing password' };
    }
  };

  const filteredAccounts = accounts;

  const PasswordModal: React.FC<{
    account: Account;
    onClose: () => void;
    onSave: (accountNumber: number, password: string) => void;
  }> = ({ account, onClose, onSave }) => {
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    const handleSubmit = () => {
      if (!password.trim()) {
        alert('Please enter a password');
        return;
      }
      if (password !== confirmPassword) {
        alert('Passwords do not match');
        return;
      }
      if (password.length < 6) {
        alert('Password must be at least 6 characters long');
        return;
      }
      onSave(account.account_number, password);
    };

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8 w-full max-w-2xl">
          <h3 className="text-2xl font-semibold text-gray-900 mb-6">
            Set Password for Account {account.account_number}
          </h3>
          <div className="mb-6">
            <p className="text-lg text-gray-600 mb-3">
              <strong>Account:</strong> {account.acct_name}
            </p>
            <p className="text-lg text-gray-600 mb-6">
              <strong>Default Pattern:</strong> {getDefaultPasswordDisplay(account)}
            </p>
          </div>
          <div className="space-y-6">
            <div>
              <label className="block text-lg font-medium text-gray-700 mb-2">
                New Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter new password..."
                className="w-full border border-gray-300 rounded-md px-4 py-3 text-lg"
              />
            </div>
            <div>
              <label className="block text-lg font-medium text-gray-700 mb-2">
                Confirm Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm password..."
                className="w-full border border-gray-300 rounded-md px-4 py-3 text-lg"
              />
            </div>
          </div>
          <div className="flex justify-end space-x-4 mt-8">
            <button
              onClick={onClose}
              className="px-6 py-3 text-lg font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              className="px-6 py-3 text-lg font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md"
            >
              Set Password
            </button>
          </div>
        </div>
      </div>
    );
  };

  const TestPasswordModal: React.FC<{
    account: Account;
    onClose: () => void;
  }> = ({ account, onClose }) => {
    const [testPasswordInput, setTestPasswordInput] = useState('');
    const [result, setResult] = useState<{message: string; isCorrect?: boolean} | null>(null);
    const [testing, setTesting] = useState(false);

    const handleTest = async () => {
      if (!testPasswordInput.trim()) {
        alert('Please enter a password to test');
        return;
      }

      setTesting(true);
      const testResult = await testPassword(account.account_number, testPasswordInput);
      setTesting(false);

      if (testResult.success) {
        setResult({
          message: testResult.message,
          isCorrect: testResult.isCorrect
        });
      } else {
        alert(testResult.message);
      }
    };

    const handleKeyPress = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleTest();
      }
    };

    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-8 w-full max-w-2xl">
          <h3 className="text-2xl font-semibold text-gray-900 mb-6">
            Test Password for Account {account.account_number}
          </h3>
          <div className="mb-6">
            <p className="text-lg text-gray-600 mb-3">
              <strong>Account:</strong> {account.acct_name}
            </p>
            <p className="text-lg text-gray-600 mb-6">
              <strong>Default Pattern:</strong> {getDefaultPasswordDisplay(account)}
            </p>
          </div>
          <div className="space-y-6">
            <div>
              <label className="block text-lg font-medium text-gray-700 mb-2">
                Enter Password to Test
              </label>
              <input
                type="password"
                value={testPasswordInput}
                onChange={(e) => setTestPasswordInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Enter password to verify..."
                className="w-full border border-gray-300 rounded-md px-4 py-3 text-lg"
                disabled={testing}
              />
            </div>
            {result && (
              <div className={`p-4 rounded-md text-center ${
                result.isCorrect 
                  ? 'bg-green-100 text-green-800 border border-green-200' 
                  : 'bg-red-100 text-red-800 border border-red-200'
              }`}>
                <div className="text-3xl font-bold mb-2">
                  {result.message}
                </div>
                <div className="text-lg">
                  {result.isCorrect ? '✓ Password matches' : '✗ Password does not match'}
                </div>
              </div>
            )}
          </div>
          <div className="flex justify-end space-x-4 mt-8">
            <button
              onClick={onClose}
              className="px-6 py-3 text-lg font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
            >
              Close
            </button>
            <button
              onClick={handleTest}
              disabled={testing}
              className={`px-6 py-3 text-lg font-medium text-white rounded-md ${
                testing
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-700'
              }`}
            >
              {testing ? 'Testing...' : 'Test Password'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      {/* Search */}
      <div className="bg-white p-6 rounded-lg shadow mt-0">
        <div className="flex items-center space-x-4">
          <div className="w-[85%]">
            <label className="block text-lg font-semibold text-gray-700 mb-2">
              Search Accounts
            </label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by account number, company name, city, or state..."
              className="w-full border border-gray-300 rounded-md px-4 py-3 text-base"
            />
          </div>
          <button
            onClick={fetchAccounts}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-md text-lg font-semibold mt-8"
          >
            Refresh Accounts
          </button>
        </div>
      </div>

      {/* Accounts Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden mt-6">
        <div className="px-8 py-6 border-b border-gray-200">
          <h3 className="text-2xl font-bold text-gray-900">
            {searchTerm 
              ? `Found ${totalAccountCount} matching accounts`
              : `Account List (Showing ${filteredAccounts.length} of ${totalAccountCount} accounts)`
            }
          </h3>
        </div>
        
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="text-gray-600 text-xl">Loading accounts...</div>
          </div>
        ) : filteredAccounts.length === 0 ? (
          <div className="flex items-center justify-center h-40">
            <div className="text-gray-600 text-xl">No accounts found</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-8 py-5 text-left text-lg font-bold text-gray-700 uppercase tracking-wider cursor-pointer" onClick={() => handleSort('account_number')}>
                    Account # {sortColumn === 'account_number' && (sortDirection === 'asc' ? '▲' : '▼')}
                  </th>
                  <th className="px-8 py-5 text-left text-lg font-bold text-gray-700 uppercase tracking-wider cursor-pointer" onClick={() => handleSort('acct_name')}>
                    Company Name {sortColumn === 'acct_name' && (sortDirection === 'asc' ? '▲' : '▼')}
                  </th>
                  <th className="px-8 py-5 text-left text-lg font-bold text-gray-700 uppercase tracking-wider cursor-pointer" onClick={() => handleSort('city')}>
                    Location {sortColumn === 'city' && (sortDirection === 'asc' ? '▲' : '▼')}
                  </th>
                  <th className="px-8 py-5 text-left text-lg font-bold text-gray-700 uppercase tracking-wider cursor-pointer" onClick={() => handleSort('phone')}>
                    Phone {sortColumn === 'phone' && (sortDirection === 'asc' ? '▲' : '▼')}
                  </th>
                  <th className="px-8 py-5 text-left text-lg font-bold text-gray-700 uppercase tracking-wider">
                    Password Status
                  </th>
                  <th className="px-8 py-5 text-left text-lg font-bold text-gray-700 uppercase tracking-wider">
                    Default Pattern
                  </th>
                  <th className="px-8 py-5 text-left text-lg font-bold text-gray-700 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredAccounts.map((account) => (
                  <tr key={account.account_number} className={`${isInactiveAccount(account) ? 'bg-red-100 hover:bg-red-200' : 'hover:bg-gray-50'}`}>
                    <td className="px-8 py-6 whitespace-nowrap text-lg font-bold text-gray-900">
                      {account.account_number}
                    </td>
                    <td className="px-8 py-6 text-lg text-gray-700 max-w-xs truncate font-semibold">
                      {account.acct_name || 'N/A'}
                    </td>
                    <td className="px-8 py-6 text-base text-gray-600">
                      {account.city || 'N/A'}, {account.state || 'N/A'} {account.zip || 'N/A'}
                    </td>
                    <td className="px-8 py-6 whitespace-nowrap text-base text-gray-600">
                      {account.phone || 'N/A'}
                    </td>
                    <td className="px-8 py-6 whitespace-nowrap text-base">
                      <div className="space-y-2">
                        <span className={`inline-flex px-3 py-2 text-sm font-bold rounded-full ${
                          account.has_custom_password 
                            ? 'bg-blue-100 text-blue-800' 
                            : 'bg-green-100 text-green-800'
                        }`}>
                          {account.has_custom_password ? 'Custom Password' : 'Default Pattern'}
                        </span>
                        {account.requires_password_change && (
                          <div>
                            <span className="inline-flex px-3 py-2 text-sm font-bold rounded-full bg-orange-100 text-orange-800">
                              Requires Change
                            </span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-8 py-6 whitespace-nowrap text-base text-gray-600 font-mono font-bold">
                      {getDefaultPasswordDisplay(account)}
                    </td>
                    <td className="px-8 py-6 whitespace-nowrap text-base text-gray-500">
                      <div className="flex space-x-3">
                        <button
                          onClick={() => {
                            setSelectedAccount(account);
                            setShowPasswordModal(true);
                          }}
                          className="text-blue-600 hover:text-blue-900 font-semibold text-base"
                        >
                          Set Pwd
                        </button>
                        <button
                          onClick={() => {
                            setSelectedAccount(account);
                            setShowTestPasswordModal(true);
                          }}
                          className="text-green-600 hover:text-green-900 font-semibold text-base"
                        >
                          Test Pwd
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        
        {/* Pagination Controls */}
        {!searchTerm && totalAccountCount > itemsPerPage && (
          <div className="px-8 py-6 border-t border-gray-200 flex items-center justify-between">
            <div className="text-lg text-gray-700">
              Page {currentPage} of {Math.ceil(totalAccountCount / itemsPerPage)}
            </div>
            <div className="flex space-x-3">
              <button
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className={`px-6 py-3 text-lg font-semibold rounded-md ${
                  currentPage === 1
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                Previous
              </button>
              <button
                onClick={() => setCurrentPage(prev => Math.min(Math.ceil(totalAccountCount / itemsPerPage), prev + 1))}
                disabled={currentPage === Math.ceil(totalAccountCount / itemsPerPage)}
                className={`px-6 py-3 text-lg font-semibold rounded-md ${
                  currentPage === Math.ceil(totalAccountCount / itemsPerPage)
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Password Modal */}
      {showPasswordModal && selectedAccount && (
        <PasswordModal
          account={selectedAccount}
          onClose={() => setShowPasswordModal(false)}
          onSave={handleSetPassword}
        />
      )}

      {/* Test Password Modal */}
      {showTestPasswordModal && selectedAccount && (
        <TestPasswordModal
          account={selectedAccount}
          onClose={() => setShowTestPasswordModal(false)}
        />
      )}
    </div>
  );
};

export default AccountsTab;
