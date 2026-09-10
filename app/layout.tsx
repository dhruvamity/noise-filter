import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BTC / USDT · Market Regime',
  description: 'A live, research-backed BTCUSDT perpetual market activity terminal.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
