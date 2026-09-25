import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "슈퍼공익 | SUPER GONGIK",
    short_name: "슈퍼공익",
    description: "사회복무요원을 위한 개인 복무 관리 도구",
    start_url: "/",
    display: "standalone",
    background_color: "#f2f4f7",
    theme_color: "#f2f4f7",
    lang: "ko",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
