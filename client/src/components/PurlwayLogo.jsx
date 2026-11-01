// Purlway mark: two conversation loops woven together as a continuous thread.
export default function PurlwayLogo({ size = 24 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M8.25 4.5h7.5a4.25 4.25 0 0 1 0 8.5h-1.4" />
      <path d="m8.25 4.5-3 2.25v2" />
      <path d="M15.75 19.5h-7.5a4.25 4.25 0 0 1 0-8.5h1.4" />
      <path d="m15.75 19.5 3-2.25v-2" />
      <path d="m9 12 2.15 2.15L15 10.3" />
    </svg>
  );
}
