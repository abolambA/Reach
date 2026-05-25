import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Reach — your LinkedIn network, mapped',
  description: 'Map the network. Find the path. Send what matters.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
