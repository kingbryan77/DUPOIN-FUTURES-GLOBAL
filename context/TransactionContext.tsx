
import React, { createContext, useState, useEffect, useContext, useCallback } from 'react';
import {
  DepositTransaction,
  WithdrawalTransaction,
  TransactionStatus,
  NotificationItem,
  CompanyBankInfo,
  Transaction,
  User,
} from '../types';
import * as transactionService from '../services/transactionService';
import * as authService from '../services/authService';
import { supabase } from '../services/supabaseClient';
import { useAuth } from './AuthContext';

interface TransactionContextType {
  balance: number;
  accountMode: 'real' | 'demo';
  toggleAccountMode: () => void;
  depositHistory: DepositTransaction[];
  withdrawalHistory: WithdrawalTransaction[];
  notifications: NotificationItem[];
  companyBankInfoList: CompanyBankInfo[];
  isLoadingTransactions: boolean;
  transactionError: string | null;
  addNotification: (message: string) => void;
  markNotificationAsRead: (notificationId: string) => void;
  deposit: (amount: number) => Promise<boolean>;
  withdraw: (amount: number, method: string, bankOrEwalletName: string, accountNumber: string, accountHolderName: string) => Promise<boolean>;
  transfer: (recipientEmail: string, amount: number) => Promise<{ success: boolean; message: string }>;
  updateDepositStatus: (depositId: string, status: TransactionStatus) => void;
  updateWithdrawalStatus: (withdrawalId: string, status: TransactionStatus) => void;
  setCompanyBankInfoList: (info: CompanyBankInfo[]) => void;
  adminUpdateUserBalance: (userId: string, amount: number, type: 'set' | 'add') => void;
  adminCreateUser: (userData: Omit<User, 'id' | 'username' | 'notifications'> & { password: string; isActive?: boolean }) => Promise<boolean>;
  deleteUser: (userId: string) => Promise<void>;
  getAllTransactions: () => Promise<Transaction[]>;
  getAllUsers: () => Promise<User[]>;
  updateUserVerification: (userId: string, isVerified: boolean) => void;
  updateUserActiveStatus: (userId: string, isActive: boolean) => Promise<void>;
  refreshLiveBalance: () => Promise<void>;
}

const TransactionContext = createContext<TransactionContextType | undefined>(undefined);

