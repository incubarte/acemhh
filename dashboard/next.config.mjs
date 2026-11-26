/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The ledger lives in supabase/functions/_shared so the Deno webhook can
  // import the same file. Compiling outside this app's directory needs this.
  experimental: { externalDir: true },
  // The attendance screen used to live at /training-sessions-beta while the
  // old one stayed at /training-sessions. The old one is gone and the new one
  // took its address; saved links and open tabs still land on it.
  async redirects() {
    return [
      { source: "/training-sessions-beta/:session", destination: "/training-sessions/:session", permanent: true },
      { source: "/api/training-sessions-beta/:session", destination: "/api/training-sessions/:session", permanent: false },
    ];
  },
};

export default nextConfig;
