"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { JapaneseProgressData } from "@/types/japanese";

interface UseJapaneseProgressReturn {
  data: JapaneseProgressData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useJapaneseProgress(): UseJapaneseProgressReturn {
  const [data, setData] = useState<JapaneseProgressData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/japanese/progress");
      if (!res.ok) {
        throw new Error(`Failed to fetch progress data (${res.status})`);
      }
      const json = (await res.json()) as JapaneseProgressData;
      if (mountedRef.current) {
        setData(json);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void fetchData();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
