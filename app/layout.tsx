import type { Metadata } from 'next';
import { Manrope } from 'next/font/google';
import { env } from 'cloudflare:workers';
import './globals.css';

const manrope = Manrope({ variable: '--font-manrope', subsets: ['latin'] });

const title = 'Worldspot — Put your brand on the world';
const description = 'Bid for one exclusive advertising spot in every country on the world map.';

export function generateMetadata(): Metadata {
  const configured = env.PUBLIC_APP_ORIGIN;
  const origin = configured?.startsWith('https://') ? configured : 'http://localhost:3000';
  const image = new URL('/og.jpg', origin).toString();
  return {
    metadataBase: new URL(origin),
    title,
    description,
    icons: {
      icon: [{ url: '/favicon.png', type: 'image/png', sizes: '64x64' }],
      apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
    },
    openGraph: { title, description, images: [{ url: image, width: 1200, height: 630, alt: 'Worldspot — Put your brand on the world' }] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={manrope.variable}>{children}</body></html>;
}
