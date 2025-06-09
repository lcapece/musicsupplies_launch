import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { KeyRound, User as UserIcon } from 'lucide-react'; // Renamed User to UserIcon to avoid conflict
import { Link, useNavigate } from 'react-router-dom'; // Import Link and useNavigate
import PasswordChangeModal from './PasswordChangeModal'; // Import the modal
import { supabase } from '../lib/supabase'; // Import supabase client
import { User } from '../types'; // Import User type
import logo from '../images/music_supplies_logo.png'; // Import the logo
import brands from '../images/brands.png'; // Import the brands image

const Login: React.FC = () => {
  const [accountNumber, setAccountNumber] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const { login, error, user, isAuthenticated, showPasswordChangeModal, handlePasswordModalClose } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthenticated && user && !user.requires_password_change) {
      // Navigate to dashboard if user is authenticated and doesn't need password change
      navigate('/dashboard');
    }
  }, [isAuthenticated, user, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    
    try {
      const loginSuccess = await login(accountNumber, password);
      if (loginSuccess) {
        // The AuthContext now handles password change modal logic
        // If login is successful and no password change is required, navigate to dashboard
        // The password change modal will be shown automatically by AuthContext if needed
        if (!user?.requires_password_change) {
          navigate('/dashboard');
        }
        // If password change is required, the modal will be shown automatically
        // and navigation will happen after password change completion
      }
    } catch (err) {
      // error state from useAuth() should cover most login errors
      console.error("Login submit error", err)
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleModalClose = (wasSuccess: boolean) => {
    handlePasswordModalClose(wasSuccess);
    if (wasSuccess) {
      navigate('/dashboard');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4"> {/* Added px-4 for some padding on very small screens */}
      <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-2xl"> {/* Changed max-w-md to max-w-2xl */}
        <div className="text-center mb-8">
          <img src={logo} alt="Music Supplies Logo" className="mx-auto h-36 w-auto mb-4" /> {/* Increased logo size */}
          <p className="text-gray-600">
            MusicSupplies.com is the customer portal for Lou Capece Music Distributors.
          </p>
        </div>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}
        
        <form onSubmit={handleSubmit}>
          <div className="flex justify-center space-x-4 mb-6"> {/* Flex container for inputs */}
            <div className="w-[35%]"> {/* Account Number Input Field */}
              <label htmlFor="accountNumber" className="block text-sm font-medium text-gray-700 mb-1">
                Account Number
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <UserIcon size={18} className="text-gray-400" />
                </div>
                <input
                  type="text"
                  id="accountNumber"
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Account Number"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  required
                />
              </div>
            </div>
            
            <div className="w-[35%]"> {/* Password Input Field */}
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                  <KeyRound size={18} className="text-gray-400" />
                </div>
                <input
                  type="password"
                  id="password"
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>
          </div>

          <div className="text-center mb-6">
            <p className="text-gray-600 mb-2">
              Please call 1(800)321-5584 for help or any questions.
            </p>
            <p className="text-red-600 text-[22px] font-semibold">
              FOR WHOLESALE ACCOUNTS ONLY
            </p>
            <Link 
              to="/new-account-application" 
              className="block mt-2 text-sm text-blue-600 hover:text-blue-800 hover:underline"
            >
              Click here to apply for a new account
            </Link>
          </div>

          {/* Brands Section - Replaced multiple images with single brands.png */}
          <div className="my-8 text-center">
            <p className="text-gray-700 font-semibold mb-4">
              Distributor of Exceptional Brands Including:
            </p>
            <div className="flex justify-center">
              <img 
                src={brands} 
                alt="Music Supplies Brands" 
                className="max-w-full h-auto"
              />
            </div>
          </div>
          
          <button
            type="submit"
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            disabled={isLoading}
          >
            {isLoading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        {user && (
          <PasswordChangeModal
            isOpen={showPasswordChangeModal}
            onClose={handleModalClose}
            accountData={user}
          />
        )}
      </div>
    </div>
  );
};

export default Login;