export const TransactionProvider: React.FC<React.PropsWithChildren<{}>> = ({ children }) => {
  const { user, refreshUser } = useAuth();
  const [balance, setBalance] = useState<number>(() => user?.balance ?? 0);
  const [accountMode, setAccountMode] = useState<'real' | 'demo'>('real');
  const [depositHistory, setDepositHistory] = useState<DepositTransaction[]>([]);
  const [withdrawalHistory, setWithdrawalHistory] = useState<WithdrawalTransaction[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [companyBankInfoList, setCompanyBankInfoListState] = useState<CompanyBankInfo[]>([]);
  const [isLoadingTransactions, setIsLoadingTransactions] = useState<boolean>(false);
  const [transactionError, setTransactionError] = useState<string | null>(null);

  // Fungsi sinkronisasi saldo langsung dari tabel profiles Supabase
  const refreshLiveBalance = useCallback(async () => {
    if (!user) return;
    try {
      const liveBal = await authService.getLiveProfileBalance(user.id, user.email);
      if (liveBal !== null) {
        setBalance(liveBal);
        if (user.balance !== liveBal) {
          user.balance = liveBal;
        }
      }
    } catch (e) {
      // ignore
    }
  }, [user]);

  // Synchronize live balance directly from Supabase 'profiles' table in real-time
  useEffect(() => {
    if (!user) {
      setBalance(0);
      return;
    }

    let isMounted = true;

    const syncLiveBalanceFromSupabase = async () => {
      try {
        const liveBal = await authService.getLiveProfileBalance(user.id, user.email);
        if (liveBal !== null && isMounted) {
          setBalance(liveBal);
          if (user.balance !== liveBal) {
            user.balance = liveBal;
          }
        }
      } catch (err) {
        // network warning
      }
    };

    // Immediate sync on user mount or change
    syncLiveBalanceFromSupabase();

    // Realtime channel subscription (postgres_changes on 'profiles')
    const channelId = `realtime-profile-${user.id || user.email}-${Math.random().toString(36).substring(2, 9)}`;
    const channel = supabase
      .channel(channelId)
      .on(
        'postgres_changes',
        {
          event: '*', // listen to all events (UPDATE, INSERT)
          schema: 'public',
          table: 'profiles',
        },
        (payload: any) => {
          if (!isMounted) return;
          const newRow = payload.new;
          if (newRow) {
            const matchesId = user.id && newRow.id === user.id;
            const matchesEmail = user.email && newRow.email && 
              newRow.email.toLowerCase() === user.email.toLowerCase();

            if (matchesId || matchesEmail) {
              if (newRow.balance !== undefined && newRow.balance !== null) {
                const newLiveBal = Number(newRow.balance);
                setBalance(newLiveBal);
                user.balance = newLiveBal;
              }
            }
          }
        }
      )
      .subscribe();

    // Periodic Polling fallback (every 3 seconds)
    // Ensures balance is synced even if Supabase Realtime WebSocket is paused or not enabled in dashboard
    const pollTimer = setInterval(syncLiveBalanceFromSupabase, 3000);

    // Window focus and visibility listener (instantly updates when admin switches tabs from Supabase dashboard back to Dupoin)
    const onWindowFocus = () => syncLiveBalanceFromSupabase();
    window.addEventListener('focus', onWindowFocus);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncLiveBalanceFromSupabase();
      }
    };
    window.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      isMounted = false;
      clearInterval(pollTimer);
      window.removeEventListener('focus', onWindowFocus);
      window.removeEventListener('visibilitychange', onVisibilityChange);
      supabase.removeChannel(channel);
    };
  }, [user]);

  const fetchTransactions = useCallback(async () => {
    if (user) {
      setIsLoadingTransactions(true);
      // Baca saldo Supabase langsung
      const liveBal = await authService.getLiveProfileBalance(user.id, user.email);
      if (liveBal !== null) {
        setBalance(liveBal);
      } else {
        setBalance(user.balance);
      }
      const deposits = await transactionService.getDepositHistory(user.id);
      const withdrawals = await transactionService.getWithdrawalHistory(user.id);
      setDepositHistory(deposits);
      setWithdrawalHistory(withdrawals);
      setNotifications(user.notifications);
      setIsLoadingTransactions(false);
    } else {
      setBalance(0);
      setDepositHistory([]);
      setWithdrawalHistory([]);
      setNotifications([]);
    }
  }, [user]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  useEffect(() => {
    const loadBankInfo = async () => {
      const info = await transactionService.getCompanyBankInfoList();
      setCompanyBankInfoListState(info);
    };
    loadBankInfo();
  }, []);

  const toggleAccountMode = () => {
    setAccountMode(prevMode => (prevMode === 'real' ? 'demo' : 'real'));
  };

  const displayedBalance = accountMode === 'real' ? balance : 100000000;

  const addNotification = async (message: string) => {
    if (user) {
      await authService.addUserNotification(user.id, message);
      refreshUser();
    }
  };

  const markNotificationAsRead = async (notificationId: string) => {
    if (user) {
      await authService.updateUserNotification(user.id, notificationId, true);
      refreshUser();
    }
  };

  const deposit = async (amount: number): Promise<boolean> => {
    if (accountMode === 'demo') {
      setTransactionError('Deposits are disabled in Demo mode.');
      return false;
    }
    if (!user) {
      setTransactionError('You must be logged in to deposit.');
      return false;
    }
    setIsLoadingTransactions(true);
    setTransactionError(null);
    const success = await transactionService.deposit(user.id, amount);
    if (success) {
      refreshUser();
      fetchTransactions();
    } else {
      setTransactionError('Deposit failed.');
    }
    setIsLoadingTransactions(false);
    return success;
  };

  const withdraw = async (
    amount: number,
    method: string,
    bankOrEwalletName: string,
    accountNumber: string,
    accountHolderName: string,
  ): Promise<boolean> => {
    if (accountMode === 'demo') {
      setTransactionError('Withdrawals are disabled in Demo mode.');
      return false;
    }
    if (!user) {
      setTransactionError('You must be logged in to withdraw.');
      return false;
    }
    if (user.isActive === false) {
      setTransactionError('Akun Belum Aktif silahkan Hubungin Admin Untuk mengaktifkan Akun');
      return false;
    }
    if (user.balance < amount) {
      setTransactionError('Insufficient balance.');
      return false;
    }

    setIsLoadingTransactions(true);
    setTransactionError(null);
    const success = await transactionService.withdraw(
      user.id,
      amount,
      method,
      bankOrEwalletName,
      accountNumber,
      accountHolderName,
    );
    if (success) {
      setBalance(prev => Math.max(0, prev - amount));
      await refreshUser();
      await fetchTransactions();
    } else {
      setTransactionError('Withdrawal failed.');
    }
    setIsLoadingTransactions(false);
    return success;
  };

  const transfer = async (recipientEmail: string, amount: number): Promise<{ success: boolean; message: string }> => {
    if (accountMode === 'demo') {
        return { success: false, message: 'Transfer disabled in Demo mode.' };
    }
    if (!user) {
        return { success: false, message: 'Login required.' };
    }
    setIsLoadingTransactions(true);
    const result = await transactionService.transfer(user.id, recipientEmail, amount);
    if (result.success) {
        setBalance(prev => Math.max(0, prev - amount));
        await refreshUser();
        await fetchTransactions();
    } else {
        setTransactionError(result.message);
    }
    setIsLoadingTransactions(false);
    return result;
  };
  
  const adminUpdateUserBalance = async (userId: string, amount: number, type: 'set' | 'add') => {
    const users = await authService.getAllUsers();
    const targetUser = users.find(u => u.id === userId);
    if (targetUser) {
        const newBalance = type === 'set' ? amount : targetUser.balance + amount;
        await authService.updateUserBalance(userId, newBalance);
        if (user?.id === userId) {
            await refreshUser();
            await fetchTransactions();
        }
    }
  };

  const adminCreateUser = async (userData: Omit<User, 'id' | 'username' | 'notifications'> & { password: string; isActive?: boolean }): Promise<boolean> => {
    setIsLoadingTransactions(true);
    const newUser = await authService.adminCreateUser(userData);
    setIsLoadingTransactions(false);
    return !!newUser;
  };

  const deleteUser = async (userId: string): Promise<void> => {
    authService.deleteCustomUser(userId);
  };

  const updateDepositStatus = async (depositId: string, status: TransactionStatus) => {
    setIsLoadingTransactions(true);
    const success = await transactionService.updateDepositStatus(depositId, status);
    if (success) {
      await refreshUser();
      await fetchTransactions();
    } else {
      setTransactionError('Failed to update deposit status.');
    }
    setIsLoadingTransactions(false);
  };

  const updateWithdrawalStatus = async (withdrawalId: string, status: TransactionStatus) => {
    setIsLoadingTransactions(true);
    const success = await transactionService.updateWithdrawalStatus(withdrawalId, status);
    if (success) {
      await refreshUser();
      await fetchTransactions();
    } else {
      setTransactionError('Failed to update withdrawal status.');
    }
    setIsLoadingTransactions(false);
  };

  const updateCompanyBankInfoList = async (infoList: CompanyBankInfo[]) => {
    await transactionService.setCompanyBankInfoList(infoList);
    setCompanyBankInfoListState(infoList);
    if(user?.isAdmin) addNotification('Company bank information updated.');
  };

  const getAllTransactions = useCallback(async () => transactionService.getAllTransactions(), []);
  const getAllUsers = useCallback(async () => authService.getAllUsers(), []);
  const updateUserVerification = async (userId: string, isVerified: boolean) => {
    await authService.updateUserInfo({ id: userId, isVerified });
    refreshUser();
  };

  const updateUserActiveStatus = async (userId: string, isActive: boolean) => {
    await authService.updateUserActiveStatus(userId, isActive);
    await refreshUser();
  };

  const value = {
    balance: displayedBalance,
    accountMode,
    toggleAccountMode,
    depositHistory,
    withdrawalHistory,
    notifications,
    companyBankInfoList: companyBankInfoList,
    isLoadingTransactions,
    transactionError,
    addNotification,
    markNotificationAsRead,
    deposit,
    withdraw,
    transfer,
    updateDepositStatus,
    updateWithdrawalStatus,
    setCompanyBankInfoList: updateCompanyBankInfoList,
    getAllTransactions,
    getAllUsers,
    updateUserVerification,
    updateUserActiveStatus,
    adminUpdateUserBalance,
    adminCreateUser,
    deleteUser,
    refreshLiveBalance,
  };

  return <TransactionContext.Provider value={value}>{children}</TransactionContext.Provider>;
};

export const useTransactions = (): TransactionContextType => {
  const context = useContext(TransactionContext);
  if (context === undefined) {
    throw new Error('useTransactions must be used within a TransactionProvider');
  }
  return context;
};
