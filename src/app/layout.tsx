import '../styles/globals.css';

export const metadata = {
  title: 'Storemanager',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" data-accent="coral">
      <body>{children}</body>
    </html>
  );
}
