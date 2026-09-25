import { CalendarDays } from "lucide-react";
import type { InputHTMLAttributes } from "react";

import { formatDateInputDisplay } from "@/lib/date-display";

/**
 * Native date input with a consistent Korean readout. The native control
 * stays in place (keyboard entry, iOS wheel, Android picker all keep working);
 * only its unfocused text is replaced by a formatted label so an empty field
 * never renders as a blank capsule or `mm/dd/yyyy`.
 */
export function DateInput({
  value,
  onValueChange,
  placeholder = "날짜 선택",
  className,
  ...props
}: Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "onChange" | "placeholder"
> & {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
}) {
  const display = formatDateInputDisplay(value);
  return (
    <span
      className={className ? `date-input ${className}` : "date-input"}
      data-empty={display ? undefined : ""}
    >
      <CalendarDays aria-hidden="true" className="date-input__icon" size={18} />
      <input
        {...props}
        type="date"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
      />
      <span aria-hidden="true" className="date-input__display">
        {display || placeholder}
      </span>
    </span>
  );
}
