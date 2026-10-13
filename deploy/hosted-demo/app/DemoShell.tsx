"use client";
import { useEffect } from "react";
export default function DemoShell() {
  useEffect(() => {
    const script = document.createElement("script");
    script.type = "module";
    script.src = "/app.js";
    document.body.appendChild(script);
    return () => {
      script.remove();
    };
  }, []);
  return (
    <>
      <div id="app" />
      <div id="notice" role="status" aria-live="polite" />
    </>
  );
}
