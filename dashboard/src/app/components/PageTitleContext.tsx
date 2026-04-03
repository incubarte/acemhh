"use client";

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";

type PageHeaderState = {
  title: string;
  onBack: (() => void) | null;
};

const PageTitleContext = createContext<{
  state: PageHeaderState;
  setTitle: (t: string) => void;
  setOnBack: (fn: (() => void) | null) => void;
}>({
  state: { title: "", onBack: null },
  setTitle: () => {},
  setOnBack: () => {},
});

export function PageTitleProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PageHeaderState>({ title: "", onBack: null });
  const setTitle = useCallback((t: string) => setState(prev => ({ ...prev, title: t })), []);
  const setOnBack = useCallback((fn: (() => void) | null) => setState(prev => ({ ...prev, onBack: fn })), []);
  return (
    <PageTitleContext.Provider value={{ state, setTitle, setOnBack }}>
      {children}
    </PageTitleContext.Provider>
  );
}

export function usePageTitle(title: string, onBack?: () => void) {
  const { setTitle, setOnBack } = useContext(PageTitleContext);
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    setTitle(title);
    setOnBack(onBackRef.current ?? null);
    return () => {
      setTitle("");
      setOnBack(null);
    };
  }, [title, setTitle, setOnBack]);
}

export function usePageHeader() {
  return useContext(PageTitleContext).state;
}
