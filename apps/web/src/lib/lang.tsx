import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

export type Lang = "vi" | "en" | "th";

const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({
  lang: "vi",
  setLang: () => {},
});

const VALID: Lang[] = ["vi", "en", "th"];

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      const url = new URLSearchParams(window.location.search).get("lang") as Lang | null;
      if (url && VALID.includes(url)) {
        localStorage.setItem("lang", url);
        return url;
      }
      return (localStorage.getItem("lang") as Lang) || "vi";
    } catch { return "vi"; }
  });

  function setLang(l: Lang) {
    setLangState(l);
    try { localStorage.setItem("lang", l); } catch {}
  }

  return (
    <LangContext.Provider value={{ lang, setLang }}>
      {children}
    </LangContext.Provider>
  );
}

export function useLang() {
  return useContext(LangContext);
}
