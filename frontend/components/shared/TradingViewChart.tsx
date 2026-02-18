"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    TradingView: any;
  }
}

interface TradingViewChartProps {
  symbol?: string;
  interval?: string;
  theme?: "light" | "dark";
  height?: number;
}

export default function TradingViewChart({
  symbol = "NASDAQ:TSLA",
  interval = "D",
  theme = "light",
  height = 500,
}: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scriptLoaded = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;

    // Clear any existing content
    containerRef.current.innerHTML = "";

    const containerId = `tradingview_${Math.random().toString(36).slice(2)}`;
    const widgetDiv = document.createElement("div");
    widgetDiv.id = containerId;
    containerRef.current.appendChild(widgetDiv);

    function createWidget() {
      if (!window.TradingView) return;
      new window.TradingView.widget({
        autosize: true,
        symbol,
        interval,
        timezone: "Etc/UTC",
        theme,
        style: "1",
        locale: "en",
        toolbar_bg: "#ffffff",
        enable_publishing: false,
        allow_symbol_change: false,
        hide_top_toolbar: false,
        hide_legend: false,
        save_image: false,
        container_id: containerId,
        studies: ["BB@tv-basicstudies"],
        withdateranges: true,
        details: false,
        hotlist: false,
        calendar: false,
      });
    }

    if (window.TradingView) {
      createWidget();
    } else if (!scriptLoaded.current) {
      scriptLoaded.current = true;
      const script = document.createElement("script");
      script.src = "https://s3.tradingview.com/tv.js";
      script.async = true;
      script.onload = createWidget;
      document.head.appendChild(script);
    } else {
      // Script is loading, wait for it
      const check = setInterval(() => {
        if (window.TradingView) {
          clearInterval(check);
          createWidget();
        }
      }, 100);
      return () => clearInterval(check);
    }
  }, [symbol, interval, theme]);

  return (
    <div
      ref={containerRef}
      style={{ height }}
      className="w-full border rounded-lg overflow-hidden"
    />
  );
}
