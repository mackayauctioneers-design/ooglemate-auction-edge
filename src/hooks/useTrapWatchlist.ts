import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface WatchlistItem {
  listing_id: string;
  is_watching: boolean;
  is_pinned: boolean;
  notes: string | null;
}

export function useTrapWatchlist(listingId: string | null) {
  const { user } = useAuth();
  const [isWatching, setIsWatching] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!listingId || !user) {
      setIsWatching(false);
      setIsPinned(false);
      setNotes(null);
      return;
    }

    const fetchWatchlistStatus = async () => {
      const { data, error } = await supabase
        .from('user_watchlist')
        .select('is_watching, is_pinned, notes')
        .eq('user_id', user.id)
        .eq('listing_id', listingId)
        .maybeSingle();

      if (error) {
        console.error('Error fetching watchlist status:', error);
        return;
      }

      if (data) {
        setIsWatching(data.is_watching ?? false);
        setIsPinned(data.is_pinned ?? false);
        setNotes(data.notes);
      } else {
        setIsWatching(false);
        setIsPinned(false);
        setNotes(null);
      }
    };

    fetchWatchlistStatus();
  }, [listingId, user]);

  const toggleWatch = useCallback(async () => {
    if (!listingId || !user) return;
    
    setLoading(true);
    const newValue = !isWatching;

    const { error } = await supabase
      .from('user_watchlist')
      .upsert(
        {
          user_id: user.id,
          listing_id: listingId,
          is_watching: newValue,
          is_pinned: isPinned,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,listing_id' }
      );

    if (error) {
      console.error('Error updating watch status:', error);
    } else {
      setIsWatching(newValue);
    }
    setLoading(false);
  }, [listingId, user, isWatching, isPinned]);

  const togglePin = useCallback(async () => {
    if (!listingId || !user) return;
    
    setLoading(true);
    const newValue = !isPinned;

    const { error } = await supabase
      .from('user_watchlist')
      .upsert(
        {
          user_id: user.id,
          listing_id: listingId,
          is_watching: isWatching || newValue, // Auto-watch when pinning
          is_pinned: newValue,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,listing_id' }
      );

    if (error) {
      console.error('Error updating pin status:', error);
    } else {
      setIsPinned(newValue);
      if (newValue && !isWatching) {
        setIsWatching(true); // Auto-watch when pinning
      }
    }
    setLoading(false);
  }, [listingId, user, isWatching, isPinned]);

  const updateNotes = useCallback(async (newNotes: string) => {
    if (!listingId || !user) return;
    
    setLoading(true);

    const { error } = await supabase
      .from('user_watchlist')
      .upsert(
        {
          user_id: user.id,
          listing_id: listingId,
          is_watching: isWatching || true, // Auto-watch when adding notes
          is_pinned: isPinned,
          notes: newNotes || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,listing_id' }
      );

    if (error) {
      console.error('Error updating notes:', error);
    } else {
      setNotes(newNotes || null);
      if (!isWatching) {
        setIsWatching(true); // Auto-watch when adding notes
      }
    }
    setLoading(false);
  }, [listingId, user, isWatching, isPinned]);

  return {
    isWatching,
    isPinned,
    notes,
    loading,
    toggleWatch,
    togglePin,
    updateNotes,
  };
}

// Hook to fetch all watchlist items for a user
export function useWatchlistItems() {
  const { user } = useAuth();
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setItems([]);
      setLoading(false);
      return;
    }

    const fetchItems = async () => {
      const { data, error } = await supabase
        .from('user_watchlist')
        .select('listing_id, is_watching, is_pinned, notes')
        .eq('user_id', user.id)
        .eq('is_watching', true);

      if (error) {
        console.error('Error fetching watchlist items:', error);
      } else {
        setItems(data || []);
      }
      setLoading(false);
    };

    fetchItems();
  }, [user]);

  return { items, loading };
}
