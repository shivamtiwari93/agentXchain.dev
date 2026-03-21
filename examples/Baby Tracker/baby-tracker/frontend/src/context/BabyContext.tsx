import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import api from '../lib/api';
import { useAuth } from './AuthContext';

export interface Baby {
  id: string;
  name: string;
  date_of_birth: string;
  gender: string;
  created_by_user_id: string;
  created_at: string;
}

interface BabyContextType {
  babies: Baby[];
  selectedBaby: Baby | null;
  setSelectedBabyId: (id: string) => void;
  fetchBabies: () => Promise<void>;
  isLoading: boolean;
}

const BabyContext = createContext<BabyContextType | undefined>(undefined);

export function BabyProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  const [babies, setBabies] = useState<Baby[]>([]);
  const [selectedBabyId, setSelectedBabyIdState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchBabies = async () => {
    if (!isAuthenticated) return;
    try {
      setIsLoading(true);
      const response = await api.get('/babies');
      const fetchedBabies = response.data.babies;
      setBabies(fetchedBabies);
      
      if (fetchedBabies.length > 0) {
        const storedId = localStorage.getItem('selectedBabyId');
        if (storedId && fetchedBabies.some((b: Baby) => b.id === storedId)) {
          setSelectedBabyIdState(storedId);
        } else {
          setSelectedBabyIdState(fetchedBabies[0].id);
          localStorage.setItem('selectedBabyId', fetchedBabies[0].id);
        }
      } else {
        setSelectedBabyIdState(null);
      }
    } catch (e) {
      console.error('Failed to fetch babies', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchBabies();
    } else {
      setBabies([]);
      setSelectedBabyIdState(null);
      setIsLoading(false);
    }
  }, [isAuthenticated]);

  const setSelectedBabyId = (id: string) => {
    setSelectedBabyIdState(id);
    localStorage.setItem('selectedBabyId', id);
  };

  const selectedBaby = babies.find(b => b.id === selectedBabyId) || null;

  return (
    <BabyContext.Provider value={{ babies, selectedBaby, setSelectedBabyId, fetchBabies, isLoading }}>
      {children}
    </BabyContext.Provider>
  );
}

export function useBaby() {
  const context = useContext(BabyContext);
  if (context === undefined) {
    throw new Error('useBaby must be used within a BabyProvider');
  }
  return context;
}
