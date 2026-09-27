import './globals.css';

const ICON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23F5B301'/%3E%3Ctext x='16' y='23' font-family='Arial,sans-serif' font-size='20' font-weight='700' text-anchor='middle' fill='%23172033'%3EK%3C/text%3E%3C/svg%3E";

export const metadata = {
  title: 'Kere Shop — Your Small Mobile Shop',
  description:
    'Turn social traffic, customer conversations and voice notes into an organized storefront, CRM and dashboard.',
  icons: { icon: ICON },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-bg text-ink font-sans text-sm antialiased">{children}</body>
    </html>
  );
}