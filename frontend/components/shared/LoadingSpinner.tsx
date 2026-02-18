"use client";

export default function LoadingSpinner({
  size = "md",
  text,
}: {
  size?: "sm" | "md" | "lg";
  text?: string;
}) {
  const sizeMap = { sm: "h-4 w-4", md: "h-6 w-6", lg: "h-8 w-8" };

  return (
    <div className="flex flex-col items-center justify-center gap-2">
      <div
        className={`${sizeMap[size]} animate-spin rounded-full border-2 border-border border-t-fg`}
      />
      {text && <p className="text-xs text-muted">{text}</p>}
    </div>
  );
}
