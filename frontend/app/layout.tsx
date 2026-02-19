import type { Metadata } from "next";
import "./globals.css";
import ClientProviders from "@/contexts/ClientProviders";
import Navbar from "@/components/shared/Navbar";
import Footer from "@/components/shared/Footer";
import NetworkCheck from "@/components/wallet/NetworkCheck";
import WalletModal from "@/components/wallet/WalletModal";
import TransactionToast from "@/components/shared/TransactionToast";
import ErrorBoundary from "@/components/shared/ErrorBoundary";

export const metadata: Metadata = {
  title: "HoodGap | Insurance doesn't have to be boring",
  description: "Protect your portfolio against weekend price gaps on Robinhood Chain.",
  icons: {
    icon: "/icon.png",
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="flex flex-col min-h-screen">
        <ErrorBoundary>
          <ClientProviders>
            <NetworkCheck />
            <WalletModal />
            <Navbar />
            <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
              {children}
            </main>
            <Footer />
            <TransactionToast />
          </ClientProviders>
        </ErrorBoundary>
      </body>
    </html>
  );
}
