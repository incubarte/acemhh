/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The ledger lives in supabase/functions/_shared so the Deno webhook can
  // import the same file. Compiling outside this app's directory needs this.
  experimental: { externalDir: true },
};

export default nextConfig;
