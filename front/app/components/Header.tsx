import React, { useState } from "react";
import { Icon } from "@iconify/react";
import { Disclosure } from "@headlessui/react";

type Props = {};

export const Header: React.FC<Props> = () => {
  const [phase, setPhase] = useState<"idle" | "quitting" | "done">("idle");

  const handleQuit = async () => {
    const confirmed = window.confirm(
      "确定要退出吗?\n\n将关闭翻译服务(worker、后端)和本页面服务,并释放显存/内存。\n重新启动:双击项目目录下的 start_webui_silent.bat"
    );
    if (!confirmed) return;
    setPhase("quitting");
    try {
      // 后端会在响应后关闭自己、worker 和前端服务
      await fetch("/api/shutdown", { method: "POST" });
    } catch {
      // 服务可能已先行关闭,视同成功
    }
    setPhase("done");
    // 浏览器安全限制:网页无法关闭不是由脚本打开的标签页,这里的
    // window.close() 只在标签页恰好是脚本打开时生效;用户手动打开的
    // 标签页会被浏览器静默忽略,由下方遮罩提示手动关闭。
    window.close();
  };

  return (
    <>
      <Disclosure as="nav" className="bg-white shadow">
        <div className="mx-auto max-w-7xl px-2 sm:px-6 lg:px-8">
          <div className="relative flex h-16 justify-between">
            <div className="flex flex-1 items-center justify-center sm:items-stretch sm:justify-start">
              <div className="flex shrink-0 items-center text-teal-500">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  className="h-8 w-auto text-teal-500"
                >
                  <path d="M11.25 4.533A9.707 9.707 0 0 0 6 3a9.735 9.735 0 0 0-3.25.555.75.75 0 0 0-.5.707v14.25a.75.75 0 0 0 1 .707A8.237 8.237 0 0 1 6 18.75c1.995 0 3.823.707 5.25 1.886V4.533ZM12.75 20.636A8.214 8.214 0 0 1 18 18.75c.966 0 1.89.166 2.75.47a.75.75 0 0 0 1-.708V4.262a.75.75 0 0 0-.5-.707A9.735 9.735 0 0 0 18 3a9.707 9.707 0 0 0-5.25 1.533v16.103Z" />
                </svg>
              </div>
              <div className="sm:ml-6 sm:flex sm:space-x-8">
                <a
                  href="/"
                  className="inline-flex items-center px-1 pt-1 font-medium text-gray-900"
                >
                  漫画图片翻译器
                </a>
              </div>
            </div>
            <div className="flex items-center">
              <button
                type="button"
                onClick={handleQuit}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 border border-red-200 rounded-md hover:bg-red-50 hover:border-red-300 transition-colors"
              >
                <Icon icon="carbon:power" className="w-4 h-4" />
                退出程序
              </button>
            </div>
          </div>
        </div>
      </Disclosure>

      {/* 正在退出遮罩 */}
      {phase !== "idle" && (
        <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center">
          <div className="bg-white rounded-lg p-8 max-w-md text-center">
            <Icon
              icon={phase === "done" ? "carbon:checkmark-outline" : "carbon:power"}
              className={`w-10 h-10 mx-auto mb-3 ${phase === "done" ? "text-green-500" : "text-red-500"}`}
            />
            <div className="text-lg font-medium text-gray-800">
              {phase === "done" ? "服务已全部退出" : "正在退出…"}
            </div>
            {phase === "done" && (
              <div className="mt-2 text-sm text-gray-600">
                浏览器不允许网页自动关闭标签页,请按
                <kbd className="mx-1 px-1.5 py-0.5 text-xs font-semibold bg-gray-100 border border-gray-300 rounded">
                  Ctrl+W
                </kbd>
                关闭此标签页。
              </div>
            )}
            <div className="mt-3 text-xs text-gray-400">
              重新启动:双击项目目录下的 start_webui_silent.bat
            </div>
          </div>
        </div>
      )}
    </>
  );
};
