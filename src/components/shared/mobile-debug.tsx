"use client";

import { useEffect } from "react";

type ErudaWindow = Window & {
  eruda?: { init: () => void; _isInit?: boolean };
};

export function MobileDebug() {
  useEffect(() => {
    // Belt-and-braces: even if the public flag was somehow set in a
    // production build, refuse to load the third-party debugger.
    if (process.env.NODE_ENV === "production") return;
    if (process.env.NEXT_PUBLIC_ENABLE_MOBILE_DEBUG !== "true") return;
    const params = new URLSearchParams(window.location.search);
    const cookieEnabled = document.cookie
      .split(";")
      .some((c) => c.trim().startsWith("mobile_debug=1"));
    if (params.get("debug") !== "1" && !cookieEnabled) return;
    document.cookie = "mobile_debug=1; Path=/; Max-Age=86400; SameSite=Lax";

    const w = window as ErudaWindow;
    if (w.eruda?._isInit) return;

    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/eruda@3.4.1/eruda.js";
    script.async = true;
    script.onload = () => {
      if (!w.eruda) return;
      w.eruda.init();
      w.eruda._isInit = true;
    };
    document.body.appendChild(script);
  }, []);

  return null;
}
