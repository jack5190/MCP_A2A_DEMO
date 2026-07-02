import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AutoA2A — MCP + A2A DeFi Automation Demo",
  description: "Configure agents that automate DeFi actions via the Model Context Protocol (MCP) and Agent-to-Agent (A2A) orchestration.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
