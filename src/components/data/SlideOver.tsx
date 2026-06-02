import { useEffect } from "react";
import { X } from "lucide-react";

/** Slide-over panel on desktop, full-screen on mobile (PRD §1.3). */
export function SlideOver({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-zinc-900/30" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-xl sm:max-w-md">
        <div className="flex h-14 items-center justify-between border-b border-zinc-200 px-5">
          <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}
