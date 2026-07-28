/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    // Logos may be hosted anywhere (Cloudinary, an S3 bucket, a pasted URL), and
    // they are rendered with a plain <img> rather than next/image, so no remote
    // patterns need allow-listing here.
    unoptimized: true,
  },
};

export default nextConfig;
