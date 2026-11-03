/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
};
export default nextConfig;
