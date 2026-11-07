import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_MONITORING_RELEASE: /^[a-f0-9]{40}$/i.test(process.env.VERCEL_GIT_COMMIT_SHA ?? "") ? process.env.VERCEL_GIT_COMMIT_SHA! : "" },
  turbopack: {
    root: projectRoot,
  },
  outputFileTracingIncludes: {
    "/**": ["./content/policies/**", "./prisma/schema.prisma", "./public/images/placeholder-listing.png"],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
      {
        protocol: "https",
        hostname: "ik.imagekit.io",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "picsum.photos",
      },
      {
        protocol: "https",
        hostname: "morrisregister.co.uk",
      },
      {
        protocol: "https",
        hostname: "**.supabase.co",
        pathname: "/storage/v1/object/public/user-avatars/**",
      },
    ],
  },
};

export default nextConfig;
