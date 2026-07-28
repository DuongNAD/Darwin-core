import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const imageUrl = `${protocol}://${host}/og.png`;

  return {
    title: "DARWIN LAB — Chọn lọc tự nhiên",
    description:
      "Mô phỏng tương tác về tốc độ, kích thước, cảm nhận và chọn lọc tự nhiên.",
    openGraph: {
      title: "DARWIN LAB — Chọn lọc tự nhiên",
      description:
        "Quan sát quần thể tiến hóa dưới áp lực thức ăn, năng lượng và săn mồi.",
      type: "website",
      images: [{ url: imageUrl, width: 1536, height: 1024 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "DARWIN LAB — Chọn lọc tự nhiên",
      description:
        "Quan sát quần thể tiến hóa dưới áp lực thức ăn, năng lượng và săn mồi.",
      images: [imageUrl],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
