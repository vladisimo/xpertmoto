"use client";
import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row gap-4",
        month: "flex flex-col gap-3",
        month_caption: "flex justify-center pt-1 relative items-center",
        caption_label: "text-sm font-semibold",
        // z-10 keeps the prev/next buttons above the month-caption divs.
        // RDP renders <Nav> as the first child of the months container, so
        // the later, position:relative captions would otherwise paint on top
        // of these absolutely-positioned buttons and swallow the clicks.
        nav: "flex items-center gap-1 absolute inset-x-1 top-1 justify-between z-10",
        button_previous: cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "h-7 w-7",
        ),
        button_next: cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "h-7 w-7",
        ),
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday:
          "text-muted-foreground rounded-md w-8 font-normal text-[0.8rem]",
        week: "flex w-full mt-1",
        day: "relative p-0 text-center text-sm focus-within:relative focus-within:z-20",
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-8 w-8 p-0 font-normal",
        ),
        range_middle:
          "bg-primary/15 [&>button]:!bg-transparent [&>button]:!text-foreground [&>button]:rounded-none hover:[&>button]:!bg-primary/25",
        range_start:
          "[&>button]:!bg-primary [&>button]:!text-primary-foreground [&>button]:rounded-l-md [&>button]:rounded-r-none hover:[&>button]:!bg-primary",
        range_end:
          "[&>button]:!bg-primary [&>button]:!text-primary-foreground [&>button]:rounded-r-md [&>button]:rounded-l-none hover:[&>button]:!bg-primary",
        today: "[&>button]:font-bold",
        outside: "[&>button]:text-muted-foreground [&>button]:opacity-60",
        disabled: "[&>button]:text-muted-foreground [&>button]:opacity-40",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, ...chevronProps }) =>
          orientation === "left" ? (
            <ChevronLeft className="h-4 w-4" {...chevronProps} />
          ) : (
            <ChevronRight className="h-4 w-4" {...chevronProps} />
          ),
      }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
