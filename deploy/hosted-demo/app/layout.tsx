import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Smart Trolley Management Demo",
  description:
    "Private interactive trolley workflow demo with a connected persistent database.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
