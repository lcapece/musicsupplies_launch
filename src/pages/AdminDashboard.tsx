import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { LogOut } from 'lucide-react';
import { supabase } from '../lib/supabase';
import AccountsTab from '../components/admin/AccountsTab';
import AccountApplicationsTab from '../components/admin/AccountApplicationsTab';
import WebOrdersTab from '../components/admin/WebOrdersTab';
import HistoryTab from '../components/admin/HistoryTab';
import ClickSendTab from '../components/admin/ClickSendTab';
import PromoCodeManagementTab from '../components/admin/PromoCodeManagementTab';
import ImageManagementTab from '../components/admin/ImageManagementTab';
import SmsFailureNotificationModal from '../components/SmsFailureNotificationModal';

type TabType = 'accounts' | 'applications' | 'orders' | 'history' | 'sms' | 'clicksend' | 'promocodes' | 'images';

const AdminDashboard: React.FC = () => {
  const { user, isAuthenticated, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<TabType>('accounts');
  const [showSmsFailureModal, setShowSmsFailureModal] = useState(false);
  const [hasCheckedForFailures, setHasCheckedForFailures] = useState(false);

  // Check for SMS failures when admin logs in
  useEffect(() => {
    const checkForSmsFailures = async () => {
      // CRITICAL: Only check for SMS failures if this is the admin account (999)
      if (!hasCheckedForFailures && user?.accountNumber === '999' && isAuthenticated) {
        try {
          // Check if there are any unacknowledged SMS failures
          const { data, error } = await supabase.rpc('get_unacknowledged_sms_failures');
          
          if (!error && data && data.length > 0) {
            setShowSmsFailureModal(true);
          }
          
          setHasCheckedForFailures(true);
        } catch (error) {
          console.error('Error checking for SMS failures:', error);
          setHasCheckedForFailures(true);
        }
      } else if (user?.accountNumber !== '999') {
        // Not admin, mark as checked to prevent any future attempts
        setHasCheckedForFailures(true);
      }
    };

    checkForSmsFailures();
  }, [user, hasCheckedForFailures, isAuthenticated]);

  if (!isAuthenticated || user?.accountNumber !== '999') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="bg-white p-8 rounded-lg shadow-lg">
          <h2 className="text-4xl font-bold text-red-600 mb-4">Access Denied</h2>
          <p className="text-2xl text-gray-700">You don't have permission to access this page.</p>
        </div>
      </div>
    );
  }

  const tabs: { id: TabType; label: string; icon: string }[] = [
    { id: 'accounts', label: 'Accounts', icon: '👥' },
    { id: 'images', label: 'Image Management', icon: '🖼️' },
    { id: 'applications', label: 'Applications', icon: '📝' },
    { id: 'orders', label: 'Web Orders', icon: '🛒' },
    { id: 'history', label: 'Order History', icon: '📊' },
    { id: 'sms', label: 'SMS Notifications', icon: '📱' },
    { id: 'clicksend', label: 'ClickSend', icon: '📨' },
    { id: 'promocodes', label: 'Promo Codes', icon: '🏷️' },
  ];

  const renderTabContent = () => {
    switch (activeTab) {
      case 'accounts':
        return <AccountsTab />;
      case 'applications':
        return <AccountApplicationsTab />;
      case 'orders':
        return <WebOrdersTab />;
      case 'history':
        return <HistoryTab />;
      case 'sms':
        return <div className="text-center py-16 text-2xl text-gray-500">SMS Notifications coming soon...</div>;
      case 'clicksend':
        return <ClickSendTab />;
      case 'promocodes':
        return <PromoCodeManagementTab />;
      case 'images':
        return <ImageManagementTab />;
      default:
        return <AccountsTab />;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Simple header with just logout button */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="container mx-auto px-4">
          <div className="flex justify-between items-center h-20">
            <h1 className="text-4xl font-semibold text-gray-900">Admin Backend System</h1>
            <button
              onClick={logout}
              className="inline-flex items-center px-6 py-3 border border-transparent text-2xl font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
            >
              <LogOut className="h-8 w-8 mr-3" />
              Logout
            </button>
          </div>
        </div>
      </div>
      
      <div className="container mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow-lg">
          <div className="border-b border-gray-200">
            {/* Tab Navigation */}
            <div className="px-6 pt-6">
              <nav className="-mb-px flex space-x-8 overflow-x-auto pb-2">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`py-4 px-2 border-b-4 font-medium text-base whitespace-nowrap flex-shrink-0 ${
                      activeTab === tab.id
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <span className="mr-2 text-xl">{tab.icon}</span>
                    {tab.label}
                  </button>
                ))}
              </nav>
            </div>
          </div>
          
          {/* Tab Content */}
          <div className="p-12">
            {renderTabContent()}
          </div>
        </div>
      </div>

      {/* SMS Failure Notification Modal */}
      <SmsFailureNotificationModal 
        isOpen={showSmsFailureModal} 
        onClose={() => setShowSmsFailureModal(false)} 
      />
    </div>
  );
};

export default AdminDashboard;
