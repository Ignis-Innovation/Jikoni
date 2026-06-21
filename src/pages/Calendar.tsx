import { useState } from "react";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { PageHeader, Card, Button, Badge } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { HOLIDAYS, holidayOn, isoDate } from "@/lib/holidays";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function Calendar() {
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });

  const first = new Date(cursor.year, cursor.month, 1);
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const leadingBlanks = first.getDay(); // 0 = Sunday
  const cells: (number | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const todayKey = isoDate(today);
  const upcoming = HOLIDAYS.filter((h) => h.date >= todayKey);
  const monthHolidays = HOLIDAYS.filter((h) => {
    const d = new Date(h.date + "T00:00:00");
    return d.getFullYear() === cursor.year && d.getMonth() === cursor.month;
  });

  const shift = (delta: number) => {
    const m = cursor.month + delta;
    setCursor({ year: cursor.year + Math.floor(m / 12), month: ((m % 12) + 12) % 12 });
  };

  return (
    <div className="w-full">
      <PageHeader
        eyebrow="Company"
        icon={CalendarDays}
        title="Calendar"
        subtitle="Kenyan public holidays for the year."
        actions={
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" onClick={() => setCursor({ year: today.getFullYear(), month: today.getMonth() })}>Today</Button>
            <Button variant="outline" size="icon" onClick={() => shift(1)} aria-label="Next month"><ChevronRight className="h-4 w-4" /></Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <Card className="p-4">
          <h2 className="mb-3 text-base font-semibold text-foreground">{MONTHS[cursor.month]} {cursor.year}</h2>
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((w) => (
              <div key={w} className="pb-1 text-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{w}</div>
            ))}
            {cells.map((day, i) => {
              if (day === null) return <div key={`b${i}`} className="aspect-square" />;
              const key = isoDate(new Date(cursor.year, cursor.month, day));
              const holiday = holidayOn(key);
              const isToday = key === todayKey;
              return (
                <div
                  key={key}
                  className={cn(
                    "flex aspect-square flex-col rounded-lg border p-1.5 text-left",
                    holiday ? "border-primary/40 bg-primary/5" : "border-border bg-card",
                    isToday && "ring-2 ring-ring"
                  )}
                >
                  <span className={cn("text-xs font-medium", holiday ? "text-primary" : "text-foreground")}>{day}</span>
                  {holiday && <span className="mt-0.5 line-clamp-2 text-[10px] leading-tight text-primary/80">{holiday.name}</span>}
                </div>
              );
            })}
          </div>
          {monthHolidays.length === 0 && (
            <p className="mt-3 text-xs text-muted-foreground">No public holidays this month.</p>
          )}
        </Card>

        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Upcoming holidays</h2>
          <div className="space-y-2">
            {upcoming.length === 0 && <p className="text-xs text-muted-foreground">No more holidays this year.</p>}
            {upcoming.map((h) => {
              const d = new Date(h.date + "T00:00:00");
              return (
                <button
                  key={h.date}
                  onClick={() => setCursor({ year: d.getFullYear(), month: d.getMonth() })}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left hover:bg-muted/50"
                >
                  <span className="text-sm font-medium text-foreground">{h.name}</span>
                  <Badge tone="blue">{d.toLocaleDateString("en-KE", { day: "numeric", month: "short" })}</Badge>
                </button>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
