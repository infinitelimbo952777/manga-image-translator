import React from "react";
import { Icon } from "@iconify/react";

export type LabeledToggleProps = {
  id: string;
  label: string;
  icon: string;
  title?: string;
  value: boolean;
  onChange: (value: boolean) => void;
};

export const LabeledToggle: React.FC<LabeledToggleProps> = ({
  id,
  label,
  icon,
  title,
  value,
  onChange,
}) => {
  return (
    <div className="flex flex-col">
      <label htmlFor={id} className="mb-1 text-sm text-gray-700 font-medium">
        {label}
      </label>
      <div className="relative">
        <Icon
          icon={icon}
          className="absolute top-1/2 left-2 -translate-y-1/2 text-gray-400"
        />
        <button
          id={id}
          type="button"
          title={title}
          onClick={() => onChange(!value)}
          className="w-full appearance-none border border-gray-300 rounded pl-8 pr-3 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none flex items-center justify-between"
        >
          <span>{value ? "开启" : "关闭"}</span>
          <span
            className={`relative inline-flex h-4 w-8 shrink-0 items-center rounded-full transition-colors ${
              value ? "bg-blue-600" : "bg-gray-300"
            }`}
          >
            <span
              className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
                value ? "translate-x-4" : "translate-x-0.5"
              }`}
            />
          </span>
        </button>
      </div>
    </div>
  );
};
