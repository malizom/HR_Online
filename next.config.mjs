/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
  poweredByHeader: false,
  // Security headers (design doc 08 §4). Sign-in redirects to login.microsoftonline.com are navigations, not fetches,
  // so CSP stays "self". Dev needs 'unsafe-eval' for React refresh only.
  async headers() {
    const dev = process.env.NODE_ENV !== "production";
    const csp = [
      "default-src 'self'", `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`, "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:", "font-src 'self' data:", `connect-src 'self'${dev ? " ws:" : ""}`,
      "frame-ancestors 'none'", "form-action 'self' https://login.microsoftonline.com", "base-uri 'self'", "object-src 'none'",
    ].join("; ");
    return [{ source: "/:path*", headers: [
      { key: "Content-Security-Policy", value: csp },
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ] }];
  },
};
export default nextConfig;
