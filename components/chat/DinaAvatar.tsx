type Size = "sm" | "md" | "lg" | "xl";

const SIZE_CLASS: Record<Size, string> = {
  sm: "h-7 w-7",
  md: "h-9 w-9",
  lg: "h-14 w-14",
  xl: "h-24 w-24",
};

export function DinaAvatar({
  size = "md",
  className = "",
  alt = "Dina",
}: {
  size?: Size;
  className?: string;
  alt?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static brand asset; matches app image usage
    <img
      src="/dina-avatar.jpg?v=2"
      alt={alt}
      width={size === "xl" ? 96 : size === "lg" ? 56 : size === "md" ? 36 : 28}
      height={size === "xl" ? 96 : size === "lg" ? 56 : size === "md" ? 36 : 28}
      className={`${SIZE_CLASS[size]} shrink-0 rounded-full object-cover ring-1 ring-black/5 dark:ring-white/10 ${className}`}
      draggable={false}
    />
  );
}
