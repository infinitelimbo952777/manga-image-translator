import type { Route } from "./+types/home";
import { App } from "../App";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "漫画图片翻译" },
    {
      name: "description",
      content: "上传漫画图片,自动检测文字并翻译成目标语言",
    },
  ];
}

export default function Home() {
  return <App />;
}
